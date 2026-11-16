import {
  ALL_FORMATS, BlobSource, BufferTarget, Conversion, Input, Mp4OutputFormat, Output, QUALITY_HIGH, QUALITY_LOW, QUALITY_MEDIUM, QUALITY_VERY_HIGH,
  QUALITY_VERY_LOW, Quality, WebMOutputFormat,
} from 'mediabunny';
import { autoVideoBitrate } from './codec-service';
import type { Marker, VideoContainer, VideoRedaction } from '@/shared/types';
import { chaptersText } from './chapters';
import { applyRedactions, activeRedactions } from './redaction';
import { activeOverlays, drawOverlays, needsFrame, type VideoOverlay } from './video-overlays';
import type { Watermark } from '@/editor/types';
import { AppError } from '@/shared/utils/errors';
import { scaledSize } from './video-size';

export { RESOLUTIONS, scaledSize } from './video-size';

export interface ExportOptions {
  container: VideoContainer;
  /** Seconds. Omit for the full length. */
  trimStart?: number;
  trimEnd?: number;
  onProgress?: (progress: number) => void;
  signal?: AbortSignal;
  hardwareAcceleration?: 'no-preference' | 'prefer-hardware' | 'prefer-software';
  /** Drop every audio track (video is copied untouched when the format stays the same). */
  removeAudio?: boolean;
  /** Target size of the short side (480, 720, 1080, 1440, 2160). Omit to keep the original size. */
  resolution?: number | null;
  /** Encoding quality; omit to copy the video when possible. */
  quality?: VideoQuality | null;
  /** Output frame rate; omit to keep the original. */
  frameRate?: number | null;
  /** Frame-accurate cuts (re-encodes) instead of cutting at the nearest key frame. */
  precise?: boolean;
  /** Privacy regions (blur / pixelate / solid mask) burned into the video. */
  redactions?: VideoRedaction[];
  /** Drawings burned into the frames (Advanced Video Editor), and a watermark on every frame. */
  overlays?: VideoOverlay[];
  watermark?: Watermark | null;
  /** Chapters, written into the file's description / comment metadata. */
  chapters?: Marker[];
}

export type VideoQuality = 'very-high' | 'high' | 'medium' | 'low' | 'very-low';

const QUALITY: Record<VideoQuality, Quality> = {
  'very-high': QUALITY_VERY_HIGH,
  high: QUALITY_HIGH,
  medium: QUALITY_MEDIUM,
  low: QUALITY_LOW,
  'very-low': QUALITY_VERY_LOW,
};

export interface ExportResult {
  blob: Blob;
  mimeType: string;
  /** True when the video stream was re-encoded (format change); false when packets were copied. */
  reencoded: boolean;
}

/**
 * Converts and/or trims a recording entirely in the browser using WebCodecs (via mediabunny).
 * No data leaves the device. The source blob is never modified.
 *
 * WebM → WebM trims copy compressed packets (fast, lossless, cut at the nearest key frame);
 * WebM → MP4 re-encodes video to H.264 when the source codec is not allowed in MP4.
 */
export async function exportVideo(source: Blob, options: ExportOptions): Promise<ExportResult> {
  const input = new Input({ source: new BlobSource(source), formats: ALL_FORMATS });
  const format = options.container === 'mp4' ? new Mp4OutputFormat({ fastStart: 'in-memory' }) : new WebMOutputFormat();
  const target = new BufferTarget();
  const output = new Output({ format, target });

  const trim = options.trimStart !== undefined || options.trimEnd !== undefined
    ? { start: options.trimStart, end: options.trimEnd }
    : undefined;

  let conversion: Conversion;
  try {
    conversion = await Conversion.init({
      input,
      output,
      ...(trim ? { trim } : {}),
      video: async (track) => {
        const size = scaledSize(track.displayWidth, track.displayHeight, options.resolution);
        const redactions = options.redactions ?? [];
        const overlays = options.overlays ?? [];
        const watermark = options.watermark ?? null;
        const drawing = overlays.length > 0 || Boolean(watermark);
        const transcode = size.scaled || Boolean(options.frameRate || options.precise || redactions.length || drawing)
          || !format.getSupportedVideoCodecs().includes(track.codec as never);
        // "Original" quality: when the video has to be re-encoded anyway, encode it at Pixora's own
        // high recording bitrate for the output size instead of the encoder's (lower) default.
        const keep = !options.quality && transcode
          ? new Quality({ bitrate: autoVideoBitrate(size.width, size.height, options.frameRate || 30) })
          : null;
        // Sample timestamps start at 0 after trimming; regions are timed on the original video.
        const offset = options.trimStart ?? 0;
        return {
          hardwareAcceleration: options.hardwareAcceleration ?? 'no-preference',
          ...(size.scaled ? { width: size.width, height: size.height, fit: 'fill' as const } : {}),
          ...(options.quality ? { quality: QUALITY[options.quality] } : keep ? { quality: keep } : {}),
          ...(options.frameRate ? { frameRate: options.frameRate } : {}),
          ...(size.scaled || options.quality || options.frameRate || options.precise || redactions.length || drawing ? { forceTranscode: true } : {}),
          ...(redactions.length || drawing
            ? {
                process: async (sample: import('mediabunny').VideoSample) => {
                  const t = sample.timestamp + offset;
                  const active = activeRedactions(redactions, t);
                  const shown = activeOverlays(overlays, t);
                  if (!active.length && !shown.length && !watermark) return sample;
                  // Privacy regions first (always the frame itself), then the drawings on top.
                  const canvas = applyRedactions(sample, active);
                  if (shown.length || watermark) {
                    const base = needsFrame(overlays, t) ? await createImageBitmap(canvas) : null;
                    drawOverlays(canvas.getContext('2d')!, base, overlays, t, canvas.width, canvas.height, watermark);
                    base?.close();
                  }
                  return canvas;
                },
              }
            : {}),
        };
      },
      ...(options.chapters?.length
        ? {
            tags: (input: import('mediabunny').MetadataTags) => {
              const text = chaptersText(options.chapters!, options.trimStart ?? 0, options.trimEnd ?? Infinity);
              return text ? { ...input, description: text, comment: text } : input;
            },
          }
        : {}),
      ...(options.removeAudio ? { audio: { discard: true } } : {}),
      showWarnings: false,
    });
  } catch (err) {
    throw new AppError('conversion-failed', String(err));
  }
  if (!conversion.isValid) {
    const reasons = conversion.discardedTracks.map((t) => t.reason).join(', ');
    throw new AppError('unsupported-format', `Conversion invalid: ${reasons}`);
  }
  const videoDiscarded = conversion.discardedTracks.some((t) => t.track.type === 'video');
  if (videoDiscarded) throw new AppError('unsupported-format', 'Video track cannot be encoded for this container');

  const transformed = Boolean(options.resolution || options.quality || options.frameRate || options.precise || options.redactions?.length || options.overlays?.length || options.watermark);
  const reencoded = conversion.utilizedTracks.some((t) => t.type === 'video') && (transformed || !(await sameVideoCodecFamily(input, options.container)));
  if (options.onProgress) conversion.onProgress = (p) => options.onProgress?.(p);
  const abort = () => void conversion.cancel();
  options.signal?.addEventListener('abort', abort, { once: true });
  try {
    await conversion.execute();
  } catch (err) {
    if (options.signal?.aborted) throw new AppError('cancelled');
    throw new AppError('conversion-failed', String(err));
  } finally {
    options.signal?.removeEventListener('abort', abort);
  }
  const buffer = target.buffer;
  if (!buffer) throw new AppError('conversion-failed', 'Empty output');
  const mimeType = options.container === 'mp4' ? 'video/mp4' : 'video/webm';
  return { blob: new Blob([buffer], { type: mimeType }), mimeType, reencoded };
}

async function sameVideoCodecFamily(input: Input, container: VideoContainer): Promise<boolean> {
  const track = await input.getPrimaryVideoTrack();
  const codec = track?.codec ?? null;
  if (!codec) return false;
  if (container === 'webm') return ['vp8', 'vp9', 'av1'].includes(codec);
  return ['avc', 'hevc', 'vp9', 'av1'].includes(codec);
}

/** Reads basic info (duration, size, codecs) without decoding. */
export async function probeVideo(source: Blob): Promise<{ durationSec: number; videoCodec: string | null; audioCodec: string | null; width: number; height: number }> {
  const input = new Input({ source: new BlobSource(source), formats: ALL_FORMATS });
  const [durationSec, video, audio] = await Promise.all([
    input.computeDuration(),
    input.getPrimaryVideoTrack(),
    input.getPrimaryAudioTrack(),
  ]);
  return {
    durationSec,
    videoCodec: video?.codec ?? null,
    audioCodec: audio?.codec ?? null,
    width: video?.displayWidth ?? 0,
    height: video?.displayHeight ?? 0,
  };
}
