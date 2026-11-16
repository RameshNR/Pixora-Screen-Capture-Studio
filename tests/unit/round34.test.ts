import { describe, expect, it } from 'vitest';
import { pickWorkArea, type DisplayLike } from '@/recording/services/display-service';
import { glideAlpha } from '@/shared/utils/cursor-glide';

const display = (over: Partial<DisplayLike> = {}): DisplayLike => ({
  isPrimary: true,
  bounds: { left: 0, top: 0, width: 1920, height: 1200 },
  workArea: { left: 0, top: 0, width: 1920, height: 1152 },
  ...over,
});

describe('record without taskbar', () => {
  it('crops a 16:10 screen from its real frame size', () => {
    // Real frames of a 1920×1200 screen captured within a 1920×1080 box: 1728×1080.
    expect(pickWorkArea([display()], 1728, 1080)!.height).toBeCloseTo(1152 / 1200);
  });

  it('a whole screen whose reported size does not match (requested box) still loses the taskbar', () => {
    // getSettings() reporting the requested 1920×1080 for a 16:10 screen: unknown capture → no crop,
    expect(pickWorkArea([display()], 1920, 1080)).toBeNull();
    // but a capture Chrome labels "screen:…" on the only monitor is cropped.
    expect(pickWorkArea([display()], 1920, 1080, true)!.height).toBeCloseTo(1152 / 1200);
  });

  it('tolerates rounding for known screens, still refuses windows and auto-hidden taskbars', () => {
    expect(pickWorkArea([display()], 1919, 1201, true)).not.toBeNull();
    expect(pickWorkArea([display(), display({ isPrimary: false, bounds: { left: 1920, top: 0, width: 1280, height: 1024 }, workArea: { left: 1920, top: 0, width: 1280, height: 984 } })], 1280, 1024, true)!.height).toBeCloseTo(984 / 1024);
    expect(pickWorkArea([display()], 1200, 900)).toBeNull();
    expect(pickWorkArea([display({ workArea: { left: 0, top: 0, width: 1920, height: 1200 } })], 1920, 1200, true)).toBeNull();
  });
});

describe('styled cursor glide', () => {
  it('follows the mouse quickly at the default smoothing', () => {
    // After 45 ms (about 3 frames at 60 Hz) it has closed at least 95% of the gap.
    expect(glideAlpha(45, 0.6)).toBeGreaterThan(0.95);
    // One 60 Hz frame moves it most of the way, not 40% like the old easing.
    expect(glideAlpha(16.7, 0.6)).toBeGreaterThan(0.6);
  });

  it('is frame-rate independent, and off means no glide', () => {
    const two60 = 1 - (1 - glideAlpha(16.7, 0.6)) ** 2;
    expect(glideAlpha(33.4, 0.6)).toBeCloseTo(two60, 5);
    expect(glideAlpha(5, 0)).toBe(1);
    expect(glideAlpha(5, 0.02)).toBe(1);
  });
});
