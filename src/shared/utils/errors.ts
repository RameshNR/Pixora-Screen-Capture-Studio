import type { AppErrorCode, AppErrorInfo } from '../types';

const CATALOG: Record<AppErrorCode, Omit<AppErrorInfo, 'code' | 'detail'>> = {
  'permission-denied-screen': {
    title: 'Screen access was not granted',
    message: 'Chrome did not give permission to capture the selected screen, window or tab.',
    recovery: 'Start again and choose a source in the sharing dialog, then click “Share”.',
  },
  'permission-denied-mic': {
    title: 'Microphone access is blocked',
    message: 'Pixora is not allowed to use your microphone.',
    recovery: 'Click “Grant access” in the popup, or allow the microphone in chrome://settings/content/microphone.',
  },
  'permission-denied-camera': {
    title: 'Camera access is blocked',
    message: 'Pixora is not allowed to use your camera.',
    recovery: 'Click “Grant access” in the popup, or allow the camera in chrome://settings/content/camera.',
  },
  'no-camera': {
    title: 'No camera found',
    message: 'No camera is connected or the selected camera is unavailable.',
    recovery: 'Connect a camera or select a different one, then try again.',
  },
  'no-microphone': {
    title: 'No microphone found',
    message: 'No microphone is connected or the selected microphone is unavailable.',
    recovery: 'Connect a microphone or select a different one, then try again.',
  },
  'device-busy': {
    title: 'Device is in use',
    message: 'The camera or microphone is being used by another application.',
    recovery: 'Close other apps that use the device (video calls, other recorders) and try again.',
  },
  'unsupported-codec': {
    title: 'Codec not supported',
    message: 'This Chrome build cannot record with the selected codec.',
    recovery: 'Choose “Auto” codec in More settings. Pixora will pick the best supported codec.',
  },
  'unsupported-format': {
    title: 'Format not supported',
    message: 'The selected output format is not supported in this environment.',
    recovery: 'Record in WebM and convert to MP4 from the result page.',
  },
  'insufficient-storage': {
    title: 'Not enough storage space',
    message: 'The browser ran out of storage while saving your capture.',
    recovery: 'Free disk space or delete old captures in Recent captures, then try again.',
  },
  'recording-interrupted': {
    title: 'Recording was interrupted',
    message: 'The recording stopped unexpectedly. Everything recorded up to that point was saved.',
    recovery: 'Open Recent captures to find the saved part of the recording.',
  },
  'recording-empty': {
    title: 'Nothing was recorded',
    message: 'The recording ended before any video was captured.',
    recovery: 'Try again. If it keeps happening, pick a different source, or choose another codec under More › Video codec.',
  },
  'source-unavailable': {
    title: 'Capture source unavailable',
    message: 'The screen, window or tab you selected is no longer available.',
    recovery: 'Make sure the window or tab is open and try again.',
  },
  'tab-closed': {
    title: 'Tab was closed',
    message: 'The tab being captured was closed.',
    recovery: 'Everything captured before the tab closed has been saved.',
  },
  'capture-timeout': {
    title: 'Capture timed out',
    message: 'The page took too long to respond while capturing.',
    recovery: 'Wait for the page to finish loading and try again.',
  },
  'fullpage-failed': {
    title: 'Full-page capture failed',
    message: 'This page could not be captured from top to bottom.',
    recovery: 'Try “Visible Part” or “Selected Area”, or reload the page and retry.',
  },
  'image-processing': {
    title: 'Image processing failed',
    message: 'The image could not be processed. It may be too large for this device.',
    recovery: 'Try a smaller area, or reduce “Image scaling” to CSS pixels in Settings.',
  },
  'conversion-failed': {
    title: 'Conversion failed',
    message: 'The video could not be converted. Your original recording is unchanged.',
    recovery: 'Download the original WebM file, or try converting again.',
  },
  'export-failed': {
    title: 'Export failed',
    message: 'The file could not be saved.',
    recovery: 'Check your Chrome download settings and available disk space, then try again.',
  },
  'restricted-page': {
    title: 'This page cannot be captured',
    message: 'Chrome does not allow extensions to capture this page (for example chrome:// pages, the Chrome Web Store or the PDF viewer).',
    recovery: 'Switch to a regular web page, or use “Entire Screen & App Window”.',
  },
  'already-recording': {
    title: 'A recording is already in progress',
    message: 'Only one recording can run at a time.',
    recovery: 'Stop the current recording first.',
  },
  cancelled: {
    title: 'Cancelled',
    message: 'The operation was cancelled.',
  },
  'clipboard-failed': {
    title: 'Clipboard unavailable',
    message: 'Could not access the clipboard.',
    recovery: 'Click inside the page first, then try again. Chrome only allows clipboard access from a focused page.',
  },
  'ocr-failed': {
    title: 'Text extraction failed',
    message: 'Text could not be recognised in this image.',
    recovery: 'Try a sharper or larger screenshot.',
  },
  'storage-unavailable': {
    title: 'Pixora’s storage could not be opened',
    message: 'Chrome could not open Pixora’s local storage on this computer (its files may be locked by another Chrome window or damaged after a crash).',
    recovery: 'Close all Chrome windows and open Chrome again. If it keeps happening, use Settings › Advanced › Repair storage.',
  },
  'saved-to-downloads': {
    title: 'Recording saved to Downloads',
    message: 'Pixora’s local storage could not be opened, so your recording was saved straight to your Downloads folder instead.',
    recovery: 'To save to Recent captures again, close all Chrome windows and reopen Chrome, or use Settings › Advanced › Repair storage.',
  },
  unknown: {
    title: 'Something went wrong',
    message: 'An unexpected error occurred.',
    recovery: 'Try again. If it keeps happening, enable debug logging in Settings › Advanced.',
  },
};

export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly detail?: string;

  constructor(code: AppErrorCode, detail?: string) {
    super(CATALOG[code].message);
    this.name = 'AppError';
    this.code = code;
    this.detail = detail;
  }

  toInfo(): AppErrorInfo {
    return makeErrorInfo(this.code, this.detail);
  }
}

export function makeErrorInfo(code: AppErrorCode, detail?: string): AppErrorInfo {
  return { code, ...CATALOG[code], ...(detail ? { detail } : {}) };
}

function rawMessage(err: unknown): string {
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  if (typeof err === 'string') return err;
  // DOMException and other error-like objects (not always instances of Error).
  if (err && typeof err === 'object' && typeof (err as { message?: unknown }).message === 'string') {
    const e = err as { name?: unknown; message: string };
    return typeof e.name === 'string' && e.name ? `${e.name}: ${e.message}` : e.message;
  }
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

export function isAppErrorInfo(value: unknown): value is AppErrorInfo {
  return (
    typeof value === 'object' && value !== null &&
    typeof (value as AppErrorInfo).code === 'string' &&
    typeof (value as AppErrorInfo).title === 'string' &&
    typeof (value as AppErrorInfo).message === 'string'
  );
}

/** Converts anything thrown (DOMException, chrome.runtime.lastError, AppError…) to a user-facing error. */
/** IndexedDB cannot be opened at all ("Internal error opening backing store", corrupted or locked files). */
export function isStorageUnavailable(err: unknown): boolean {
  if (err instanceof AppError) return err.code === 'storage-unavailable' || /backing store/i.test(err.detail ?? '');
  if (isAppErrorInfo(err)) return err.code === 'storage-unavailable' || /backing store/i.test(err.detail ?? '');
  // Also when wrapped in another error (its message keeps Chrome's text).
  const m = rawMessage(err).toLowerCase();
  return m.includes('backing store') || m.includes('indexeddb open failed') || (m.includes('internal error') && m.includes('indexeddb'));
}

export function toAppError(err: unknown, context?: 'camera' | 'microphone' | 'screen' | 'capture' | 'fullpage' | 'export'): AppErrorInfo {
  if (err instanceof AppError) return err.toInfo();
  if (isAppErrorInfo(err)) return err;
  const detail = rawMessage(err);
  const name = err instanceof Error || (typeof DOMException !== 'undefined' && err instanceof DOMException) ? (err as Error).name : '';
  const msg = detail.toLowerCase();

  if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || msg.includes('permission denied')) {
    if (context === 'camera') return makeErrorInfo('permission-denied-camera', detail);
    if (context === 'microphone') return makeErrorInfo('permission-denied-mic', detail);
    return makeErrorInfo('permission-denied-screen', detail);
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') {
    if (context === 'camera') return makeErrorInfo('no-camera', detail);
    if (context === 'microphone') return makeErrorInfo('no-microphone', detail);
    return makeErrorInfo('source-unavailable', detail);
  }
  if (name === 'NotReadableError' || name === 'TrackStartError') return makeErrorInfo('device-busy', detail);
  if (name === 'QuotaExceededError' || msg.includes('quota')) return makeErrorInfo('insufficient-storage', detail);
  if (isStorageUnavailable(err)) return makeErrorInfo('storage-unavailable', detail);
  if (name === 'AbortError' && context === 'screen') return makeErrorInfo('permission-denied-screen', detail);
  if (
    msg.includes('cannot access') || msg.includes('chrome://') || msg.includes('cannot be scripted') ||
    msg.includes('extensions gallery') || msg.includes('the extensions gallery cannot') ||
    msg.includes('activetab') || msg.includes('not been invoked') || msg.includes('missing host permission')
  ) {
    return makeErrorInfo('restricted-page', detail);
  }
  if (msg.includes('no tab with id') || msg.includes('tab was closed')) return makeErrorInfo('tab-closed', detail);
  if (context === 'fullpage') return makeErrorInfo('fullpage-failed', detail);
  if (context === 'export') return makeErrorInfo('export-failed', detail);
  if (context === 'capture') return makeErrorInfo('image-processing', detail);
  return makeErrorInfo('unknown', detail);
}
