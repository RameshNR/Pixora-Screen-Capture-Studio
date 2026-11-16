/**
 * "Save to a folder on this computer": the user picks any folder (outside Chrome's downloads
 * directory too) with the File System Access API, and files are written straight into it.
 *
 * The folder handle is kept in its own small IndexedDB database (handles cannot go in
 * chrome.storage). Writing needs the folder permission: Chrome keeps it while the browser runs and
 * asks again (one click) after a restart; pages ask on the user's click, so saving works from
 * extension pages. Nothing leaves this computer.
 */

const DB = 'pixora-save-folder';
const STORE = 'handles';
const KEY = 'folder';

type DirHandle = FileSystemDirectoryHandle & {
  queryPermission?: (d: { mode: 'readwrite' }) => Promise<PermissionState>;
  requestPermission?: (d: { mode: 'readwrite' }) => Promise<PermissionState>;
};

function openFolderDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('Could not open the folder store'));
  });
}

async function withStore<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openFolderDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

/** True where folders can be picked (extension pages in Chrome; not the service worker). */
export function canPickFolder(): boolean {
  return typeof window !== 'undefined' && typeof (window as { showDirectoryPicker?: unknown }).showDirectoryPicker === 'function';
}

/** Shows the folder picker; stores and returns the chosen folder's name (null if cancelled). */
export async function pickSaveFolder(): Promise<string | null> {
  const pick = (window as unknown as { showDirectoryPicker: (o: object) => Promise<DirHandle> }).showDirectoryPicker;
  let handle: DirHandle;
  try {
    handle = await pick({ id: 'pixora-save', mode: 'readwrite', startIn: 'pictures' });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') return null;
    throw err;
  }
  await withStore('readwrite', (s) => s.put(handle, KEY));
  return handle.name;
}

export async function getSaveFolder(): Promise<DirHandle | null> {
  try {
    return ((await withStore('readonly', (s) => s.get(KEY))) as DirHandle | undefined) ?? null;
  } catch {
    return null;
  }
}

export async function forgetSaveFolder(): Promise<void> {
  await withStore('readwrite', (s) => s.delete(KEY)).catch(() => undefined);
}

/** 'granted', 'prompt' (one click needed after a browser restart) or 'denied'. */
export async function folderPermission(handle: DirHandle, ask: boolean): Promise<PermissionState> {
  const opts = { mode: 'readwrite' as const };
  let state: PermissionState = (await handle.queryPermission?.(opts)) ?? 'granted';
  if (state === 'prompt' && ask && handle.requestPermission) state = await handle.requestPermission(opts);
  return state;
}

/** A name that does not overwrite an existing file: "name (1).png", "name (2).png"… */
export async function freeName(dir: FileSystemDirectoryHandle, name: string): Promise<string> {
  const dot = name.lastIndexOf('.');
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  for (let i = 0; i < 1000; i++) {
    const candidate = i === 0 ? name : `${base} (${i})${ext}`;
    try {
      await dir.getFileHandle(candidate);
    } catch {
      return candidate;
    }
  }
  return `${base} ${Date.now()}${ext}`;
}

/**
 * Writes the file into the chosen folder (inside `subfolder` when given). Returns the saved name,
 * or null when no folder is set or access was not granted (the caller then uses Downloads).
 */
export async function saveToFolder(blob: Blob, filename: string, subfolder = ''): Promise<string | null> {
  if (!canPickFolder()) return null;
  const root = await getSaveFolder();
  if (!root) return null;
  if ((await folderPermission(root, true)) !== 'granted') return null;
  let dir: FileSystemDirectoryHandle = root;
  for (const part of subfolder.split('/').map((p) => p.trim()).filter(Boolean)) dir = await dir.getDirectoryHandle(part, { create: true });
  const name = await freeName(dir, filename);
  const file = await dir.getFileHandle(name, { create: true });
  const out = await file.createWritable();
  try {
    await out.write(blob);
  } finally {
    await out.close();
  }
  return name;
}
