import { logger } from '@/shared/utils/logger';
import { headerLayout } from './browser-header';
import type { RawCapture } from './visible-capture';

/**
 * "Include browser header" (service worker side). Chrome's screenshot API only sees the page, so
 * Pixora's header window asks Chrome for a picture of the browser window (Chrome's "Choose what to
 * share" dialog), cuts out the tabs / address bar / bookmarks strip and sends it back here.
 */

let pending: ((dataUrl: string | null) => void) | null = null;

/** The header window's answer (see message-handler; only Pixora's own pages may send it). */
export function onHeaderResult(dataUrl: string | null): void {
  const resolve = pending;
  pending = null;
  resolve?.(dataUrl);
}

/** How long the dialog may stay open before the screenshot is kept without the header. */
const HEADER_TIMEOUT_MS = 3 * 60_000;

/** Opens the header window next to `windowId` and waits for the strip (null: skipped / failed). */
export async function captureBrowserHeader(windowId: number): Promise<ImageBitmap | null> {
  onHeaderResult(null); // an older request still waiting ends now
  const source = await chrome.windows.get(windowId).catch(() => null);
  const width = 440;
  const height = 250;
  const left = source?.left !== undefined && source.width !== undefined ? Math.round(source.left + (source.width - width) / 2) : undefined;
  const top = source?.top !== undefined ? source.top + 120 : undefined;

  const answer = new Promise<string | null>((resolve) => {
    pending = resolve;
  });
  let helperId: number | undefined;
  const closed = (id: number) => {
    if (id === helperId) onHeaderResult(null);
  };
  chrome.windows.onRemoved.addListener(closed);
  // Extension API calls keep the service worker running while the dialog is open.
  const keepAlive = setInterval(() => void chrome.runtime.getPlatformInfo().catch(() => undefined), 20_000);
  const timer = setTimeout(() => onHeaderResult(null), HEADER_TIMEOUT_MS);
  try {
    const helper = await chrome.windows.create({
      url: chrome.runtime.getURL(`progress.html?mode=header&win=${windowId}`),
      type: 'popup', width, height, left, top, focused: true,
    });
    helperId = helper?.id;
    const dataUrl = await answer;
    if (!dataUrl) return null;
    const blob = await (await fetch(dataUrl)).blob();
    return await createImageBitmap(blob);
  } catch (err) {
    logger.warn('browser header not captured', err);
    return null;
  } finally {
    clearInterval(keepAlive);
    clearTimeout(timer);
    chrome.windows.onRemoved.removeListener(closed);
    if (pending) onHeaderResult(null);
    if (helperId !== undefined) void chrome.windows.remove(helperId).catch(() => undefined);
  }
}

/** Draws `header` above `image` (sizes from headerLayout); a wider header widens the result. */
export function stackHeader(header: CanvasImageSource & { width: number; height: number }, image: CanvasImageSource & { width: number; height: number }, scale: number): OffscreenCanvas {
  const lay = headerLayout(header, image.width, scale);
  const canvas = new OffscreenCanvas(lay.canvasWidth, lay.height + image.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no 2d context');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(header, 0, 0, lay.width, lay.height);
  ctx.drawImage(image, 0, lay.height);
  return canvas;
}

/** Puts the header on the first image of a capture (the top part of a long page). */
export async function addHeaderToCapture(raw: RawCapture, header: ImageBitmap, scale: number): Promise<RawCapture> {
  const first = raw.parts?.[0];
  if (first) {
    const bmp = await createImageBitmap(first.blob);
    const canvas = stackHeader(header, bmp, scale);
    bmp.close();
    const blob = await canvas.convertToBlob({ type: 'image/png' });
    return { ...raw, parts: [{ blob, width: canvas.width, height: canvas.height }, ...raw.parts!.slice(1)] };
  }
  return { ...raw, canvas: stackHeader(header, raw.canvas, scale) };
}
