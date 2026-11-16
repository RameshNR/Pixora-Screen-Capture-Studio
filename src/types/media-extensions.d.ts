/**
 * Legacy Chrome `mandatory` constraints used with tabCapture / desktopCapture stream ids.
 * (Breakout-box types come from @types/dom-mediacapture-transform.)
 */
interface ChromeMandatoryConstraints {
  chromeMediaSource: 'tab' | 'desktop';
  chromeMediaSourceId: string;
  maxWidth?: number;
  maxHeight?: number;
  minWidth?: number;
  minHeight?: number;
  maxFrameRate?: number;
  minFrameRate?: number;
}

interface ChromeLegacyTrackConstraints {
  mandatory: ChromeMandatoryConstraints;
  optional?: unknown[];
}
