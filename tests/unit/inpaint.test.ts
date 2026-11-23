import { describe, expect, it } from 'vitest';
import { inpaint } from '@/editor/tools/inpaint';

/** w × h picture: vertical stripes (8 px blue, 8 px white), with a red square drawn on top. */
function stripes(w: number, h: number, square: { x: number; y: number; s: number } | null) {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const blue = Math.floor(x / 8) % 2 === 0;
      const red = square && x >= square.x && x < square.x + square.s && y >= square.y && y < square.y + square.s;
      d.set(red ? [230, 20, 20, 255] : blue ? [40, 90, 220, 255] : [250, 250, 250, 255], i);
    }
  }
  return d;
}

describe('inpaint (fill with matching background)', () => {
  it('removes an object and continues the pattern behind it', () => {
    const w = 96;
    const h = 72;
    const sq = { x: 36, y: 24, s: 20 };
    const img = stripes(w, h, sq);
    const hole = new Uint8Array(w * h);
    for (let y = sq.y - 2; y < sq.y + sq.s + 2; y++) for (let x = sq.x - 2; x < sq.x + sq.s + 2; x++) hole[y * w + x] = 1;
    const out = inpaint(img, w, h, hole);
    const truth = stripes(w, h, null);
    let red = 0;
    let off = 0;
    let n = 0;
    for (let y = sq.y; y < sq.y + sq.s; y++) {
      for (let x = sq.x; x < sq.x + sq.s; x++) {
        const i = (y * w + x) * 4;
        if (out[i]! > 150 && out[i + 1]! < 80) red++;
        off += Math.abs(out[i]! - truth[i]!) + Math.abs(out[i + 2]! - truth[i + 2]!);
        n++;
      }
    }
    // None of the red is left, and the stripes mostly line up again (no white or grey patch).
    expect(red).toBe(0);
    expect(off / n / 2).toBeLessThan(45);
    // Pixels outside the hole are untouched.
    expect(out[0]).toBe(img[0]);
    expect(Array.from(out.slice(((h - 1) * w + w - 1) * 4))).toEqual(Array.from(img.slice(((h - 1) * w + w - 1) * 4)));
  });

  it('is the same every time and leaves a picture with no hole alone', () => {
    const w = 40;
    const h = 30;
    const img = stripes(w, h, { x: 15, y: 10, s: 8 });
    const hole = new Uint8Array(w * h);
    for (let y = 9; y < 19; y++) for (let x = 14; x < 24; x++) hole[y * w + x] = 1;
    expect(Array.from(inpaint(img, w, h, hole))).toEqual(Array.from(inpaint(img, w, h, hole)));
    expect(Array.from(inpaint(img, w, h, new Uint8Array(w * h)))).toEqual(Array.from(img));
  });

  it('fills a 200 × 200 hole in a 600 × 600 picture in reasonable time', () => {
    const w = 600;
    const h = 600;
    const img = stripes(w, h, { x: 200, y: 200, s: 200 });
    const hole = new Uint8Array(w * h);
    for (let y = 196; y < 404; y++) for (let x = 196; x < 404; x++) hole[y * w + x] = 1;
    const t = performance.now();
    inpaint(img, w, h, hole);
    expect(performance.now() - t).toBeLessThan(8000);
  });
});
