import type {
  AppErrorInfo, CursorEffects, FlowCaptureMode, FlowConfig, FlowEvent, FlowItem, FlowState, ScrollAreaChoice, LiveEffect, Marker, PixelRect, RecordingConfig, RecordingEvent, RecordingState, RelativeRect, ScreenshotMode,
} from '../types';
import { isPageGeometry, type PageGeometry } from '@/recording/services/screen-map';

/**
 * Every runtime message carries a `target` so each context can cheaply ignore traffic that is not
 * meant for it (chrome.runtime.sendMessage reaches every extension page at once).
 */
export type MessageTarget = 'background' | 'host' | 'offscreen' | 'broadcast' | 'content';

/* ----------------------------- to background ----------------------------- */
export type BackgroundMessage =
  | { target: 'background'; type: 'screenshot/capture'; mode: ScreenshotMode; tabId: number; delaySeconds?: number; ocr?: boolean; scrollAreas?: ScrollAreaChoice[] }
  | { target: 'background'; type: 'screenshot/scroll-areas'; tabId: number }
  /** Stop a full-page capture and keep what is captured so far (from the progress window). */
  | { target: 'background'; type: 'screenshot/stop-full' }
  | { target: 'background'; type: 'screenshot/highlight-area'; tabId: number; index: number | null; show: boolean }
  | { target: 'background'; type: 'screenshot/area-result'; rect: PixelRect; viewport: { width: number; height: number }; dpr: number }
  | { target: 'background'; type: 'screenshot/area-cancel' }
  | { target: 'background'; type: 'recording/start'; config: RecordingConfig; tabId: number | null }
  | { target: 'background'; type: 'recording/area-selected'; rect: RelativeRect }
  | { target: 'background'; type: 'recording/area-cancel' }
  | { target: 'background'; type: 'recording/command'; command: RecordingCommand }
  | { target: 'background'; type: 'recording/get-state' }
  | { target: 'background'; type: 'recording/get-pending'; sessionId: string }  | { target: 'background'; type: 'recording/host-event'; sessionId: string; event: RecordingEvent }
  | { target: 'background'; type: 'recording/host-finished'; sessionId: string; captureId: string | null; error?: AppErrorInfo }
  | { target: 'background'; type: 'controlbar/resize'; minimized: boolean; expanded?: boolean }
  | { target: 'background'; type: 'recording/marker'; name?: string; description?: string }
  /** The offscreen recorder cannot use the downloads API: the service worker saves its file (storage unavailable). */
  | { target: 'background'; type: 'recording/save-file'; url: string; filename: string }
  | { target: 'background'; type: 'recording/marker-update'; id: string; name?: string; description?: string; remove?: boolean }
  | { target: 'background'; type: 'recording/effect'; effect: LiveEffect }
  | { target: 'background'; type: 'recording/annotate'; action: AnnotateAction }
  | { target: 'background'; type: 'recording/region-select'; purpose: 'highlight' | 'zoom' }
  /** Choosing a zoom / highlight area was cancelled (the recording resumes). */
  | { target: 'background'; type: 'recording/region-cancelled' }
  /** `page`: where the page the area was chosen on sits on screen (desktop / window recordings map it onto the recording). */
  | { target: 'background'; type: 'recording/region-selected'; purpose: 'highlight' | 'zoom'; rect: RelativeRect | null; page?: PageGeometry }
  | { target: 'background'; type: 'teleprompter/open' }
  | { target: 'background'; type: 'flow/start'; tabId: number; config: FlowConfig; limited?: boolean }
  | { target: 'background'; type: 'flow/arm'; tabId: number; config: FlowConfig }
  | { target: 'background'; type: 'flow/start-armed' }
  | { target: 'background'; type: 'flow/event'; event: FlowEvent }
  /** The pointer rests on a control (capture-on-hover): picture it before the click. */
  | { target: 'background'; type: 'flow/hover'; selector: string }
  /** The user starts to scroll / types a navigation key: a step picture still waiting is taken now. */
  | { target: 'background'; type: 'flow/activity' }
  | { target: 'background'; type: 'flow/command'; command: 'pause' | 'resume' | 'finish' | 'cancel' }
  | { target: 'background'; type: 'flow/get-state' }
  | { target: 'background'; type: 'flow/capture'; mode: FlowCaptureMode }
  | { target: 'background'; type: 'flow/undo' }
  | { target: 'background'; type: 'flow/minimize'; minimized: boolean }
  | { target: 'background'; type: 'flow/page-image'; item: FlowItem | null }
  /** From Pixora's header window: the browser header strip (PNG data URL), or null when skipped. */
  | { target: 'background'; type: 'screenshot/header'; dataUrl: string | null }
  | { target: 'background'; type: 'history/open'; captureId: string }
  | { target: 'background'; type: 'schedule/update' };

export type RecordingCommand = 'pause' | 'resume' | 'toggle-pause' | 'stop' | 'cancel' | 'toggle-mic' | 'toggle-camera';

/* ------------------------- to the recording host ------------------------- */
export type HostMessage =
  | {
      target: 'host';
      type: 'host/start';
      sessionId: string;
      config: RecordingConfig;
      streamId: string;
      area: RelativeRect | null;
      tabId: number;
      sourceTitle?: string;
      sourceUrl?: string;
      /** The tab's size in physical pixels, so Chrome captures it 1:1 (no rescaling). */
      sourceSize?: { width: number; height: number };
    }
  | { target: 'host'; type: 'host/command'; sessionId: string; command: RecordingCommand }
  | { target: 'host'; type: 'host/effect'; sessionId: string; effect: LiveEffect }
  | { target: 'host'; type: 'host/region-select'; sessionId: string; purpose: 'highlight' | 'zoom' }
  /** An area chosen on a web page during a desktop / window recording: the host places it on the recording. */
  | { target: 'host'; type: 'host/page-region'; sessionId: string; purpose: 'highlight' | 'zoom'; rect: RelativeRect; page: PageGeometry }
  | { target: 'host'; type: 'host/ping' };

/* ------------------------ to the offscreen document ----------------------- */
export type OffscreenMessage =
  | { target: 'offscreen'; type: 'offscreen/object-url'; captureId: string; format?: 'png' | 'jpeg' | 'webp'; quality?: number }
  | { target: 'offscreen'; type: 'offscreen/revoke'; url: string };

/* ------------------------------- broadcast ------------------------------- */
export type BroadcastMessage =
  | { target: 'broadcast'; type: 'recording/state'; state: RecordingState }
  | { target: 'broadcast'; type: 'history/changed' }
  | { target: 'broadcast'; type: 'flow/state'; state: FlowState }
  | { target: 'broadcast'; type: 'recording/levels'; mic: number | null; system: number | null; micMuted: boolean; micSilentMs: number }
  | { target: 'broadcast'; type: 'capture/status'; label: string; progress: number | null; error?: AppErrorInfo };

/* --------------------------- to content scripts -------------------------- */
export type OverlayMode = 'area-screenshot' | 'area-record' | 'region-highlight' | 'region-zoom';

/** Live screen annotation: tool choice, style and actions from the control bar. */
export type AnnotateTool = 'pen' | 'arrow' | 'line' | 'rect' | 'circle' | 'text' | 'eraser';
export type AnnotateAction =
  | { kind: 'start' }
  | { kind: 'stop' }
  | { kind: 'tool'; tool: AnnotateTool }
  | { kind: 'style'; color?: string; width?: number; opacity?: number; fontSize?: number }
  | { kind: 'undo' }
  | { kind: 'redo' }
  | { kind: 'clear' }
  | { kind: 'visible'; visible: boolean }
  | { kind: 'interact'; on: boolean };

export type ContentMessage =
  | { target: 'content'; type: 'overlay/select'; mode: OverlayMode }
  | { target: 'content'; type: 'overlay/effects'; cursor: CursorEffects; clicks: boolean; keys: boolean; track: boolean }
  | { target: 'content'; type: 'overlay/annotate'; action: AnnotateAction }
  | { target: 'content'; type: 'overlay/marker-added'; marker: Marker }
  | { target: 'content'; type: 'overlay/flow'; action: 'start' | 'pause' | 'resume' | 'stop'; config?: FlowConfig }
  | { target: 'content'; type: 'overlay/countdown'; seconds: number }
  | { target: 'content'; type: 'overlay/area-frame'; rect: RelativeRect | null }
  | { target: 'content'; type: 'overlay/highlights'; clicks: boolean; keys: boolean }
  | { target: 'content'; type: 'overlay/toast'; text: string; durationMs: number }
  | { target: 'content'; type: 'overlay/teardown' };

export type RuntimeMessage = BackgroundMessage | HostMessage | OffscreenMessage | BroadcastMessage;

export type MessageResponse<T = unknown> = { ok: true; data: T } | { ok: false; error: AppErrorInfo };

/* ------------------------------- validation ------------------------------ */
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === 'string';
const isRect = (v: unknown): boolean => isObj(v) && isNum(v.x) && isNum(v.y) && isNum(v.width) && isNum(v.height);
const isRelRect = (v: unknown): boolean =>
  isRect(v) && [(v as RelativeRect).x, (v as RelativeRect).y, (v as RelativeRect).width, (v as RelativeRect).height].every((n) => n >= 0 && n <= 1);

const EFFECT_KINDS = ['camera', 'zoom', 'spotlight', 'highlight', 'teleprompter'];
const ANNOTATE_KINDS = ['start', 'stop', 'tool', 'style', 'undo', 'redo', 'clear', 'visible', 'interact'];
const isEffect = (v: unknown): v is LiveEffect => isObj(v) && isStr(v.kind) && EFFECT_KINDS.includes(v.kind);

const FLOW_EVENTS = ['click', 'type', 'select', 'check', 'radio', 'submit', 'key', 'scroll', 'navigate'];
/** Structural check of page-reported flow events (they come from web pages' overlay, so stay strict). */
export function isFlowEvent(v: unknown): v is FlowEvent {
  if (!isObj(v) || !isStr(v.kind) || !FLOW_EVENTS.includes(v.kind)) return false;
  const el = v.element;
  const okEl = el === undefined || el === null || (isObj(el) && isStr(el.tag) && isStr(el.selector) && el.selector.length < 600);
  const short = (s: unknown, max = 2000) => s === undefined || (isStr(s) && s.length <= max);
  return okEl && short(v.value) && short(v.url, 4000) && short(v.title, 500) && short(v.key, 40);
}

const COMMANDS: RecordingCommand[] = ['pause', 'resume', 'toggle-pause', 'stop', 'cancel', 'toggle-mic', 'toggle-camera'];
const SCREENSHOT_MODES: ScreenshotMode[] = ['visible', 'full', 'area'];

function isRecordingConfig(v: unknown): v is RecordingConfig {
  return (
    isObj(v) && isStr(v.mode) && ['desktop', 'camera', 'tab', 'area'].includes(v.mode) &&
    isStr(v.resolution) && isNum(v.fps) && isStr(v.container) &&
    isObj(v.mic) && isObj(v.camera) && isNum(v.countdownSeconds) && isNum(v.maxDurationMs)
  );
}

/** Structural validation for messages arriving at the service worker. */
export function isBackgroundMessage(msg: unknown): msg is BackgroundMessage {
  if (!isObj(msg) || msg.target !== 'background' || !isStr(msg.type)) return false;
  switch (msg.type) {
    case 'screenshot/capture':
      return SCREENSHOT_MODES.includes(msg.mode as ScreenshotMode) && isNum(msg.tabId) &&
        (msg.delaySeconds === undefined || (isNum(msg.delaySeconds) && msg.delaySeconds >= 0 && msg.delaySeconds <= 300)) &&
        (msg.scrollAreas === undefined || (Array.isArray(msg.scrollAreas) && msg.scrollAreas.length <= 24 &&
          msg.scrollAreas.every((a) => isObj(a) && isNum(a.index) && isNum(a.screens) && a.screens >= 0 && a.screens <= 200)));
    case 'screenshot/stop-full':
      return true;
    case 'screenshot/header':
      return msg.dataUrl === null || (isStr(msg.dataUrl) && msg.dataUrl.startsWith('data:image/png;base64,') && msg.dataUrl.length < 40_000_000);
    case 'screenshot/scroll-areas':
      return isNum(msg.tabId);
    case 'screenshot/highlight-area':
      return isNum(msg.tabId) && (msg.index === null || isNum(msg.index)) && typeof msg.show === 'boolean';
    case 'screenshot/area-result':
      return isRect(msg.rect) && isObj(msg.viewport) && isNum(msg.dpr);
    case 'recording/start':
      return isRecordingConfig(msg.config) && (msg.tabId === null || isNum(msg.tabId));
    case 'recording/area-selected':
      return isRelRect(msg.rect);
    case 'recording/command':
      return COMMANDS.includes(msg.command as RecordingCommand);
    case 'recording/get-pending':
      return isStr(msg.sessionId);
    case 'recording/host-event':
      return isStr(msg.sessionId) && isObj(msg.event) && isStr(msg.event.type);
    case 'recording/host-finished':
      return isStr(msg.sessionId) && (msg.captureId === null || isStr(msg.captureId));
    case 'controlbar/resize':
      return typeof msg.minimized === 'boolean';
    case 'recording/save-file':
      // Only blob URLs made by this extension, and a plain file name.
      return isStr(msg.url) && msg.url.startsWith(`blob:chrome-extension://${chrome.runtime.id}/`) && isStr(msg.filename) &&
        msg.filename.length > 0 && msg.filename.length <= 200 && !/[\\/:*?"<>|]/.test(msg.filename);
    case 'recording/marker':
      return (msg.name === undefined || (isStr(msg.name) && msg.name.length <= 200)) && (msg.description === undefined || (isStr(msg.description) && msg.description.length <= 2000));
    case 'recording/marker-update':
      return isStr(msg.id) && (msg.name === undefined || isStr(msg.name)) && (msg.description === undefined || isStr(msg.description));
    case 'recording/effect':
      return isEffect(msg.effect);
    case 'recording/annotate':
      return isObj(msg.action) && isStr(msg.action.kind) && ANNOTATE_KINDS.includes(msg.action.kind);
    case 'recording/region-select':
      return msg.purpose === 'highlight' || msg.purpose === 'zoom';
    case 'recording/region-cancelled':
      return true;
    case 'recording/region-selected':
      return (msg.purpose === 'highlight' || msg.purpose === 'zoom') && (msg.rect === null || isRelRect(msg.rect)) && (msg.page === undefined || isPageGeometry(msg.page));
    case 'teleprompter/open':
    case 'flow/get-state':
      return true;
    case 'flow/start-armed':
      return true;
    case 'flow/start':
    case 'flow/arm':
      return isNum(msg.tabId) && isObj(msg.config) && isStr(msg.config.screenshots) && isStr(msg.config.values);
    case 'flow/event':
      return isFlowEvent(msg.event);
    case 'flow/hover':
      return isStr(msg.selector) && msg.selector.length > 0 && msg.selector.length < 600;
    case 'flow/activity':
      return true;
    case 'flow/capture':
      return ['visible', 'full', 'area', 'screen', 'window'].includes(msg.mode as string);
    case 'flow/undo':
      return true;
    case 'flow/minimize':
      return typeof msg.minimized === 'boolean';
    case 'flow/page-image':
      return msg.item === null || (isObj(msg.item) && isStr(msg.item.id));
    case 'flow/command':
      return ['pause', 'resume', 'finish', 'cancel'].includes(msg.command as string);
    case 'history/open':
      return isStr(msg.captureId);
    case 'screenshot/area-cancel':
    case 'recording/area-cancel':
    case 'recording/get-state':
    case 'schedule/update':
      return true;
    default:
      return false;
  }
}

export function isHostMessage(msg: unknown): msg is HostMessage {
  if (!isObj(msg) || msg.target !== 'host' || !isStr(msg.type)) return false;
  switch (msg.type) {
    case 'host/start':
      return isStr(msg.sessionId) && isStr(msg.streamId) && isRecordingConfig(msg.config) && isNum(msg.tabId) &&
        (msg.area === null || isRelRect(msg.area)) &&
        (msg.sourceSize === undefined || (isObj(msg.sourceSize) && isNum(msg.sourceSize.width) && isNum(msg.sourceSize.height) && msg.sourceSize.width > 0 && msg.sourceSize.height > 0 && msg.sourceSize.width <= 16384 && msg.sourceSize.height <= 16384));
    case 'host/command':
      return isStr(msg.sessionId) && COMMANDS.includes(msg.command as RecordingCommand);
    case 'host/effect':
      return isStr(msg.sessionId) && isEffect(msg.effect);
    case 'host/region-select':
      return isStr(msg.sessionId) && (msg.purpose === 'highlight' || msg.purpose === 'zoom');
    case 'host/page-region':
      return isStr(msg.sessionId) && (msg.purpose === 'highlight' || msg.purpose === 'zoom') && isRelRect(msg.rect) && isPageGeometry(msg.page);
    case 'host/ping':
      return true;
    default:
      return false;
  }
}

export function isOffscreenMessage(msg: unknown): msg is OffscreenMessage {
  if (!isObj(msg) || msg.target !== 'offscreen' || !isStr(msg.type)) return false;
  if (msg.type === 'offscreen/object-url') return isStr(msg.captureId);
  if (msg.type === 'offscreen/revoke') return isStr(msg.url) && msg.url.startsWith('blob:');
  return false;
}

export function isBroadcastMessage(msg: unknown): msg is BroadcastMessage {
  return isObj(msg) && msg.target === 'broadcast' && isStr(msg.type);
}

export function isContentMessage(msg: unknown): msg is ContentMessage {
  return isObj(msg) && msg.target === 'content' && isStr(msg.type);
}

/** Port name prefix (pixora-scroll-areas:<tabId>) kept open while the popup outlines scroll areas. */
export const SCROLL_AREAS_PORT = 'pixora-scroll-areas';
