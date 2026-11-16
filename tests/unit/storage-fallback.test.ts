import { describe, expect, it, vi } from 'vitest';

const broken = () => Promise.reject(new DOMException('Internal error opening backing store for indexedDB.open.', 'UnknownError'));

vi.mock('@/shared/storage/idb', async (orig) => {
  const real = await orig<typeof import('@/shared/storage/idb')>();
  return { ...real, putOne: vi.fn(broken), withStores: vi.fn(broken), deleteOne: vi.fn(broken) };
});

const { ChunkWriter, assembleChunks, deleteSession } = await import('@/recording/services/chunk-store');
const { toAppError, isStorageUnavailable } = await import('@/shared/utils/errors');

describe('recording when Pixora storage cannot be opened', () => {
  it('names the problem clearly instead of "Something went wrong"', () => {
    const err = new DOMException('Internal error opening backing store for indexedDB.open.', 'UnknownError');
    expect(isStorageUnavailable(err)).toBe(true);
    expect(toAppError(err).code).toBe('storage-unavailable');
    expect(toAppError(err).title).toMatch(/storage could not be opened/);
  });

  it('keeps every chunk in memory, in order, so nothing recorded is lost', async () => {
    const onError = vi.fn();
    const w = new ChunkWriter('s1', onError);
    w.write(new Blob(['ab']));
    w.write(new Blob(['cd']));
    await w.flush();
    w.write(new Blob(['ef']));
    await w.flush();
    expect(onError).not.toHaveBeenCalled();
    expect(w.inMemory).toBe(true);
    const blob = await assembleChunks('s1', 'video/webm');
    expect(await blob.text()).toBe('abcdef');
    await deleteSession('s1').catch(() => undefined);
    await expect(assembleChunks('s1', 'video/webm')).rejects.toThrow();
  });
});
