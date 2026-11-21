import { describe, expect, it } from 'vitest';
import { BLUR_GROUPS, MASK_GROUPS, PIXEL_GROUPS, designActive, designPatch, redactScope, scopePatch } from '@/editor/tools/blur';
import type { RedactAnnotation } from '@/editor/types';

const area = (patch: Partial<RedactAnnotation> = {}): RedactAnnotation =>
  ({ id: 'a', type: 'blur', x: 100, y: 80, w: 300, h: 200, intensity: 12, opacity: 1, ...patch }) as RedactAnnotation;
const preset = (groups: typeof BLUR_GROUPS, id: string) => groups.flatMap((g) => g.items).find((p) => p.id === id)!.patch;

describe('blur / pixelate / mask designs', () => {
  it('never decide where the effect applies (that is "Apply to")', () => {
    for (const groups of [BLUR_GROUPS, PIXEL_GROUPS, MASK_GROUPS]) {
      for (const p of groups.flatMap((g) => g.items)) expect(p.patch.invert, p.id).toBeUndefined();
    }
  });

  it('a style design replaces the earlier style (Depth → Zoom keeps no leftovers)', () => {
    const a = { ...area(), ...designPatch(preset(BLUR_GROUPS, 'b-depth')) };
    const b = { ...a, ...designPatch(preset(BLUR_GROUPS, 'b-zoom')) };
    expect(b.mode).toBe('zoom');
    expect(b.fade).toBeUndefined();
    expect(b.invert).toBeUndefined();
    expect(designActive(b, preset(BLUR_GROUPS, 'b-zoom'))).toBe(true);
    expect(designActive(b, preset(BLUR_GROUPS, 'b-depth'))).toBe(false);
  });

  it('keeps where it applies when the design changes', () => {
    const outside = area({ invert: true });
    expect({ ...outside, ...designPatch(preset(BLUR_GROUPS, 'b-zoom')) }.invert).toBe(true);
  });

  it('a colour design keeps the shape; a shape design keeps the colour (masks)', () => {
    const m = area({ type: 'mask', color: '#000000' });
    const cloud = { ...m, ...designPatch(preset(MASK_GROUPS, 'm-cloud')) };
    const red = { ...cloud, ...designPatch(preset(MASK_GROUPS, 'm-red')) };
    expect(red.shape).toBe('cloud');
    expect(red.color).toBe('#FF1F1F');
    // A shape picked after text lines keeps the lines, inside the new shape.
    const lines = { ...red, ...designPatch(preset(MASK_GROUPS, 'm-lines')) };
    const circle = { ...lines, ...designPatch(preset(MASK_GROUPS, 'm-circle')) };
    expect(lines.maskPattern).toBe('lines');
    expect(circle.shape).toBe('ellipse');
    // The text lines stay, drawn inside the circle (a design adds to the shape).
    expect(circle.maskPattern).toBe('lines');
    expect(designActive(circle, preset(MASK_GROUPS, 'm-circle'))).toBe(true);
    expect(designActive(circle, preset(MASK_GROUPS, 'm-red'))).toBe(true);
    expect(designActive(circle, preset(MASK_GROUPS, 'm-blue'))).toBe(false);
  });

  it('the strength the user set does not switch the highlighted design off', () => {
    const z = { ...area(), ...designPatch(preset(BLUR_GROUPS, 'b-zoom')), intensity: 40 };
    expect(designActive(z, preset(BLUR_GROUPS, 'b-zoom'))).toBe(true);
    expect(designActive(z, preset(BLUR_GROUPS, 'b-heavy'))).toBe(false);
  });
});

describe('Apply to: this area, everything else, whole picture', () => {
  it('tells where an area applies', () => {
    expect(redactScope(area(), 1000, 600)).toBe('area');
    expect(redactScope(area({ invert: true }), 1000, 600)).toBe('outside');
    expect(redactScope(area({ x: 0, y: 0, w: 1000, h: 600 }), 1000, 600)).toBe('whole');
  });

  it('changes it, and comes back from the whole picture with an area to move', () => {
    expect(scopePatch(area(), 'whole', 1000, 600)).toEqual({ x: 0, y: 0, w: 1000, h: 600, invert: undefined });
    expect(scopePatch(area(), 'outside', 1000, 600)).toEqual({ invert: true });
    expect(scopePatch(area({ invert: true }), 'area', 1000, 600)).toEqual({ invert: undefined });
    expect(scopePatch(area({ x: 0, y: 0, w: 1000, h: 600 }), 'area', 1000, 600)).toEqual({ x: 250, y: 150, w: 500, h: 300, invert: undefined });
  });
});

describe('round 80: what works where, In use, Circle vs Oval', () => {
  it('greys out what cannot work outside the area', async () => {
    const { designAvailable } = await import('@/editor/tools/blur');
    expect(designAvailable('blur', { fade: 'top' }, 'outside')).toBe(false);
    expect(designAvailable('blur', { glass: true }, 'outside')).toBe(false);
    expect(designAvailable('blur', { mode: 'bokeh' }, 'outside')).toBe(true);
    expect(designAvailable('blur', { fade: 'top' }, 'area')).toBe(true);
    expect(designAvailable('mask', { maskPattern: 'person' }, 'outside')).toBe(false);
    expect(designAvailable('mask', { shape: 'cloud' }, 'outside')).toBe(true);
  });

  it('Circle makes the area square around its centre, Oval makes a square longer', async () => {
    const { designSize, designInUse } = await import('@/editor/tools/blur');
    expect(designSize('m-circle', { x: 100, y: 100, w: 400, h: 200 })).toEqual({ x: 200, y: 100, w: 200, h: 200 });
    expect(designSize('m-oval', { x: 100, y: 100, w: 200, h: 200 })).toEqual({ x: 50, w: 300 });
    expect(designSize('m-circle', { x: 0, y: 0, w: 200, h: 200 })).toEqual({});
    expect(designInUse('m-circle', { shape: 'ellipse', w: 200, h: 200 }, { shape: 'ellipse' })).toBe(true);
    expect(designInUse('m-oval', { shape: 'ellipse', w: 200, h: 200 }, { shape: 'ellipse' })).toBe(false);
  });

  it('lists the look in use, each with what removes it', async () => {
    const { lookInUse } = await import('@/editor/tools/blur');
    const chips = lookInUse({ mode: 'bokeh', shape: 'cloud', border: 'white', borderColor: '#fff', tone: 'gray' });
    expect(chips.map((c) => c.label)).toEqual(['Bokeh', 'Cloud', 'Grayscale', 'Border']);
    expect(chips.find((c) => c.part === 'Border')!.clear).toEqual({ border: undefined, borderColor: undefined });
    expect(lookInUse({})).toEqual([]);
  });
});
