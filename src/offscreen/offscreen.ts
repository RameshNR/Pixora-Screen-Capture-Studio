import { isHostMessage, isOffscreenMessage } from '@/shared/messaging/messages';
import { fail, ok } from '@/shared/messaging/client';
import { getCaptureBlob } from '@/history/history-service';
import { AppError } from '@/shared/utils/errors';
import { TabRecordingHost } from './recording-processor';

/**
 * Offscreen document: hosts tab recordings (needs DOM media APIs the service worker lacks) and
 * turns stored captures into blob: URLs for chrome.downloads.
 */
const host = new TabRecordingHost();
const urls = new Set<string>();


async function encodeImage(blob: Blob, format: 'png' | 'jpeg' | 'webp', quality: number): Promise<Blob> {
  if (format === 'png' && blob.type === 'image/png') return blob;
  const bitmap = await createImageBitmap(blob);
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new AppError('image-processing');
  if (format === 'jpeg') {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  return canvas.convertToBlob({ type: `image/${format}`, quality });
}

// Cursor positions from the recorded page drive zoom-follow, auto zoom on click and the spotlight.
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'glint-cursor' || port.sender?.id !== chrome.runtime.id) return;
  port.onMessage.addListener((msg: unknown) => {
    if (!msg || typeof msg !== 'object') return;
    const m = msg as { x?: unknown; y?: unknown; click?: unknown };
    if (typeof m.x !== 'number' || typeof m.y !== 'number' || !Number.isFinite(m.x) || !Number.isFinite(m.y)) return;
    host.cursor({ x: Math.max(0, Math.min(1, m.x)), y: Math.max(0, Math.min(1, m.y)), ...(m.click === 'left' || m.click === 'right' ? { click: m.click } : {}) });
  });
});

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return false;

  if (isHostMessage(message)) {
    if (message.type === 'host/start') {
      host
        .start(message)
        .then(() => sendResponse(ok(null)))
        .catch((err: unknown) => sendResponse(fail(err)));
      return true;
    }
    if (message.type === 'host/effect') {
      if (host.activeSessionId !== message.sessionId) return false;
      host.effect(message.effect);
      sendResponse(ok(null));
      return false;
    }
    if (message.type === 'host/command') {
      // Only answer for our own session; the recorder tab answers for desktop/camera sessions.
      if (host.activeSessionId !== message.sessionId) return false;
      host.command(message.sessionId, message.command);
      sendResponse(ok(null));
      return false;
    }
    return false;
  }

  if (isOffscreenMessage(message)) {
    if (message.type === 'offscreen/object-url') {
      (async () => {
        const blob = await getCaptureBlob(message.captureId);
        if (!blob) throw new AppError('export-failed', 'capture not found');
        const out = message.format ? await encodeImage(blob, message.format, message.quality ?? 1) : blob;
        const url = URL.createObjectURL(out);
        urls.add(url);
        return url;
      })()
        .then((url) => sendResponse(ok(url)))
        .catch((err: unknown) => sendResponse(fail(err)));
      return true;
    }
    if (message.type === 'offscreen/revoke') {
      if (urls.delete(message.url)) URL.revokeObjectURL(message.url);
      sendResponse(ok(null));
      return false;
    }
  }
  return false;
});
