import type { FlowCaptureMode, FlowConfig, FlowDoc, FlowEvent, FlowItem, FlowState, FlowStep } from '@/shared/types';
import { broadcast } from '@/shared/messaging/client';
import { AppError, toAppError } from '@/shared/utils/errors';
import { createId } from '@/shared/utils/misc';
import { logger } from '@/shared/utils/logger';
import { loadSettings } from '@/settings/settings-service';
// Service workers cannot use dynamic import(): everything is imported statically.
import { addCapture, deleteCapture, getCapture, getCaptureBlob, updateCapture } from '@/history/history-service';
import { applyEvent, hashDistance, normalizeUrl, SAME_SCREEN_DISTANCE, wantsScreenshot } from '@/flow/flow-engine';
import { findDuplicate, getFlow, imageDigest, imageHash, putFlow, storeFlowImage, updateFlow } from '@/flow/flow-store';
import { captureVisibleTabRaw, waitUntilReady } from '@/screenshot/services/visible-capture';
import { captureFullPage } from '@/screenshot/services/full-page-capture';
import { injectOverlay, sendOverlay, sendOverlaySafe } from './overlay';
import { clearBadge, setBadge } from './badge';

/**
 * Flow Capture sessions: a collection of screenshots taken while browsing (Capture button in the
 * flow toolbar, in any mode), plus an interaction log and — when "Auto steps" is on — automatic
 * screenshots at meaningful actions. State survives popup closing and service-worker restarts
 * (chrome.storage.session); images and the flow document live in IndexedDB.
 */

const STATE_KEY = 'glint.flow.state';
const PENDING_AREA_KEY = 'glint.flow.pendingArea';
const ARMED_KEY = 'glint.flow.armed';
/** An armed start is used only within this time (the user answering Chrome's access prompt). */
const ARM_TTL_MS = 5 * 60_000;
const ALL_SITES = { origins: ['<all_urls>'] };

export const IDLE_FLOW: FlowState = {
  status: 'idle', flowId: null, tabIds: [], startedAt: null, accumulatedMs: 0, resumedAt: null, steps: 0, items: 0, config: null, windowId: null,
  busy: false, minimized: false, withRecording: false, limited: false, barWindowId: null, lastStep: null,
};

let state: FlowState = IDLE_FLOW;
let loaded: Promise<void> | null = null;
let queue: Promise<unknown> = Promise.resolve();
/** Last URL seen per tab (navigation dedup). */
const lastUrl = new Map<number, string>();

function ensureLoaded(): Promise<void> {
  if (!loaded) {
    loaded = chrome.storage.session.get(STATE_KEY).then((r) => {
      const stored = r[STATE_KEY] as FlowState | undefined;
      if (stored && typeof stored === 'object' && 'status' in stored) state = { ...IDLE_FLOW, ...stored };
    });
  }
  return loaded;
}

function serial<T>(fn: () => Promise<T>): Promise<T> {
  const next = queue.then(fn, fn);
  queue = next.catch(() => undefined);
  return next;
}

async function setState(patch: Partial<FlowState>): Promise<FlowState> {
  state = { ...state, ...patch };
  if (state.status !== 'recording') clearHoverShots();
  await chrome.storage.session.set({ [STATE_KEY]: state });
  broadcast({ target: 'broadcast', type: 'flow/state', state });
  if (state.status === 'recording' || state.status === 'paused') {
    if (!state.withRecording) void setBadge(String(state.items), state.status === 'paused' ? '#E0A100' : '#7C5CF6');
  } else if (!state.withRecording) {
    void clearBadge();
  }
  return state;
}

export async function getFlowState(): Promise<FlowState> {
  await ensureLoaded();
  return state;
}

export function flowElapsed(s: FlowState, now = Date.now()): number {
  return s.accumulatedMs + (s.status === 'recording' && s.resumedAt ? now - s.resumedAt : 0);
}

const active = () => state.status === 'recording' || state.status === 'paused';

/* ---------------------------------- start ---------------------------------- */

export interface StartFlowOptions {
  tabId: number;
  config: FlowConfig;
  /** Started by a video recording (no separate toolbar; finishes with the recording). */
  withRecording?: boolean;
  /** Host access was not granted: only the starting page can be followed. */
  limited?: boolean;
  /** Follow every tab the user activates or opens (window / desktop recordings). */
  followAll?: boolean;
}

async function hasAllSites(): Promise<boolean> {
  return chrome.permissions.contains(ALL_SITES).catch(() => false);
}

/* --------------------- start after Chrome's access prompt -------------------- */

interface ArmedStart {
  tabId: number;
  config: FlowConfig;
  at: number;
}

let armQueue: Promise<unknown> = Promise.resolve();

/**
 * The popup asks Chrome for all-sites access when a flow starts. Chrome's prompt closes the popup,
 * so the popup first "arms" the start here; the flow then starts as soon as access is granted
 * (permissions.onAdded), or when the popup is still open to report the answer.
 */
export async function armFlow(tabId: number, config: FlowConfig): Promise<void> {
  await chrome.storage.session.set({ [ARMED_KEY]: { tabId, config, at: Date.now() } satisfies ArmedStart });
}

/** Starts the armed flow once (whichever of the popup and the permission event comes first). */
export function startArmedFlow(): Promise<FlowState> {
  const run = armQueue.then(async () => {
    const r = await chrome.storage.session.get(ARMED_KEY);
    const armed = r[ARMED_KEY] as ArmedStart | undefined;
    await chrome.storage.session.remove(ARMED_KEY);
    if (!armed || Date.now() - armed.at > ARM_TTL_MS) return getFlowState();
    return startFlow({ tabId: armed.tabId, config: armed.config });
  });
  armQueue = run.catch(() => undefined);
  return run;
}

/** permissions.onAdded: start an armed flow, or lift the "this site only" limit of a running one. */
export async function onPermissionsAdded(perms: chrome.permissions.Permissions): Promise<void> {
  if (!perms.origins?.includes('<all_urls>')) return;
  await startArmedFlow().catch((err: unknown) => logger.warn('armed flow start failed', err));
  await serial(async () => {
    await ensureLoaded();
    if (active() && state.limited) await setState({ limited: false });
  });
}

export function startFlow(opts: StartFlowOptions): Promise<FlowState> {
  return serial(async () => {
    await ensureLoaded();
    if (active()) throw new AppError('already-recording', 'A flow capture is already running');
    if (opts.limited === undefined) opts = { ...opts, limited: !(await hasAllSites()) };
    const tab = await chrome.tabs.get(opts.tabId).catch(() => {
      throw new AppError('tab-closed');
    });
    const id = createId('f_');
    const now = Date.now();
    const doc: FlowDoc = {
      id, name: `Flow ${new Date(now).toLocaleString()}`, config: opts.config, items: [], steps: [], startedAt: now, ...(opts.limited ? { limited: true } : {}),
    };
    await putFlow(doc);
    lastUrl.set(opts.tabId, tab.url ?? '');
    await setState({
      ...IDLE_FLOW, status: 'recording', flowId: id, tabIds: [opts.tabId], startedAt: now, resumedAt: now, config: opts.config, windowId: tab.windowId,
      withRecording: Boolean(opts.withRecording), limited: Boolean(opts.limited), followAll: Boolean(opts.followAll),
    });
    await startTracking(opts.tabId);
    if (!opts.withRecording) await openFlowBar();
    return state;
  });
}

/** Injects the page overlay and starts the interaction tracker (best effort; restricted pages are skipped). */
async function startTracking(tabId: number): Promise<void> {
  if (!state.config) return;
  try {
    await injectOverlay(tabId);
    await sendOverlay(tabId, { target: 'content', type: 'overlay/flow', action: state.status === 'paused' ? 'pause' : 'start', config: state.config });
  } catch (err) {
    logger.info('flow tracking unavailable on this page', err);
  }
}

/* ------------------------------- flow toolbar ------------------------------ */

const BAR = { width: 500, height: 150, minimizedWidth: 260, minimizedHeight: 74 };

async function openFlowBar(): Promise<void> {
  const anchor = await chrome.windows.getLastFocused().catch(() => null);
  const left = Math.max(0, (anchor?.left ?? 0) + (anchor?.width ?? 1280) - BAR.width - 24);
  const top = Math.max(0, (anchor?.top ?? 0) + 90);
  const create = (b: { left?: number; top?: number }) => chrome.windows.create({ url: chrome.runtime.getURL('flowbar.html'), type: 'popup', width: BAR.width, height: BAR.height, focused: true, ...b });
  try {
    const win = await create({ left, top }).catch(() => create({}));
    await setState({ barWindowId: win?.id ?? null });
  } catch (err) {
    logger.warn('flow toolbar failed', err);
  }
}

export async function setFlowBarMinimized(minimized: boolean): Promise<void> {
  await ensureLoaded();
  if (state.barWindowId === null) return;
  await chrome.windows.update(state.barWindowId, minimized ? { width: BAR.minimizedWidth, height: BAR.minimizedHeight } : { width: BAR.width, height: BAR.height }).catch(() => undefined);
  await setState({ minimized });
}

async function closeFlowBar(): Promise<void> {
  if (state.barWindowId !== null) await chrome.windows.remove(state.barWindowId).catch(() => undefined);
}

/* --------------------------------- capture --------------------------------- */

/** The page to capture: the active tab of the last focused normal browser window. */
async function targetTab(): Promise<chrome.tabs.Tab> {
  const win = await chrome.windows.getLastFocused({ windowTypes: ['normal'] }).catch(() => null);
  const windowId = win?.id ?? state.windowId ?? undefined;
  const [tab] = await chrome.tabs.query({ active: true, ...(windowId !== undefined ? { windowId } : { lastFocusedWindow: true }) });
  if (!tab?.id) throw new AppError('tab-closed', 'No browser tab to capture');
  return tab;
}

async function nextSeq(): Promise<number> {
  const doc = state.flowId ? await getFlow(state.flowId) : undefined;
  return (doc?.items.length ?? 0) + 1;
}

/** Adds a captured image to the session and links interaction steps made since the last image. */
async function addItem(item: FlowItem, linkSteps: boolean): Promise<void> {
  if (!state.flowId) return;
  // Never keep the same picture twice: the new copy is dropped and the toolbar says so.
  const current = await getFlow(state.flowId);
  const dup = findDuplicate(current?.items ?? [], item.digest, item.id);
  if (dup >= 0) {
    await deleteCapture(item.id).catch(() => undefined);
    await setState({ lastStep: `Same as image ${dup + 1}: not added again` });
    return;
  }
  const doc = await updateFlow(state.flowId, (d) => {
    const steps = linkSteps ? d.steps.map((s) => (s.itemId ? s : { ...s, itemId: item.id })) : d.steps;
    return { ...d, items: [...d.items, item], steps };
  });
  await setState({ items: doc.items.length, lastStep: item.description || `Capture ${doc.items.length}` });
}

/** Capture button: takes a screenshot in the chosen mode with the existing screenshot engines. */
export function captureFlow(mode: FlowCaptureMode): Promise<void> {
  return serial(async () => {
    await ensureLoaded();
    if (state.status !== 'recording') throw new AppError('cancelled', state.status === 'paused' ? 'Flow capture is paused' : 'No flow capture is running');
    if (mode === 'screen' || mode === 'window') {
      // Chrome's screen / window picker runs in an extension page, which adds the image to the flow.
      await setState({ busy: true });
      await chrome.tabs.create({ url: chrome.runtime.getURL(`recorder.html?intent=screenshot&flow=${state.flowId}&source=${mode}`), active: true });
      return;
    }
    const tab = await targetTab();
    if (state.config && !state.tabIds.includes(tab.id!)) await followTab(tab.id!);
    if (mode === 'area') {
      await injectOverlay(tab.id!).catch(() => {
        throw new AppError('restricted-page');
      });
      await chrome.storage.session.set({ [PENDING_AREA_KEY]: { tabId: tab.id, flowId: state.flowId } });
      await setState({ busy: true });
      await chrome.windows.update(tab.windowId, { focused: true }).catch(() => undefined);
      await sendOverlay(tab.id!, { target: 'content', type: 'overlay/select', mode: 'area-screenshot' });
      return;
    }
    await setState({ busy: true });
    try {
      const settings = await loadSettings();
      let canvas: OffscreenCanvas;
      let url = tab.url ?? '';
      let title = tab.title ?? '';
      if (mode === 'full') {
        // The capture scrolls the page itself: that is not a user step.
        sendOverlaySafe(tab.id!, { target: 'content', type: 'overlay/flow', action: 'pause' });
        const raw = await captureFullPage(tab, settings.screenshot.fullPage, settings.screenshot.scale, (p) => void setBadge(`${Math.round(p * 100)}%`, '#7C5CF6'));
        canvas = raw.canvas;
        url = raw.url || url;
        title = raw.title || title;
      } else {
        await waitUntilReady(tab.id, 4000, 300);
        const bmp = await captureVisibleTabRaw(tab.windowId);
        canvas = new OffscreenCanvas(bmp.width, bmp.height);
        canvas.getContext('2d')!.drawImage(bmp, 0, 0);
        bmp.close();
      }
      const digest = await imageDigest(canvas);
      const existing = findDuplicate((await getFlow(state.flowId!))?.items ?? [], digest);
      if (existing >= 0) {
        await setState({ lastStep: `Same as image ${existing + 1}: not added again` });
        return;
      }
      const blob = await canvas.convertToBlob({ type: 'image/png' });
      const item = await storeFlowImage(state.flowId!, await nextSeq(), {
        blob, width: canvas.width, height: canvas.height, mode, auto: false, url, pageTitle: title, hash: await imageHash(canvas), digest,
      });
      await addItem(item, true);
    } catch (err) {
      throw new AppError(toAppError(err, 'capture').code, String(err));
    } finally {
      await setState({ busy: false });
      if (mode === 'full') {
        // Let the page's own scroll restore settle before tracking resumes.
        setTimeout(() => sendOverlaySafe(tab.id!, { target: 'content', type: 'overlay/flow', action: 'resume' }), 700);
      }
    }
  });
}

/** Selected-area capture finished in the page overlay (called by the screenshot service). */
export async function takePendingFlowArea(): Promise<{ tabId: number; flowId: string } | null> {
  const pending = (await chrome.storage.session.get(PENDING_AREA_KEY))[PENDING_AREA_KEY] as { tabId: number; flowId: string } | undefined;
  if (!pending) return null;
  await chrome.storage.session.remove(PENDING_AREA_KEY);
  return pending;
}

export function addAreaImage(canvas: OffscreenCanvas, url: string, title: string): Promise<void> {
  return serial(async () => {
    await ensureLoaded();
    try {
      if (!state.flowId) return;
      const digest = await imageDigest(canvas);
      const existing = findDuplicate((await getFlow(state.flowId))?.items ?? [], digest);
      if (existing >= 0) {
        await setState({ lastStep: `Same as image ${existing + 1}: not added again` });
        return;
      }
      const blob = await canvas.convertToBlob({ type: 'image/png' });
      const item = await storeFlowImage(state.flowId, await nextSeq(), { blob, width: canvas.width, height: canvas.height, mode: 'area', auto: false, url, pageTitle: title, hash: await imageHash(canvas), digest });
      await addItem(item, true);
    } finally {
      await setState({ busy: false });
    }
  });
}

/** An extension page (screen / window picker) stored an image for the flow. */
export function onPageImageAdded(item: FlowItem | null): Promise<void> {
  return serial(async () => {
    await ensureLoaded();
    if (item && state.flowId) await addItem(item, true);
    await setState({ busy: false });
  });
}

export async function cancelPendingCapture(): Promise<void> {
  await chrome.storage.session.remove(PENDING_AREA_KEY);
  if (state.busy) await setState({ busy: false });
}

export function undoLastCapture(): Promise<void> {
  return serial(async () => {
    await ensureLoaded();
    if (!state.flowId) return;
    const doc = await getFlow(state.flowId);
    const last = doc?.items[doc.items.length - 1];
    if (!doc || !last) return;
    await deleteCapture(last.id);
    const next = await updateFlow(state.flowId, (d) => ({ ...d, items: d.items.filter((i) => i.id !== last.id), steps: d.steps.map((s) => (s.itemId === last.id ? { ...s, itemId: undefined } : s)) }));
    await setState({ items: next.items.length, lastStep: next.items[next.items.length - 1]?.description ?? null });
  });
}

/* ------------------------------ auto steps & log ----------------------------- */

let lastAutoShot = 0;

/** Capture-on-hover pictures, one per tab: the control under the pointer before it was clicked. */
interface HoverShot {
  selector: string;
  bmp: ImageBitmap;
  at: number;
}
const hoverShots = new Map<number, HoverShot>();
/** A hover picture is used only for a click that follows soon after. */
const HOVER_SHOT_TTL_MS = 15_000;

function dropHoverShot(tabId: number): void {
  hoverShots.get(tabId)?.bmp.close();
  hoverShots.delete(tabId);
}

function clearHoverShots(): void {
  for (const id of [...hoverShots.keys()]) dropHoverShot(id);
}

/** The pointer rests on a control (capture-on-hover): picture the screen now, before the click. */
export function onFlowHover(tabId: number | undefined, selector: string): Promise<void> {
  return serial(async () => {
    await ensureLoaded();
    const c = state.config;
    if (state.status !== 'recording' || state.busy || !c || !c.autoSteps || c.shotTiming !== 'on-hover' || tabId === undefined || !state.tabIds.includes(tabId)) return;
    // Chrome allows about two visible-tab pictures per second (shared with the step pictures).
    if (Date.now() - lastAutoShot < Math.min(500, c.minShotIntervalMs)) return;
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (!tab?.active) return;
    try {
      const bmp = await captureVisibleTabRaw(tab.windowId);
      lastAutoShot = Date.now();
      dropHoverShot(tabId);
      hoverShots.set(tabId, { selector, bmp, at: lastAutoShot });
    } catch (err) {
      logger.info('hover picture skipped', err);
    }
  });
}

/** The hover picture of this click's control, if one was taken just before (removed from the cache). */
function takeHoverShot(tabId: number, selector: string | undefined): ImageBitmap | null {
  const shot = hoverShots.get(tabId);
  if (!shot) return null;
  hoverShots.delete(tabId);
  if (shot.selector !== selector || Date.now() - shot.at > HOVER_SHOT_TTL_MS) {
    shot.bmp.close();
    return null;
  }
  return shot.bmp;
}

/**
 * Step pictures still waiting for the page (loaders, a free capture). When the user does something
 * else (clicks, starts scrolling, types) the waiting picture is taken at once — otherwise it would
 * show the next step (a "Go to" picture already scrolled, a "Scroll" picture already showing the
 * page that opens after the following click). A click passes its press picture: the screen just
 * before the click is exactly how the previous step ended.
 */
type Interrupt = Promise<ImageBitmap | null> | null;
let pictureWaiters: Array<(shot: Interrupt) => void> = [];
function userActed(shot: Interrupt): void {
  const waiting = pictureWaiters;
  pictureWaiters = [];
  waiting.forEach((f) => f(shot));
}

/** The page reports that the user starts scrolling or presses a key (before the page changes). */
export function onFlowActivity(tabId: number | undefined): void {
  if (state.status !== 'recording' || tabId === undefined || !state.tabIds.includes(tabId)) return;
  userActed(null);
}

/** Interaction reported by a page overlay. */
export function onFlowEvent(tabId: number | undefined, ev: FlowEvent, windowId?: number): Promise<void> {
  // Capture-on-click: the picture is taken right now, before anything else (the page has not
  // reacted to the press yet), and used once the step is processed below.
  const c = state.config;
  const early =
    ev.kind === 'click' && c?.shotTiming === 'on-click' && c.autoSteps && state.status === 'recording' && !state.busy &&
    // Every click gets its own picture (Chrome's two-per-second limit is handled by queueing the capture).
    tabId !== undefined && state.tabIds.includes(tabId) && windowId !== undefined
      ? captureVisibleTabRaw(windowId).then((b) => b, () => null)
      : null;
  if (early) lastAutoShot = Date.now();
  // Anything the user does (not a page load) ends the wait of an earlier step's picture.
  if (ev.kind !== 'navigate' && tabId !== undefined && state.tabIds.includes(tabId)) userActed(early);
  return serial(async () => {
    await ensureLoaded();
    const pressShot = early ? await early : null;
    if (state.status !== 'recording' || state.busy || !state.flowId || !state.config || tabId === undefined || !state.tabIds.includes(tabId)) {
      pressShot?.close();
      return;
    }
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (!tab) {
      pressShot?.close();
      return;
    }
    const now = Date.now();
    const doc = await getFlow(state.flowId);
    if (!doc) return;
    const current = lastUrl.get(tabId) ?? tab.url ?? '';
    if (ev.kind === 'navigate') lastUrl.set(tabId, ev.url);
    const result = applyEvent(doc.steps, ev, { now, currentUrl: current, config: state.config });
    if (result.kind === 'skip') return;
    if (result.kind === 'update') {
      await updateFlow(state.flowId, (d) => ({ ...d, steps: d.steps.map((s, i) => (i === result.index ? { ...s, ...result.patch } : s)) }));
      await setState({ lastStep: result.patch.title ?? state.lastStep });
      return;
    }
    const recording = state.withRecording ? await chrome.storage.session.get('glint.recording.state') : null;
    const rs = recording?.['glint.recording.state'] as { accumulatedMs?: number; resumedAt?: number | null } | undefined;
    const step: FlowStep = {
      ...result.step,
      id: createId('st_'),
      url: ev.kind === 'navigate' ? ev.url : tab.url ?? current,
      pageTitle: ev.kind === 'navigate' ? ev.title : tab.title ?? '',
      at: now,
      elapsedMs: flowElapsed(state, now),
      ...(rs ? { videoMs: (rs.accumulatedMs ?? 0) + (rs.resumedAt ? now - rs.resumedAt : 0) } : {}),
    };
    const isNewPage = ev.kind === 'navigate' || !doc.items.some((i) => normalizeUrl(i.url) === normalizeUrl(step.url));
    let itemId: string | undefined;
    // Capture-on-hover: a click uses the picture taken while the pointer rested on the control.
    // Capture-on-click: the picture taken at the press (above). Both skip waiting for the page.
    const timing = state.config.shotTiming;
    const before = (timing === 'on-hover' || timing === 'on-click') && ev.kind === 'click';
    const pre = timing === 'on-hover' && ev.kind === 'click' ? takeHoverShot(tabId, ev.element.selector) : pressShot;
    if (pre !== pressShot) pressShot?.close();
    // Only the page on screen is pictured: a step from a background tab (a page still loading,
    // a tab the user left) would picture whatever else is visible in that window.
    const visible = tab.active === true;
    if (visible && state.config.autoSteps && wantsScreenshot(step.action, state.config, isNewPage) && (pre || now - lastAutoShot >= state.config.minShotIntervalMs)) {
      itemId = await autoShot(tab, step, doc, pre ?? undefined, before);
    } else pre?.close();
    await updateFlow(state.flowId, (d) => ({ ...d, steps: [...d.steps, { ...step, ...(itemId ? { itemId } : {}) }] }));
    await setState({ steps: doc.steps.length + 1, lastStep: step.title });
  });
}

/** Screenshot for an auto step; unchanged screens reuse the previous image instead of adding one. */
async function autoShot(tab: chrome.tabs.Tab, step: FlowStep, doc: FlowDoc, pre?: ImageBitmap, immediate = false): Promise<string | undefined> {
  try {
    // Interrupted when the user acts before the picture is taken (see userActed).
    let actedWith: Interrupt | undefined;
    let resolveActed: () => void = () => undefined;
    const acted = new Promise<void>((resolve) => { resolveActed = resolve; });
    const waiterSlot = (shot: Interrupt) => { actedWith = shot; resolveActed(); };
    if (!pre) pictureWaiters.push(waiterSlot);
    const waitForPage = (async () => {
      // "Wait before picture": -1 automatic (below), 0 no delay, otherwise a fixed wait.
      const fixed = state.config?.shotDelayMs ?? -1;
      if (pre || immediate) {
        // Capture-on-hover: the picture shows the screen before the click (no waiting for the page).
      } else if (fixed >= 0) {
        if (fixed > 0) await new Promise((r) => setTimeout(r, fixed));
      } else if (step.action === 'navigate') await new Promise((r) => setTimeout(r, 500));
      // Steps are reported on pointer-down: give the page a moment to react (open the dropdown,
      // tick the box), then wait for its opening animation so nothing is captured half-drawn.
      else if (step.action !== 'scroll') await new Promise((r) => setTimeout(r, 220));
      // Clicks often start a loader (spinner, skeleton, progress bar): wait for the real content.
      if (!pre && !immediate && fixed < 0) await waitUntilReady(tab.id, step.action === 'scroll' ? 1500 : 8000);
    })();
    if (!pre) await Promise.race([waitForPage, acted]);
    // The user may have switched tabs while the page was loading: then this step gets no picture.
    const still = pre ? tab : await chrome.tabs.get(tab.id!).catch(() => null);
    if (state.status !== 'recording' || !still?.active) {
      pre?.close();
      return undefined;
    }
    // Automatic pictures (no click press) leave Chrome's second capture of the second free for a click;
    // when the user acts meanwhile, the picture is taken now (or the click's press picture is used).
    let bmp: ImageBitmap | null = pre ?? null;
    if (!bmp && actedWith === undefined) bmp = await captureVisibleTabRaw(tab.windowId, 'low', () => actedWith !== undefined).catch((err: unknown) => (actedWith !== undefined ? null : Promise.reject(err)));
    if (!bmp && actedWith !== undefined) {
      const press = actedWith ? await actedWith : null;
      bmp = press ? await createImageBitmap(press) : await captureVisibleTabRaw(tab.windowId, 'high');
    }
    pictureWaiters = pictureWaiters.filter((f) => f !== waiterSlot);
    if (!bmp) return undefined;
    if (!pre) lastAutoShot = Date.now();
    const hash = await imageHash(bmp);
    const prev = [...doc.items].reverse().find((i) => i.auto);
    // Only scrolling is de-duplicated by the rough look of the screen: a page change or an Enter
    // (a search submitted on the same address) can look alike in a tiny thumbnail and still be a new
    // step. Exact repeats of any step are linked below instead of stored twice.
    const pageLevel = step.action === 'scroll';
    if (prev?.hash && pageLevel && normalizeUrl(prev.url) === normalizeUrl(step.url) && hashDistance(prev.hash, hash) <= SAME_SCREEN_DISTANCE) {
      bmp.close();
      return prev.id;
    }
    // The exact same picture is already in the flow (any position): link the step to it.
    const digest = await imageDigest(bmp);
    const same = findDuplicate(doc.items, digest);
    if (same >= 0) {
      bmp.close();
      return doc.items[same]!.id;
    }
    const canvas = new OffscreenCanvas(bmp.width, bmp.height);
    canvas.getContext('2d')!.drawImage(bmp, 0, 0);
    bmp.close();
    const blob = await canvas.convertToBlob({ type: 'image/png' });
    const item = await storeFlowImage(state.flowId!, doc.items.length + 1, {
      digest,
      blob, width: canvas.width, height: canvas.height, mode: 'visible', auto: true, url: step.url, pageTitle: step.pageTitle, description: step.title,
      ...(step.point ? { point: step.point } : {}), ...(step.highlight ? { highlight: step.highlight } : {}), hash,
    });
    await updateFlow(state.flowId!, (d) => ({ ...d, items: [...d.items, item] }));
    await setState({ items: doc.items.length + 1 });
    return item.id;
  } catch (err) {
    logger.info('auto step screenshot skipped', err);
    return undefined;
  }
}

/* ------------------------------ page following ------------------------------ */

async function followTab(tabId: number): Promise<void> {
  if (state.tabIds.includes(tabId)) return;
  await setState({ tabIds: [...state.tabIds, tabId] });
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (tab?.url) lastUrl.set(tabId, tab.url);
  await startTracking(tabId);
}

/** Full page loads: log the navigation and re-attach the tracker (needs host access). */
export function onTabUpdated(tabId: number, info: { status?: string; url?: string }, tab: chrome.tabs.Tab): Promise<void> {
  return serial(async () => {
    await ensureLoaded();
    if (!active() || !state.tabIds.includes(tabId)) return;
    if (info.status === 'complete' && tab.url && !state.limited) {
      await startTracking(tabId);
      const prev = lastUrl.get(tabId);
      if (prev !== undefined && normalizeUrl(prev) !== normalizeUrl(tab.url)) {
        // Queue after this update so onFlowEvent can run in order.
        setTimeout(() => void onFlowEvent(tabId, { kind: 'navigate', url: tab.url!, title: tab.title ?? '', via: 'load' }), 0);
      }
    }
  });
}

/** Links opened in a new tab from a followed tab are followed too. */
export function onTabCreated(tab: chrome.tabs.Tab): Promise<void> {
  return serial(async () => {
    await ensureLoaded();
    if (!active() || state.limited || tab.id === undefined) return;
    if (!state.followAll && (tab.openerTabId === undefined || !state.tabIds.includes(tab.openerTabId))) return;
    if (state.tabIds.includes(tab.id)) return;
    await setState({ tabIds: [...state.tabIds, tab.id] });
  });
}

/** Window / desktop recordings follow whichever page the user switches to. */
export function onTabActivated(tabId: number): Promise<void> {
  return serial(async () => {
    await ensureLoaded();
    if (!active() || state.limited || !state.followAll || state.tabIds.includes(tabId)) return;
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    // Only web pages: extension pages (the recorder, editors) are not part of the flow.
    if (!tab?.url || !/^(https?|file):/.test(tab.url)) return;
    await followTab(tabId);
  });
}

export function onFlowWindowRemoved(windowId: number): Promise<void> {
  return serial(async () => {
    await ensureLoaded();
    if (state.barWindowId === windowId) await setState({ barWindowId: null });
  });
}

/* ------------------------------ pause / finish ------------------------------ */

export function pauseFlow(paused: boolean): Promise<void> {
  return serial(async () => {
    await ensureLoaded();
    if (!active()) return;
    const now = Date.now();
    if (paused && state.status === 'recording') await setState({ status: 'paused', accumulatedMs: flowElapsed(state, now), resumedAt: null });
    else if (!paused && state.status === 'paused') await setState({ status: 'recording', resumedAt: now });
    for (const id of state.tabIds) sendOverlaySafe(id, { target: 'content', type: 'overlay/flow', action: paused ? 'pause' : 'resume' });
  });
}

/** Finishes the session: saves the flow to Recent captures and opens the Flow Editor (unless it belongs to a recording). */
export function finishFlow(recordingId?: string): Promise<string | null> {
  return serial(async () => {
    await ensureLoaded();
    if (!active() || !state.flowId) return null;
    const flowId = state.flowId;
    const withRecording = state.withRecording;
    for (const id of state.tabIds) sendOverlaySafe(id, { target: 'content', type: 'overlay/flow', action: 'stop' });
    await setState({ status: 'finishing' });
    const doc = await updateFlow(flowId, (d) => ({ ...d, endedAt: Date.now(), ...(recordingId ? { recordingId } : {}) }));
    // Nothing captured: just stop (no empty flow in Recent captures, no editor window).
    if (doc.items.length === 0 && !(withRecording && doc.steps.length > 0)) {
      await deleteCapture(flowId);
      await closeFlowBar();
      await setState({ ...IDLE_FLOW });
      lastUrl.clear();
      return null;
    }
    const first = doc.items[0] ? await getCapture(doc.items[0].id) : undefined;
    let size = 0;
    for (const item of doc.items) size += (await getCaptureBlob(item.id))?.size ?? 0;
    const summary = new Blob([JSON.stringify({ items: doc.items.length, steps: doc.steps.length })], { type: 'application/json' });
    await addCapture(
      {
        id: flowId,
        kind: 'flow',
        name: doc.name,
        mimeType: 'application/vnd.glint.flow+json',
        width: first?.width ?? 0,
        height: first?.height ?? 0,
        thumbnail: first?.thumbnail,
        sourceTitle: `${doc.items.length} image${doc.items.length === 1 ? '' : 's'} · ${doc.steps.length} step${doc.steps.length === 1 ? '' : 's'}`,
        sourceUrl: doc.items[0]?.url ?? doc.steps[0]?.url,
        durationMs: (doc.endedAt ?? Date.now()) - doc.startedAt,
      },
      summary,
    );
    // The size shown in Recent captures includes the images.
    await updateCapture(flowId, { size: size + summary.size }).catch(() => undefined);
    await closeFlowBar();
    await setState({ ...IDLE_FLOW });
    lastUrl.clear();
    broadcast({ target: 'broadcast', type: 'history/changed' });
    if (!withRecording) await chrome.tabs.create({ url: chrome.runtime.getURL(`flow.html?id=${encodeURIComponent(flowId)}`), active: true });
    return flowId;
  });
}

/** Cancels the session and deletes everything it captured (the UI asks for confirmation first). */
export function cancelFlow(): Promise<void> {
  return serial(async () => {
    await ensureLoaded();
    if (!active() || !state.flowId) return;
    const flowId = state.flowId;
    for (const id of state.tabIds) sendOverlaySafe(id, { target: 'content', type: 'overlay/flow', action: 'stop' });
    await deleteCapture(flowId);
    await closeFlowBar();
    await setState({ ...IDLE_FLOW });
    lastUrl.clear();
  });
}

/** Called on service-worker start: a session interrupted by a browser restart is finished and kept. */
export async function verifyFlowAfterRestart(): Promise<void> {
  await ensureLoaded();
  if (state.status === 'finishing') await setState({ status: 'recording' });
  if (active() && state.flowId && !(await getFlow(state.flowId))) await setState({ ...IDLE_FLOW });
}
