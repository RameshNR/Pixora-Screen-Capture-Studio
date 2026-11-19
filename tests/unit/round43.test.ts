import { describe, expect, it } from 'vitest';
import { normalizeSettings } from '@/settings/settings-service';
import { DEFAULT_SETTINGS } from '@/shared/constants/defaults';
import { framesPerPart, PART_MAX_PX } from '@/screenshot/services/image-stitching';
import { pointerOutline } from '@/editor/tools/shapes';
import { LINE_PRESETS } from '@/editor/tools/line-presets';
import { MAX_CANVAS_AREA, MAX_CANVAS_DIMENSION } from '@/shared/constants/media';

describe('longer full-page screenshots', () => {
  it('the limit is much higher (v7 raises the old default, keeps a chosen one)', () => {
    expect(DEFAULT_SETTINGS.screenshot.fullPage.maxHeight).toBe(100000);
    const old = (h: number) => normalizeSettings({ ...structuredClone(DEFAULT_SETTINGS), version: 6, screenshot: { ...DEFAULT_SETTINGS.screenshot, fullPage: { ...DEFAULT_SETTINGS.screenshot.fullPage, maxHeight: h } } });
    expect(old(30000).screenshot.fullPage.maxHeight).toBe(100000);
    expect(old(10000).screenshot.fullPage.maxHeight).toBe(10000);
  });

  it('a long page is split into full-resolution parts within Chrome’s canvas limits', () => {
    // 900 CSS px screens at 2× on a 1280 px wide page.
    const n = framesPerPart(900, 1280, 2);
    expect(n).toBe(Math.floor(PART_MAX_PX / 1800));
    expect(n * 1800).toBeLessThanOrEqual(MAX_CANVAS_DIMENSION);
    // Very wide pages: the area limit decides.
    const wide = framesPerPart(900, 12000, 2);
    expect(wide * 1800 * 24000).toBeLessThanOrEqual(MAX_CANVAS_AREA);
    // Always at least one screen per part.
    expect(framesPerPart(40000, 1280, 2)).toBe(1);
  });
});

describe('pointer arrow (tapered body, big head)', () => {
  it('is one shape: rounded tail, wider body, barbs reaching past the body, tip at the end', () => {
    // A sampled straight path (the editor samples paths the same way before drawing).
    const path = Array.from({ length: 41 }, (_, i) => ({ x: i * 5, y: 0 }));
    const poly = pointerOutline(path, 10);
    const tip = poly.find((p) => Math.abs(p.x - 200) < 1e-6 && Math.abs(p.y) < 1e-6);
    expect(tip).toBeTruthy();
    const halfAt = (x: number) => Math.max(...poly.filter((p) => Math.abs(p.x - x) < 6).map((p) => Math.abs(p.y)));
    // Tail thinner than the body before the head; barbs much wider than the body.
    expect(halfAt(0)).toBeLessThan(halfAt(120) / 2);
    const barb = Math.max(...poly.map((p) => Math.abs(p.y)));
    expect(barb).toBeGreaterThan(halfAt(120) * 2);
    expect(LINE_PRESETS.some((p) => p.id === 'pointer' && p.patch.body === 'pointer')).toBe(true);
  });
});
