import type { FlowSettings, RecordingConfig, RecordingMode, RecordingSettings } from '@/shared/types';

/** Builds the immutable per-session config from persisted settings (single source of truth). */
export function buildRecordingConfig(
  rec: RecordingSettings,
  overrides: Partial<Pick<RecordingConfig, 'mode' | 'maxDurationMs'>> = {},
  options: { experimental?: boolean; flow?: FlowSettings } = {},
): RecordingConfig {
  const requested: RecordingMode = overrides.mode ?? rec.mode;
  // "Custom area" of a screen is a desktop recording with a region picked after sharing.
  const screenArea = requested === 'area' && rec.areaSource === 'screen';
  const mode: RecordingMode = screenArea ? 'desktop' : requested;
  return {
    mode,
    resolution: rec.resolution,
    fps: rec.fps,
    container: rec.container,
    // Experimental: try AV1 first when the codec is automatic (falls back if unsupported).
    videoCodec: options.experimental && rec.videoCodec === 'auto' ? 'av1' : rec.videoCodec,
    audioCodec: rec.audioCodec,
    videoBitrateKbps: rec.videoBitrateKbps,
    audioBitrateKbps: rec.audioBitrateKbps,
    mic: {
      enabled: rec.micEnabled,
      deviceId: rec.micDeviceId,
      volume: rec.micVolume,
      noiseSuppression: rec.noiseSuppression,
      echoCancellation: rec.echoCancellation,
    },
    camera: {
      // Camera-only mode always needs the camera.
      enabled: mode === 'camera' ? true : rec.cameraEnabled,
      deviceId: rec.cameraDeviceId,
      resolution: rec.cameraResolution,
      position: rec.cameraPosition,
      size: rec.cameraSize,
      shape: rec.cameraShape,
    },
    systemAudio: mode === 'camera' ? false : rec.systemAudio,
    countdownSeconds: rec.countdownSeconds,
    maxDurationMs: overrides.maxDurationMs ?? rec.maxDurationMinutes * 60_000,
    highlightClicks: rec.highlightClicks,
    highlightKeys: rec.highlightKeys,
    controlBar: rec.controlBar,
    controlBarPosition: rec.controlBarPosition,
    filenamePattern: rec.filenamePattern,
    autoSave: rec.autoSave,
    excludeTaskbar: rec.excludeTaskbar,
    selectArea: screenArea,
    cameraStyle: { ...rec.cameraStyle, shape: rec.cameraShape },
    cursorEffects: rec.cursorEffects,
    zoom: rec.zoom,
    spotlight: rec.spotlight,
    // Flow Capture runs alongside tab / area / desktop recordings; Camera Only only when chosen explicitly.
    // There is no flow toolbar during a recording, so step pictures are always automatic.
    flow: options.flow && options.flow.withRecording && (mode !== 'camera' || options.flow.inCameraMode)
      ? { ...options.flow, autoSteps: true, area: null }
      : null,
  };
}

export function modeUsesTabCapture(mode: RecordingMode, areaSource: 'tab' | 'screen' = 'tab'): boolean {
  return mode === 'tab' || (mode === 'area' && areaSource === 'tab');
}
