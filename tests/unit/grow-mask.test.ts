import { describe, expect, it } from 'vitest';
import { growMask } from '@/editor/tools/mask';

/** The plain way (window max / min, edges clamped), to check the fast one against. */
function slow(mask: Uint8ClampedArray, w: number, h: number, r: number): Uint8ClampedArray {
  const k = Math.abs(r);
  const pick = r > 0 ? Math.max : Math.min;
  const tmp = new Uint8ClampedArray(mask.length);
  const out = new Uint8ClampedArray(mask.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let v = mask[y * w + x]!;
    for (let d = 1; d <= k; d++) v = pick(v, mask[y * w + Math.max(0, x - d)]!, mask[y * w + Math.min(w - 1, x + d)]!);
    tmp[y * w + x] = v;
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let v = tmp[y * w + x]!;
    for (let d = 1; d <= k; d++) v = pick(v, tmp[Math.max(0, y - d) * w + x]!, tmp[Math.min(h - 1, y + d) * w + x]!);
    out[y * w + x] = v;
  }
  return out;
}

describe('growMask (fast window max / min)', () => {
  it('matches the plain way for growing and shrinking, soft and hard masks, odd sizes', () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32);
    for (const [w, h] of [[37, 23], [5, 61], [64, 1], [1, 9]] as const) {
      const m = new Uint8ClampedArray(w * h).map(() => (rnd() < 0.15 ? Math.floor(rnd() * 256) : 0));
      for (const r of [1, 2, 3, 7, -1, -4, 30]) expect(Array.from(growMask(m, w, h, r)), `${w}x${h} r=${r}`).toEqual(Array.from(slow(m, w, h, r)));
    }
  });

  it('is fast on a 20-megapixel mask with a wide window', () => {
    const w = 6000, h = 3376;
    const m = new Uint8ClampedArray(w * h);
    for (let y = 1000; y < 2000; y++) m.fill(255, y * w + 2000, y * w + 3500);
    const t = performance.now();
    growMask(m, w, h, 11);
    expect(performance.now() - t).toBeLessThan(4000);
  });
});
