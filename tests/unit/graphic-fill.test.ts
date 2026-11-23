import { describe, expect, it } from 'vitest';
import { graphicFill, knownFlatness } from '@/editor/tools/graphic-fill';

/** A dark page with a white card (x 40–160, y 30–100) and black "text" on the card. */
function page(w = 200, h = 140) {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const card = x >= 40 && x < 160 && y >= 30 && y < 100;
    const text = card && y >= 50 && y < 60 && x >= 60 && x < 140 && (x % 6 < 3);
    d.set(text ? [0, 0, 0, 255] : card ? [255, 255, 255, 255] : [20, 25, 33, 255], (y * w + x) * 4);
  }
  return d;
}
const px = (d: Uint8ClampedArray, w: number, x: number, y: number) => Array.from(d.slice((y * w + x) * 4, (y * w + x) * 4 + 3));

describe('graphic fill (screenshots)', () => {
  it('a hole over text on a card becomes the card colour; no text is copied in', () => {
    const w = 200, h = 140;
    const d = page(w, h);
    const hole = new Uint8Array(w * h);
    for (let y = 48; y < 62; y++) for (let x = 58; x < 142; x++) hole[y * w + x] = 1;
    const out = graphicFill(d, hole, w, h);
    for (let y = 48; y < 62; y++) for (let x = 58; x < 142; x++) expect(px(out, w, x, y)).toEqual([255, 255, 255]);
  });

  it('a hole across the card edge continues the edge straight: card inside, page outside', () => {
    const w = 200, h = 140;
    const d = page(w, h);
    const hole = new Uint8Array(w * h);
    // Over the card's bottom-left corner region, half on the card and half on the page.
    for (let y = 85; y < 115; y++) for (let x = 20; x < 70; x++) hole[y * w + x] = 1;
    const out = graphicFill(d, hole, w, h);
    expect(px(out, w, 60, 90)).toEqual([255, 255, 255]); // on the card
    expect(px(out, w, 60, 110)).toEqual([20, 25, 33]); // below the card: page, no white spill
    expect(px(out, w, 30, 90)).toEqual([20, 25, 33]); // left of the card: page
  });

  it('tells a flat page from a photo', () => {
    const w = 200, h = 140;
    expect(knownFlatness(page(w, h), new Uint8Array(w * h), w, h)).toBeGreaterThan(0.8);
    const noise = new Uint8ClampedArray(w * h * 4).map((_, i) => (i % 4 === 3 ? 255 : (i * 2654435761) % 251));
    expect(knownFlatness(noise, new Uint8Array(w * h), w, h)).toBeLessThan(0.1);
  });
});
