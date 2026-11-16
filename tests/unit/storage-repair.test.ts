import { describe, expect, it } from 'vitest';
import { getAll, openDb, putOne, repairDatabase, resetDbConnection, storageHealthy } from '@/shared/storage/idb';
import { AppError, isStorageUnavailable, toAppError } from '@/shared/utils/errors';

describe('Repair storage', () => {
  it('rebuilds Pixora storage empty, with every store, and reports it healthy', async () => {
    resetDbConnection();
    await putOne('flows', { id: 'f1' });
    expect(await getAll('flows')).toHaveLength(1);
    await repairDatabase();
    const db = await openDb();
    expect(['captures', 'blobs', 'chunks', 'sessions', 'flows'].every((s) => db.objectStoreNames.contains(s))).toBe(true);
    expect(await getAll('flows')).toHaveLength(0);
    expect(await storageHealthy()).toBe(true);
  });

  it('keeps the storage problem recognisable when it is wrapped (saving a capture)', () => {
    const wrapped = new AppError('export-failed', 'UnknownError: Internal error opening backing store for indexedDB.open.');
    expect(toAppError(new AppError('storage-unavailable', 'x')).code).toBe('storage-unavailable');
    // The recording fallback (save to Downloads) and the editor still recognise it.
    expect(isStorageUnavailable(wrapped)).toBe(true);
    expect(isStorageUnavailable(new AppError('export-failed', 'disk error'))).toBe(false);
  });
});
