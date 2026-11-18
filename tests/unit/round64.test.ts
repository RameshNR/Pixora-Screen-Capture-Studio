import { describe, expect, it } from 'vitest';
import type { CalloutAnnotation } from '@/editor/types';
import { fitCallout } from '@/editor/tools/callouts';
import { resizeBy } from '@/editor/tools/annotations';

const callout = (patch: Partial<CalloutAnnotation> = {}): CalloutAnnotation => ({
  id: 'c', type: 'callout', opacity: 1, x: 100, y: 100, w: 400, h: 400, tailX: 900, tailY: 700, text: 'Everything will be looks good when you see it as positive.', fill: '#fff', stroke: '#000', strokeWidth: 2, radius: 8,
  tail: 'leader', design: 'oval', color: '#000', fontFamily: 'Inter', fontSize: 20, bold: false, italic: false, align: 'center', ...patch,
} as CalloutAnnotation);

describe('callouts keep their shape when the text grows', () => {
  it('a circle stays a circle at a large text size', () => {
    const big = fitCallout(callout({ fontSize: 64 }));
    expect(big.h).toBeGreaterThan(400);
    expect(Math.abs(big.w - big.h)).toBeLessThanOrEqual(1);
  });

  it('a wide box keeps its proportions', () => {
    const a = callout({ design: 'bubble', w: 300, h: 100, fontSize: 48 });
    const big = fitCallout(a);
    expect(big.w / big.h).toBeCloseTo(3, 1);
  });

  it('grows around its centre and leaves the pointer where it was placed', () => {
    const a = callout({ fontSize: 64 });
    const big = fitCallout(a);
    expect(big.x + big.w / 2).toBeCloseTo(a.x + a.w / 2, 5);
    expect(big.y + big.h / 2).toBeCloseTo(a.y + a.h / 2, 5);
    expect([big.tailX, big.tailY]).toEqual([a.tailX, a.tailY]);
  });

  it('comes back to the chosen size when the text gets smaller again', () => {
    const big = fitCallout(callout({ fontSize: 64 }));
    const back = fitCallout({ ...big, fontSize: 20 });
    expect([back.w, back.h]).toEqual([400, 400]);
    expect([back.x, back.y]).toEqual([100, 100]);
    expect(back.fitBase).toBeUndefined();
  });

  it('does not change a box the text already fits', () => {
    const a = callout();
    expect(fitCallout(a)).toBe(a);
  });

  it('a size set by hand becomes the new own size', () => {
    const big = fitCallout(callout({ fontSize: 64 }));
    const resized = resizeBy(big, 'se', 20, 20) as CalloutAnnotation;
    expect(resized.fitBase).toBeUndefined();
  });
});
