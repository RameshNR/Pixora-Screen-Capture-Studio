import { describe, expect, it } from 'vitest';
import { autoVideoBitrate, buildCandidates, describeMime, fitWithin, resolveVideoBitrate, selectMimeType, targetDimensions } from '@/recording/services/codec-service';

const supports = (list: string[]) => (mime: string) => list.includes(mime);

describe('codec selection', () => {
  it('prefers VP9 + Opus for WebM', () => {
    const sel = selectMimeType('webm', 'auto', 'auto', true, supports(['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus']));
    expect(sel?.mimeType).toBe('video/webm;codecs=vp9,opus');
    expect(sel?.warnings).toEqual([]);
  });

  it('uses native MP4 / H.264 high profile when available', () => {
    const sel = selectMimeType('mp4', 'auto', 'auto', true, supports(['video/mp4;codecs=avc1.640033,mp4a.40.2', 'video/webm;codecs=vp9,opus']));
    expect(sel?.container).toBe('mp4');
    expect(sel?.videoCodec).toBe('h264');
    expect(sel?.audioCodec).toBe('aac');
  });

  it('falls back from MP4 to WebM with an explanation', () => {
    const sel = selectMimeType('mp4', 'auto', 'auto', false, supports(['video/webm;codecs=vp8']));
    expect(sel?.container).toBe('webm');
    expect(sel?.mimeType).toBe('video/webm;codecs=vp8');
    expect(sel?.warnings.join(' ')).toMatch(/cannot record MP4/);
  });

  it('honours a preferred codec and warns when it is unavailable', () => {
    const ok = selectMimeType('webm', 'vp8', 'auto', false, supports(['video/webm;codecs=vp9', 'video/webm;codecs=vp8']));
    expect(ok?.videoCodec).toBe('vp8');
    const fallback = selectMimeType('webm', 'av1', 'auto', false, supports(['video/webm;codecs=vp9']));
    expect(fallback?.videoCodec).toBe('vp9');
    expect(fallback?.warnings[0]).toMatch(/AV1/);
  });

  it('never picks AV1 automatically before VP9/VP8', () => {
    const order = buildCandidates('webm', 'auto', 'auto', false).map((c) => c.video);
    expect(order.indexOf('av1')).toBeGreaterThan(order.lastIndexOf('vp8'));
  });

  it('returns null when nothing is supported', () => {
    expect(selectMimeType('webm', 'auto', 'auto', true, () => false)).toBeNull();
  });
});

describe('resolution handling', () => {
  it('never upscales', () => {
    expect(fitWithin({ width: 1920, height: 1080 }, targetDimensions('2160p'))).toEqual({ width: 1920, height: 1080 });
  });

  it('downscales preserving aspect ratio to even sizes', () => {
    expect(fitWithin({ width: 3840, height: 2160 }, targetDimensions('1080p'))).toEqual({ width: 1920, height: 1080 });
    const odd = fitWithin({ width: 2561, height: 1081 }, targetDimensions('720p'));
    expect(odd.width % 2).toBe(0);
    expect(odd.height % 2).toBe(0);
    expect(odd.width).toBeLessThanOrEqual(1280);
  });

  it('matches portrait sources against a portrait box', () => {
    expect(fitWithin({ width: 2160, height: 3840 }, targetDimensions('1080p'))).toEqual({ width: 1080, height: 1920 });
  });

  it('keeps 4K as a real target', () => {
    expect(targetDimensions('2160p')).toEqual({ width: 3840, height: 2160 });
  });
});

describe('bitrate', () => {
  it('scales with resolution and frame rate', () => {
    const hd = autoVideoBitrate(1920, 1080, 30);
    const uhd = autoVideoBitrate(3840, 2160, 30);
    // High quality for screen text: about 12 Mbps at 1080p30.
    expect(hd).toBeGreaterThan(11_000_000);
    expect(hd).toBeLessThan(14_000_000);
    expect(uhd).toBeGreaterThan(hd * 3);
    expect(autoVideoBitrate(1920, 1080, 60)).toBeGreaterThan(hd);
    expect(autoVideoBitrate(100, 100, 15)).toBe(2_000_000);
  });

  it('gives 8K enough bitrate (not capped at a 4K level)', () => {
    const uhd = autoVideoBitrate(3840, 2160, 30);
    const eightK = autoVideoBitrate(7680, 4320, 30);
    expect(eightK).toBeGreaterThan(uhd * 3.5);
    expect(eightK).toBeLessThanOrEqual(250_000_000);
  });

  it('offers an 8K target and an orientation-free original ceiling', () => {
    expect(targetDimensions('4320p')).toEqual({ width: 7680, height: 4320 });
    // A portrait 8K screen is not scaled down by the "Original" ceiling.
    expect(fitWithin({ width: 4320, height: 7680 }, targetDimensions('original'))).toEqual({ width: 4320, height: 7680 });
  });

  it('respects a manual override', () => {
    expect(resolveVideoBitrate(5000, 3840, 2160, 30)).toBe(5_000_000);
  });

  it('describes MIME types', () => {
    expect(describeMime('video/webm;codecs=vp9,opus')).toBe('WebM · VP9 + Opus');
    expect(describeMime('video/mp4;codecs=avc1.640033,mp4a.40.2')).toBe('MP4 · H.264 + AAC');
  });
});
