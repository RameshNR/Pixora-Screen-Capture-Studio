import { describe, expect, it } from 'vitest';
import type { Annotation, CalloutAnnotation } from '@/editor/types';
import { leaderEndColorOf, leaderPath } from '@/editor/tools/callouts';
import { syncOverlays, BUILTIN_OVERLAY_DEFAULTS, type VideoOverlay } from '@/recording/services/video-overlays';
import {
  commitVideoHistory, createVideoHistory, describeVideoChange, jumpVideoHistory, redoVideoHistory, undoVideoHistory, videoTimeline, type VideoSnapshot,
} from '@/recording/services/video-history';
import { ENCODE_SHARE, encodeProgress, timeLeftLabel } from '@/recording/services/export-progress';

const mask = (id: string, x = 0): Annotation => ({ id, type: 'mask', x, y: 0, w: 10, h: 10, opacity: 1 }) as Annotation;
const overlay = (id: string, x = 0): VideoOverlay => ({ id: `ov_${id}`, annotation: mask(id, x), start: 0, end: 5, animIn: 'none', animOut: 'none', effect: 'none' });
const snap = (overlays: VideoOverlay[] = [], patch: Partial<VideoSnapshot> = {}): VideoSnapshot => ({ overlays, watermark: null, markers: [], regions: [], trim: null, ...patch });

describe('layer order reaches playback and export', () => {
  const sync = (list: VideoOverlay[], annotations: Annotation[]) =>
    syncOverlays(list, annotations, new Set(annotations.map((a) => a.id)), 1, 10, BUILTIN_OVERLAY_DEFAULTS, () => 'new').overlays.map((o) => o.annotation.id);

  it('follows the order set in the editor', () => {
    const list = [overlay('a'), overlay('b'), overlay('c')];
    expect(sync(list, [list[1]!.annotation, list[0]!.annotation, list[2]!.annotation])).toEqual(['b', 'a', 'c']);
    expect(sync(list, [list[2]!.annotation, list[1]!.annotation, list[0]!.annotation])).toEqual(['c', 'b', 'a']);
  });

  it('leaves drawings that are not on this frame where they are', () => {
    const list = [overlay('a'), overlay('later'), overlay('b')];
    expect(sync(list, [list[2]!.annotation, list[0]!.annotation])).toEqual(['b', 'later', 'a']);
  });
});

describe('video undo / redo', () => {
  it('steps back and forward, and a new change drops the steps ahead', () => {
    const one = snap([overlay('a')]);
    const two = snap([overlay('a'), overlay('b')]);
    let h = createVideoHistory(snap());
    h = commitVideoHistory(commitVideoHistory(h, one), two);
    expect(h.past).toHaveLength(2);
    h = undoVideoHistory(h);
    expect(h.present.snapshot).toBe(one);
    h = redoVideoHistory(h);
    expect(h.present.snapshot).toBe(two);
    h = commitVideoHistory(undoVideoHistory(h), snap());
    expect(h.future).toEqual([]);
  });

  it('jumps to any step of the History window', () => {
    let h = createVideoHistory(snap());
    for (const id of ['a', 'b', 'c']) h = commitVideoHistory(h, snap([overlay(id)]));
    h = jumpVideoHistory(h, 1);
    expect(h.past).toHaveLength(1);
    expect(h.future).toHaveLength(2);
    expect(videoTimeline(h)).toHaveLength(4);
  });

  it('names each step', () => {
    const a = overlay('a');
    const b = overlay('b');
    expect(describeVideoChange(snap([a]), snap([a, b]))).toBe('Add Mask');
    expect(describeVideoChange(snap([a, b]), snap([a]))).toBe('Delete Mask');
    expect(describeVideoChange(snap([a, b]), snap([b, a]))).toBe('Change layer order');
    expect(describeVideoChange(snap([a]), snap([{ ...a, end: 3 }]))).toBe('Change timing of Mask');
    expect(describeVideoChange(snap([a]), snap([{ ...a, annotation: mask('a', 40) }]))).toBe('Move Mask');
    const base = snap();
    expect(describeVideoChange(base, { ...base, trim: { start: 1, end: 2 } })).toBe('Trim video');
  });
});

describe('export progress', () => {
  it('uses the real length and only reaches 100% when the file is written', () => {
    expect(encodeProgress(30, 120)).toBeCloseTo(0.25 * ENCODE_SHARE);
    expect(encodeProgress(500, 120)).toBe(ENCODE_SHARE);
    expect(ENCODE_SHARE).toBeLessThan(1);
    expect(encodeProgress(5, 0)).toBe(0);
  });

  it('estimates the time left once there is enough to go on', () => {
    expect(timeLeftLabel(0.01, 10_000)).toBeNull();
    expect(timeLeftLabel(0.5, 1000)).toBeNull();
    expect(timeLeftLabel(ENCODE_SHARE / 2, 120_000)).toBe('about 2 min');
    expect(timeLeftLabel(ENCODE_SHARE / 2, 20_000)).toBe('about 20 s');
  });
});

describe('callout leader line', () => {
  const callout = (patch: Partial<CalloutAnnotation>): CalloutAnnotation => ({
    id: 'c', type: 'callout', opacity: 1, x: 100, y: 100, w: 300, h: 100, tailX: 0, tailY: 0, text: 'Hi', fill: '#fff', stroke: '#7c3aed', strokeWidth: 2, radius: 12,
    tail: 'leader', design: 'bubble', color: '#000', fontFamily: 'Inter', fontSize: 18, bold: false, italic: false, align: 'left', ...patch,
  } as CalloutAnnotation);

  it.each([
    ['below right', { tailX: 560, tailY: 330 }],
    ['below', { tailX: 250, tailY: 320 }],
    ['right', { tailX: 620, tailY: 150 }],
    ['above left', { tailX: 20, tailY: 10 }],
  ])('leaves the callout at a right angle and stays outside it (%s)', (_, tip) => {
    const a = callout(tip);
    const [start, elbow, end] = leaderPath(a)!;
    expect(end).toEqual({ x: tip.tailX, y: tip.tailY });
    // The first part is perpendicular to the side, so it never runs along an edge.
    const horizontal = Math.abs(start!.y - elbow!.y) < 0.01;
    const vertical = Math.abs(start!.x - elbow!.x) < 0.01;
    expect(horizontal || vertical).toBe(true);
    const onSide = start!.x <= a.x + 1 || start!.x >= a.x + a.w - 1 ? 'x' : 'y';
    expect(onSide === 'x' ? horizontal : vertical).toBe(true);
    // The bend is outside the box.
    const inside = elbow!.x > a.x && elbow!.x < a.x + a.w && elbow!.y > a.y && elbow!.y < a.y + a.h;
    expect(inside).toBe(false);
  });

  it('keeps the start away from the rounded corners', () => {
    const a = callout({ tailX: 900, tailY: 900 });
    const [start] = leaderPath(a)!;
    expect(start!.x).toBeLessThanOrEqual(a.x + a.w - a.radius);
  });

  it('the end point has its own colour, the line colour by default', () => {
    expect(leaderEndColorOf(callout({}))).toBe('#7c3aed');
    expect(leaderEndColorOf(callout({ leaderEndColor: '#16a34a' }))).toBe('#16a34a');
  });
});
