/**
 * Minimal promise wrapper around IndexedDB. Shared by the service worker, extension pages and the
 * offscreen document (they all share the extension origin, therefore the same database).
 *
 * Stores:
 *  - captures : CaptureRecord metadata (keyPath id, index createdAt)
 *  - blobs    : capture payloads keyed by capture id (kept separate so listing history is cheap)
 *  - chunks   : in-progress recording chunks keyed by [sessionId, seq]
 *  - sessions : in-progress recording session metadata (for crash recovery)
 *  - flows    : Flow Capture sessions (image order, captions, interaction log); images are captures
 */
export const DB_NAME = 'glint-capture';
/** Minimum schema version; the actual version may be higher after a self-repair. */
export const DB_VERSION = 1;
export type StoreName = 'captures' | 'blobs' | 'chunks' | 'sessions' | 'flows';

let dbPromise: Promise<IDBDatabase> | null = null;

const STORES: StoreName[] = ['captures', 'blobs', 'chunks', 'sessions', 'flows'];

/** Opening retries a few times: "error opening backing store" is often a short-lived lock. */
/** Storage failed to open just now: further attempts try once, without waiting (a broken store would make every save slow). */
let brokenUntil = 0;

async function openRetrying(version: number | undefined): Promise<IDBDatabase> {
  if (Date.now() < brokenUntil) return openWithVersion(version);
  try {
    return await openWithRetries(version);
  } catch (err) {
    brokenUntil = Date.now() + 30_000;
    throw err;
  }
}

async function openWithRetries(version: number | undefined): Promise<IDBDatabase> {
  let last: unknown;
  for (const wait of [0, 250, 750, 1500]) {
    if (wait) await new Promise((r) => setTimeout(r, wait));
    try {
      return await openWithVersion(version);
    } catch (err) {
      last = err;
      const name = err instanceof DOMException ? err.name : '';
      // Only internal / unknown open failures are worth retrying.
      if (name && name !== 'UnknownError' && name !== 'InvalidStateError') break;
    }
  }
  throw last;
}

export function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  // Open at the current version (creating v1 with our stores if the database is new).
  dbPromise = openRetrying(undefined).then((db) => {
    // Self-repair: if the database exists at our version but without our stores (e.g. it was
    // created by an unversioned open), bump the version so the upgrade creates them.
    if (STORES.every((s) => db.objectStoreNames.contains(s))) return db;
    const next = db.version + 1;
    db.close();
    return openWithVersion(next);
  });
  dbPromise.catch(() => {
    dbPromise = null;
  });
  return dbPromise;
}

function openWithVersion(version: number | undefined): Promise<IDBDatabase> {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const req = version === undefined ? indexedDB.open(DB_NAME) : indexedDB.open(DB_NAME, Math.max(DB_VERSION, version));
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('captures')) {
        const s = db.createObjectStore('captures', { keyPath: 'id' });
        s.createIndex('createdAt', 'createdAt');
      }
      if (!db.objectStoreNames.contains('blobs')) db.createObjectStore('blobs');
      if (!db.objectStoreNames.contains('chunks')) {
        const s = db.createObjectStore('chunks', { keyPath: ['sessionId', 'seq'] });
        s.createIndex('sessionId', 'sessionId');
      }
      if (!db.objectStoreNames.contains('sessions')) db.createObjectStore('sessions', { keyPath: 'sessionId' });
      if (!db.objectStoreNames.contains('flows')) db.createObjectStore('flows', { keyPath: 'id' });
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
  });
}

export function promisify<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? new DOMException('Transaction aborted', 'AbortError'));
    tx.onerror = () => reject(tx.error ?? new Error('Transaction failed'));
  });
}

/** Runs `fn` inside a transaction and resolves once the transaction commits. */
export async function withStores<R>(
  stores: StoreName | StoreName[],
  mode: IDBTransactionMode,
  fn: (tx: IDBTransaction) => Promise<R> | R,
): Promise<R> {
  const db = await openDb();
  const tx = db.transaction(stores, mode);
  const completion = done(tx);
  const result = await fn(tx);
  await completion;
  return result;
}

export async function getOne<T>(store: StoreName, key: IDBValidKey): Promise<T | undefined> {
  return withStores(store, 'readonly', (tx) => promisify(tx.objectStore(store).get(key) as IDBRequest<T | undefined>));
}

export async function putOne(store: StoreName, value: unknown, key?: IDBValidKey): Promise<void> {
  await withStores(store, 'readwrite', (tx) => {
    tx.objectStore(store).put(value, key);
  });
}

export async function deleteOne(store: StoreName, key: IDBValidKey | IDBKeyRange): Promise<void> {
  await withStores(store, 'readwrite', (tx) => {
    tx.objectStore(store).delete(key);
  });
}

export async function getAll<T>(store: StoreName): Promise<T[]> {
  return withStores(store, 'readonly', (tx) => promisify(tx.objectStore(store).getAll() as IDBRequest<T[]>));
}

/** True when the database opens normally. */
export async function storageHealthy(): Promise<boolean> {
  try {
    await openDb();
    return true;
  } catch {
    return false;
  }
}

/**
 * Rebuilds Pixora's database when Chrome cannot open it (files locked or damaged): deletes it and
 * creates it again, empty. Other extension pages close their connection when asked (onversionchange).
 */
export async function repairDatabase(): Promise<void> {
  brokenUntil = 0;
  try {
    const db = await Promise.race([dbPromise ?? Promise.reject(new Error('none')), new Promise<never>((_, r) => setTimeout(() => r(new Error('none')), 100))]);
    db.close();
  } catch {
    /* no open connection */
  }
  dbPromise = null;
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error ?? new Error('Could not delete the database'));
    // Another page still has it open: it closes on versionchange, then the delete completes.
    req.onblocked = () => undefined;
  });
  await openDb();
}

/** Test helper: drop the cached connection. */
export function resetDbConnection(): void {
  dbPromise = null;
}
