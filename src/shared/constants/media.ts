import type { CameraResolution, CameraSize, FrameRate, ResolutionPreset } from '../types';

export interface Dimensions {
  width: number;
  height: number;
}

/** Target bounding boxes. Captures are scaled *down* to fit; never up. */
export const RESOLUTION_PRESETS: Record<Exclude<ResolutionPreset, 'original'>, Dimensions> = {
  '480p': { width: 854, height: 480 },
  '720p': { width: 1280, height: 720 },
  '1080p': { width: 1920, height: 1080 },
  '1440p': { width: 2560, height: 1440 },
  '2160p': { width: 3840, height: 2160 },
  '4320p': { width: 7680, height: 4320 },
};

/**
 * Ceiling used for "Original" so Chrome delivers the native source size: up to 8K in either
 * orientation (a portrait 8K screen is 4320 × 7680, so both sides allow 7680).
 */
export const ORIGINAL_CEILING: Dimensions = { width: 7680, height: 7680 };

/** Ceiling for single-frame screen / window screenshots: the full source, even beyond 8K. */
export const SCREENSHOT_CEILING: Dimensions = { width: 16384, height: 16384 };

export const RESOLUTION_LABELS: Record<ResolutionPreset, string> = {
  '480p': '480p',
  '720p': '720p HD',
  '1080p': '1080p Full HD',
  '1440p': '1440p QHD',
  '2160p': '4K UHD',
  '4320p': '8K UHD',
  original: 'Original',
};

export const RESOLUTION_SHORT_LABELS: Record<ResolutionPreset, string> = {
  '480p': '480p',
  '720p': '720p',
  '1080p': '1080p',
  '1440p': '1440p',
  '2160p': '4K',
  '4320p': '8K',
  original: 'Original',
};

export const FRAME_RATES: FrameRate[] = [15, 24, 30, 60];

export const CAMERA_RESOLUTIONS: Record<CameraResolution, Dimensions> = {
  '480p': { width: 640, height: 480 },
  '720p': { width: 1280, height: 720 },
  '1080p': { width: 1920, height: 1080 },
};

/** Camera overlay diameter / width as a fraction of the output video's shorter side. */
export const CAMERA_OVERLAY_SCALE: Record<CameraSize, number> = {
  small: 0.18,
  medium: 0.26,
  large: 0.36,
};

export const COUNTDOWN_OPTIONS = [0, 3, 5, 10];
export const MAX_DURATION_OPTIONS = [0, 5, 10, 15, 30, 60];
export const SCREENSHOT_DELAY_OPTIONS = [0, 1, 2, 3, 4, 5, 10, 15];

/** MediaRecorder timeslice: chunks are flushed to IndexedDB this often to bound memory use. */
export const RECORDER_TIMESLICE_MS = 1000;


/** Max canvas dimension Chrome reliably supports. */
export const MAX_CANVAS_DIMENSION = 32767;
export const MAX_CANVAS_AREA = 268_435_456;
