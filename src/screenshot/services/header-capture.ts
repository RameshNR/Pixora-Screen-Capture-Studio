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
const HEADER_TIMEOUT_MS = 10 * 60_000;

/** Opens the header window next to `windowId` and waits for the strip (null: skipped / failed). */
export async function captureBrowserHeader(windowId: number, shot: { tabId?: number; width?: number; height?: number } = {}): Promise<ImageBitmap | null> {
  onHeaderResult(null); // an older request still waiting ends now
  // As large as the browser window and over it: Chrome's dialog is drawn inside this window, so a
  // small window made it cramped. (It minimises itself before the picture.)
  const source = await chrome.windows.get(windowId).catch(() => null);
  const width = Math.max(560, Math.min(source?.width ?? 1000, 1600));
  const height = Math.max(520, Math.min(source?.height ?? 760, 1100));
  const left = source?.left !== undefined && source.width !== undefined ? Math.max(0, Math.round(source.left + (source.width - width) / 2)) : undefined;
  const top = source?.top !== undefined && source.height !== undefined ? Math.max(0, Math.round(source.top + (source.height - height) / 2)) : undefined;

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
      url: chrome.runtime.getURL(`progress.html?${headerWindowQuery(windowId, shot)}`),
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

/** Query of the header window: the browser window, and the tab and page-area size of the screenshot. */
export function headerWindowQuery(windowId: number, shot: { tabId?: number; width?: number; height?: number }): string {
  const q = new URLSearchParams({ mode: 'header', win: String(windowId) });
  if (shot.tabId !== undefined) q.set('tab', String(shot.tabId));
  if (shot.width) q.set('vw', String(shot.width));
  if (shot.height) q.set('vh', String(shot.height));
  return q.toString();
}

/** Width difference (CSS px) still fitted automatically: rounding, a slightly different window. */
export const fitWidthLimit = (width: number) => Math.max(16, Math.round(width * 0.05));
/** Height difference allowed (the bookmarks bar shown / hidden changes the page height only). */
export const fitHeightLimit = (height: number) => Math.max(48, Math.round(height * 0.1));

/**
 * Whether the browser window still shows the screenshot's tab at about the screenshot's size (the
 * header must match the screenshot). Small differences are fitted automatically; a big one (e.g. no
 * longer maximised) is reported. `now` is the window's active tab now.
 */
export function sameAsScreenshot(now: { id?: number; width?: number; height?: number } | undefined, shot: { tabId?: number; width?: number; height?: number }): 'ok' | 'tab' | 'size' {
  if (!now) return 'tab';
  if (shot.tabId !== undefined && now.id !== shot.tabId) return 'tab';
  if (shot.width && now.width && Math.abs(now.width - shot.width) > fitWidthLimit(shot.width)) return 'size';
  if (shot.height && now.height && Math.abs(now.height - shot.height) > fitHeightLimit(shot.height)) return 'size';
  return 'ok';
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
