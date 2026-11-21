import { describe, expect, it } from 'vitest';
import { BLUR_SECTIONS, MASK_SECTIONS, PIXEL_SECTIONS, choiceAvailable, sectionChoice, sectionPatch, type LookSection } from '@/editor/tools/blur';
import type { RedactAnnotation } from '@/editor/types';

const sec = (list: LookSection[], id: string) => list.find((s) => s.id === id)!;
const opt = (s: LookSection, id: string) => s.options.find((o) => o.id === id)!;

describe('the look, one part at a time', () => {
  it('each part changes only its own fields', () => {
    for (const list of [BLUR_SECTIONS, PIXEL_SECTIONS, MASK_SECTIONS]) {
      for (const s of list) for (const o of s.options) {
        for (const k of Object.keys(o.patch)) expect(s.fields, `${s.id}/${o.id}`).toContain(k);
      }
    }
  });

  it('exactly one choice per part is in use (glass designs no longer all light up)', () => {
    const a: Partial<RedactAnnotation> = { glass: true, shape: 'rounded', tone: 'dim', fade: 'edges', intensity: 12 };
    for (const s of BLUR_SECTIONS) {
      const chosen = s.options.filter((o) => sectionChoice(s, a)?.id === o.id);
      expect(chosen.length, s.id).toBe(1);
    }
    expect(sectionChoice(sec(BLUR_SECTIONS, 'glass'), a)!.id).toBe('frosted');
    expect(sectionChoice(sec(BLUR_SECTIONS, 'colour'), a)!.id).toBe('dim');
    expect(sectionChoice(sec(BLUR_SECTIONS, 'edges'), a)!.id).toBe('soft');
    expect(sectionChoice(sec(BLUR_SECTIONS, 'effect'), a)!.id).toBe('normal');
  });

  it('a strength set with the slider is no listed choice (shown as Custom)', () => {
    expect(sectionChoice(sec(BLUR_SECTIONS, 'strength'), { intensity: 17 })).toBeNull();
    expect(sectionChoice(sec(BLUR_SECTIONS, 'strength'), { intensity: 26 })!.id).toBe('heavy');
  });

  it('Circle / Oval by the area proportions, and they set them', () => {
    const shape = sec(MASK_SECTIONS, 'shape');
    expect(sectionChoice(shape, { shape: 'ellipse', w: 200, h: 200 })!.id).toBe('circle');
    expect(sectionChoice(shape, { shape: 'ellipse', w: 300, h: 200 })!.id).toBe('oval');
    expect(sectionPatch(opt(shape, 'circle'), { x: 0, y: 0, w: 300, h: 200 })).toEqual({ shape: 'ellipse', x: 50, y: 0, w: 200, h: 200 });
  });

  it('outside the area only the "none" choice of inside-only parts', () => {
    const edges = sec(BLUR_SECTIONS, 'edges');
    expect(choiceAvailable(edges, opt(edges, 'sharp'), 'outside')).toBe(true);
    expect(choiceAvailable(edges, opt(edges, 'soft'), 'outside')).toBe(false);
    expect(choiceAvailable(edges, opt(edges, 'soft'), 'area')).toBe(true);
    const effect = sec(BLUR_SECTIONS, 'effect');
    expect(choiceAvailable(effect, opt(effect, 'bokeh'), 'outside')).toBe(true);
  });
});
