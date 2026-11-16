import type { PixelRect, ScreenshotMode, ScrollAreaChoice, Settings } from '@/shared/types';
import { addCapture } from '@/history/history-service';
import { loadSettings } from '@/settings/settings-service';
import { broadcast } from '@/shared/messaging/client';
import { AppError, toAppError, isStorageUnavailable } from '@/shared/utils/errors';
import { buildFilename } from '@/shared/utils/filename';
import { logger } from '@/shared/utils/logger';
import { generateImageThumbnail } from '@/recording/services/thumbnail';
import { clearBadge, notify, setBadge } from '@/background/badge';
import { downloadCaptureFromBackground } from '@/background/download-manager';
import { injectOverlay, sendOverlay } from '@/background/overlay';
import { captureArea } from './area-capture';
import { captureFullPage } from './full-page-capture';
import { captureVisible, type RawCapture } from './visible-capture';
import { addAreaImage, cancelPendingCapture, takePendingFlowArea } from '@/background/flow-manager';

interface PendingArea {
  tabId: number;
  ocr: boolean;
}
const PENDING_AREA_KEY = 'glint.pendingArea';

/** Entry point for every in-browser screenshot. Runs in the service worker. */
export async function takeScreenshot(
  mode: ScreenshotMode,
  tabId: number,
  opts: { delaySeconds?: number; ocr?: boolean; scrollAreas?: ScrollAreaChoice[] } = {},
): Promise<void> {
  const settings = await loadSettings();
  const tab = await chrome.tabs.get(tabId).catch(() => {
    throw new AppError('tab-closed');
  });

  if (mode === 'area') {
    await injectOverlay(tabId);
    await chrome.storage.session.set({ [PENDING_AREA_KEY]: { tabId, ocr: Boolean(opts.ocr) } satisfies PendingArea });
    await sendOverlay(tabId, { target: 'content', type: 'overlay/select', mode: 'area-screenshot' });
    return;
  }

  if (opts.delaySeconds && opts.delaySeconds > 0) await countdownOnBadge(opts.delaySeconds);

  try {
    let raw: RawCapture;
    if (mode === 'full') {
      // Progress and Stop show in Pixora's popup, opened by the toolbar icon (where Chrome allows it;
      // otherwise a click on the icon shows it, and the badge shows the percentage meanwhile).
      void openPopupIn(tab.windowId);
      raw = await captureFullPage(tab, settings.screenshot.fullPage, settings.screenshot.scale, (p) => {
        void setBadge(`${Math.round(p * 100)}%`);
        broadcast({ target: 'broadcast', type: 'capture/status', label: 'Capturing full page…', progress: p });
      }, opts.scrollAreas ?? [], true);
    } else {
      // The tab may have changed during a delay: capture whatever is visible in the original window.
      const current = opts.delaySeconds ? (await chrome.tabs.query({ active: true, windowId: tab.windowId }))[0] ?? tab : tab;
      raw = await captureVisible(current, settings.screenshot.scale);
    }
    await finishScreenshot(raw, settings, tab, Boolean(opts.ocr));
  } catch (err) {
    await reportCaptureError(err, settings);
    throw err;
  } finally {
    await clearBadge();
  }
}

export async function completeAreaScreenshot(rect: PixelRect, viewport: { width: number; height: number }): Promise<void> {
  const settings = await loadSettings();
  // A Flow Capture "Selected Area" capture: the image joins the flow instead of opening the editor.
  const flowArea = await takePendingFlowArea();
  if (flowArea) {
    try {
      const tab = await chrome.tabs.get(flowArea.tabId);
      const raw = await captureArea(tab, rect, viewport, settings.screenshot.scale);
      await addAreaImage(raw.canvas, raw.url, raw.title);
    } catch (err) {
      await cancelPendingCapture();
      throw err;
    }
    return;
  }
  const stored = (await chrome.storage.session.get(PENDING_AREA_KEY))[PENDING_AREA_KEY] as PendingArea | undefined;
  await chrome.storage.session.remove(PENDING_AREA_KEY);
  if (!stored) throw new AppError('cancelled', 'No pending area selection');
  try {
    const tab = await chrome.tabs.get(stored.tabId);
    const raw = await captureArea(tab, rect, viewport, settings.screenshot.scale);
    await finishScreenshot(raw, settings, tab, stored.ocr);
  } catch (err) {
    await reportCaptureError(err, settings);
    throw err;
  }
}

export async function cancelAreaScreenshot(): Promise<void> {
  await cancelPendingCapture();
  await chrome.storage.session.remove(PENDING_AREA_KEY);
}

/** Opens Pixora's popup (it shows the running capture); ignored where Chrome doesn't allow it. */
async function openPopupIn(windowId: number): Promise<void> {
  const action = chrome.action as unknown as { openPopup?: (o?: { windowId?: number }) => Promise<void> };
  try {
    await action.openPopup?.({ windowId });
  } catch {
    /* already open, window not focused, or not supported */
  }
}

async function countdownOnBadge(seconds: number): Promise<void> {
  // Badge updates are extension API calls, which also keep the service worker alive during the wait.
  for (let s = Math.round(seconds); s > 0; s--) {
    await setBadge(String(s), '#4F8DF7');
    await new Promise((r) => setTimeout(r, 1000));
  }
  await clearBadge();
}

async function finishScreenshot(raw: RawCapture, settings: Settings, sourceTab: chrome.tabs.Tab, ocr: boolean): Promise<void> {
  let last: Blob;
  try {
    last = await raw.canvas.convertToBlob({ type: 'image/png' });
  } catch (err) {
    throw new AppError('image-processing', String(err));
  }
  // A long full page can come in several parts (top first): each is a capture of its own.
  const images = [...(raw.parts ?? []), { blob: last, width: raw.canvas.width, height: raw.canvas.height }];
  const baseName = buildFilename(settings.general.filenamePattern, { type: 'Screenshot', title: raw.title, url: raw.url, extension: 'png' });
  const nameOf = (i: number) => (images.length > 1 ? baseName.replace(/(\.png)?$/i, ` (part ${i + 1} of ${images.length})$1`) : baseName);
  const ids: string[] = [];
  for (let i = 0; i < images.length; i++) {
    const im = images[i]!;
    try {
      const rec = await addCapture(
        {
          kind: 'screenshot',
          name: nameOf(i),
          mimeType: 'image/png',
          width: im.width,
          height: im.height,
          thumbnail: await generateImageThumbnail(im.blob),
          sourceTitle: raw.title,
          sourceUrl: raw.url,
          notes: i === 0 ? raw.notes : [],
          ocrRequested: ocr && i === 0,
        },
        im.blob,
      );
      ids.push(rec.id);
    } catch (err) {
      if (!isStorageUnavailable(err)) throw err;
      // Pixora's storage cannot be opened: save the screenshot straight to Downloads instead of losing it.
      for (let j = i; j < images.length; j++) await saveImageToDownloads(images[j]!.blob, nameOf(j));
      await notify('Screenshot saved to Downloads', 'Pixora’s storage could not be opened, so the editor cannot open it. Use Settings › Advanced › Repair storage.');
      return;
    }
  }
  const record = { id: ids[0]! };
  broadcast({ target: 'broadcast', type: 'history/changed' });

  const openEditor = settings.screenshot.autoOpenEditor || ocr;
  if (openEditor) {
    const params = new URLSearchParams({ id: record.id, fresh: '1' });
    // All parts of a long page open together in the editor's image panel.
    if (ids.length > 1) params.set('set', ids.join(','));
    if (ocr) params.set('ocr', '1');
    if (settings.screenshot.autoSave) params.set('autosave', '1');
    if (settings.screenshot.copyToClipboard) params.set('copy', '1');
    await chrome.tabs.create({
      url: chrome.runtime.getURL(`editor.html?${params.toString()}`),
      index: sourceTab.index + 1,
      openerTabId: sourceTab.id,
    });
    return;
  }
  if (settings.screenshot.autoSave) {
    for (const id of ids) await downloadCaptureFromBackground(id, settings.screenshot.format);
  }
  if (settings.general.notifications) {
    await notify('Screenshot captured', settings.screenshot.autoSave ? 'Saved to your downloads.' : 'Find it in Recent captures.', `capture:${record.id}`);
  }
}

async function reportCaptureError(err: unknown, settings: Settings): Promise<void> {
  const info = toAppError(err, 'capture');
  logger.error('screenshot failed', err);
  broadcast({ target: 'broadcast', type: 'capture/status', label: info.title, progress: null, error: info });
  if (settings.general.notifications && info.code !== 'cancelled') {
    await notify(info.title, [info.message, info.recovery].filter(Boolean).join(' '));
  }
}

/** Downloads a PNG from the service worker (no object URLs there: a data URL instead). */
async function saveImageToDownloads(blob: Blob, fileName: string): Promise<void> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  await chrome.downloads.download({ url: `data:image/png;base64,${btoa(bin)}`, filename: fileName, conflictAction: 'uniquify', saveAs: false });
}
