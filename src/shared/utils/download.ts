import { AppError } from './errors';
import { sanitizeFilename, sanitizeSubfolder } from './filename';
import { saveToFolder } from './save-folder';
import { SETTINGS_STORAGE_KEY } from '@/shared/constants/defaults';
import { logger } from './logger';

/** Downloads id returned when a file was written to the user's own folder (no Chrome download). */
export const SAVED_TO_FOLDER = -1;

async function savesToFolder(): Promise<boolean> {
  try {
    const raw = (await chrome.storage.local.get(SETTINGS_STORAGE_KEY))[SETTINGS_STORAGE_KEY] as { storage?: { location?: string } } | undefined;
    return raw?.storage?.location === 'folder';
  } catch {
    return false;
  }
}

export interface DownloadOptions {
  saveAs?: boolean;
  subfolder?: string;
}

/**
 * Downloads a blob from an extension page via chrome.downloads (supports sub-folders and the
 * "Save as" dialog). Chrome only allows paths inside the user's download directory; a fully custom
 * location is chosen through the Save-as dialog.
 */
export async function downloadBlob(blob: Blob, filename: string, opts: DownloadOptions = {}): Promise<number> {
  const folder = opts.subfolder ? sanitizeSubfolder(opts.subfolder) : '';
  const name = sanitizeFilename(filename, 180);
  // "Save to a folder on this computer": written straight into the chosen folder (any location).
  if (!opts.saveAs && (await savesToFolder())) {
    try {
      if (await saveToFolder(blob, name, folder)) return SAVED_TO_FOLDER;
    } catch (err) {
      logger.warn('saving to the chosen folder failed; using Downloads', err);
    }
  }
  const url = URL.createObjectURL(blob);
  try {
    const id = await chrome.downloads.download({
      url,
      filename: folder ? `${folder}/${name}` : name,
      saveAs: Boolean(opts.saveAs),
      conflictAction: 'uniquify',
    });
    if (id === undefined) throw new Error(chrome.runtime.lastError?.message ?? 'Download was blocked');
    const listener = (delta: chrome.downloads.DownloadDelta) => {
      if (delta.id !== id || !delta.state) return;
      if (delta.state.current !== 'in_progress') {
        chrome.downloads.onChanged.removeListener(listener);
        URL.revokeObjectURL(url);
      }
    };
    chrome.downloads.onChanged.addListener(listener);
    return id;
  } catch (err) {
    URL.revokeObjectURL(url);
    const msg = String(err);
    // The user closing the Save-as dialog is not an error.
    if (/cancel/i.test(msg)) throw new AppError('cancelled', msg);
    throw new AppError('export-failed', msg);
  }
}

/** Waits for a download to finish; resolves false if it was cancelled or interrupted. */
export function waitForDownload(id: number): Promise<boolean> {
  return new Promise((resolve) => {
    const listener = (delta: chrome.downloads.DownloadDelta) => {
      if (delta.id !== id || !delta.state) return;
      if (delta.state.current === 'complete') {
        chrome.downloads.onChanged.removeListener(listener);
        resolve(true);
      } else if (delta.state.current === 'interrupted') {
        chrome.downloads.onChanged.removeListener(listener);
        resolve(false);
      }
    };
    chrome.downloads.onChanged.addListener(listener);
  });
}

export async function showInFolder(downloadId: number | undefined): Promise<boolean> {
  if (downloadId === undefined || downloadId === SAVED_TO_FOLDER) return false;
  const [item] = await chrome.downloads.search({ id: downloadId });
  if (!item || item.state !== 'complete' || !item.exists) return false;
  chrome.downloads.show(downloadId);
  return true;
}

/** Copies an image to the clipboard (the Clipboard API only accepts PNG for images). */
export async function copyImageToClipboard(blob: Blob): Promise<void> {
  let png = blob;
  if (blob.type !== 'image/png') {
    const bitmap = await createImageBitmap(blob);
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0);
    bitmap.close();
    png = await canvas.convertToBlob({ type: 'image/png' });
  }
  try {
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
  } catch (err) {
    throw new AppError('clipboard-failed', String(err));
  }
}

export async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch (err) {
    throw new AppError('clipboard-failed', String(err));
  }
}
