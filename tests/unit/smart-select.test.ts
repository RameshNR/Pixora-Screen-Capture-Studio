import { describe, expect, it } from 'vitest';
import { flatness, graphicSubject, selectInGraphic } from '@/editor/tools/smart-select';

/** A tiny "screenshot": light page, a purple button with white text bars, a dark word, a red badge. */
function ui(w = 400, h = 300) {
  const d = new Uint8ClampedArray(w * h * 4);
  const fill = (x0: number, y0: number, x1: number, y1: number, c: number[]) => {
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) d.set([...c, 255], (y * w + x) * 4);
  };
  fill(0, 0, w, h, [246, 247, 250]);
  fill(40, 40, 200, 80, [124, 58, 237]); // button
  fill(70, 55, 80, 66, [255, 255, 255]); // its "text"
  fill(90, 55, 100, 66, [255, 255, 255]);
  // A word: three letters (4 px wide, 12 px tall) 3 px apart.
  for (const x of [60, 67, 74]) fill(x, 150, x + 4, 162, [30, 30, 40]);
  // Another word far away on the same line.
  fill(300, 150, 304, 162, [30, 30, 40]);
  // Badge with a hole.
  fill(300, 40, 340, 80, [224, 40, 40]);
  fill(316, 52, 324, 68, [255, 255, 255]);
  return { d, w, h };
}
const count = (m: Uint8Array | null) => (m ? m.reduce((s, v) => s + v, 0) : 0);
const at = (m: Uint8Array | null, w: number, x: number, y: number) => (m ? m[y * w + x] : 0);

describe('smart select (screenshots)', () => {
  it('tells a screenshot from noise', () => {
    const { d, w, h } = ui();
    expect(flatness(d, w, h)).toBeGreaterThan(0.8);
    const noise = new Uint8ClampedArray(w * h * 4).map((_, i) => (i % 4 === 3 ? 255 : (i * 2654435761) % 251));
    expect(flatness(noise, w, h)).toBeLessThan(0.2);
  });

  it('a click on a button selects the whole button, with its text, and nothing else', () => {
    const { d, w, h } = ui();
    const m = selectInGraphic(d, w, h, 50, 45);
    expect(count(m)).toBe(160 * 40);
    expect(at(m, w, 75, 60)).toBe(1);
    expect(at(m, w, 30, 30)).toBe(0);
  });

  it('a click on a letter selects its word, not the far word or the page', () => {
    const { d, w, h } = ui();
    const m = selectInGraphic(d, w, h, 62, 155);
    expect(at(m, w, 62, 155)).toBe(1);
    expect(at(m, w, 76, 155)).toBe(1);
    expect(at(m, w, 302, 155)).toBe(0);
    expect(count(m)).toBeLessThan(40 * 30);
  });

  it('a badge comes with the number inside it; empty page gives nothing', () => {
    const { d, w, h } = ui();
    const m = selectInGraphic(d, w, h, 305, 45);
    expect(at(m, w, 320, 60)).toBe(1);
    expect(count(m)).toBe(40 * 40);
    expect(selectInGraphic(d, w, h, 250, 250)).toBeNull();
  });

  it('the subject of a graphic is everything that is not the edge colour', () => {
    const { d, w, h } = ui();
    const s = graphicSubject(d, w, h)!.mask;
    expect(at(s, w, 100, 60)).toBe(1);
    expect(at(s, w, 5, 5)).toBe(0);
  });
});

describe('graphic background', () => {
  it('a header bar along the top only is content, not background; the page colour is background', () => {
    const w = 300, h = 200;
    const d = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) d.set(y < 30 ? [19, 25, 33, 255] : [255, 255, 255, 255], (y * w + x) * 4);
    for (let y = 80; y < 140; y++) for (let x = 100; x < 200; x++) d.set([30, 60, 200, 255], (y * w + x) * 4);
    const s = graphicSubject(d, w, h)!.mask;
    expect(s[10 * w + 150]).toBe(1); // header kept
    expect(s[100 * w + 150]).toBe(1); // the blue box kept
    expect(s[170 * w + 20]).toBe(0); // page removed
  });
});

describe('smart select on a real screenshot (tests/unit/fixtures/editor-shot.png, the 1.1.3 store picture)', () => {
  const box = (m: Uint8Array | null, w: number) => {
    let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
    if (m) for (let k = 0; k < m.length; k++) if (m[k]) { const x = k % w, y = (k - x) / w; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    return { x0, y0, x1, y1 };
  };
  it('the red arrow, the badge (also from its "1"), and the Book trip button from its label', async () => {
    const { readPng } = await import('./png');
    const { data, width: w, height: h } = readPng('tests/unit/fixtures/editor-shot.png');
    const arrow = box(selectInGraphic(data, w, h, 400, 548), w);
    expect(arrow.x1 - arrow.x0).toBeGreaterThan(90);
    expect(arrow.x1 - arrow.x0).toBeLessThan(140);
    for (const [x, y] of [[822, 428], [828, 428]] as const) {
      const badge = box(selectInGraphic(data, w, h, x, y), w);
      expect(badge.x1 - badge.x0).toBeLessThan(50);
      expect(badge.x0).toBeGreaterThan(800);
    }
    const button = box(selectInGraphic(data, w, h, 742, 589), w);
    expect(button.x1 - button.x0).toBeGreaterThan(200);
    expect(button.y1 - button.y0).toBeLessThan(35);
  });
});
