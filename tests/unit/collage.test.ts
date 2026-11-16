import { describe, expect, it } from 'vitest';
import { aspectOf, autoSize, buildTemplate, computeRects, dividers, placeImage, resizeAt, type CollageNode } from '@/collage/layout';

const box = { x: 0, y: 0, w: 1000, h: 500 };

describe('collage layout', () => {
  it('builds horizontal, vertical, grid and feature templates', () => {
    expect(computeRects(buildTemplate('row', 3), box, 0).map((r) => r.box.w)).toEqual([1000 / 3, 1000 / 3, 1000 / 3]);
    expect(computeRects(buildTemplate('col', 2), box, 0).map((r) => r.box.y)).toEqual([0, 250]);
    const grid = computeRects(buildTemplate('grid', 4), box, 0);
    expect(grid.map((r) => [r.box.x, r.box.y])).toEqual([[0, 0], [500, 0], [0, 250], [500, 250]]);
    const feature = computeRects(buildTemplate('feature-left', 3), box, 0);
    expect(feature[0]!.box).toEqual({ x: 0, y: 0, w: 500, h: 500 });
    expect(feature[1]!.box.h).toBe(250);
    expect(buildTemplate('grid', 1)).toEqual({ kind: 'leaf', slot: 0 });
  });

  it('accounts for spacing between cells', () => {
    const rects = computeRects(buildTemplate('row', 2), box, 20);
    expect(rects[0]!.box.w).toBe(490);
    expect(rects[1]!.box.x).toBe(510);
  });

  it('sizes cells so images are not cropped', () => {
    const aspects = [2, 1]; // a wide and a square image side by side
    const t = autoSize(buildTemplate('row', 2), aspects);
    expect(aspectOf(t, aspects)).toBe(3);
    const rects = computeRects(t, { x: 0, y: 0, w: 300, h: 100 }, 0);
    expect(rects.map((r) => r.box.w / r.box.h)).toEqual([2, 1]);
    const stacked = autoSize(buildTemplate('col', 2), aspects);
    const sr = computeRects(stacked, { x: 0, y: 0, w: 100, h: aspectOf(stacked, aspects) ** -1 * 100 }, 0);
    expect(sr[0]!.box.w / sr[0]!.box.h).toBeCloseTo(2);
  });

  it('exposes draggable dividers and resizes neighbouring cells', () => {
    const t = buildTemplate('row', 3);
    const ds = dividers(t, box, 0);
    expect(ds).toHaveLength(2);
    expect(ds[0]!.box.x).toBeCloseTo(1000 / 3);
    const resized = resizeAt(t, [], 0, 0.1) as Extract<CollageNode, { kind: 'split' }>;
    expect(resized.sizes[0]).toBeCloseTo(1 / 3 + 0.1);
    expect(resized.sizes[1]).toBeCloseTo(1 / 3 - 0.1);
    expect(resized.sizes.reduce((a, b) => a + b)).toBeCloseTo(1);
    // Cells never collapse.
    const clamped = resizeAt(t, [], 0, 5) as Extract<CollageNode, { kind: 'split' }>;
    expect(clamped.sizes[1]).toBeCloseTo(0.06);
  });

  it('finds dividers inside nested splits', () => {
    const t = buildTemplate('feature-top', 3);
    const ds = dividers(t, box, 0);
    expect(ds.map((d) => d.dir).sort()).toEqual(['col', 'row']);
    const inner = ds.find((d) => d.dir === 'row')!;
    expect(inner.path).toEqual([1]);
  });

  it('places images with cover / contain fit, zoom and pan', () => {
    const cell = { x: 0, y: 0, w: 100, h: 100 };
    expect(placeImage(200, 100, cell, { zoom: 1, ox: 0, oy: 0, fit: 'cover' })).toEqual({ x: -50, y: 0, w: 200, h: 100 });
    expect(placeImage(200, 100, cell, { zoom: 1, ox: 0, oy: 0, fit: 'contain' })).toEqual({ x: 0, y: 25, w: 100, h: 50 });
    expect(placeImage(200, 100, cell, { zoom: 1, ox: 1, oy: 0, fit: 'cover' }).x).toBe(0); // panned fully right
    expect(placeImage(200, 100, cell, { zoom: 2, ox: 0, oy: 0, fit: 'cover' }).w).toBe(400);
  });
});
