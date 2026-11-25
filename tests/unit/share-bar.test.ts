import { describe, expect, it } from 'vitest';
import { alignShot, fillFromEdges, findShareBar, shotMismatch } from '@/recording/services/share-bar';

type RGB = [number, number, number];

/** An RGBA picture filled with one colour, with helpers to paint rectangles. */
function picture(w: number, h: number, fill: RGB) {
  const d = new Uint8ClampedArray(w * h * 4);
  const rect = (x: number, y: number, rw: number, rh: number, c: RGB) => {
    for (let j = y; j < y + rh; j++) for (let i = x; i < x + rw; i++) {
      const k = (j * w + i) * 4;
      d[k] = c[0]; d[k + 1] = c[1]; d[k + 2] = c[2]; d[k + 3] = 255;
    }
  };
  rect(0, 0, w, h, fill);
  return { d, rect };
}

/** Chrome's bar as it shows on a 1080p screen, reduced to half size (the recorder's probe). */
function bar(p: ReturnType<typeof picture>, theme: 'dark' | 'light', x = 333, y = 232) {
  const bg: RGB = theme === 'dark' ? [32, 33, 36] : [255, 255, 255];
  const text: RGB = theme === 'dark' ? [232, 234, 237] : [32, 33, 36];
  const pill: RGB = theme === 'dark' ? [168, 199, 250] : [11, 87, 208];
  p.rect(x, y, 295, 30, bg);
  // "||  Pixora – … is sharing your screen."  (thin glyph strokes, level with the pill's middle)
  p.rect(x + 8, y + 11, 2, 9, text);
  p.rect(x + 12, y + 11, 2, 9, text);
  for (let i = x + 20; i < x + 200; i += 4) p.rect(i, y + 12, 2, 7, text);
  // "Stop sharing": a pill with its label.
  p.rect(x + 202, y + 3, 66, 24, pill);
  for (let i = x + 212; i < x + 258; i += 5) p.rect(i, y + 12, 2, 6, theme === 'dark' ? [11, 29, 41] : [255, 255, 255]);
  // "Hide"
  for (let i = x + 274; i < x + 290; i += 4) p.rect(i, y + 12, 2, 7, [168, 199, 250]);
}

describe('finding Chrome’s “is sharing your screen” bar in recorded frames', () => {
  it('the dark bar on a light page', () => {
    const p = picture(960, 297, [236, 240, 243]);
    bar(p, 'dark');
    const r = findShareBar(p.d, 960, 297, 540)!;
    expect(r).not.toBeNull();
    expect(Math.abs(r.x - 333)).toBeLessThanOrEqual(2);
    expect(Math.abs(r.y - 232)).toBeLessThanOrEqual(2);
    expect(Math.abs(r.w - 295)).toBeLessThanOrEqual(3);
    expect(Math.abs(r.h - 30)).toBeLessThanOrEqual(3);
  });

  it('the light bar on a coloured page', () => {
    const p = picture(960, 297, [180, 225, 225]);
    bar(p, 'light', 300, 200);
    const r = findShareBar(p.d, 960, 297, 540)!;
    expect(r).not.toBeNull();
    expect(Math.abs(r.x - 300)).toBeLessThanOrEqual(2);
  });

  it('the bar over dark surroundings (a dark photo above, the taskbar below)', () => {
    const p = picture(960, 297, [240, 240, 240]);
    p.rect(0, 150, 960, 82, [70, 45, 35]); // dark photo just above the bar (a wooden table)
    p.rect(0, 267, 960, 30, [30, 34, 40]); // taskbar
    bar(p, 'dark');
    expect(findShareBar(p.d, 960, 297, 540)).not.toBeNull();
  });

  it('the dark bar on an equally dark page (dark-theme site): found by its message and Hide link', () => {
    const p = picture(960, 297, [32, 33, 36]);
    bar(p, 'dark');
    const r = findShareBar(p.d, 960, 297, 540)!;
    expect(r).not.toBeNull();
    expect(r.x).toBeLessThanOrEqual(341);
    expect(r.x + r.w).toBeGreaterThanOrEqual(623);
    // The same bar high up the screen is not Chrome's (it shows it low and centred).
    const q = picture(960, 297, [32, 33, 36]);
    bar(q, 'dark', 333, 20);
    expect(findShareBar(q.d, 960, 297, 540)).toBeNull();
  });

  it('a blue button on a plain web page is left alone', () => {
    const p = picture(960, 297, [255, 255, 255]);
    p.rect(500, 100, 70, 26, [11, 87, 208]); // "Sign in" on a white header
    p.rect(200, 180, 120, 30, [32, 33, 36]); // a dark card elsewhere
    p.rect(330, 183, 60, 24, [168, 199, 250]); // a light-blue chip next to it, not on a bar
    expect(findShareBar(p.d, 960, 297, 540)).toBeNull();
  });

  it('a dark page with a light-blue button is left alone (the background runs on)', () => {
    const p = picture(960, 297, [32, 33, 36]);
    p.rect(540, 235, 66, 24, [168, 199, 250]);
    expect(findShareBar(p.d, 960, 297, 540)).toBeNull();
  });
});

describe('taking the bar out of the picture', () => {
  /** A busy page: a pattern that only lines up one way. */
  const pageAt = (x: number, y: number): RGB => [(x * 37 + y * 11) % 256, (x * 5 + y * 53) % 256, ((x ^ y) * 29) % 256];

  it('a plain page background comes back exactly, even with the taskbar just below', () => {
    const p = picture(200, 60, [255, 255, 255]);
    p.rect(0, 50, 200, 10, [30, 34, 40]); // taskbar
    p.rect(40, 20, 120, 28, [32, 33, 36]); // the bar
    fillFromEdges(p.d, 200, 60, { x: 38, y: 18, w: 124, h: 32 });
    for (const [x, y] of [[40, 20], [100, 34], [159, 47], [38, 49]] as const) {
      const k = (y * 200 + x) * 4;
      expect([p.d[k], p.d[k + 1], p.d[k + 2]]).toEqual([255, 255, 255]);
    }
  });

  it('carries the page on into the gap without blurring it (columns keep their colour)', () => {
    const p = picture(200, 60, [255, 255, 255]);
    p.rect(90, 0, 10, 60, [200, 40, 40]); // a red column running through
    p.rect(40, 20, 120, 20, [32, 33, 36]);
    fillFromEdges(p.d, 200, 60, { x: 40, y: 20, w: 120, h: 20 });
    const k = (30 * 200 + 95) * 4;
    expect([p.d[k], p.d[k + 1], p.d[k + 2]]).toEqual([200, 40, 40]);
    const j = (30 * 200 + 110) * 4; // next to it stays white, not pink
    expect([p.d[j], p.d[j + 1], p.d[j + 2]]).toEqual([255, 255, 255]);
  });

  it('fits Chrome’s picture of the page onto the frame by its pixels, to the exact pixel', () => {
    const area = { x: 100, y: 80, w: 160, h: 60 };
    const bar = { x: 116, y: 96, w: 128, h: 28 };
    const slack = 24;
    // Where the page really is, and where the window's position says it is (a few pixels out).
    const real = { x: 7, y: -5 };
    const frame = new Uint8ClampedArray(area.w * area.h * 4);
    for (let y = 0; y < area.h; y++) for (let x = 0; x < area.w; x++) {
      const c = pageAt(area.x + x - real.x, area.y + y - real.y);
      frame.set([...c, 255], (y * area.w + x) * 4);
    }
    // The bar on the frame.
    for (let y = bar.y - area.y; y < bar.y - area.y + bar.h; y++) for (let x = bar.x - area.x; x < bar.x - area.x + bar.w; x++) frame.set([32, 33, 36, 255], (y * area.w + x) * 4);
    const sw = area.w + slack * 2;
    const sh = area.h + slack * 2;
    const shot = new Uint8ClampedArray(sw * sh * 4);
    for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) shot.set([...pageAt(area.x - slack + x, area.y - slack + y), 255], (y * sw + x) * 4);
    const fit = alignShot(frame, shot, area, bar, slack);
    expect(fit).toEqual({ dx: 7, dy: -5, mismatch: 0 });
    // Another page doesn't fit anywhere.
    const other = shot.map((v, i) => (i % 4 === 3 ? 255 : 255 - v));
    expect(alignShot(frame, other, area, bar, slack).mismatch).toBeGreaterThan(40);
    expect(shotMismatch(frame, shot, area, bar, slack, 0, 0)).toBeGreaterThan(40);
  });
});
