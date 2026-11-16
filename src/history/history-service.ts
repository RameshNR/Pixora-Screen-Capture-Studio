import type { CaptureKind, CaptureRecord } from '@/shared/types';
import { deleteOne, getAll, getOne, promisify, withStores } from '@/shared/storage/idb';
import { createId } from '@/shared/utils/misc';
import { AppError, toAppError } from '@/shared/utils/errors';

export type HistoryFilter = 'all' | CaptureKind;
export type HistorySort = 'newest' | 'oldest' | 'name' | 'size';

export interface NewCapture extends Omit<CaptureRecord, 'id' | 'createdAt' | 'updatedAt' | 'size'> {
  id?: string;
}

/** Persists a capture (metadata + payload) atomically. */
export async function addCapture(input: NewCapture, blob: Blob): Promise<CaptureRecord> {
  const now = Date.now();
  const record: CaptureRecord = {
    ...input,
    id: input.id ?? createId(input.kind === 'video' ? 'v_' : 's_'),
    size: blob.size,
    createdAt: now,
    updatedAt: now,
  };
  try {
    await withStores(['captures', 'blobs'], 'readwrite', (tx) => {
      tx.objectStore('captures').put(record);
      tx.objectStore('blobs').put(blob, record.id);
    });
  } catch (err) {
    const code = toAppError(err).code;
    throw new AppError(code === 'insufficient-storage' || code === 'storage-unavailable' ? code : 'export-failed', String(err));
  }
  return record;
}

export async function getCapture(id: string): Promise<CaptureRecord | undefined> {
  return getOne<CaptureRecord>('captures', id);
}

export async function getCaptureBlob(id: string): Promise<Blob | undefined> {
  return getOne<Blob>('blobs', id);
}

export async function updateCapture(id: string, patch: Partial<Omit<CaptureRecord, 'id'>>, blob?: Blob): Promise<CaptureRecord> {
  return withStores(['captures', 'blobs'], 'readwrite', async (tx) => {
    const store = tx.objectStore('captures');
    const existing = await promisify(store.get(id) as IDBRequest<CaptureRecord | undefined>);
    if (!existing) throw new AppError('unknown', `Capture ${id} not found`);
    const next: CaptureRecord = { ...existing, ...patch, id, updatedAt: Date.now(), ...(blob ? { size: blob.size } : {}) };
    store.put(next);
    if (blob) tx.objectStore('blobs').put(blob, id);
    return next;
  });
}

export async function deleteCapture(id: string): Promise<void> {
  // A flow also owns its images (and their kept originals).
  const flow = await getOne<{ items: Array<{ id: string }>; deleted?: Array<{ id: string }> }>('flows', id).catch(() => undefined);
  await withStores(['captures', 'blobs', 'flows'], 'readwrite', (tx) => {
    tx.objectStore('captures').delete(id);
    tx.objectStore('blobs').delete(id);
    tx.objectStore('blobs').delete(`orig:${id}`);
    for (const item of [...(flow?.items ?? []), ...(flow?.deleted ?? [])]) {
      tx.objectStore('captures').delete(item.id);
      tx.objectStore('blobs').delete(item.id);
      tx.objectStore('blobs').delete(`orig:${item.id}`);
    }
    if (flow) tx.objectStore('flows').delete(id);
  });
}

export async function listCaptures(filter: HistoryFilter = 'all', sort: HistorySort = 'newest'): Promise<CaptureRecord[]> {
  // Images that belong to a flow are listed inside the flow, not on their own.
  const all = (await getAll<CaptureRecord>('captures')).filter((c) => !c.flowId);
  return sortCaptures(filterCaptures(all, filter), sort);
}

export function filterCaptures(items: CaptureRecord[], filter: HistoryFilter): CaptureRecord[] {
  return filter === 'all' ? items : items.filter((c) => c.kind === filter);
}

export function sortCaptures(items: CaptureRecord[], sort: HistorySort): CaptureRecord[] {
  const copy = [...items];
  switch (sort) {
    case 'oldest':
      return copy.sort((a, b) => a.createdAt - b.createdAt);
    case 'name':
      return copy.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
    case 'size':
      return copy.sort((a, b) => b.size - a.size);
    case 'newest':
    default:
      return copy.sort((a, b) => b.createdAt - a.createdAt);
  }
}

/** Deletes captures older than `days`. Returns how many were removed. */
export async function applyRetention(days: number, now = Date.now()): Promise<number> {
  if (days <= 0) return 0;
  const cutoff = now - days * 86_400_000;
  const all = await getAll<CaptureRecord>('captures');
  const expired = all.filter((c) => c.createdAt < cutoff && !c.flowId);
  for (const c of expired) await deleteCapture(c.id);
  return expired.length;
}

export interface StorageUsage {
  captures: number;
  screenshots: number;
  videos: number;
  bytes: number;
  quota: number | null;
  usage: number | null;
}

export async function getStorageUsage(): Promise<StorageUsage> {
  const all = await getAll<CaptureRecord>('captures');
  let quota: number | null = null;
  let usage: number | null = null;
  try {
    const est = await navigator.storage?.estimate?.();
    quota = est?.quota ?? null;
    usage = est?.usage ?? null;
  } catch {
    /* estimate unavailable */
  }
  return {
    captures: all.length,
    screenshots: all.filter((c) => c.kind === 'screenshot').length,
    videos: all.filter((c) => c.kind === 'video').length,
    bytes: all.reduce((sum, c) => sum + c.size, 0),
    quota,
    usage,
  };
}

/** Removes orphaned recording chunks / sessions (temporary files). */
export async function clearTemporaryData(activeSessionId: string | null): Promise<void> {
  const sessions = await getAll<{ sessionId: string }>('sessions');
  for (const s of sessions) {
    if (s.sessionId === activeSessionId) continue;
    await deleteOne('sessions', s.sessionId);
    await deleteOne('chunks', IDBKeyRange.bound([s.sessionId, 0], [s.sessionId, Number.MAX_SAFE_INTEGER]));
  }
}

export async function clearAllCaptures(): Promise<void> {
  await withStores(['captures', 'blobs', 'flows'], 'readwrite', (tx) => {
    tx.objectStore('captures').clear();
    tx.objectStore('blobs').clear();
    tx.objectStore('flows').clear();
  });
}
