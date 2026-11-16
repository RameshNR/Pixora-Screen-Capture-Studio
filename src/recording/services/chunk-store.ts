import { deleteOne, getAll, getOne, promisify, putOne, withStores } from '@/shared/storage/idb';
import { isStorageUnavailable } from '@/shared/utils/errors';
import type { RecordingConfig, RecordingMode } from '@/shared/types';

/**
 * Recording chunks are persisted to IndexedDB as they arrive (every second), so memory use stays flat
 * for long recordings and a crash of the recording host does not lose the recording.
 */
export interface SessionMeta {
  sessionId: string;
  mode: RecordingMode;
  mimeType: string;
  startedAt: number;
  /** Active (non-paused) recording time, updated periodically for crash recovery. */
  activeMs: number;
  width: number;
  height: number;
  fps: number;
  config: RecordingConfig;
  sourceTitle?: string;
  sourceUrl?: string;
  notes: string[];
  hasMicrophone: boolean;
  hasSystemAudio: boolean;
}

interface ChunkRow {
  sessionId: string;
  seq: number;
  blob: Blob;
}

export async function saveSessionMeta(meta: SessionMeta): Promise<void> {
  await putOne('sessions', meta);
}

export async function getSessionMeta(sessionId: string): Promise<SessionMeta | undefined> {
  return getOne<SessionMeta>('sessions', sessionId);
}

export async function listSessionMetas(): Promise<SessionMeta[]> {
  return getAll<SessionMeta>('sessions');
}

export async function updateSessionActiveMs(sessionId: string, activeMs: number): Promise<void> {
  await withStores('sessions', 'readwrite', async (tx) => {
    const store = tx.objectStore('sessions');
    const meta = await promisify(store.get(sessionId) as IDBRequest<SessionMeta | undefined>);
    if (meta) store.put({ ...meta, activeMs });
  });
}

export async function appendChunk(sessionId: string, seq: number, blob: Blob): Promise<void> {
  const row: ChunkRow = { sessionId, seq, blob };
  await putOne('chunks', row);
}

export async function countChunks(sessionId: string): Promise<number> {
  return withStores('chunks', 'readonly', (tx) =>
    promisify(tx.objectStore('chunks').index('sessionId').count(IDBKeyRange.only(sessionId))),
  );
}

/**
 * Chunks kept in memory when Pixora's storage cannot be opened, so the recording is not lost (it is
 * then saved to Downloads). Keyed by session.
 */
const memoryChunks = new Map<string, Array<{ seq: number; blob: Blob }>>();

export function memoryChunksOf(sessionId: string): number {
  return memoryChunks.get(sessionId)?.length ?? 0;
}

/** Concatenates the chunks in order (stored ones, then any kept in memory). */
export async function assembleChunks(sessionId: string, mimeType: string): Promise<Blob> {
  let rows: Array<{ seq: number; blob: Blob }> = [];
  try {
    rows = await withStores('chunks', 'readonly', (tx) =>
      promisify(tx.objectStore('chunks').index('sessionId').getAll(IDBKeyRange.only(sessionId)) as IDBRequest<ChunkRow[]>),
    );
  } catch (err) {
    if (!memoryChunks.has(sessionId)) throw err;
  }
  rows = [...rows, ...(memoryChunks.get(sessionId) ?? [])];
  rows.sort((a, b) => a.seq - b.seq);
  return new Blob(rows.map((r) => r.blob), { type: mimeType });
}

export function dropMemoryChunks(sessionId: string): void {
  memoryChunks.delete(sessionId);
}

export async function deleteSession(sessionId: string): Promise<void> {
  memoryChunks.delete(sessionId);
  await deleteOne('chunks', IDBKeyRange.bound([sessionId, 0], [sessionId, Number.MAX_SAFE_INTEGER]));
  await deleteOne('sessions', sessionId);
}

/**
 * Serialises chunk writes (MediaRecorder can emit faster than IndexedDB commits) and surfaces the
 * first write error, e.g. QuotaExceededError.
 */
export class ChunkWriter {
  private seq = 0;
  private queue: Promise<void> = Promise.resolve();
  private failure: unknown = null;
  /** Writing to memory because storage is unavailable. */
  inMemory = false;
  bytesWritten = 0;

  constructor(private readonly sessionId: string, private readonly onError: (err: unknown) => void) {}

  write(blob: Blob): void {
    if (blob.size === 0 || this.failure) return;
    const seq = this.seq++;
    this.bytesWritten += blob.size;
    const keep = () => {
      const list = memoryChunks.get(this.sessionId) ?? [];
      list.push({ seq, blob });
      memoryChunks.set(this.sessionId, list);
    };
    if (this.inMemory) {
      keep();
      return;
    }
    this.queue = this.queue.then(() =>
      appendChunk(this.sessionId, seq, blob).catch((err: unknown) => {
        // Storage cannot be opened: keep recording in memory (saved to Downloads at the end).
        if (isStorageUnavailable(err)) {
          this.inMemory = true;
          keep();
          return;
        }
        if (!this.failure) {
          this.failure = err;
          this.onError(err);
        }
      }),
    );
  }

  get failed(): boolean {
    return this.failure !== null;
  }

  flush(): Promise<void> {
    return this.queue;
  }
}
