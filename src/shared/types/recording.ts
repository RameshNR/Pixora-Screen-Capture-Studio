import type {
  AudioCodecPreference, CameraResolution, CameraShape, CameraSize, ControlBarPosition, CornerPosition,
  FrameRate, RecordingMode, ResolutionPreset, VideoCodecPreference, VideoContainer,
} from './settings';
import type { RelativeRect } from './capture';
import type { AppErrorInfo } from './errors';
import type { CameraBackground, CameraStyle, CursorEffects, LiveEffect, LiveEffectsState, Marker, SpotlightSettings, ZoomSettings } from './effects';

export interface MicConfig {
  enabled: boolean;
  deviceId: string;
  volume: number;
  noiseSuppression: boolean;
  echoCancellation: boolean;
}

export interface CameraConfig {
  enabled: boolean;
  deviceId: string;
  resolution: CameraResolution;
  position: CornerPosition;
  size: CameraSize;
  shape: CameraShape;
  /** Background blurred / removed / replaced (none when absent). */
  background?: CameraBackground;
  /** Camera Only: a removed background becomes a plain colour (a video has no see-through parts). */
  opaque?: boolean;
}

/** Fully-resolved configuration for one recording session. */
export interface RecordingConfig {
  mode: RecordingMode;
  resolution: ResolutionPreset;
  fps: FrameRate;
  container: VideoContainer;
  videoCodec: VideoCodecPreference;
  audioCodec: AudioCodecPreference;
  videoBitrateKbps: number;
  audioBitrateKbps: number;
  mic: MicConfig;
  camera: CameraConfig;
  systemAudio: boolean;
  countdownSeconds: number;
  maxDurationMs: number;
  highlightClicks: boolean;
  highlightKeys: boolean;
  controlBar: boolean;
  controlBarPosition: ControlBarPosition;
  filenamePattern: string;
  autoSave: boolean;
  excludeTaskbar: boolean;
  /** Desktop mode: let the user pick a region of the shared screen / window. */
  selectArea: boolean;
  cameraStyle: CameraStyle;
  cursorEffects: CursorEffects;
  zoom: ZoomSettings;
  spotlight: SpotlightSettings;
  /** Track the browser flow (steps + screenshots) during this recording. */
  flow?: import('./flow').FlowConfig | null;
}

export type RecordingStatus =
  | 'idle'
  | 'preparing'
  | 'selecting'
  | 'countdown'
  | 'recording'
  | 'paused'
  | 'stopping'
  | 'error';

export type RecordingHost = 'offscreen' | 'recorder-tab';

export interface ActualRecordingInfo {
  width: number;
  height: number;
  fps: number;
  mimeType: string;
  sourceWidth: number;
  sourceHeight: number;
  videoBitrate: number;
  hasMicrophone: boolean;
  hasSystemAudio: boolean;
}

export interface RecordingState {
  status: RecordingStatus;
  sessionId: string | null;
  mode: RecordingMode | null;
  host: RecordingHost | null;
  hostTabId: number | null;
  targetTabId: number | null;
  /** Epoch ms when recording (not countdown) first started. */
  startedAt: number | null;
  /** Active recording time accumulated before the current segment. */
  accumulatedMs: number;
  /** Epoch ms when the current active segment began; null while paused. */
  resumedAt: number | null;
  countdownEndsAt: number | null;
  maxDurationMs: number;
  actual: ActualRecordingInfo | null;
  micOn: boolean;
  cameraOn: boolean;
  micAvailable: boolean;
  cameraAvailable: boolean;
  warnings: string[];
  error: AppErrorInfo | null;
  controlBarWindowId: number | null;
  area: RelativeRect | null;
  /** Chapters / markers added while recording; saved with the capture. */
  markers: Marker[];
  effects: LiveEffectsState;
}

export type RecordingEvent =
  | { type: 'PREPARE'; sessionId: string; mode: RecordingMode; maxDurationMs: number; targetTabId: number | null }
  | { type: 'SELECTING' }
  | { type: 'HOST_ASSIGNED'; host: RecordingHost; hostTabId: number | null }
  | { type: 'COUNTDOWN'; endsAt: number }
  | {
      type: 'STARTED';
      at: number;
      actual: ActualRecordingInfo;
      micAvailable: boolean;
      cameraAvailable: boolean;
      warnings: string[];
    }
  | { type: 'PAUSED'; at: number }
  | { type: 'RESUMED'; at: number }
  | { type: 'STOPPING'; at: number }
  | { type: 'MIC'; on: boolean }
  | { type: 'CAMERA'; on: boolean }
  | { type: 'AREA'; area: RelativeRect }
  | { type: 'CONTROL_BAR'; windowId: number | null }
  | { type: 'WARN'; message: string }
  | { type: 'MARKER_ADD'; marker: Marker }
  | { type: 'MARKER_UPDATE'; id: string; patch: Partial<Omit<Marker, 'id'>> }
  | { type: 'MARKER_DELETE'; id: string }
  | { type: 'EFFECT'; effect: LiveEffect }
  | { type: 'ANNOTATING'; on: boolean }
  | { type: 'FAILED'; error: AppErrorInfo }
  | { type: 'RESET' };
