import type { AppErrorInfo, ControlBarPosition, RecordingConfig, RecordingEvent, RecordingState, RelativeRect } from '@/shared/types';
import type { ContentMessage, RecordingCommand } from '@/shared/messaging/messages';
import { broadcast, sendToHost } from '@/shared/messaging/client';
import { AppError, makeErrorInfo, toAppError } from '@/shared/utils/errors';
import { createId } from '@/shared/utils/misc';
import { logger } from '@/shared/utils/logger';
import { loadSettings } from '@/settings/settings-service';
import { INITIAL_RECORDING_STATE, elapsedMs, isBusy, recordingReducer } from '@/recording/services/recording-state';
import { getSessionMeta } from '@/recording/services/chunk-store';
import { finalizeRecording } from '@/recording/services/recording-session';
import { updateCapture } from '@/history/history-service';
import { cancelFlow, finishFlow, getFlowState, startFlow } from './flow-manager';
import { badgeForRecording, notify } from './badge';
import { closeOffscreenDocument, ensureOffscreenDocument, hasOffscreenDocument } from './offscreen-manager';
import { injectOverlay, sendOverlay, sendOverlaySafe } from './overlay';
import { CAMERA_BG_IMAGE_KEY } from '@/shared/constants/camera';

/**
 * Authoritative recording state lives here (service worker) and is mirrored to
 * chrome.storage.session so it survives service-worker suspension. The media itself lives in a
 * recording host (offscreen document or recorder tab), which reports events back.
 */
const STATE_KEY = 'glint.recording.state';
const PENDING_KEY = 'glint.recording.pending';

export interface PendingRecording {
  sessionId: string;
  config: RecordingConfig;
  tabId: number | null;
  autoStart: boolean;
}

let state: RecordingState = INITIAL_RECORDING_STATE;
let loaded: Promise<void> | null = null;
let queue: Promise<unknown> = Promise.resolve();

function ensureLoaded(): Promise<void> {
  if (!loaded) {
    loaded = chrome.storage.session.get(STATE_KEY).then((res) => {
      const stored = res[STATE_KEY] as RecordingState | undefined;
      if (stored && typeof stored === 'object' && 'status' in stored) state = { ...INITIAL_RECORDING_STATE, ...stored };
    });
  }
  return loaded;
}

/** Serialises state updates so concurrent host messages cannot interleave. */
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const next = queue.then(fn, fn);
  queue = next.catch(() => undefined);
  return next;
}

export async function getRecordingState(): Promise<RecordingState> {
  await ensureLoaded();
  return state;
}

async function dispatch(event: RecordingEvent): Promise<RecordingState> {
  await ensureLoaded();
  const prev = state;
  const next = recordingReducer(prev, event);
  if (next === prev) return prev;
  state = next;
  await chrome.storage.session.set({ [STATE_KEY]: state });
  broadcast({ target: 'broadcast', type: 'recording/state', state });
  void badgeForRecording(state);
  void sideEffects(prev, next, event);
  return state;
}

/** Serialised state update for other background modules (markers, live effects). */
export function recordingDispatch(event: RecordingEvent): Promise<RecordingState> {
  return serial(() => dispatch(event));
}

/** Stores the markers added while recording with the finished capture. */
async function saveMarkers(captureId: string, markers: RecordingState['markers']): Promise<void> {
  if (!markers.length) return;
  await updateCapture(captureId, { markers }).catch((err: unknown) => logger.warn('saving markers failed', err));
}

async function getPendingStore(): Promise<PendingRecording | null> {
  const res = await chrome.storage.session.get(PENDING_KEY);
  return (res[PENDING_KEY] as PendingRecording | undefined) ?? null;
}

export async function getPending(sessionId: string): Promise<PendingRecording> {
  const pending = await getPendingStore();
  if (!pending || pending.sessionId !== sessionId) throw new AppError('cancelled', 'No pending recording for this session');
  return pending;
}

/* --------------------------------- start --------------------------------- */

export function startRecording(config: RecordingConfig, tabId: number | null, autoStart = false): Promise<RecordingState> {
  return serial(async () => {
    await ensureLoaded();
    if (isBusy(state)) throw new AppError('already-recording');
    if (state.status === 'error') await dispatch({ type: 'RESET' });

    const sessionId = createId('r_');
    await dispatch({ type: 'PREPARE', sessionId, mode: config.mode, maxDurationMs: config.maxDurationMs, targetTabId: tabId });
    if (config.camera.background?.mode === 'image' && !config.camera.background.image) {
      const stored = ((await chrome.storage.local.get(CAMERA_BG_IMAGE_KEY).catch(() => ({}))) as Record<string, unknown>)[CAMERA_BG_IMAGE_KEY];
      config = { ...config, camera: { ...config.camera, background: { ...config.camera.background, image: typeof stored === 'string' ? stored : undefined } } };
    }
    const pending: PendingRecording = { sessionId, config, tabId, autoStart };
    await chrome.storage.session.set({ [PENDING_KEY]: pending });

    try {
      switch (config.mode) {
        case 'tab':
          await beginTabCapture(pending, null);
          break;
        case 'area':
          if (tabId === null) throw new AppError('source-unavailable', 'No tab to record');
          await injectOverlay(tabId);
          await dispatch({ type: 'SELECTING' });
          await sendOverlay(tabId, { target: 'content', type: 'overlay/select', mode: 'area-record' });
          break;
        case 'desktop':
        case 'camera': {
          const tab = await chrome.tabs.create({ url: chrome.runtime.getURL(`recorder.html?session=${sessionId}`), active: true });
          await dispatch({ type: 'HOST_ASSIGNED', host: 'recorder-tab', hostTabId: tab.id ?? null });
          break;
        }
      }
    } catch (err) {
      await failSession(toAppError(err, 'screen'));
      throw err;
    }
    return state;
  });
}

/** The tab's viewport in physical pixels (null on pages that block scripts). */
async function tabPixelSize(tabId: number): Promise<{ width: number; height: number } | null> {
  try {
    const [res] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => ({ width: Math.round(window.innerWidth * (window.devicePixelRatio || 1)), height: Math.round(window.innerHeight * (window.devicePixelRatio || 1)) }),
    });
    const r = res?.result as { width: number; height: number } | undefined;
    return r && r.width > 0 && r.height > 0 ? r : null;
  } catch {
    return null;
  }
}

async function beginTabCapture(pending: PendingRecording, area: RelativeRect | null): Promise<void> {
  const { config, tabId, sessionId } = pending;
  if (tabId === null) throw new AppError('source-unavailable', 'No tab to record');
  const tab = await chrome.tabs.get(tabId).catch(() => {
    throw new AppError('tab-closed');
  });
  // The page overlay powers the countdown, click effects, cursor tracking for zoom / spotlight,
  // live drawing and the marker shortcut. Optional: recording still works on pages that block it.
  if (config.mode === 'tab') {
    // Optional for full-tab recording; the recording still works on pages that block scripts.
    await injectOverlay(tabId).catch((err: unknown) => logger.warn('overlay injection failed', err));
  }
  let streamId: string;
  try {
    streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId });
  } catch (err) {
    throw new AppError(toAppError(err, 'screen').code === 'restricted-page' ? 'restricted-page' : 'permission-denied-screen', String(err));
  }
  // The tab's real pixel size: Chrome then captures it 1:1 instead of scaling it into its own size.
  const sourceSize = await tabPixelSize(tabId);
  await ensureOffscreenDocument();
  await dispatch({ type: 'HOST_ASSIGNED', host: 'offscreen', hostTabId: null });
  await sendToHost({
    target: 'host',
    type: 'host/start',
    sessionId,
    config,
    streamId,
    area,
    tabId,
    sourceTitle: tab.title,
    sourceUrl: tab.url,
    ...(sourceSize ? { sourceSize } : {}),
  });
}

export function onAreaSelected(rect: RelativeRect): Promise<void> {
  return serial(async () => {
    await ensureLoaded();
    if (state.status !== 'selecting') return;
    const pending = await getPendingStore();
    if (!pending || pending.sessionId !== state.sessionId) return;
    await dispatch({ type: 'AREA', area: rect });
    try {
      await beginTabCapture(pending, rect);
    } catch (err) {
      await failSession(toAppError(err, 'screen'));
    }
  });
}

export function onAreaCancelled(): Promise<void> {
  return serial(async () => {
    await ensureLoaded();
    if (state.status === 'selecting') await dispatch({ type: 'RESET' });
  });
}

/* -------------------------------- commands ------------------------------- */

export function sendCommand(command: RecordingCommand): Promise<void> {
  return serial(async () => {
    await ensureLoaded();
    if (state.status === 'error' && command === 'cancel') {
      await dispatch({ type: 'RESET' });
      return;
    }
    if (!isBusy(state) || !state.sessionId) return;
    if (state.status === 'selecting') {
      if (command === 'stop' || command === 'cancel') {
        sendOverlaySafe(state.targetTabId, { target: 'content', type: 'overlay/teardown' });
        await dispatch({ type: 'RESET' });
      }
      return;
    }
    try {
      await sendToHost({ target: 'host', type: 'host/command', sessionId: state.sessionId, command });
    } catch (err) {
      logger.warn('host unreachable, recovering', err);
      await recoverOrphanedSession('Recording host stopped responding.');
    }
  });
}

/* ------------------------------ host reports ----------------------------- */

export function onHostEvent(sessionId: string, event: RecordingEvent): Promise<void> {
  return serial(async () => {
    await ensureLoaded();
    if (sessionId !== state.sessionId) return;
    await dispatch(event);
  });
}

export function onHostFinished(sessionId: string, captureId: string | null, error?: AppErrorInfo): Promise<void> {
  return serial(async () => {
    await ensureLoaded();
    if (sessionId !== state.sessionId) return;
    const { host, hostTabId, markers } = state;
    const pending = await getPendingStore();
    await chrome.storage.session.remove(PENDING_KEY);
    if (error?.code === 'saved-to-downloads') {
      // Not a failure: the recording was kept (in Downloads, because Pixora's storage is unavailable).
      await dispatch({ type: 'RESET' });
      sendOverlaySafe(state.targetTabId, { target: 'content', type: 'overlay/teardown' });
      const settings = await loadSettings();
      if (settings.general.notifications) await notify(error.title, [error.message, error.recovery].filter(Boolean).join(' '));
    } else if (error && error.code !== 'cancelled') {
      await failSession(error);
    } else {
      await dispatch({ type: 'RESET' });
    }
    const flowState = await getFlowState();
    if (flowState.withRecording && flowState.status !== 'idle' && error?.code === 'cancelled' && !captureId) {
      // Recording discarded: its flow goes too.
      await cancelFlow().catch(() => undefined);
    } else if (flowState.withRecording && flowState.status !== 'idle') {
      const flowId = await finishFlow(captureId ?? undefined).catch(() => null);
      if (flowId && captureId) await updateCapture(captureId, { linkedFlowId: flowId }).catch(() => undefined);
    }
    if (captureId) {
      await saveMarkers(captureId, markers);
      broadcast({ target: 'broadcast', type: 'history/changed' });
      await openResult(captureId, pending?.config.autoSave ?? false, host === 'recorder-tab' ? hostTabId : null);
    } else if (host === 'recorder-tab' && hostTabId !== null && error?.code === 'cancelled') {
      await chrome.tabs.remove(hostTabId).catch(() => undefined);
    }
    if (host === 'offscreen') await closeOffscreenDocument();
  });
}

async function openResult(captureId: string, autoSave: boolean, reuseTabId: number | null): Promise<void> {
  const url = chrome.runtime.getURL(`video.html?id=${encodeURIComponent(captureId)}${autoSave ? '&autosave=1' : ''}`);
  if (reuseTabId !== null) {
    const ok = await chrome.tabs.update(reuseTabId, { url, active: true }).then(() => true, () => false);
    if (ok) return;
  }
  await chrome.tabs.create({ url, active: true });
}

async function failSession(error: AppErrorInfo): Promise<void> {
  const { targetTabId } = state;
  await dispatch({ type: 'FAILED', error });
  sendOverlaySafe(targetTabId, { target: 'content', type: 'overlay/teardown' });
  const settings = await loadSettings();
  if (settings.general.notifications && error.code !== 'cancelled') {
    await notify(error.title, [error.message, error.recovery].filter(Boolean).join(' '));
  }
}

/* ------------------------------ side effects ----------------------------- */

async function sideEffects(prev: RecordingState, next: RecordingState, event: RecordingEvent): Promise<void> {
  const pending = await getPendingStore();
  const config = pending?.config;
  const tabCapture = next.mode === 'tab' || next.mode === 'area';

  if (event.type === 'COUNTDOWN' && tabCapture && next.targetTabId !== null && event.endsAt > Date.now()) {
    sendOverlaySafe(next.targetTabId, {
      target: 'content',
      type: 'overlay/countdown',
      seconds: Math.max(1, Math.round((event.endsAt - Date.now()) / 1000)),
    });
  }

  if (event.type === 'STARTED') {
    if (config?.controlBar) await openControlBar(config.controlBarPosition);
    if (next.cameraAvailable && config) await recordingDispatch({ type: 'EFFECT', effect: { kind: 'camera', patch: config.cameraStyle } });
    // Flow Capture alongside the recording (browser interactions of the recorded / active tab).
    if (config?.flow && next.targetTabId !== null) {
      const flowState = await getFlowState();
      if (flowState.status === 'idle') {
        // Window and desktop recordings show every page, so the flow follows all of them.
        const followAll = next.mode !== 'tab' && next.mode !== 'area';
        await startFlow({ tabId: next.targetTabId, config: config.flow, withRecording: true, followAll }).catch((err: unknown) => logger.warn('flow with recording failed', err));
      }
    }
    if (next.targetTabId !== null && config && next.mode !== 'camera') {
      const fx = pageEffects(config, next.mode);
      if (fx) {
        // Tab recordings already have the overlay (countdown, area frame).
        if (!tabCapture) await injectOverlay(next.targetTabId).catch(() => undefined);
        await injectFrames(next.targetTabId);
        sendOverlaySafe(next.targetTabId, fx);
        fxTabs.add(next.targetTabId);
      }
    }
    if (next.mode === 'area' && next.area) {
      sendOverlaySafe(next.targetTabId, { target: 'content', type: 'overlay/area-frame', rect: next.area });
    }
  }

  const ended = (next.status === 'idle' || next.status === 'error') && prev.status !== 'idle' && prev.status !== 'error';
  if (ended) {
    sendOverlaySafe(prev.targetTabId, { target: 'content', type: 'overlay/teardown' });
    for (const id of fxTabs) if (id !== prev.targetTabId) sendOverlaySafe(id, { target: 'content', type: 'overlay/teardown' });
    fxTabs.clear();
    await closeControlBar(next.controlBarWindowId ?? prev.controlBarWindowId);
  }
}

/* ---------------------- click / key effects on every page ---------------------- */

/** Pages that got the click / key / cursor effects during this recording (removed at the end). */
const fxTabs = new Set<number>();

/**
 * What the recorded page draws: click highlights, key combos, cursor halo / styled cursor and the
 * mouse position for zoom. Null when nothing is wanted.
 */
export function pageEffects(config: RecordingConfig, mode: RecordingState['mode']): Extract<ContentMessage, { type: 'overlay/effects' }> | null {
  if (mode === 'camera') return null;
  const tabCapture = mode === 'tab' || mode === 'area';
  // The styled cursor is drawn into the page, so it only makes sense when the tab itself is
  // recorded. Desktop / window recordings show the real cursor (Chrome records it); a page-drawn
  // copy would trail behind it and freeze when the mouse leaves the page.
  const cursor = tabCapture ? config.cursorEffects : { ...config.cursorEffects, pointer: false, hideSystemCursor: false };
  const wanted = config.highlightClicks || config.highlightKeys || cursor.cursor || Boolean(cursor.pointer);
  // Desktop recordings: the page also reports the mouse, so zoom follows it (placed on the screen by the recorder).
  if (!tabCapture && !wanted && mode !== 'desktop') return null;
  // Cursor positions drive zoom / spotlight; only meaningful when the tab itself (or the desktop) is recorded.
  return { target: 'content', type: 'overlay/effects', cursor, clicks: config.highlightClicks, keys: config.highlightKeys, track: tabCapture || mode === 'desktop' };
}

/** Puts the effects into a page (again): a page that was just loaded starts without them. */
async function applyPageEffects(tabId: number): Promise<void> {
  const config = (await getPendingStore())?.config;
  const fx = config ? pageEffects(config, state.mode) : null;
  if (!fx) return;
  try {
    await injectOverlay(tabId);
  } catch {
    return; // A browser page, or no access to this site.
  }
  await injectFrames(tabId);
  sendOverlaySafe(tabId, fx);
  fxTabs.add(tabId);
}

/** Embedded frames (videos, forms, editors in iframes) show their clicks too, where the site allows it. */
async function injectFrames(tabId: number): Promise<void> {
  await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files: ['content/overlay.js'] }).catch(() => undefined);
}

const recordingNow = () => state.status === 'recording' || state.status === 'paused';

/** The recorded page loaded a new page (link, form, reload): its click highlights come back. */
export function onRecordingTabUpdated(tabId: number, info: { status?: string }, tab: chrome.tabs.Tab): Promise<void> {
  return serial(async () => {
    await ensureLoaded();
    // As soon as the new page starts (clicks while a slow page is still loading), and again once it has loaded.
    if ((info.status !== 'loading' && info.status !== 'complete') || !recordingNow()) return;
    const followsActive = state.mode === 'desktop'; // (screen or window)
    if (tabId === state.targetTabId || (followsActive && tab.active) || fxTabs.has(tabId)) await applyPageEffects(tabId);
  });
}

/** Screen and window recordings show whichever tab is chosen: it gets the effects too. */
export function onRecordingTabActivated(tabId: number): Promise<void> {
  return serial(async () => {
    await ensureLoaded();
    if (!recordingNow() || state.mode !== 'desktop' || fxTabs.has(tabId)) return;
    await applyPageEffects(tabId);
  });
}

/* ------------------------------- control bar ----------------------------- */

const BAR_SIZE = { width: 640, height: 92, minimizedWidth: 270, expandedHeight: 360 };

async function openControlBar(position: ControlBarPosition): Promise<void> {
  if (state.controlBarWindowId !== null) return;
  const anchor = await chrome.windows.getLastFocused().catch(() => null);
  const ax = anchor?.left ?? 0;
  const ay = anchor?.top ?? 0;
  const aw = anchor?.width ?? 1280;
  const ah = anchor?.height ?? 800;
  const margin = 24;
  let left = position.endsWith('left') ? ax + margin : position.endsWith('right') ? ax + aw - BAR_SIZE.width - margin : ax + Math.round((aw - BAR_SIZE.width) / 2);
  let top = position.startsWith('top') ? ay + 80 : ay + ah - BAR_SIZE.height - margin;
  // Keep the bar fully on the display the browser window is on (Chrome rejects off-screen bounds).
  const area = await displayAreaFor(ax + aw / 2, ay + ah / 2);
  if (area) {
    left = Math.max(area.left, Math.min(left, area.left + area.width - BAR_SIZE.width));
    top = Math.max(area.top, Math.min(top, area.top + area.height - BAR_SIZE.height));
  }
  const create = (bounds: { left?: number; top?: number }) =>
    chrome.windows.create({ url: chrome.runtime.getURL('controlbar.html'), type: 'popup', width: BAR_SIZE.width, height: BAR_SIZE.height, focused: false, ...bounds });
  try {
    const win = await create({ left: Math.round(left), top: Math.round(top) }).catch(() => create({}));
    await dispatch({ type: 'CONTROL_BAR', windowId: win?.id ?? null });
  } catch (err) {
    logger.warn('control bar failed', err);
  }
}

async function displayAreaFor(x: number, y: number): Promise<chrome.system.display.Bounds | null> {
  try {
    const displays = await chrome.system.display.getInfo();
    const hit = displays.find((d) => x >= d.workArea.left && x < d.workArea.left + d.workArea.width && y >= d.workArea.top && y < d.workArea.top + d.workArea.height);
    return (hit ?? displays.find((d) => d.isPrimary) ?? displays[0])?.workArea ?? null;
  } catch {
    return null;
  }
}

export async function resizeControlBar(minimized: boolean, expanded = false): Promise<void> {
  await ensureLoaded();
  if (state.controlBarWindowId === null) return;
  const win = await chrome.windows.get(state.controlBarWindowId).catch(() => null);
  const height = expanded && !minimized ? BAR_SIZE.expandedHeight : BAR_SIZE.height;
  // Panels open upwards when the bar sits near the bottom of the screen.
  let top = win?.top !== undefined && win.height !== undefined ? Math.max(0, win.top + win.height - height) : undefined;
  const area = win?.left !== undefined && win.top !== undefined ? await displayAreaFor(win.left + 10, win.top + 10) : null;
  if (area && top !== undefined) top = Math.max(area.top, Math.min(top, area.top + area.height - height));
  await chrome.windows
    .update(state.controlBarWindowId, { width: minimized ? BAR_SIZE.minimizedWidth : BAR_SIZE.width, height, ...(top !== undefined ? { top } : {}) })
    .catch(() => undefined);
}

async function closeControlBar(windowId: number | null): Promise<void> {
  if (windowId === null) return;
  await chrome.windows.remove(windowId).catch(() => undefined);
  if (state.controlBarWindowId === windowId) await dispatch({ type: 'CONTROL_BAR', windowId: null });
}

export function onWindowRemoved(windowId: number): Promise<void> {
  return serial(async () => {
    await ensureLoaded();
    if (state.controlBarWindowId === windowId) await dispatch({ type: 'CONTROL_BAR', windowId: null });
  });
}

/* --------------------------- interruption / recovery --------------------- */

export function onTabRemoved(tabId: number): Promise<void> {
  return serial(async () => {
    await ensureLoaded();
    if (!isBusy(state)) return;
    if (state.host === 'recorder-tab' && tabId === state.hostTabId) {
      await recoverOrphanedSession('The recording tab was closed.');
    } else if (tabId === state.targetTabId && (state.mode === 'tab' || state.mode === 'area') && state.sessionId) {
      if (state.status === 'selecting') {
        await dispatch({ type: 'RESET' });
      } else {
        // The offscreen host also sees the track end; this is a safety net.
        await sendToHost({ target: 'host', type: 'host/command', sessionId: state.sessionId, command: 'stop' }).catch(() => undefined);
      }
    }
  });
}

/** Saves whatever chunks a dead host left behind, then resets. */
async function recoverOrphanedSession(reason: string): Promise<void> {
  const sessionId = state.sessionId;
  const duration = elapsedMs(state);
  if (!sessionId) {
    await dispatch({ type: 'RESET' });
    return;
  }
  const meta = await getSessionMeta(sessionId).catch(() => undefined);
  let captureId: string | null = null;
  if (meta) {
    try {
      captureId = await finalizeRecording(meta, Math.max(meta.activeMs, duration), { reason: 'recovered', thumbnail: false });
    } catch (err) {
      logger.error('recovery failed', err);
    }
  }
  await chrome.storage.session.remove(PENDING_KEY);
  if (captureId) {
    await saveMarkers(captureId, state.markers);
    await dispatch({ type: 'RESET' });
    broadcast({ target: 'broadcast', type: 'history/changed' });
    await openResult(captureId, false, null);
    await notify('Recording saved', `${reason} Everything recorded up to that point was saved.`);
  } else if (state.status === 'preparing' || state.status === 'countdown' || state.status === 'selecting') {
    await dispatch({ type: 'RESET' });
  } else {
    await failSession(makeErrorInfo('recording-interrupted', reason));
  }
}

/** Called when the service worker starts: verifies the host of an in-flight recording still exists. */
export async function verifyAfterRestart(): Promise<void> {
  await ensureLoaded();
  void badgeForRecording(state);
  if (!isBusy(state)) return;
  let alive = false;
  if (state.host === 'offscreen') alive = await hasOffscreenDocument();
  else if (state.host === 'recorder-tab' && state.hostTabId !== null) {
    alive = await chrome.tabs.get(state.hostTabId).then(() => true, () => false);
  } else if (state.status === 'selecting' && state.targetTabId !== null) {
    alive = await chrome.tabs.get(state.targetTabId).then(() => true, () => false);
  }
  if (!alive) await serial(() => recoverOrphanedSession('Chrome stopped the recording unexpectedly.'));
}
