import type { AnnotateAction } from '@/shared/messaging/messages';
import type { LiveEffect, Marker, RelativeRect } from '@/shared/types';
import { sendToHost } from '@/shared/messaging/client';
import type { PageGeometry } from '@/recording/services/screen-map';
import { AppError } from '@/shared/utils/errors';
import { createId } from '@/shared/utils/misc';
import { elapsedMs, isBusy, isCapturing } from '@/recording/services/recording-state';
import { getRecordingState, recordingDispatch, sendCommand } from './recording-manager';
import { injectOverlay, sendOverlay, sendOverlaySafe } from './overlay';

/**
 * Live tools used while recording: chapter markers, zoom / spotlight / highlight / camera effects,
 * screen annotation and the teleprompter window. Recording state stays in recording-manager; this
 * module only translates user actions into state events, host messages and page overlay messages.
 */

/* --------------------------------- markers -------------------------------- */

export async function addMarker(name?: string, description?: string): Promise<Marker | null> {
  const state = await getRecordingState();
  if (!isCapturing(state)) return null;
  const marker: Marker = {
    id: createId('m_'),
    timeMs: Math.round(elapsedMs(state)),
    name: name?.trim() || `Marker ${state.markers.length + 1}`,
    ...(description?.trim() ? { description: description.trim() } : {}),
  };
  await recordingDispatch({ type: 'MARKER_ADD', marker });
  sendOverlaySafe(annotateTabId ?? state.targetTabId, { target: 'content', type: 'overlay/marker-added', marker });
  return marker;
}

export async function updateMarker(id: string, patch: { name?: string; description?: string; remove?: boolean }): Promise<void> {
  if (patch.remove) {
    await recordingDispatch({ type: 'MARKER_DELETE', id });
    return;
  }
  await recordingDispatch({
    type: 'MARKER_UPDATE',
    id,
    patch: { ...(patch.name !== undefined ? { name: patch.name.slice(0, 200) } : {}), ...(patch.description !== undefined ? { description: patch.description.slice(0, 2000) } : {}) },
  });
}

/* --------------------------------- effects -------------------------------- */

export async function applyEffect(effect: LiveEffect): Promise<void> {
  const state = await getRecordingState();
  if (!isBusy(state) || !state.sessionId) throw new AppError('cancelled', 'Not recording');
  await recordingDispatch({ type: 'EFFECT', effect });
  await sendToHost({ target: 'host', type: 'host/effect', sessionId: state.sessionId, effect }).catch(() => undefined);
}

/** Zoom level that fits a selected region (capped at 4×), centred on it. */
export function zoomForRegion(rect: RelativeRect): { level: number; center: { x: number; y: number } } {
  const level = Math.max(1, Math.min(4, 1 / Math.max(rect.width, rect.height, 0.05)));
  return { level: Math.round(level * 100) / 100, center: { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 } };
}

/** The web page the user is working on (active tab of the last focused normal window), if any. */
async function workingTab(state: { hostTabId: number | null; targetTabId: number | null }): Promise<chrome.tabs.Tab | null> {
  const win = await chrome.windows.getLastFocused({ windowTypes: ['normal'] }).catch(() => null);
  const [active] = win?.id !== undefined ? await chrome.tabs.query({ active: true, windowId: win.id }).catch(() => []) : [];
  const candidates = [active, state.targetTabId !== null ? await chrome.tabs.get(state.targetTabId).catch(() => undefined) : undefined];
  return candidates.find((t): t is chrome.tabs.Tab => !!t && t.id !== undefined && t.id !== state.hostTabId && /^https?:|^file:/.test(t.url ?? t.pendingUrl ?? 'https:')) ?? null;
}

/**
 * Choosing a zoom / highlight area shows Pixora's selection on the screen; recorded, it would be in
 * the video. The recording pauses while the area is chosen and resumes after (or on cancel).
 */
let pausedForRegion = false;
async function pauseForRegion(): Promise<void> {
  const state = await getRecordingState();
  if (state.status !== 'recording') return;
  await sendCommand('pause').catch(() => undefined);
  pausedForRegion = true;
}
export async function resumeAfterRegion(): Promise<void> {
  if (!pausedForRegion) return;
  pausedForRegion = false;
  await sendCommand('resume').catch(() => undefined);
}

export async function startRegionSelect(purpose: 'highlight' | 'zoom'): Promise<void> {
  const state = await getRecordingState();
  if (!isBusy(state) || !state.sessionId) return;
  const mode = purpose === 'zoom' ? 'region-zoom' : 'region-highlight';
  if (state.mode === 'tab' || state.mode === 'area') {
    if (state.targetTabId === null) return;
    await pauseForRegion();
    await sendOverlay(state.targetTabId, { target: 'content', type: 'overlay/select', mode });
    await chrome.tabs.update(state.targetTabId, { active: true }).catch(() => undefined);
    return;
  }
  if (state.mode === 'desktop') {
    // Choose the area where you are working: on the page itself. The recorder places it on the
    // recorded screen / window (and falls back to its live preview if the page isn't in the recording).
    const tab = await workingTab(state);
    if (tab?.id !== undefined) {
      try {
        await injectOverlay(tab.id);
        await pauseForRegion();
        await sendOverlay(tab.id, { target: 'content', type: 'overlay/select', mode });
        await chrome.tabs.update(tab.id, { active: true }).catch(() => undefined);
        await chrome.windows.update(tab.windowId, { focused: true }).catch(() => undefined);
        return;
      } catch {
        /* no access to that page: pick on the preview instead (the recorder pauses for it) */
        await resumeAfterRegion();
      }
    }
  }
  await pickOnPreview(state, purpose);
}

/** Desktop / camera fallback: the region is picked on the live preview in the recorder tab. */
async function pickOnPreview(state: { sessionId: string | null; hostTabId: number | null }, purpose: 'highlight' | 'zoom'): Promise<void> {
  if (!state.sessionId) return;
  await sendToHost({ target: 'host', type: 'host/region-select', sessionId: state.sessionId, purpose });
  if (state.hostTabId !== null) {
    const tab = await chrome.tabs.update(state.hostTabId, { active: true }).catch(() => null);
    if (tab?.windowId !== undefined) await chrome.windows.update(tab.windowId, { focused: true }).catch(() => undefined);
  }
}

export async function onRegionSelected(purpose: 'highlight' | 'zoom', rect: RelativeRect | null, page?: PageGeometry): Promise<void> {
  const state = await getRecordingState();
  // Chosen on a web page during a desktop / window recording: the recorder maps it onto its frames.
  if (page && rect && state.mode === 'desktop' && state.sessionId && isBusy(state)) {
    await sendToHost({ target: 'host', type: 'host/page-region', sessionId: state.sessionId, purpose, rect, page });
    return;
  }
  if (purpose === 'highlight') await applyEffect({ kind: 'highlight', rect });
  else if (!rect) await applyEffect({ kind: 'zoom', level: 1, center: null });
  else {
    const z = zoomForRegion(rect);
    await applyEffect({ kind: 'zoom', level: z.level, center: z.center });
  }
  await resumeAfterRegion();
}

/* -------------------------------- annotation ------------------------------- */

let annotateTabId: number | null = null;

/** Sends a drawing action to the page being recorded (or the active tab for desktop recordings). */
export async function annotate(action: AnnotateAction, fromTabId?: number): Promise<void> {
  const state = await getRecordingState();
  if (!isBusy(state)) throw new AppError('cancelled', 'Live drawing is available while recording.');
  if (fromTabId !== undefined) annotateTabId = fromTabId;
  let tabId = annotateTabId ?? state.targetTabId;
  if (state.mode === 'tab' || state.mode === 'area') tabId = state.targetTabId;
  if (tabId === null) {
    const [active] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    tabId = active?.id ?? null;
  }
  if (tabId === null) throw new AppError('restricted-page', 'No page to draw on.');
  if (action.kind === 'start') {
    try {
      await injectOverlay(tabId);
    } catch {
      throw new AppError(
        'restricted-page',
        'Chrome only lets Pixora draw on a page you opened Pixora on. Click the Pixora icon on that page (or use the “Toggle screen drawing” shortcut) and try again.',
      );
    }
  }
  annotateTabId = tabId;
  await sendOverlay(tabId, { target: 'content', type: 'overlay/annotate', action });
  if (action.kind === 'start' || action.kind === 'tool') await recordingDispatch({ type: 'ANNOTATING', on: true });
  if (action.kind === 'stop') await recordingDispatch({ type: 'ANNOTATING', on: false });
  if (action.kind === 'interact') await recordingDispatch({ type: 'ANNOTATING', on: !action.on });
}

/** The page told us drawing was switched on/off with a page shortcut. */
export async function onPageAnnotateState(drawing: boolean): Promise<void> {
  await recordingDispatch({ type: 'ANNOTATING', on: drawing });
}

export function resetLiveTools(): void {
  annotateTabId = null;
}

/* ------------------------------- teleprompter ------------------------------ */

const TELEPROMPTER_KEY = 'glint.teleprompter.window';

export async function openTeleprompter(): Promise<void> {
  const stored = (await chrome.storage.session.get(TELEPROMPTER_KEY))[TELEPROMPTER_KEY] as number | undefined;
  if (stored !== undefined) {
    const ok = await chrome.windows.update(stored, { focused: true }).then(() => true, () => false);
    if (ok) return;
  }
  const anchor = await chrome.windows.getLastFocused().catch(() => null);
  const width = 560;
  const height = 420;
  const win = await chrome.windows.create({
    url: chrome.runtime.getURL('teleprompter.html'),
    type: 'popup',
    width,
    height,
    left: Math.max(0, (anchor?.left ?? 0) + Math.round(((anchor?.width ?? 1280) - width) / 2)),
    top: Math.max(0, (anchor?.top ?? 0) + 60),
    focused: true,
  });
  if (win?.id !== undefined) await chrome.storage.session.set({ [TELEPROMPTER_KEY]: win.id });
}
