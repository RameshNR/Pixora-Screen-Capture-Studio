export type AppErrorCode =
  | 'permission-denied-screen'
  | 'permission-denied-mic'
  | 'permission-denied-camera'
  | 'no-camera'
  | 'no-microphone'
  | 'device-busy'
  | 'unsupported-codec'
  | 'unsupported-format'
  | 'insufficient-storage'
  | 'recording-interrupted'
  | 'recording-empty'
  | 'source-unavailable'
  | 'tab-closed'
  | 'capture-timeout'
  | 'fullpage-failed'
  | 'image-processing'
  | 'conversion-failed'
  | 'export-failed'
  | 'restricted-page'
  | 'already-recording'
  | 'cancelled'
  | 'clipboard-failed'
  | 'ocr-failed'
  | 'storage-unavailable'
  | 'saved-to-downloads'
  | 'unknown';

/** Serializable error shape passed across extension contexts. */
export interface AppErrorInfo {
  code: AppErrorCode;
  title: string;
  message: string;
  recovery?: string;
  /** Raw technical detail – only displayed when debug logging is enabled. */
  detail?: string;
}
