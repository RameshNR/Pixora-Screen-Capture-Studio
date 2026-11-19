import { describe, expect, it } from 'vitest';
import type { Annotation, EditorDoc, LineAnnotation, Watermark } from '@/editor/types';
import { DEFAULT_WATERMARK } from '@/editor/types';
import { createHistory, historyReducer, sameDoc } from '@/editor/history/history';
import { handlesFor } from '@/editor/tools/annotations';
import { pointerOutline } from '@/editor/tools/shapes';
import { watermarkMovable } from '@/editor/tools/decorations';
import { redactSource } from '@/editor/tools/layers';

const base = {} as ImageBitmap;
const doc = (patch: Partial<EditorDoc> = {}): EditorDoc => ({ base, width: 800, height: 600, annotations: [], watermark: null, frame: null, ...patch });
const pen = (id: string, x = 10): Annotation => ({ id, type: 'pen', points: [{ x, y: 10 }, { x: x + 50, y: 10 }], color: '#f00', width: 8, opacity: 1 }) as Annotation;

describe('nothing left means nothing changed', () => {
  it('a drawing added and removed again is no change', () => {
    const start = doc();
    let h = createHistory(start);
    h = historyReducer(h, { type: 'commit', doc: { ...start, annotations: [pen('a')] }, label: 'Add' });
    h = historyReducer(h, { type: 'commit', doc: { ...start, annotations: [] }, label: 'Remove' });
    expect(h.present.doc).not.toBe(h.original);
    expect(sameDoc(h.present.doc, h.original)).toBe(true);
  });

  it('real differences count', () => {
    expect(sameDoc(doc(), doc({ annotations: [pen('a')] }))).toBe(false);
    expect(sameDoc(doc({ annotations: [pen('a')] }), doc({ annotations: [pen('a', 90)] }))).toBe(false);
    expect(sameDoc(doc(), doc({ watermark: DEFAULT_WATERMARK }))).toBe(false);
    expect(sameDoc(doc(), doc({ base: {} as ImageBitmap }))).toBe(false);
  });
});

describe('arrows', () => {
  const line = (patch: Partial<LineAnnotation>): LineAnnotation => ({ id: 'l', type: 'arrow', x1: 0, y1: 0, x2: 400, y2: 0, color: '#f00', width: 14, opacity: 1, headStart: 'none', headEnd: 'triangle', dash: 'solid', bends: [{ x: 200, y: 100 }], ...patch });

  it('an elbow has no curve points to drag', () => {
    expect(handlesFor(line({})).some((h) => h.handle === 'b0')).toBe(true);
    expect(handlesFor(line({ route: 'elbow' })).some((h) => h.handle === 'b0')).toBe(false);
  });

  it('a pointer on a line that doubles back keeps its body', () => {
    const out = Array.from({ length: 40 }, (_, i) => ({ x: i * 10, y: 0 }));
    const back = Array.from({ length: 40 }, (_, i) => ({ x: 390 - i * 10, y: 120 }));
    const poly = pointerOutline([...out, { x: 400, y: 60 }, ...back], 14);
    // Most of the outward part is still there, although it lies ahead of the head's direction.
    expect(poly.filter((p) => Math.abs(p.y) < 30).length).toBeGreaterThan(40);
  });
});

describe('watermark', () => {
  it('can be moved unless it is a pattern or a ribbon', () => {
    const wm = (patch: Partial<Watermark>): Watermark => ({ ...DEFAULT_WATERMARK, ...patch });
    expect(watermarkMovable(wm({ position: 'center' }))).toBe(true);
    expect(watermarkMovable(wm({ position: 'tile' }))).toBe(false);
    expect(watermarkMovable(wm({ style: 'ribbon' }))).toBe(false);
  });
});

describe('blur in layer order', () => {
  const blur = { id: 'b', type: 'blur', x: 300, y: 300, w: 100, h: 100, intensity: 4, opacity: 1 } as Annotation;

  it('reads only the image when no lower layer overlaps it', () => {
    expect(redactSource(base, 800, 600, [pen('far'), blur], 1)).toBe(base);
    expect(redactSource(base, 800, 600, [blur, pen('above', 310)], 0)).toBe(base);
  });
});
