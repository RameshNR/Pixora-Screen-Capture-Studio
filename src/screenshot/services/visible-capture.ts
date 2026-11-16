import { AppError, toAppError } from '@/shared/utils/errors';
import { delay } from '@/shared/utils/misc';
import { readPageInfo, waitForAnimations, waitForPageReady } from './page-scripts';

/** Chrome allows 2 captureVisibleTab calls in any one second; a small margin on top. */
export const CAPTURE_WINDOW_MS = 1000 + 60;
const recentCaptures: number[] = [];

/**
 * How long a capture must wait (ms). `high` (the picture of a click, a manual capture) may use both
 * calls of the window; `low` (automatic pictures of scrolls, page loads) only takes a call when
 * none was made in the last second, so one is always left for a click right after it — the click
 * is then captured at the press, before the page reacts (loading fog, navigation).
 */
export function captureWait(history: readonly number[], now: number, priority: 'high' | 'low'): number {
  const inWindow = history.filter((t) => now - t < CAPTURE_WINDOW_MS).sort((a, b) => a - b);
  const free = priority === 'high' ? 2 : 1;
  if (inWindow.length < free) return 0;
  // Wait until enough calls have left the window.
  const mustLeave = inWindow.length - free + 1;
  return Math.max(0, inWindow[mustLeave - 1]! + CAPTURE_WINDOW_MS - now);
}

/** chrome.tabs.captureVisibleTab, respecting Chrome's two-per-second limit (see captureWait). */
export async function captureVisibleTabRaw(windowId: number, priority: 'high' | 'low' = 'high', stop?: () => boolean): Promise<ImageBitmap> {
  for (;;) {
    const wait = captureWait(recentCaptures, Date.now(), priority);
    if (wait <= 0) break;
    // `stop`: the caller no longer needs this picture (checked while waiting for a free capture).
    if (stop?.()) throw new AppError('cancelled', 'Capture no longer needed');
    await delay(stop ? Math.min(wait, 50) : wait);
  }
  if (stop?.()) throw new AppError('cancelled', 'Capture no longer needed');
  recentCaptures.push(Date.now());
  while (recentCaptures.length > 4) recentCaptures.shift();
  let dataUrl: string;
  try {
    dataUrl = await chrome.tabs.captureVisibleTab(windowId, { format: 'png' });
  } catch (err) {
    // Over the limit anyway (another extension page captured too): one retry after the window.
    if (/MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND/i.test(String(err))) {
      await delay(CAPTURE_WINDOW_MS);
      recentCaptures.push(Date.now());
      dataUrl = await chrome.tabs.captureVisibleTab(windowId, { format: 'png' });
    } else {
      const info = toAppError(err, 'capture');
      throw new AppError(info.code === 'image-processing' ? 'restricted-page' : info.code, String(err));
    }
  }
  const blob = await (await fetch(dataUrl)).blob();
  return createImageBitmap(blob);
}

/**
 * Lets the page finish opening animations (dropdowns, menus, popovers) before a screenshot.
 * Best effort: pages that block scripts are captured as they are.
 */
export async function settlePage(tabId: number | undefined, maxMs = 1000): Promise<void> {
  if (tabId === undefined) return;
  try {
    await Promise.race([
      chrome.scripting.executeScript({ target: { tabId }, func: waitForAnimations, args: [maxMs] }),
      delay(maxMs + 300),
    ]);
  } catch {
    /* restricted page or no access */
  }
}

/**
 * Waits until the page is ready after an interaction (loaders gone, network quiet, animations
 * done), so a click that starts a loading screen is captured once the content is there.
 */
export async function waitUntilReady(tabId: number | undefined, maxMs = 8000, quietMs = 500): Promise<void> {
  if (tabId === undefined) return;
  try {
    await Promise.race([
      chrome.scripting.executeScript({ target: { tabId }, func: waitForPageReady, args: [maxMs, quietMs] }),
      delay(maxMs + 500),
    ]);
  } catch {
    /* restricted page, or the page is navigating: fall back to a short pause */
    await delay(400);
  }
}

export interface PageInfo {
  title: string;
  url: string;
  dpr: number;
  width: number;
  height: number;
}

/** Reads title / url / devicePixelRatio. Falls back to tab metadata on pages that block scripting. */
export async function getPageInfo(tab: chrome.tabs.Tab): Promise<PageInfo> {
  try {
    const [res] = await chrome.scripting.executeScript({ target: { tabId: tab.id! }, func: readPageInfo });
    if (res?.result) return res.result;
  } catch {
    /* restricted page */
  }
  return { title: tab.title ?? '', url: tab.url ?? '', dpr: 1, width: tab.width ?? 0, height: tab.height ?? 0 };
}

export interface RawCapture {
  canvas: OffscreenCanvas;
  title: string;
  url: string;
  notes: string[];
  /**
   * A page too tall for one full-resolution image: its earlier parts (top first, already encoded as
   * PNG). `canvas` is then the last part.
   */
  parts?: Array<{ blob: Blob; width: number; height: number }>;
}

export async function captureVisible(tab: chrome.tabs.Tab, scale: 'device' | 'css'): Promise<RawCapture> {
  const info = await getPageInfo(tab);
  await settlePage(tab.id);
  const bitmap = await captureVisibleTabRaw(tab.windowId);
  const ratio = info.width ? bitmap.width / info.width : info.dpr;
  const userScale = scale === 'css' && ratio > 1 ? 1 / ratio : 1;
  const canvas = new OffscreenCanvas(Math.round(bitmap.width * userScale), Math.round(bitmap.height * userScale));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new AppError('image-processing', 'no 2d context');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return { canvas, title: info.title, url: info.url, notes: [] };
}
