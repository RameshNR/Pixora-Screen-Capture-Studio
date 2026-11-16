import { FULLPAGE_STATE_KEY, type FullPageProgress } from '@/shared/constants/fullpage';
import type { FullPageSettings, ScrollAreaChoice } from '@/shared/types';
import { AppError, toAppError } from '@/shared/utils/errors';
import { logger } from '@/shared/utils/logger';
import {
  detectScrollAreas, expandScrollAreas, highlightScrollAreas, preloadLazyContent, preparePageForCapture, restorePageAfterCapture, restoreScrollAreas,
  scrollPageTo, type PageMetrics, type ScrollAreaReport,
} from './page-scripts';
import { framesPerPart, planFullPageCapture, stitchFrames, type CapturedFrame } from './image-stitching';
import { captureVisibleTabRaw, type RawCapture } from './visible-capture';

const STEP_TIMEOUT_MS = 10_000;

/** Stop pressed in the progress window: the capture keeps the screens taken so far. */
let stopRequested = false;
export function requestFullPageStop(): void {
  stopRequested = true;
}

async function publish(state: FullPageProgress | null): Promise<void> {
  if (state) await chrome.storage.session.set({ [FULLPAGE_STATE_KEY]: state }).catch(() => undefined);
  else await chrome.storage.session.remove(FULLPAGE_STATE_KEY).catch(() => undefined);
}

async function run<T, A extends unknown[]>(tabId: number, func: (...args: A) => T | Promise<T>, ...args: A): Promise<T> {
  const exec = chrome.scripting.executeScript({ target: { tabId }, func, args } as unknown as chrome.scripting.ScriptInjection<A, T>);
  const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new AppError('capture-timeout')), STEP_TIMEOUT_MS));
  const [res] = (await Promise.race([exec, timeout])) as Array<chrome.scripting.InjectionResult<Awaited<T>>>;
  return res?.result as T;
}

/**
 * Scroll-and-stitch full-page capture:
 *  1. measure the page and find the real scrolling element,
 *  2. optionally pre-scroll so lazy content loads,
 *  3. capture one viewport per step (fixed/sticky elements hidden after the first frame),
 *  4. stitch frames at their actual scroll offsets (no duplicated rows),
 *  5. always restore the page, even on failure.
 */
export async function captureFullPage(
  tab: chrome.tabs.Tab,
  opts: FullPageSettings,
  scale: 'device' | 'css',
  onProgress: (fraction: number) => void,
  scrollAreas: ScrollAreaChoice[] = [],
  /** Long pages become several full-resolution images instead of one scaled-down image. */
  split = false,
): Promise<RawCapture> {
  const tabId = tab.id!;
  let metrics: PageMetrics;
  // The numbered area outlines must never appear in the capture.
  await run(tabId, highlightScrollAreas, null, false).catch(() => undefined);
  // Scrollable panels the user chose are expanded first, so the page scroll captures their content.
  if (opts.scrollAreas === 'all' && scrollAreas.length === 0) {
    const report = await run(tabId, detectScrollAreas).catch(() => null);
    scrollAreas = (report?.areas ?? []).map((a) => ({ index: a.index, screens: 0 }));
  }
  if (scrollAreas.length) {
    await run(tabId, expandScrollAreas, scrollAreas).catch((err: unknown) => logger.warn('expanding scroll areas failed', err));
    await new Promise((r) => setTimeout(r, 250));
  }
  try {
    metrics = await run(tabId, preparePageForCapture, { hideScrollbars: opts.hideScrollbars });
  } catch (err) {
    throw new AppError(toAppError(err, 'fullpage').code, String(err));
  }
  if (!metrics) throw new AppError('fullpage-failed', 'Could not measure page');

  let frames: CapturedFrame[] = [];
  const notes: string[] = [];
  const parts: Array<{ blob: Blob; width: number; height: number }> = [];
  stopRequested = false;
  // Progress and Stop are shown in Pixora's popup (opened by the toolbar icon while it runs).
  await publish({ running: true, progress: 0, title: tab.title ?? '' });
  try {
    if (opts.preloadLazyContent) {
      onProgress(0.02);
      const newHeight = await run(tabId, preloadLazyContent, opts.maxHeight).catch(() => metrics.totalHeight);
      if (typeof newHeight === 'number' && newHeight > metrics.totalHeight) metrics.totalHeight = newHeight;
    }
    const plan = planFullPageCapture(metrics.totalHeight, metrics.clip.height, opts.maxHeight);
    if (plan.truncated) {
      notes.push(`Page is ${metrics.totalHeight.toLocaleString()} px tall; captured the first ${plan.captureHeight.toLocaleString()} px (limit set in Settings).`);
    }

    const total = plan.positions.length;
    let pageTop = 0;
    let perPart = 0;
    let userScale = 1;
    /** Stitches the screens collected so far into one image (relative to the page top). */
    const stitchPart = async () => {
      const first = frames[0]!.scrollTop;
      const last = frames[frames.length - 1]!.scrollTop;
      const height = Math.min(plan.captureHeight - (first - pageTop), last - first + metrics.clip.height);
      return stitchFrames({ frames, clip: metrics.clip, viewportWidth: metrics.viewportWidth, captureHeight: height, userScale });
    };
    for (let i = 0; i < total; i++) {
      const target = plan.positions[i]!;
      const actual = await run(tabId, scrollPageTo, target, opts.hideFixedElements && i > 0);
      const bitmap = await captureVisibleTabRaw(tab.windowId);
      if (i === 0) {
        pageTop = typeof actual === 'number' ? actual : target;
        const ratio = bitmap.width / metrics.viewportWidth;
        userScale = scale === 'css' && ratio > 1 ? 1 / ratio : 1;
        perPart = split ? framesPerPart(metrics.clip.height, metrics.clip.width, ratio * userScale) : Number.POSITIVE_INFINITY;
      }
      frames.push({ bitmap, scrollTop: typeof actual === 'number' ? actual : target });
      // Page shorter than measured (content collapsed): this is the last screen.
      const collapsed = typeof actual === 'number' && actual < target - 2;
      // A full part: make it an image now and free its screens (keeps memory low on long pages).
      // Never on the last screen taken (the final image needs at least one screen), and never just
      // before the last planned screen: that one is moved up to the page bottom and overlaps the one
      // before, so it stays in the same image.
      if (frames.length >= perPart && i + 2 < total && !stopRequested && !collapsed) {
        const { canvas: partCanvas } = await stitchPart();
        parts.push({ blob: await partCanvas.convertToBlob({ type: 'image/png' }), width: partCanvas.width, height: partCanvas.height });
        frames.forEach((f) => f.bitmap.close());
        // The next part starts with the next screen, exactly where this one ends.
        frames = [];
      }
      onProgress((i + 1) / total);
      void publish({ running: true, progress: (i + 1) / total, title: tab.title ?? '' });
      if (collapsed) break;
      // Stop pressed in the popup: keep what is captured so far (it opens in the editor).
      if (i + 1 < total && stopRequested) {
        notes.push(`Stopped after ${i + 1} of ${total} screens — the part captured so far is shown.`);
        break;
      }
    }

    const { canvas, scaled } = await stitchPart();
    if (scaled) notes.push('The page was too large for a full-resolution image, so it was scaled down to fit Chrome’s image size limits.');
    if (parts.length) notes.push(`The page was too tall for one image, so it is in ${parts.length + 1} images (top to bottom) — all open in the editor’s image panel.`);
    return { canvas, title: metrics.title, url: metrics.url, notes, ...(parts.length ? { parts } : {}) };
  } catch (err) {
    logger.error('full page capture failed', err);
    const info = toAppError(err, 'fullpage');
    throw new AppError(info.code === 'unknown' ? 'fullpage-failed' : info.code, String(err));
  } finally {
    frames.forEach((f) => f.bitmap.close());
    await publish(null);
    await run(tabId, restorePageAfterCapture).catch(() => undefined);
    await run(tabId, restoreScrollAreas).catch(() => undefined);
  }
}

/** Finds the scrollable panels of a page (tags them for the capture) and outlines them. */
export async function findScrollAreas(tabId: number): Promise<ScrollAreaReport> {
  const report = await run(tabId, detectScrollAreas);
  await run(tabId, highlightScrollAreas, null, report.areas.length > 0).catch(() => undefined);
  return report;
}

export async function highlightScrollArea(tabId: number, index: number | null, show: boolean): Promise<void> {
  await run(tabId, highlightScrollAreas, index, show);
}
