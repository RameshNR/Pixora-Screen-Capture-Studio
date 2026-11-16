export type CaptureKind = 'screenshot' | 'video' | 'flow';

/** Metadata for a capture stored in IndexedDB. The binary payload lives in the `blobs` store. */
export interface CaptureRecord {
  id: string;
  kind: CaptureKind;
  name: string;
  mimeType: string;
  size: number;
  width: number;
  height: number;
  createdAt: number;
  updatedAt: number;
  /** Small JPEG data URL used by history lists. */
  thumbnail?: string;
  sourceUrl?: string;
  sourceTitle?: string;
  durationMs?: number;
  fps?: number;
  videoCodec?: string;
  audio?: { microphone: boolean; system: boolean };
  /** Requested-vs-actual notes shown on the result page (e.g. "Source was 1080p; 4K not available"). */
  notes?: string[];
  downloadId?: number;
  edited?: boolean;
  /** Set when the user asked for OCR at capture time; the editor opens the OCR panel. */
  ocrRequested?: boolean;
  /** Chapters / markers (videos). */
  markers?: import('./effects').Marker[];
  /** Part of a flow session (hidden from Recent captures; shown in the Flow Editor). */
  flowId?: string;
  /** Flow captured together with this video. */
  linkedFlowId?: string;
  /** Privacy regions applied when exporting (videos). */
  redactions?: import('./effects').VideoRedaction[];
  /** Advanced Video Editor: timed drawings with animations / effects, and a watermark for the whole video. */
  overlays?: import('@/recording/services/video-overlays').StoredOverlay[];
  videoWatermark?: import('@/editor/types').Watermark | null;
}

export interface PixelRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Rectangle expressed as fractions (0–1) of the viewport, so it survives viewport resizing. */
export interface RelativeRect {
  x: number;
  y: number;
  width: number;
  height: number;
}
