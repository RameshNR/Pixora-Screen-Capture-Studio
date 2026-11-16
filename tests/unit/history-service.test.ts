import { beforeEach, describe, expect, it } from 'vitest';
import {
  addCapture, applyRetention, clearAllCaptures, clearTemporaryData, deleteCapture, getCapture, getCaptureBlob, getStorageUsage,
  listCaptures, sortCaptures, updateCapture,
} from '@/history/history-service';
import { appendChunk, assembleChunks, ChunkWriter, countChunks, deleteSession, saveSessionMeta } from '@/recording/services/chunk-store';
import { DEFAULT_SETTINGS } from '@/shared/constants/defaults';
import { buildRecordingConfig } from '@/recording/services/config';
import type { CaptureRecord } from '@/shared/types';

const shot = (name: string) => ({ kind: 'screenshot' as const, name, mimeType: 'image/png', width: 10, height: 10 });

describe('history persistence (IndexedDB)', () => {
  beforeEach(async () => {
    await clearAllCaptures();
  });

  it('stores metadata and payload separately', async () => {
    const rec = await addCapture(shot('a.png'), new Blob(['12345'], { type: 'image/png' }));
    expect(rec.id).toMatch(/^s_/);
    expect(rec.size).toBe(5);
    expect((await getCapture(rec.id))?.name).toBe('a.png');
    expect(await (await getCaptureBlob(rec.id))?.text()).toBe('12345');
  });

  it('filters and sorts', async () => {
    await addCapture(shot('b.png'), new Blob(['1']));
    await new Promise((r) => setTimeout(r, 2));
    await addCapture({ kind: 'video', name: 'a.webm', mimeType: 'video/webm', width: 1, height: 1, durationMs: 1000 }, new Blob(['12345678']));
    expect((await listCaptures('all', 'newest')).map((c) => c.name)).toEqual(['a.webm', 'b.png']);
    expect((await listCaptures('all', 'oldest')).map((c) => c.name)).toEqual(['b.png', 'a.webm']);
    expect((await listCaptures('screenshot')).map((c) => c.name)).toEqual(['b.png']);
    expect((await listCaptures('video', 'size')).map((c) => c.name)).toEqual(['a.webm']);
    expect((await listCaptures('all', 'name')).map((c) => c.name)).toEqual(['a.webm', 'b.png']);
  });

  it('sorts names naturally', () => {
    const items = ['Shot 10', 'Shot 2', 'shot 1'].map((name, i) => ({ id: String(i), name, size: 0, createdAt: i }) as CaptureRecord);
    expect(sortCaptures(items, 'name').map((c) => c.name)).toEqual(['shot 1', 'Shot 2', 'Shot 10']);
  });

  it('updates and deletes', async () => {
    const rec = await addCapture(shot('x.png'), new Blob(['1']));
    const updated = await updateCapture(rec.id, { name: 'y.png', edited: true }, new Blob(['123']));
    expect(updated.name).toBe('y.png');
    expect(updated.size).toBe(3);
    await deleteCapture(rec.id);
    expect(await getCapture(rec.id)).toBeUndefined();
    expect(await getCaptureBlob(rec.id)).toBeUndefined();
  });

  it('applies retention and reports usage', async () => {
    const old = await addCapture(shot('old.png'), new Blob(['1']));
    await updateCapture(old.id, {});
    const removed = await applyRetention(1, Date.now() + 2 * 86_400_000);
    expect(removed).toBe(1);
    await addCapture(shot('new.png'), new Blob(['12']));
    const usage = await getStorageUsage();
    expect(usage.captures).toBe(1);
    expect(usage.bytes).toBe(2);
  });
});

describe('recording chunk store', () => {
  const config = buildRecordingConfig(DEFAULT_SETTINGS.recording);

  it('writes chunks in order and assembles them', async () => {
    const writer = new ChunkWriter('sess-1', () => undefined);
    ['a', 'b', 'c'].forEach((t) => writer.write(new Blob([t])));
    writer.write(new Blob([])); // empty chunks are skipped
    await writer.flush();
    expect(writer.bytesWritten).toBe(3);
    expect(await countChunks('sess-1')).toBe(3);
    expect(await (await assembleChunks('sess-1', 'video/webm')).text()).toBe('abc');
  });

  it('cleans up temporary data except the active session', async () => {
    for (const id of ['keep', 'drop']) {
      await saveSessionMeta({ sessionId: id, mode: 'tab', mimeType: 'video/webm', startedAt: 0, activeMs: 0, width: 1, height: 1, fps: 30, config, notes: [], hasMicrophone: false, hasSystemAudio: false });
      await appendChunk(id, 0, new Blob(['x']));
    }
    await clearTemporaryData('keep');
    expect(await countChunks('keep')).toBe(1);
    expect(await countChunks('drop')).toBe(0);
    await deleteSession('keep');
    expect(await countChunks('keep')).toBe(0);
  });
});
