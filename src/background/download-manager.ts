import { sendToOffscreen } from '@/shared/messaging/client';
import type { ImageFormat } from '@/shared/types';
import { getCapture } from '@/history/history-service';
import { loadSettings } from '@/settings/settings-service';
import { AppError } from '@/shared/utils/errors';
import { replaceExtension, sanitizeSubfolder } from '@/shared/utils/filename';
import { ensureOffscreenDocument } from './offscreen-manager';

/**
 * Service-worker side downloads. Workers cannot create blob: URLs, so the offscreen document
 * creates one from the stored capture and we hand that URL to chrome.downloads.
 */
export async function downloadCaptureFromBackground(captureId: string, format?: ImageFormat): Promise<number> {
  const [record, settings] = await Promise.all([getCapture(captureId), loadSettings()]);
  if (!record) throw new AppError('export-failed', 'Capture not found');
  await ensureOffscreenDocument();
  const url = await sendToOffscreen<string>({
    target: 'offscreen',
    type: 'offscreen/object-url',
    captureId,
    ...(format && record.kind === 'screenshot' ? { format, quality: settings.screenshot.quality } : {}),
  });
  const ext = format === 'jpeg' ? 'jpg' : format;
  const name = ext && record.kind === 'screenshot' ? replaceExtension(record.name, ext) : record.name;
  const folder = sanitizeSubfolder(settings.storage.subfolder);
  try {
    const id = await chrome.downloads.download({
      url,
      filename: folder ? `${folder}/${name}` : name,
      saveAs: settings.storage.askWhereToSave,
      conflictAction: 'uniquify',
    });
    revokeWhenDone(id, url);
    return id;
  } catch (err) {
    void sendToOffscreen({ target: 'offscreen', type: 'offscreen/revoke', url }).catch(() => undefined);
    throw new AppError('export-failed', String(err));
  }
}

function revokeWhenDone(downloadId: number, url: string): void {
  const listener = (delta: chrome.downloads.DownloadDelta) => {
    if (delta.id !== downloadId || !delta.state) return;
    if (delta.state.current === 'complete' || delta.state.current === 'interrupted') {
      chrome.downloads.onChanged.removeListener(listener);
      void sendToOffscreen({ target: 'offscreen', type: 'offscreen/revoke', url }).catch(() => undefined);
    }
  };
  chrome.downloads.onChanged.addListener(listener);
}
