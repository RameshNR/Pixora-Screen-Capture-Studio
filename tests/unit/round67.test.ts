import { describe, expect, it } from 'vitest';
import type { Annotation, CalloutAnnotation } from '@/editor/types';
import { calloutBadgeRect, calloutBounds, calloutTextGrips } from '@/editor/tools/callouts';
import { canChange, canMove, handlesFor, resizeBy } from '@/editor/tools/annotations';

const callout = (patch: Partial<CalloutAnnotation> = {}): CalloutAnnotation => ({
  id: 'c', type: 'callout', opacity: 1, x: 100, y: 100, w: 420, h: 140, tailX: 0, tailY: 0, text: 'Click the Settings icon.', title: 'Step 1', badge: '1', fill: '#fff', stroke: '#000', strokeWidth: 2, radius: 12,
  tail: 'none', design: 'step-seal', color: '#000', fontFamily: 'Inter', fontSize: 20, bold: false, italic: false, align: 'left', ...patch,
} as CalloutAnnotation);

describe("a callout's number badge", () => {
  it('has its own move handle and can be dragged', () => {
    const a = callout();
    expect(calloutTextGrips(a).map((g) => g.handle)).toContain('tg');
    const before = calloutBadgeRect(a)!;
    const moved = resizeBy(a, 'tg', -80, 30) as CalloutAnnotation;
    expect(moved.badgeOffset).toEqual({ x: -80, y: 30 });
    expect(calloutBadgeRect(moved)).toMatchObject({ x: before.x - 80, y: before.y + 30 });
    expect(calloutBounds(moved).x).toBeLessThan(a.x);
  });

  it('designs without a separate badge have no badge handle', () => {
    expect(calloutBadgeRect(callout({ design: 'bubble' }))).toBeNull();
    expect(calloutTextGrips(callout({ design: 'bubble' })).map((g) => g.handle)).not.toContain('tg');
  });
});

describe('Lock and Move only', () => {
  const box = (lock?: 'all' | 'move'): Annotation => ({ id: 'r', type: 'rect', x: 0, y: 0, w: 100, h: 60, stroke: '#000', fill: 'transparent', width: 2, opacity: 1, ...(lock ? { lock } : {}) }) as Annotation;

  it('locked and move-only annotations have no handles', () => {
    expect(handlesFor(box()).length).toBeGreaterThan(0);
    expect(handlesFor(box('all'))).toEqual([]);
    expect(handlesFor(box('move'))).toEqual([]);
  });

  it('move only can be moved but not changed; locked can do neither', () => {
    expect([canMove(box()), canChange(box())]).toEqual([true, true]);
    expect([canMove(box('move')), canChange(box('move'))]).toEqual([true, false]);
    expect([canMove(box('all')), canChange(box('all'))]).toEqual([false, false]);
  });
});
