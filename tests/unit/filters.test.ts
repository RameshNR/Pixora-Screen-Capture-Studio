import { describe, expect, it } from 'vitest';
import { applyPixels, isActive, NO_FILTERS, resolve, type ImageFilters } from '@/editor/tools/filters';

const px = (r: number, g: number, b: number) => new Uint8ClampedArray([r, g, b, 255]);
const run = (f: ImageFilters, d: Uint8ClampedArray, w = 1, h = 1) => { applyPixels(d, w, h, resolve(f)); return Array.from(d); };

describe('filters', () => {
  it('Original with nothing changed is no filter at all', () => {
    expect(isActive(NO_FILTERS)).toBe(false);
    expect(run(NO_FILTERS, px(10, 120, 240))).toEqual([10, 120, 240, 255]);
  });

  it('a preset is scaled by its intensity, and the user’s own values add to it', () => {
    const noir = resolve({ ...NO_FILTERS, preset: 'noir', intensity: 50 });
    expect(noir.saturation).toBe(-50);
    const both = resolve({ ...NO_FILTERS, preset: 'noir', intensity: 100, adjust: { saturation: 30 } });
    expect(both.saturation).toBe(-70);
    expect(resolve({ ...NO_FILTERS, preset: 'noir', intensity: 0 }).saturation).toBe(0);
  });

  it('Noir makes the picture grey; Warm makes it warmer; Brightness lightens', () => {
    const [r, g, b] = run({ ...NO_FILTERS, preset: 'noir', intensity: 100, effects: { vignette: -36 as number, grain: -14 as number } }, px(200, 40, 40));
    expect(Math.abs(r! - g!)).toBeLessThan(3);
    expect(Math.abs(g! - b!)).toBeLessThan(3);
    const warm = run({ ...NO_FILTERS, preset: 'warm', intensity: 100 }, px(128, 128, 128));
    expect(warm[0]).toBeGreaterThan(warm[2]! + 20);
    const light = run({ ...NO_FILTERS, adjust: { brightness: 50 } }, px(100, 100, 100));
    expect(light[0]).toBeGreaterThan(130);
  });

  it('see-through pixels stay see-through', () => {
    const d = new Uint8ClampedArray([50, 60, 70, 0]);
    applyPixels(d, 1, 1, resolve({ ...NO_FILTERS, preset: 'vivid', intensity: 100 }));
    expect(d[3]).toBe(0);
  });
});
