import { describe, expect, it } from 'vitest';
import { pickWorkArea, type DisplayLike } from '@/recording/services/display-service';
import { alphaOf, formatColor, parseColor, sameHue, withAlpha } from '@/shared/utils/color';
import { buildTemplate, computeRects } from '@/collage/layout';

const screen = (over: Partial<DisplayLike> = {}): DisplayLike => ({
  isPrimary: true,
  bounds: { left: 0, top: 0, width: 1920, height: 1080 },
  workArea: { left: 0, top: 0, width: 1920, height: 1032 }, // 48 px taskbar at the bottom
  ...over,
});

describe('capture without taskbar', () => {
  it('crops a full-screen capture to the work area, even when scaled', () => {
    expect(pickWorkArea([screen()], 3840, 2160)).toEqual({ x: 0, y: 0, width: 1, height: 1032 / 1080 });
  });

  it('handles taskbars on the left / top (macOS menu bar)', () => {
    const left = pickWorkArea([screen({ workArea: { left: 60, top: 0, width: 1860, height: 1080 } })], 1920, 1080)!;
    expect(left.x).toBeCloseTo(60 / 1920);
    const mac = pickWorkArea([screen({ bounds: { left: 0, top: 0, width: 1512, height: 982 }, workArea: { left: 0, top: 33, width: 1512, height: 949 } })], 3024, 1964)!;
    expect(mac.y).toBeCloseTo(33 / 982);
  });

  it('matches the right monitor and ignores windows / unchanged screens', () => {
    const ultrawide = screen({ isPrimary: false, bounds: { left: 1920, top: 0, width: 3440, height: 1440 }, workArea: { left: 1920, top: 0, width: 3440, height: 1400 } });
    expect(pickWorkArea([screen(), ultrawide], 3440, 1440)!.height).toBeCloseTo(1400 / 1440);
    expect(pickWorkArea([screen()], 1200, 900)).toBeNull(); // a window, not a screen
    expect(pickWorkArea([screen({ workArea: { left: 0, top: 0, width: 1920, height: 1080 } })], 1920, 1080)).toBeNull(); // auto-hidden taskbar
  });
});

describe('colours with transparency', () => {
  it('round-trips 8-digit hex', () => {
    expect(formatColor('#E05252', 0.5)).toBe('#e0525280');
    expect(parseColor('#e0525280').alpha).toBeCloseTo(0.5, 2);
    expect(formatColor('#E05252', 1)).toBe('#e05252');
    // Zero opacity keeps the hue so the colour (and its slider) stay visible.
    expect(formatColor('#E05252', 0)).toBe('#e0525200');
  });

  it('applies opacity to gradients and compares hues', () => {
    expect(withAlpha('linear:#ffffff:#000000', 0.5)).toBe('linear:#ffffff80:#00000080');
    expect(alphaOf('linear:#ffffff80:#00000080')).toBeCloseTo(0.5, 2);
    expect(sameHue('#E05252', '#e0525233')).toBe(true);
    expect(sameHue('transparent', '#000000')).toBe(false);
  });
});

describe('collage grid columns', () => {
  it('lays out many images with a chosen column count', () => {
    const rects = computeRects(buildTemplate('grid', 10, 5), { x: 0, y: 0, w: 1000, h: 400 }, 0);
    expect(rects).toHaveLength(10);
    expect(new Set(rects.map((r) => r.box.y)).size).toBe(2);
    expect(rects[4]!.box.x).toBe(800);
  });
});
