import { describe, expect, it } from 'vitest';
import type { Annotation, CalloutAnnotation } from '@/editor/types';
import { calloutBounds, calloutTextGrips, calloutTextRects, fitCallout, leaderPath } from '@/editor/tools/callouts';
import { handlesFor, hitTest, isRoundHandle, resizeBy } from '@/editor/tools/annotations';

const callout = (patch: Partial<CalloutAnnotation> = {}): CalloutAnnotation => ({
  id: 'c', type: 'callout', opacity: 1, x: 100, y: 100, w: 300, h: 120, tailX: 600, tailY: 160, text: 'Hello there', title: 'Step 1', fill: '#fff', stroke: '#e05252', strokeWidth: 4, radius: 8,
  tail: 'leader', leaderEnd: 'arrow', design: 'bubble', color: '#000', fontFamily: 'Inter', fontSize: 20, bold: false, italic: false, align: 'left', ...patch,
} as CalloutAnnotation);

const direction = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.atan2(b.y - a.y, b.x - a.x);

describe('straight leader lines', () => {
  it.each([
    ['right', { tailX: 600, tailY: 160 }],
    ['left', { tailX: 10, tailY: 130 }],
    ['below', { tailX: 250, tailY: 400 }],
    ['above', { tailX: 150, tailY: 20 }],
  ])('runs in one straight line when the end is straight out (%s)', (_, tip) => {
    const [start, mid, end] = leaderPath(callout(tip))!;
    expect(direction(start!, mid!)).toBeCloseTo(direction(mid!, end!), 5);
    expect(start!.x === end!.x || start!.y === end!.y).toBe(true);
  });

  it('has no tiny bend at the tip just past the corner, so the arrow head stays in line', () => {
    const [start, mid, end] = leaderPath(callout({ tailX: 700, tailY: 96 }))!;
    expect(direction(start!, mid!)).toBeCloseTo(direction(mid!, end!), 5);
  });
});

describe('movable callout text', () => {
  it('has a move handle for the title and for the text', () => {
    const handles = handlesFor(callout()).map((h) => h.handle);
    expect(handles).toEqual(expect.arrayContaining(['tt', 'tb']));
    expect(isRoundHandle('tt')).toBe(true);
    expect(handlesFor(callout({ title: '' })).map((h) => h.handle)).not.toContain('tt');
  });

  it('moves only the dragged text, and adds up over several drags', () => {
    const a = callout();
    const before = calloutTextRects(a);
    const once = resizeBy(a, 'tb', 30, -10) as CalloutAnnotation;
    const twice = resizeBy(once, 'tb', 5, 5) as CalloutAnnotation;
    expect(twice.textOffset).toEqual({ x: 35, y: -5 });
    expect(twice.titleOffset).toBeUndefined();
    expect(calloutTextRects(twice).body.x).toBe(before.body.x + 35);
    expect(calloutTextRects(twice).title).toEqual(before.title);
    expect((resizeBy(a, 'tt', 12, 4) as CalloutAnnotation).titleOffset).toEqual({ x: 12, y: 4 });
  });

  it('follows the rotated callout', () => {
    const moved = resizeBy(callout({ rotation: 90 }), 'tb', 10, 0) as CalloutAnnotation;
    expect(moved.textOffset!.x).toBeCloseTo(0, 5);
    expect(moved.textOffset!.y).toBeCloseTo(-10, 5);
  });

  it('text moved outside the box can still be selected', () => {
    const a = callout({ tail: 'none', textOffset: { x: 500, y: 0 } });
    const { body } = calloutTextRects(a);
    expect(hitTest(a, { x: body.x + 5, y: body.y + 5 }, 2)).toBe(true);
    expect(calloutBounds(a).w).toBeGreaterThan(a.w + 400);
  });

  it('the handle sits just before the first line, also for centred text', () => {
    const [, body] = calloutTextGrips(callout({ align: 'center' }));
    expect(body!.x).toBeGreaterThan(callout().x);
  });
});

describe('Shift keeps equal sides while resizing', () => {
  const box = (type: 'rect' | 'ellipse'): Annotation => ({ id: 'r', type, x: 100, y: 100, w: 200, h: 100, stroke: '#000', fill: 'transparent', width: 2, opacity: 1 }) as Annotation;

  it.each(['rect', 'ellipse'] as const)('%s: a corner makes it square and the opposite corner stays', (type) => {
    const r = resizeBy(box(type), 'se', 40, 10, true) as Annotation & { x: number; y: number; w: number; h: number };
    expect(r).toMatchObject({ x: 100, y: 100, w: 240, h: 240 });
  });

  it('dragging the top left corner keeps the bottom right corner', () => {
    const r = resizeBy(box('rect'), 'nw', -50, -10, true) as Annotation & { x: number; y: number; w: number; h: number };
    expect(r.w).toBe(r.h);
    expect(r.x + r.w).toBe(300);
    expect(r.y + r.h).toBe(200);
  });

  it('a side handle sets the size and stays centred on the other axis', () => {
    const r = resizeBy(box('rect'), 'e', 60, 0, true) as Annotation & { x: number; y: number; w: number; h: number };
    expect(r).toMatchObject({ x: 100, w: 260, h: 260, y: 150 - 130 });
  });

  it('callouts become square too, and stay square when they grow to fit their text', () => {
    const r = resizeBy(callout(), 'se', 20, 10, true) as CalloutAnnotation;
    expect(r.w).toBe(r.h);
    const small = { ...r, w: 90, h: 90, text: 'word '.repeat(60) };
    const fitted = fitCallout(small);
    expect(fitted.h).toBeGreaterThan(90);
    expect(fitted.w).toBe(fitted.h);
  });

  it('without Shift the sides stay free', () => {
    const r = resizeBy(box('rect'), 'se', 40, 10) as Annotation & { w: number; h: number };
    expect([r.w, r.h]).toEqual([240, 110]);
  });
});
