import { describe, expect, it } from 'vitest';
import { fromShown, motionOffset, overlayState, shownAt, syncOverlays, BUILTIN_OVERLAY_DEFAULTS, type VideoOverlay } from '@/recording/services/video-overlays';
import type { Annotation } from '@/editor/types';

const box = (x = 100, y = 100): Annotation => ({ id: 'a1', type: 'rect', x, y, w: 80, h: 40, stroke: '#f00', fill: 'transparent', width: 4, opacity: 1, radius: 0, dash: 'solid' } as unknown as Annotation);
const ov = (patch: Partial<VideoOverlay> = {}): VideoOverlay => ({ id: 'o1', annotation: box(), start: 2, end: 10, animIn: 'none', animOut: 'none', effect: 'none', ...patch });

describe('several animations on one drawing', () => {
  it('combines them (fade + slide in from left + zoom in)', () => {
    const s = overlayState(ov({ ins: ['fade', 'slide-from-left', 'zoom-in'] }), 2.05, 720);
    expect(s.alpha).toBeLessThan(0.5);
    expect(s.dx).toBeLessThan(0); // coming from the left
    expect(s.scale).toBeLessThan(0.6);
    const done = overlayState(ov({ ins: ['fade', 'slide-from-left', 'zoom-in'] }), 5, 720);
    expect([done.alpha, done.dx, done.scale]).toEqual([1, 0, 1]);
  });

  it('wipes in every direction and slides out to the top', () => {
    expect(overlayState(ov({ ins: ['wipe'] }), 2.1, 720).clip.r).toBeLessThan(1);
    expect(overlayState(ov({ ins: ['wipe-rtl'] }), 2.1, 720).clip.l).toBeGreaterThan(0);
    expect(overlayState(ov({ ins: ['wipe-down'] }), 2.1, 720).clip.b).toBeLessThan(1);
    expect(overlayState(ov({ ins: ['wipe-up'] }), 2.1, 720).clip.t).toBeGreaterThan(0);
    expect(overlayState(ov({ outs: ['slide-to-top'] }), 9.95, 720).dy).toBeLessThan(0);
    // Older recordings: the single fields still work.
    expect(overlayState(ov({ animIn: 'fade' }), 2, 720).alpha).toBe(0);
  });
});

describe('moving from point A to point B over time', () => {
  it('glides between the points and stays at the last one', () => {
    const o = ov({ motion: true, moves: [{ t: 6, dx: 200, dy: -40 }] });
    expect(motionOffset(o, 2)).toEqual({ dx: 0, dy: 0 });
    const mid = motionOffset(o, 4);
    expect(mid.dx).toBeGreaterThan(0);
    expect(mid.dx).toBeLessThan(200);
    expect(motionOffset(o, 8)).toEqual({ dx: 200, dy: -40 });
    expect(overlayState(o, 8, 720).dx).toBe(200);
  });

  it('dragging the drawing at a later moment adds a move point (with Move over time on)', () => {
    const o = ov({ motion: true });
    const dragged = { ...box(), x: 250, y: 160 } as Annotation;
    const next = fromShown(o, dragged, 6);
    expect(next.moves).toEqual([{ t: 6, dx: 150, dy: 60 }]);
    expect(next.annotation).toMatchObject({ x: 100, y: 100 }); // where it was drawn stays
    expect(shownAt(next, 6)).toMatchObject({ x: 250, y: 160 });
    // Without Move over time, dragging moves the drawing for its whole time.
    expect(fromShown(ov(), dragged, 6).annotation).toMatchObject({ x: 250, y: 160 });
  });

  it('style changes on a moved frame keep the path', () => {
    const o = ov({ motion: true, moves: [{ t: 6, dx: 150, dy: 60 }] });
    const shown = shownAt(o, 6);
    const recoloured = { ...shown, stroke: '#00f' } as Annotation;
    const r = syncOverlays([o], [recoloured], new Set(['a1']), 6, 20, BUILTIN_OVERLAY_DEFAULTS, () => 'x');
    expect(r.overlays[0]!.moves).toEqual([{ t: 6, dx: 150, dy: 60 }]);
    expect(r.overlays[0]!.annotation).toMatchObject({ x: 100, y: 100, stroke: '#00f' });
  });
});
