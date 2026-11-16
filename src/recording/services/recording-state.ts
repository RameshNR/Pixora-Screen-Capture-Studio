import type { RecordingEvent, RecordingState, RecordingStatus } from '@/shared/types';

export const INITIAL_RECORDING_STATE: RecordingState = {
  status: 'idle',
  sessionId: null,
  mode: null,
  host: null,
  hostTabId: null,
  targetTabId: null,
  startedAt: null,
  accumulatedMs: 0,
  resumedAt: null,
  countdownEndsAt: null,
  maxDurationMs: 0,
  actual: null,
  micOn: false,
  cameraOn: false,
  micAvailable: false,
  cameraAvailable: false,
  warnings: [],
  error: null,
  controlBarWindowId: null,
  area: null,
  markers: [],
  effects: { zoom: 1, spotlight: false, highlight: false, annotating: false, teleprompter: false, camera: null },
};

const ACTIVE: RecordingStatus[] = ['preparing', 'selecting', 'countdown', 'recording', 'paused', 'stopping'];

export function isBusy(state: RecordingState): boolean {
  return ACTIVE.includes(state.status);
}

export function isCapturing(state: RecordingState): boolean {
  return state.status === 'recording' || state.status === 'paused';
}

/** Elapsed active recording time (excludes paused periods). */
export function elapsedMs(state: RecordingState, now = Date.now()): number {
  const running = state.status === 'recording' && state.resumedAt !== null ? now - state.resumedAt : 0;
  return state.accumulatedMs + Math.max(0, running);
}

export function remainingMs(state: RecordingState, now = Date.now()): number | null {
  if (!state.maxDurationMs) return null;
  return Math.max(0, state.maxDurationMs - elapsedMs(state, now));
}

/**
 * Pure state machine for a recording session. Invalid transitions are ignored (state returned as-is)
 * so late or duplicated messages from a recording host can never corrupt the state.
 */
export function recordingReducer(state: RecordingState, event: RecordingEvent): RecordingState {
  switch (event.type) {
    case 'PREPARE':
      if (isBusy(state)) return state;
      return {
        ...INITIAL_RECORDING_STATE,
        status: 'preparing',
        sessionId: event.sessionId,
        mode: event.mode,
        maxDurationMs: event.maxDurationMs,
        targetTabId: event.targetTabId,
      };
    case 'SELECTING':
      return state.status === 'preparing' ? { ...state, status: 'selecting' } : state;
    case 'AREA':
      return state.status === 'selecting' || state.status === 'preparing' ? { ...state, status: 'preparing', area: event.area } : state;
    case 'HOST_ASSIGNED':
      return isBusy(state) ? { ...state, host: event.host, hostTabId: event.hostTabId } : state;
    case 'COUNTDOWN':
      return state.status === 'preparing' ? { ...state, status: 'countdown', countdownEndsAt: event.endsAt } : state;
    case 'STARTED':
      if (state.status !== 'preparing' && state.status !== 'countdown') return state;
      return {
        ...state,
        status: 'recording',
        startedAt: event.at,
        resumedAt: event.at,
        accumulatedMs: 0,
        countdownEndsAt: null,
        actual: event.actual,
        micAvailable: event.micAvailable,
        cameraAvailable: event.cameraAvailable,
        micOn: event.micAvailable,
        cameraOn: event.cameraAvailable,
        warnings: [...state.warnings, ...event.warnings],
      };
    case 'PAUSED':
      if (state.status !== 'recording') return state;
      return {
        ...state,
        status: 'paused',
        accumulatedMs: state.accumulatedMs + Math.max(0, event.at - (state.resumedAt ?? event.at)),
        resumedAt: null,
      };
    case 'RESUMED':
      return state.status === 'paused' ? { ...state, status: 'recording', resumedAt: event.at } : state;
    case 'STOPPING': {
      if (!isBusy(state) || state.status === 'stopping') return state;
      const accumulated = state.status === 'recording' && state.resumedAt !== null
        ? state.accumulatedMs + Math.max(0, event.at - state.resumedAt)
        : state.accumulatedMs;
      return { ...state, status: 'stopping', accumulatedMs: accumulated, resumedAt: null };
    }
    case 'MIC':
      return state.micAvailable ? { ...state, micOn: event.on } : state;
    case 'CAMERA':
      return state.cameraAvailable ? { ...state, cameraOn: event.on } : state;
    case 'CONTROL_BAR':
      return { ...state, controlBarWindowId: event.windowId };
    case 'MARKER_ADD':
      if (!isCapturing(state) && state.status !== 'stopping') return state;
      return { ...state, markers: [...state.markers, event.marker].sort((a, b) => a.timeMs - b.timeMs) };
    case 'MARKER_UPDATE':
      return { ...state, markers: state.markers.map((m) => (m.id === event.id ? { ...m, ...event.patch, id: m.id } : m)) };
    case 'MARKER_DELETE':
      return { ...state, markers: state.markers.filter((m) => m.id !== event.id) };
    case 'ANNOTATING':
      return isBusy(state) ? { ...state, effects: { ...state.effects, annotating: event.on } } : state;
    case 'EFFECT': {
      if (!isBusy(state)) return state;
      const e = event.effect;
      const fx = { ...state.effects };
      if (e.kind === 'zoom') fx.zoom = e.level;
      if (e.kind === 'spotlight') fx.spotlight = e.on;
      if (e.kind === 'highlight') fx.highlight = e.rect !== null;
      if (e.kind === 'teleprompter') fx.teleprompter = e.state !== null;
      if (e.kind === 'camera') fx.camera = { ...(fx.camera ?? {}), ...e.patch } as typeof fx.camera;
      return { ...state, effects: fx };
    }
    case 'WARN':
      return state.warnings.includes(event.message) ? state : { ...state, warnings: [...state.warnings, event.message] };
    case 'FAILED':
      return { ...INITIAL_RECORDING_STATE, status: 'error', error: event.error, controlBarWindowId: state.controlBarWindowId };
    case 'RESET':
      return { ...INITIAL_RECORDING_STATE, controlBarWindowId: state.controlBarWindowId };
    default:
      return state;
  }
}
