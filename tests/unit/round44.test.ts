import { describe, expect, it } from 'vitest';
import { pageBands } from '@/screenshot/services/image-stitching';

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
