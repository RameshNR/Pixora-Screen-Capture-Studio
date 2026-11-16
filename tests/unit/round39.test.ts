import { describe, expect, it } from 'vitest';
import { BUILTIN_OVERLAY_DEFAULTS, syncOverlays, type VideoOverlay } from '@/recording/services/video-overlays';
import { performanceNote } from '@/recording/services/recording-session';
import type { Annotation } from '@/editor/types';

const ann = (id: string, x = 10): Annotation => ({ id, type: 'rect', x, y: 10, w: 50, h: 40, stroke: '#f00', fill: 'transparent', width: 4, opacity: 1, radius: 0, dash: 'solid' } as unknown as Annotation);
const ov = (id: string, a: Annotation, start = 0, end = 4): VideoOverlay => ({ id, annotation: a, start, end, animIn: 'fade', animOut: 'fade', effect: 'none' });

describe('drawing on the paused video updates the overlays live', () => {
  it('a new drawing becomes an overlay from the current time with the defaults', () => {
    let n = 0;
    const r = syncOverlays([], [ann('a1')], new Set(), 3, 20, BUILTIN_OVERLAY_DEFAULTS, () => `ov${++n}`);
    expect(r.overlays).toEqual([expect.objectContaining({ id: 'ov1', start: 3, end: 3 + BUILTIN_OVERLAY_DEFAULTS.seconds, animIn: 'fade' })]);
    expect(r.known.has('a1')).toBe(true);
  });

  it('a moved drawing updates its overlay; a deleted one is removed; others stay', () => {
    const base = [ov('o1', ann('a1')), ov('o2', ann('a2'), 10, 12)];
    const moved = syncOverlays(base, [ann('a1', 99)], new Set(['a1']), 1, 20, BUILTIN_OVERLAY_DEFAULTS, () => 'x');
    expect(moved.overlays.find((o) => o.id === 'o1')!.annotation).toMatchObject({ x: 99 });
    expect(moved.overlays.find((o) => o.id === 'o2')).toBeDefined(); // not on this frame: untouched
    const deleted = syncOverlays(base, [], new Set(['a1']), 1, 20, BUILTIN_OVERLAY_DEFAULTS, () => 'x');
    expect(deleted.overlays.map((o) => o.id)).toEqual(['o2']);
  });

  it('a new overlay never runs past the end of the video', () => {
    const r = syncOverlays([], [ann('a1')], new Set(), 18.5, 20, BUILTIN_OVERLAY_DEFAULTS, () => 'x');
    expect(r.overlays[0]!.end).toBe(20);
  });
});

describe('recording performance note', () => {
  it('says when frames were skipped, and stays quiet when the computer kept up', () => {
    expect(performanceNote({ frames: 900, slowShare: 0.02, avgMs: 8, budgetMs: 33.3 }, 30)).toBeNull();
    expect(performanceNote(null, 30)).toBeNull();
    const note = performanceNote({ frames: 900, slowShare: 0.4, avgMs: 41, budgetMs: 33.3 }, 30)!;
    expect(note).toMatch(/40% of the frames took longer than 33 ms/);
    expect(note).toMatch(/mouse may look jumpy/);
  });
});
