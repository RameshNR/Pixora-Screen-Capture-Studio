import { describe, expect, it } from 'vitest';
import { findBars } from '@/recording/services/trim-bars';
import { normalizeSettings } from '@/settings/settings-service';
import { DEFAULT_SETTINGS } from '@/shared/constants/defaults';

/** RGBA image filled with `bg`, with a `fg` rectangle inside. */
function image(w: number, h: number, inner: { x: number; y: number; w: number; h: number } | null, fg = [200, 220, 240], bg = [0, 0, 0]): Uint8ClampedArray {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const on = inner && x >= inner.x && x < inner.x + inner.w && y >= inner.y && y < inner.y + inner.h;
      const c = on ? fg : bg;
      d.set([c[0]!, c[1]!, c[2]!, 255], (y * w + x) * 4);
    }
  }
  return d;
}

describe('video frames: letterbox bars', () => {
  it('finds black bands on every side', () => {
    expect(findBars(image(400, 300, { x: 50, y: 20, w: 300, h: 250 }), 400, 300)).toEqual({ top: 20, bottom: 30, left: 50, right: 50 });
  });
  it('keeps pictures without bars, all-black frames and thin dark edges', () => {
    expect(findBars(image(400, 300, { x: 0, y: 0, w: 400, h: 300 }), 400, 300)).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
    expect(findBars(image(400, 300, null), 400, 300)).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
    expect(findBars(image(400, 300, { x: 2, y: 0, w: 396, h: 300 }), 400, 300)).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
  });
  it('does not cut dark content that is not a full band', () => {
    // A dark page with one light line across the top row: no top bar.
    const d = image(200, 100, { x: 0, y: 0, w: 200, h: 1 });
    expect(findBars(d, 200, 100).top).toBe(0);
  });
});

describe('settings v2', () => {
  it('starts recordings on Desktop with Flow Capture on', () => {
    expect(DEFAULT_SETTINGS.recording.mode).toBe('desktop');
    expect(DEFAULT_SETTINGS.flow.withRecording).toBe(true);
  });
  it('moves older saved settings to Desktop + Flow Capture once, then keeps the user choice', () => {
    const old = normalizeSettings({ version: 1, recording: { mode: 'tab' }, flow: { withRecording: false } });
    expect(old.recording.mode).toBe('desktop');
    expect(old.flow.withRecording).toBe(true);
    expect(old.version).toBe(DEFAULT_SETTINGS.version);
    const later = normalizeSettings({ ...old, recording: { ...old.recording, mode: 'tab' }, flow: { ...old.flow, withRecording: false } });
    expect(later.recording.mode).toBe('tab');
    expect(later.flow.withRecording).toBe(false);
  });
});

describe('settings v3', () => {
  it('records high-quality MP4 at the screen resolution by default', () => {
    expect(DEFAULT_SETTINGS.recording.container).toBe('mp4');
    expect(DEFAULT_SETTINGS.recording.resolution).toBe('original');
  });
  it('moves older WebM / 1080p defaults over once, then keeps the user choice', () => {
    const old = normalizeSettings({ version: 2, recording: { container: 'webm', resolution: '1080p' } });
    expect(old.recording.container).toBe('mp4');
    expect(old.recording.resolution).toBe('original');
    const kept = normalizeSettings({ version: 2, recording: { container: 'webm', resolution: '720p' } });
    expect(kept.recording.resolution).toBe('720p');
    const later = normalizeSettings({ ...old, recording: { ...old.recording, container: 'webm', resolution: '1080p' } });
    expect(later.recording.container).toBe('webm');
    expect(later.recording.resolution).toBe('1080p');
  });
});
