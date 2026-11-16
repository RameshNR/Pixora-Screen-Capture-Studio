import { describe, expect, it } from 'vitest';
import { buildTemplate } from '@/collage/layout';
import { exportScale, LAYOUT_WIDTH, type CollageModel } from '@/collage/render';

const style = { gap: 16, padding: 32, radius: 0, background: '#fff', lines: { show: false, color: '#000', width: 2, dash: 'solid' as const } };
const img = (w: number, h: number, i: number) => ({ key: `k${i}`, name: `${i}`, bitmap: { width: w, height: h } as ImageBitmap, view: { zoom: 1, ox: 0, oy: 0, fit: 'cover' as const } });
const model = (sizes: Array<[number, number]>, height = 600): CollageModel => ({
  tree: buildTemplate('row', sizes.length), images: sizes.map(([w, h], i) => img(w, h, i)), style, width: LAYOUT_WIDTH, height,
});

describe('collage export size', () => {
  it('keeps every picture at full resolution by default (no downscaling)', () => {
    // Three 4K screenshots side by side, filling cells 536 px tall in the layout: each one is drawn
    // 2160 px tall in the export, so none of its pixels are thrown away.
    const m = model([[3840, 2160], [3840, 2160], [3840, 2160]]);
    const out = exportScale(m, 'original');
    const cellH = 600 - 32 * 2;
    expect(cellH * out.scale).toBeCloseTo(2160, 0);
    expect(out.width).toBeGreaterThan(7000);
    expect(out.limited).toBe(false);
  });

  it('never goes below the layout size for small pictures', () => {
    expect(exportScale(model([[200, 100]]), 'original').width).toBe(LAYOUT_WIDTH);
  });

  it('exports fixed sizes up to 8K', () => {
    const m = model([[800, 600]]);
    expect(exportScale(m, 3840)).toMatchObject({ width: 3840, height: 1200 });
    expect(exportScale(m, 7680)).toMatchObject({ width: 7680, height: 2400 });
  });

  it('stays inside the browser canvas limits', () => {
    const out = exportScale(model([[30000, 30000], [30000, 30000]], 1200), 'original');
    expect(out.limited).toBe(true);
    expect(Math.max(out.width, out.height)).toBeLessThanOrEqual(16384);
    expect(out.width * out.height).toBeLessThanOrEqual(268_435_456 / 2);
  });
});
