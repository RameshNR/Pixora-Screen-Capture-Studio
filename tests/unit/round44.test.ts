import { describe, expect, it } from 'vitest';
import { pageBands } from '@/screenshot/services/image-stitching';
import { pointerOutline } from '@/editor/tools/shapes';

type P = { x: number; y: number };
const cross = (a: P, b: P, c: P) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
/** True when segments a–b and c–d properly cross (touching at shared ends doesn't count). */
const crosses = (a: P, b: P, c: P, d: P) => cross(a, b, c) * cross(a, b, d) < -1e-6 && cross(c, d, a) * cross(c, d, b) < -1e-6;

describe('pointer arrow outline', () => {
  for (const [name, path] of [
    ['straight', Array.from({ length: 41 }, (_, i) => ({ x: i * 10, y: 0 }))],
    ['diagonal', Array.from({ length: 41 }, (_, i) => ({ x: i * 8, y: -i * 5 }))],
    ['curved', Array.from({ length: 61 }, (_, i) => ({ x: i * 6, y: Math.sin(i / 20) * 60 }))],
  ] as const) {
    it(`never crosses itself (no unfilled triangles) — ${name}`, () => {
      for (const width of [4, 8, 14, 24]) {
        const poly = pointerOutline(path as unknown as P[], width);
        const n = poly.length;
        for (let i = 0; i < n; i++) {
          for (let j = i + 2; j < n; j++) {
            if (i === 0 && j === n - 1) continue;
            expect(crosses(poly[i]!, poly[(i + 1) % n]!, poly[j]!, poly[(j + 1) % n]!), `${name} w=${width} edges ${i}/${j}`).toBe(false);
          }
        }
      }
    });
  }
});

const m = (usesInnerScroller: boolean, clip: { x: number; y: number; width: number; height: number }) =>
  ({ usesInnerScroller, viewportWidth: 1280, viewportHeight: 800, clip });

describe('full page: strips around a scrolling box', () => {
  it('a full-width box under a header (and above a footer) keeps both strips', () => {
    expect(pageBands(m(true, { x: 0, y: 105, width: 1263, height: 645 }))).toEqual({ top: 105, bottom: 50 });
  });
  it('normal pages and boxes with side bars have none', () => {
    expect(pageBands(m(false, { x: 0, y: 0, width: 1280, height: 800 }))).toEqual({ top: 0, bottom: 0 });
    expect(pageBands(m(true, { x: 240, y: 60, width: 1040, height: 740 }))).toEqual({ top: 0, bottom: 0 });
  });
});
