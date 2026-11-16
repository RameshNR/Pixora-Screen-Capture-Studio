import { describe, expect, it } from 'vitest';
import { addCapture, listCaptures } from '@/history/history-service';
import { DB_NAME, resetDbConnection } from '@/shared/storage/idb';

describe('IndexedDB self-repair', () => {
  it('creates missing stores when the database already exists without them', async () => {
    resetDbConnection();
    await new Promise<void>((resolve) => {
      const del = indexedDB.deleteDatabase(DB_NAME);
      del.onsuccess = () => resolve();
    });
    // Simulate a foreign, unversioned open creating an empty database.
    await new Promise<void>((resolve) => {
      const req = indexedDB.open(DB_NAME);
      req.onsuccess = () => {
        req.result.close();
        resolve();
      };
    });
    await addCapture({ kind: 'screenshot', name: 'a.png', mimeType: 'image/png', width: 1, height: 1 }, new Blob(['x']));
    expect((await listCaptures()).map((c) => c.name)).toContain('a.png');
  });
});
