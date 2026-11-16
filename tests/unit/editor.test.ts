import { describe, expect, it } from 'vitest';
import { canRedo, canUndo, createHistory, HISTORY_LIMIT, historyReducer, timeline } from '@/editor/history/history';
import { describeAnnotation, findAt, getBounds, handlesFor, hitTest, resizeBy, transformAnnotation, translate } from '@/editor/tools/annotations';
import { aspectValue, constrainAspect } from '@/editor/tools/crop';
import { appendPoint } from '@/editor/tools/pen';
import { defaultBends, endAngle, headLength, isLight, samplePath, snap45 } from '@/editor/tools/shapes';
import { wrapText } from '@/editor/tools/text';
import { calloutTail } from '@/editor/tools/callouts';
import { chromeScale, frameLayout, BAR_TAB_HEIGHT, BAR_TOOL_HEIGHT } from '@/editor/tools/decorations';
import { dashPattern } from '@/editor/tools/common';
import type { Annotation, BoxAnnotation, CalloutAnnotation, CursorAnnotation, EditorDoc, LineAnnotation, MarkerAnnotation, StickerAnnotation } from '@/editor/types';
import { DEFAULT_FRAME } from '@/editor/types';

const fakeBitmap = { width: 100, height: 50, close() {} } as unknown as ImageBitmap;
const doc = (annotations: Annotation[] = []): EditorDoc => ({ base: fakeBitmap, width: 100, height: 50, annotations, watermark: null, frame: null });
const rect: BoxAnnotation = { id: 'r', type: 'rect', x: 10, y: 10, w: 20, h: 10, stroke: '#f00', fill: 'transparent', width: 2, opacity: 1, radius: 4, dash: 'solid' };
const arrow: LineAnnotation = { id: 'l', type: 'arrow', x1: 0, y1: 0, x2: 40, y2: 0, color: '#f00', width: 4, opacity: 1, headStart: 'none', headEnd: 'triangle', dash: 'solid', bends: [] };
const marker: MarkerAnnotation = { id: 'm', type: 'marker', x: 50, y: 25, n: 1, color: '#f00', size: 20, opacity: 1 };
const callout: CalloutAnnotation = {
  id: 'c', type: 'callout', x: 10, y: 10, w: 40, h: 20, tailX: 15, tailY: 45, text: 'Hello', fontFamily: 'sans-serif', fontSize: 10, bold: false,
  italic: false, color: '#000', align: 'left', fill: '#fff', stroke: '#f00', strokeWidth: 2, radius: 4, opacity: 1,
};
const sticker: StickerAnnotation = { id: 's', type: 'sticker', x: 80, y: 20, size: 20, glyph: '✅', variant: 'emoji', color: '#f00', opacity: 1 };

const commit = (d: EditorDoc, label = 'change', coalesceKey?: string) => ({ type: 'commit' as const, doc: d, label, coalesceKey });

describe('editor history', () => {
  it('undoes and redoes commits without touching the original', () => {
    const d0 = doc();
    let h = createHistory(d0);
    const d1 = doc([rect]);
    const d2 = doc([rect, arrow]);
    h = historyReducer(h, commit(d1, 'Add rectangle'));
    h = historyReducer(h, commit(d2, 'Add arrow'));
    expect(canUndo(h)).toBe(true);
    h = historyReducer(h, { type: 'undo' });
    expect(h.present.doc).toBe(d1);
    expect(canRedo(h)).toBe(true);
    h = historyReducer(h, { type: 'redo' });
    expect(h.present.doc).toBe(d2);
    h = historyReducer(h, { type: 'reset' });
    expect(h.present.doc).toBe(d0);
    h = historyReducer(h, { type: 'undo' }); // reset itself is undoable
    expect(h.present.doc).toBe(d2);
    expect(h.original).toBe(d0);
  });

  it('labels every step and can jump to any of them', () => {
    let h = createHistory(doc());
    h = historyReducer(h, commit(doc([rect]), 'Add rectangle'));
    h = historyReducer(h, commit(doc([rect, arrow]), 'Add arrow'));
    expect(timeline(h).map((s) => s.label)).toEqual(['Original capture', 'Add rectangle', 'Add arrow']);
    h = historyReducer(h, { type: 'jump', index: 0 });
    expect(h.present.label).toBe('Original capture');
    expect(h.future).toHaveLength(2);
    h = historyReducer(h, { type: 'jump', index: 2 });
    expect(h.present.label).toBe('Add arrow');
    expect(historyReducer(h, { type: 'jump', index: 9 })).toBe(h);
  });

  it('clears the redo stack on a new commit', () => {
    let h = createHistory(doc());
    h = historyReducer(h, commit(doc([rect])));
    h = historyReducer(h, { type: 'undo' });
    h = historyReducer(h, commit(doc([arrow])));
    expect(canRedo(h)).toBe(false);
  });

  it('coalesces continuous edits into one undo step', () => {
    let h = createHistory(doc());
    for (let i = 0; i < 5; i++) h = historyReducer(h, commit(doc([{ ...rect, width: i }]), 'Edit', 'r:width'));
    expect(h.past.length).toBe(1);
    h = historyReducer(h, commit(doc([rect]), 'Edit', 'r:color'));
    expect(h.past.length).toBe(2);
  });

  it('bounds the history size', () => {
    let h = createHistory(doc());
    for (let i = 0; i < HISTORY_LIMIT + 20; i++) h = historyReducer(h, commit(doc()));
    expect(h.past.length).toBe(HISTORY_LIMIT);
  });
});

describe('annotation geometry', () => {
  it('hit-tests outlines, filled shapes, lines, markers, callouts and stickers', () => {
    expect(hitTest(rect, { x: 10, y: 15 }, 2)).toBe(true);
    expect(hitTest(rect, { x: 20, y: 15 }, 2)).toBe(false); // hollow centre
    expect(hitTest({ ...rect, fill: '#000' }, { x: 20, y: 15 }, 2)).toBe(true);
    expect(hitTest(arrow, { x: 20, y: 2 }, 1)).toBe(true);
    expect(hitTest(arrow, { x: 20, y: 20 }, 1)).toBe(false);
    expect(findAt([rect, marker], { x: 52, y: 25 }, 1)?.id).toBe('m');
    expect(hitTest(callout, { x: 30, y: 20 }, 1)).toBe(true);
    expect(hitTest(callout, { x: 15, y: 40 }, 1)).toBe(true); // on the tail
    expect(hitTest(sticker, { x: 80, y: 20 }, 1)).toBe(true);
  });

  it('ignores hidden annotations', () => {
    expect(hitTest({ ...rect, hidden: true }, { x: 10, y: 15 }, 2)).toBe(false);
  });

  it('moves and resizes', () => {
    expect(translate(rect, 5, -5)).toMatchObject({ x: 15, y: 5 });
    expect(translate(arrow, 1, 1)).toMatchObject({ x1: 1, y1: 1, x2: 41, y2: 1 });
    expect(translate(callout, 1, 2)).toMatchObject({ x: 11, y: 12, tailX: 16, tailY: 47 });
    expect(resizeBy(rect, 'se', 10, 5)).toMatchObject({ x: 10, y: 10, w: 30, h: 15 });
    expect(resizeBy(rect, 'e', -30, 0)).toMatchObject({ x: 0, w: 10 });
    expect(resizeBy(arrow, 'p2', 0, 10)).toMatchObject({ x2: 40, y2: 10 });
    expect(resizeBy(callout, 't', 5, 5)).toMatchObject({ tailX: 20, tailY: 50 });
    expect((resizeBy(sticker, 'se', 10, 10) as StickerAnnotation).size).toBeGreaterThan(20);
    // Eight resize handles plus the rotation handle.
    expect(handlesFor(rect)).toHaveLength(9);
    expect(handlesFor(rect).some((h) => h.handle === 'rot')).toBe(true);
    expect(handlesFor(arrow).map((h) => h.handle)).toEqual(['p1', 'p2']);
    expect(handlesFor({ ...arrow, bends: [{ x: 10, y: 5 }, { x: 20, y: -5 }, { x: 30, y: 5 }] }).map((h) => h.handle)).toEqual(['p1', 'p2', 'b0', 'b1', 'b2']);
    expect(handlesFor(callout).map((h) => h.handle)).toContain('t');
  });

  it('maps annotations through crop / rotate / resize transforms', () => {
    const crop = { point: (p: { x: number; y: number }) => ({ x: p.x - 5, y: p.y - 5 }), rect: (r: { x: number; y: number; w: number; h: number }) => ({ ...r, x: r.x - 5, y: r.y - 5 }), scale: 1 };
    expect(transformAnnotation(rect, crop)).toMatchObject({ x: 5, y: 5, w: 20, h: 10 });
    expect(transformAnnotation({ ...arrow, bends: [{ x: 20, y: 10 }] }, crop)).toMatchObject({ bends: [{ x: 15, y: 5 }] });

    const H = 50;
    const rotateCw = { point: (p: { x: number; y: number }) => ({ x: H - p.y, y: p.x }), rect: (r: { x: number; y: number; w: number; h: number }) => ({ x: H - r.y - r.h, y: r.x, w: r.h, h: r.w }), scale: 1 };
    expect(transformAnnotation(rect, rotateCw)).toMatchObject({ x: 30, y: 10, w: 10, h: 20 });
    expect(transformAnnotation(arrow, rotateCw)).toMatchObject({ x1: 50, y1: 0, x2: 50, y2: 40 });

    const resize = { point: (p: { x: number; y: number }) => ({ x: p.x * 2, y: p.y * 2 }), rect: (r: { x: number; y: number; w: number; h: number }) => ({ x: r.x * 2, y: r.y * 2, w: r.w * 2, h: r.h * 2 }), scale: 2 };
    expect(transformAnnotation(marker, resize)).toMatchObject({ x: 100, y: 50, size: 40 });
    expect(transformAnnotation(rect, resize)).toMatchObject({ width: 4, radius: 8 });
    expect(transformAnnotation(sticker, resize)).toMatchObject({ x: 160, size: 40 });
  });

  it('constrains crop rectangles to an aspect ratio inside the image', () => {
    expect(constrainAspect({ x: 0, y: 0, w: 100, h: 10 }, 1, 100, 50)).toEqual({ x: 0, y: 0, w: 50, h: 50 });
    expect(constrainAspect({ x: 90, y: 0, w: -40, h: 30 }, null, 100, 50)).toEqual({ x: 50, y: 0, w: 40, h: 30 });
    expect(aspectValue('16:9', { width: 1, height: 1 })).toBeCloseTo(16 / 9);
    expect(aspectValue('original', { width: 100, height: 50 })).toBe(2);
    expect(aspectValue('free', { width: 1, height: 1 })).toBeNull();
  });

  it('thins pen points and picks marker text colour', () => {
    const pts = appendPoint(appendPoint([{ x: 0, y: 0 }], { x: 0.5, y: 0 }), { x: 5, y: 0 });
    expect(pts).toHaveLength(2);
    expect(isLight('#FFD84D')).toBe(true);
    expect(isLight('#202938')).toBe(false);
  });
});

describe('arrows, curves and line styles', () => {
  it('passes exactly through every bend point (up to six)', () => {
    for (const n of [1, 2, 3, 4, 5, 6]) {
      const bends = defaultBends(arrow, n, true);
      expect(bends).toHaveLength(n);
      const line = { ...arrow, bends };
      const path = samplePath(line);
      for (const b of bends) expect(path.some((p) => Math.hypot(p.x - b.x, p.y - b.y) < 1e-6)).toBe(true);
      expect(path[0]).toEqual({ x: 0, y: 0 });
      expect(path.at(-1)).toEqual({ x: 40, y: 0 });
      // The curve is hittable at its bends and the bounds include them.
      expect(hitTest(line, bends[0]!, 1)).toBe(true);
      expect(getBounds(line).h).toBeGreaterThan(5);
    }
    expect(defaultBends(arrow, 9)).toHaveLength(6);
    expect(defaultBends(arrow, 0)).toEqual([]);
  });

  it('orients heads along the curve and alternates bends for S-curves', () => {
    const one = { ...arrow, x2: 100, bends: [{ x: 50, y: 40 }] };
    expect(endAngle(one, 'end')).toBeLessThan(0); // arrives travelling upwards
    const s2 = defaultBends({ x1: 0, y1: 0, x2: 90, y2: 0 }, 2, true);
    expect(Math.sign(s2[0]!.y)).toBe(-Math.sign(s2[1]!.y));
    // Without `curved` the points sit on the straight line (the line doesn't bend until dragged).
    const flat = defaultBends({ x1: 0, y1: 0, x2: 90, y2: 0 }, 3);
    expect(flat.map((p) => p.y)).toEqual([0, 0, 0]);
    expect(flat.map((p) => Math.round(p.x))).toEqual([23, 45, 68]);
    expect(hitTest({ ...arrow, x2: 100, bends: [{ x: 50, y: 40 }] }, { x: 50, y: 0 }, 2)).toBe(false);
  });

  it('snaps straight strokes to 45 degrees', () => {
    expect(snap45({ x: 0, y: 0 }, { x: 100, y: 7 })).toEqual({ x: 100.24470060806208, y: 0 });
    const d = snap45({ x: 0, y: 0 }, { x: 50, y: 48 });
    expect(d.x).toBeCloseTo(d.y);
  });

  it('sizes heads by style and supports dash patterns', () => {
    expect(headLength('big', 4)).toBeGreaterThan(headLength('triangle', 4));
    expect(headLength('none', 4)).toBe(0);
    expect(dashPattern('solid', 4)).toEqual([]);
    expect(dashPattern('dashed', 4)).toEqual([12, 8]);
    expect(dashPattern('dotted', 4)[1]).toBe(8);
  });

  it('names layers by what they are', () => {
    expect(describeAnnotation({ ...arrow, headEnd: 'none' })).toBe('Line');
    expect(describeAnnotation({ ...arrow, bends: [{ x: 1, y: 1 }] })).toBe('Curved arrow');
    expect(describeAnnotation({ ...arrow, headEnd: 'none', bends: [{ x: 1, y: 1 }] })).toBe('Curved line');
    expect(describeAnnotation(callout)).toBe('Callout “Hello”');
  });
});

describe('callouts and text', () => {
  it('attaches the tail to the side facing the tip', () => {
    const below = calloutTail(callout)!;
    // On the bottom edge (y + h), tucked a hair inside so the tail's fill joins the body's.
    expect(below[0].y).toBeGreaterThan(27);
    expect(below[0].y).toBeLessThanOrEqual(30);
    const right = calloutTail({ ...callout, tailX: 120, tailY: 20 })!;
    expect(right[0].x).toBeGreaterThan(47); // right edge (x + w)
    expect(right[0].x).toBeLessThanOrEqual(50);
    expect(calloutTail({ ...callout, tailX: 20, tailY: 20 })).toBeNull(); // tip inside the box
  });

  it('word-wraps to the box width and keeps explicit line breaks', () => {
    const style = { fontFamily: 'sans-serif', fontSize: 10, bold: false, italic: false, color: '#000', align: 'left' as const };
    const l = wrapText('one two three four\nfive', style, 30);
    expect(l.lines.length).toBeGreaterThan(2);
    expect(l.lines.at(-1)).toBe('five');
  });
});

describe('frame layout', () => {
  it('is the image itself without a frame', () => {
    expect(frameLayout(doc()).outer).toEqual({ x: 0, y: 0, w: 100, h: 50 });
  });

  it('adds padding and a browser bar on top or bottom', () => {
    const W = 1280;
    const base = { width: W, height: 720 };
    const padded = frameLayout({ ...base, frame: { ...DEFAULT_FRAME, padding: 40 } });
    expect(padded.outer).toEqual({ x: -40, y: -40, w: W + 80, h: 800 });
    const barH = (BAR_TAB_HEIGHT + BAR_TOOL_HEIGHT) * chromeScale(W);
    const top = frameLayout({ ...base, frame: { ...DEFAULT_FRAME, padding: 0, browser: { style: 'mac', position: 'top', theme: 'light', url: 'https://x', title: 't' } } });
    expect(top.bar).toEqual({ x: 0, y: -barH, w: W, h: barH });
    expect(top.outer.h).toBe(720 + barH);
    const bottom = frameLayout({ ...base, frame: { ...DEFAULT_FRAME, padding: 0, browser: { style: 'windows', position: 'bottom', theme: 'dark', url: '', title: '' } } });
    expect(bottom.bar!.y).toBe(720);
    expect(bottom.outer.y).toBe(0);
  });

  it('scales browser chrome with the image size', () => {
    expect(chromeScale(2560)).toBe(2);
    expect(chromeScale(100)).toBe(0.6);
  });
});

describe('cursor annotations', () => {
  const cursor: CursorAnnotation = {
    id: 'cur', type: 'cursor', x: 100, y: 100, size: 48, design: 'arrow', color: '#fff', outline: '#000',
    click: 'none', clickColor: '#f00', effect: 'none', effectColor: '#ff0', effectSize: 1, opacity: 1,
  };

  it('points at its x / y: the arrow starts at the hot spot', () => {
    const b = getBounds(cursor);
    expect(b.x).toBeCloseTo(100);
    expect(b.y).toBeCloseTo(100);
    expect(b.h).toBeCloseTo(48);
  });

  it('grows its bounds for click indicators and effects, around the hot spot', () => {
    const plain = getBounds(cursor);
    const clicked = getBounds({ ...cursor, click: 'right' });
    expect(clicked.w).toBeGreaterThan(plain.w);
    expect(clicked.x).toBeLessThan(plain.x); // click marks above-left of the tip
    const ring = getBounds({ ...cursor, effect: 'ripple', effectSize: 2 });
    expect(ring.x + ring.w / 2).toBeLessThan(plain.x + plain.w); // centred near the hot spot
    expect(ring.w).toBeGreaterThan(getBounds({ ...cursor, effect: 'ripple' }).w);
  });

  it('hit-tests the pointer, and a spotlight only inside its bright circle', () => {
    expect(hitTest(cursor, { x: 103, y: 110 }, 2)).toBe(true);
    expect(hitTest(cursor, { x: 300, y: 300 }, 2)).toBe(false);
    const spot = { ...cursor, effect: 'spotlight' as const };
    expect(hitTest(spot, { x: 110, y: 110 }, 2)).toBe(true);
    expect(hitTest(spot, { x: 400, y: 400 }, 2)).toBe(false);
  });

  it('resizes from a corner, moves, scales with the image and has a readable layer name', () => {
    const bigger = resizeBy(cursor, 'se', 20, 20);
    expect(bigger.type === 'cursor' && bigger.size).toBeGreaterThan(48);
    const moved = translate(cursor, 5, -5);
    expect(moved).toMatchObject({ x: 105, y: 95 });
    const half = transformAnnotation(cursor, { point: (p) => ({ x: p.x / 2, y: p.y / 2 }), rect: (r) => r, scale: 0.5 });
    expect(half).toMatchObject({ x: 50, y: 50, size: 24 });
    expect(describeAnnotation({ ...cursor, click: 'double' })).toBe('Cursor (double click)');
    expect(handlesFor(cursor).map((h) => h.handle)).toEqual(['nw', 'ne', 'se', 'sw']);
  });
});
