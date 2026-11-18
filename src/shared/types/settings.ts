export type { ThemePreference } from '../theme/themes';
import type { ThemePreference } from '../theme/themes';
export type PopupTab = 'screenshot' | 'record';
export type ImageFormat = 'png' | 'jpeg' | 'webp';
export type ScreenshotMode = 'visible' | 'full' | 'area';
export type ImageScale = 'device' | 'css';
export type RecordingMode = 'desktop' | 'camera' | 'tab' | 'area';
export type ResolutionPreset = '480p' | '720p' | '1080p' | '1440p' | '2160p' | '4320p' | 'original';
export type CameraResolution = '480p' | '720p' | '1080p';
export type FrameRate = 15 | 24 | 30 | 60;
export type VideoContainer = 'webm' | 'mp4';
export type VideoCodecPreference = 'auto' | 'vp9' | 'vp8' | 'av1' | 'h264';
export type AudioCodecPreference = 'auto' | 'opus' | 'aac';
export type CornerPosition = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
export type ControlBarPosition = 'top-left' | 'top-center' | 'top-right' | 'bottom-left' | 'bottom-center' | 'bottom-right';
export type CameraShape = 'circle' | 'rounded' | 'square';
export type CameraSize = 'small' | 'medium' | 'large';
export type StorageTarget = 'local' | 'cloud';
export type HardwareAcceleration = 'auto' | 'prefer-hardware' | 'prefer-software';
import type { CameraStyle, CursorEffects, SpotlightSettings, ZoomSettings } from './effects';
import type { FlowSettings } from './flow';

export interface GeneralSettings {
  theme: ThemePreference;
  /** Which popup tab opens first. 'last' re-opens the last used tab. */
  defaultTab: PopupTab | 'last';
  lastTab: PopupTab;
  language: 'auto' | 'en';
  notifications: boolean;
  filenamePattern: string;
}

export interface FullPageSettings {
  hideFixedElements: boolean;
  preloadLazyContent: boolean;
  hideScrollbars: boolean;
  /** Safety limit in CSS pixels; longer pages are truncated with a warning. */
  maxHeight: number;
  /** Pages with scrollable panels: ask which to include, page only, or every panel. */
  scrollAreas: 'ask' | 'page' | 'all';
}

/** A scrollable panel to include in a full-page capture (`screens` 0 = all of it). */
export interface ScrollAreaChoice {
  index: number;
  screens: number;
}

export interface ScreenshotSettings {
  format: ImageFormat;
  /** 0.1 – 1, used for JPEG / WebP. */
  quality: number;
  defaultMode: ScreenshotMode;
  delaySeconds: number;
  autoOpenEditor: boolean;
  autoSave: boolean;
  copyToClipboard: boolean;
  scale: ImageScale;
  fullPage: FullPageSettings;
  storage: StorageTarget;
  /** Entire-screen screenshots leave out the taskbar / dock. */
  excludeTaskbar: boolean;
  /** “Entire Screen & App Window”: seconds to arrange the screen before the picture (at least 3). */
  desktopDelaySeconds: number;
  /** Frames added automatically to every new screenshot (all off unless chosen). */
  autoFrame: AutoFrame;
  /**
   * Visible / full-page screenshots get the real browser header (tabs, address bar, bookmarks) on
   * top, from a picture of the Chrome window (Chrome asks which window to share each time).
   */
  browserHeader: boolean;
}

export interface AutoFrame {
  /** Browser window bar (address bar and tab title). */
  browser: boolean;
  /** Background with padding and rounded corners. */
  background: boolean;
  /** Border line around the image. */
  border: boolean;
}

export interface RecordingSettings {
  mode: RecordingMode;
  resolution: ResolutionPreset;
  fps: FrameRate;
  container: VideoContainer;
  videoCodec: VideoCodecPreference;
  audioCodec: AudioCodecPreference;
  /** 0 = automatic (derived from resolution and frame rate). */
  videoBitrateKbps: number;
  audioBitrateKbps: number;
  micEnabled: boolean;
  micDeviceId: string;
  micVolume: number;
  noiseSuppression: boolean;
  echoCancellation: boolean;
  cameraEnabled: boolean;
  cameraDeviceId: string;
  cameraResolution: CameraResolution;
  cameraPosition: CornerPosition;
  cameraSize: CameraSize;
  cameraShape: CameraShape;
  systemAudio: boolean;
  controlBar: boolean;
  controlBarPosition: ControlBarPosition;
  countdownSeconds: number;
  /** 0 = no limit. */
  maxDurationMinutes: number;
  highlightClicks: boolean;
  highlightKeys: boolean;
  filenamePattern: string;
  autoSave: boolean;
  storage: StorageTarget;
  /** Full-screen desktop recordings leave out the taskbar / dock. */
  excludeTaskbar: boolean;
  /** Video page: drawing tools, timed overlays, animations and effects (Advanced Video Editor). */
  advancedVideoEditor: boolean;
  /** Custom-area recording: a region of this tab, or a region of a screen / window. */
  areaSource: 'tab' | 'screen';
  cameraStyle: CameraStyle;
  cursorEffects: CursorEffects;
  zoom: ZoomSettings;
  spotlight: SpotlightSettings;
}

export interface StorageSettings {
  /** Ask where to save every file (Chrome "Save as" dialog). */
  askWhereToSave: boolean;
  /** Sub-folder inside the Chrome downloads directory (or inside the chosen folder). Empty = its root. */
  subfolder: string;
  /** Where files are saved: Chrome's downloads folder, or a folder chosen on this computer. */
  location?: 'downloads' | 'folder';
  /** Name of the chosen folder (shown in Settings; the folder itself is kept separately). */
  folderName?: string;
  /** Automatically delete history items older than N days. 0 = keep forever. */
  retentionDays: number;
}

export interface AdvancedSettings {
  hardwareAcceleration: HardwareAcceleration;
  experimental: boolean;
  debugLogging: boolean;
}

export interface ScheduleSettings {
  enabled: boolean;
  /** Local date-time strings as produced by <input type="datetime-local">. */
  startAt: string;
  endAt: string;
  mode: RecordingMode;
}

export interface Settings {
  version: number;
  general: GeneralSettings;
  screenshot: ScreenshotSettings;
  recording: RecordingSettings;
  storage: StorageSettings;
  advanced: AdvancedSettings;
  schedule: ScheduleSettings;
  flow: FlowSettings;
}

export type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };
