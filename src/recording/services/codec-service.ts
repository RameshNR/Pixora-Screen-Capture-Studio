import type { AudioCodecPreference, ResolutionPreset, VideoCodecPreference, VideoContainer } from '@/shared/types';
import { ORIGINAL_CEILING, RESOLUTION_PRESETS, type Dimensions } from '@/shared/constants/media';

export interface MimeSelection {
  mimeType: string;
  container: VideoContainer;
  videoCodec: string;
  audioCodec: string | null;
  warnings: string[];
}

interface Candidate {
  mime: string;
  container: VideoContainer;
  video: Exclude<VideoCodecPreference, 'auto'>;
  audio: Exclude<AudioCodecPreference, 'auto'> | null;
}

/* Ordered best-first. H.264 High@5.1 (avc1.640033) covers 4K; Chrome raises the level itself for 8K. */
const VIDEO_CANDIDATES: Record<VideoContainer, Array<{ video: Candidate['video']; codecs: string[] }>> = {
  webm: [
    { video: 'vp9', codecs: ['vp9', 'vp09.00.51.08'] },
    { video: 'vp8', codecs: ['vp8'] },
    { video: 'av1', codecs: ['av01.0.12M.08', 'av1'] },
    { video: 'h264', codecs: ['avc1.640033', 'h264'] },
  ],
  mp4: [
    { video: 'h264', codecs: ['avc1.640033', 'avc1.64002a', 'avc1.4d002a', 'avc1'] },
    { video: 'vp9', codecs: ['vp09.00.51.08', 'vp9'] },
    { video: 'av1', codecs: ['av01.0.12M.08', 'av01'] },
  ],
};

const AUDIO_CODECS: Record<VideoContainer, Array<{ audio: Exclude<AudioCodecPreference, 'auto'>; codec: string }>> = {
  webm: [{ audio: 'opus', codec: 'opus' }],
  mp4: [
    { audio: 'aac', codec: 'mp4a.40.2' },
    { audio: 'opus', codec: 'opus' },
  ],
};

export function buildCandidates(
  container: VideoContainer,
  videoPref: VideoCodecPreference,
  audioPref: AudioCodecPreference,
  withAudio: boolean,
): Candidate[] {
  const videos = [...VIDEO_CANDIDATES[container]];
  if (videoPref !== 'auto') {
    // Move the preferred codec to the front but keep the others as fallbacks.
    videos.sort((a, b) => Number(b.video === videoPref) - Number(a.video === videoPref));
  } else {
    // AV1 encodes are very CPU-heavy in real time; only use it when explicitly requested.
    const av1 = videos.findIndex((v) => v.video === 'av1');
    if (av1 >= 0) videos.push(...videos.splice(av1, 1));
  }
  const audios = [...AUDIO_CODECS[container]];
  if (audioPref !== 'auto') audios.sort((a, b) => Number(b.audio === audioPref) - Number(a.audio === audioPref));

  const out: Candidate[] = [];
  for (const v of videos) {
    for (const vc of v.codecs) {
      if (withAudio) {
        for (const a of audios) out.push({ mime: `video/${container};codecs=${vc},${a.codec}`, container, video: v.video, audio: a.audio });
      } else {
        out.push({ mime: `video/${container};codecs=${vc}`, container, video: v.video, audio: null });
      }
    }
  }
  return out;
}

/**
 * Picks the best MediaRecorder MIME type. Falls back from MP4 to WebM when the browser cannot
 * record MP4 natively (the result page can convert afterwards) and explains every fallback.
 */
export function selectMimeType(
  container: VideoContainer,
  videoPref: VideoCodecPreference,
  audioPref: AudioCodecPreference,
  withAudio: boolean,
  isTypeSupported: (mime: string) => boolean,
): MimeSelection | null {
  const warnings: string[] = [];
  const containers: VideoContainer[] = container === 'mp4' ? ['mp4', 'webm'] : ['webm', 'mp4'];
  for (const c of containers) {
    const found = buildCandidates(c, videoPref, audioPref, withAudio).find((cand) => isTypeSupported(cand.mime));
    if (!found) {
      if (c === 'mp4' && container === 'mp4') {
        warnings.push('This Chrome version cannot record MP4 directly. Recording in WebM — you can convert to MP4 on the result page.');
      }
      continue;
    }
    if (videoPref !== 'auto' && found.video !== videoPref) {
      warnings.push(`The ${videoPref.toUpperCase()} codec is not available here; using ${found.video.toUpperCase()} instead.`);
    }
    if (withAudio && audioPref !== 'auto' && found.audio !== audioPref) {
      warnings.push(`The ${audioPref.toUpperCase()} audio codec is not available here; using ${(found.audio ?? 'opus').toUpperCase()}.`);
    }
    return { mimeType: found.mime, container: found.container, videoCodec: found.video, audioCodec: found.audio, warnings };
  }
  // Last resort: let the browser choose.
  for (const generic of ['video/webm', 'video/mp4']) {
    if (isTypeSupported(generic)) {
      return { mimeType: generic, container: generic.endsWith('mp4') ? 'mp4' : 'webm', videoCodec: 'default', audioCodec: null, warnings };
    }
  }
  return null;
}

/** The bounding box a preset asks for (used as maxWidth / maxHeight constraints). */
export function targetDimensions(preset: ResolutionPreset): Dimensions {
  return preset === 'original' ? ORIGINAL_CEILING : RESOLUTION_PRESETS[preset];
}

/**
 * Fits `source` inside `box`, preserving aspect ratio and never upscaling. Results are even, as
 * required by most video encoders. A portrait box is matched against a portrait source.
 */
export function fitWithin(source: Dimensions, box: Dimensions): Dimensions {
  const landscape = source.width >= source.height;
  const bw = landscape ? Math.max(box.width, box.height) : Math.min(box.width, box.height);
  const bh = landscape ? Math.min(box.width, box.height) : Math.max(box.width, box.height);
  const scale = Math.min(1, bw / source.width, bh / source.height);
  const even = (n: number) => Math.max(2, Math.floor(n / 2) * 2);
  return { width: even(source.width * scale), height: even(source.height * scale) };
}

/** Highest automatic video bitrate (8K30 at 0.2 bits per pixel ≈ 200 Mbps fits under it). */
export const MAX_AUTO_VIDEO_BITRATE = 250_000_000;

/**
 * Automatic video bitrate, tuned for sharp screen text: ~0.2 bits per pixel per frame
 * (≈ 12 Mbps at 1080p30, ≈ 50 Mbps at 4K30, ≈ 200 Mbps at 8K30), with diminishing returns above
 * 30 fps. Clamped to 2–250 Mbps, so quality is never capped below what 8K needs.
 */
export function autoVideoBitrate(width: number, height: number, fps: number): number {
  const pixelsPerSecond = width * height * Math.min(fps, 30) + width * height * Math.max(0, fps - 30) * 0.5;
  const bps = pixelsPerSecond * 0.2;
  return Math.round(Math.min(MAX_AUTO_VIDEO_BITRATE, Math.max(2_000_000, bps)));
}

export function resolveVideoBitrate(overrideKbps: number, width: number, height: number, fps: number): number {
  return overrideKbps > 0 ? overrideKbps * 1000 : autoVideoBitrate(width, height, fps);
}

/** Human-readable codec label from a MIME type, e.g. "VP9 + Opus". */
export function describeMime(mime: string): string {
  const m = mime.toLowerCase();
  const video = m.includes('vp9') || m.includes('vp09') ? 'VP9' : m.includes('vp8') ? 'VP8' : m.includes('av01') || m.includes('av1') ? 'AV1' : m.includes('avc1') || m.includes('h264') ? 'H.264' : '';
  const audio = m.includes('opus') ? 'Opus' : m.includes('mp4a') ? 'AAC' : '';
  const container = m.includes('mp4') ? 'MP4' : m.includes('matroska') ? 'MKV' : 'WebM';
  return [container, [video, audio].filter(Boolean).join(' + ')].filter(Boolean).join(' · ');
}
