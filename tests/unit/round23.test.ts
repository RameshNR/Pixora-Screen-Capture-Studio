import { describe, expect, it } from 'vitest';
import { flattenStroke, resample, strokeBoundsOf, isBoxyStroke, PEN_GROUPS, HIGHLIGHT_GROUPS } from '@/editor/tools/pen-styles';
import { hitStroke, strokeBounds } from '@/editor/tools/pen';
import { BLUR_GROUPS, PIXEL_GROUPS, MASK_GROUPS, MASK_REGIONS, CLEAR_LOOK } from '@/editor/tools/blur';
import { hitMarker, markerBounds, markerLabel } from '@/editor/tools/shapes';
import { STICKER_GROUPS, STICKER_ICONS, sameSticker } from '@/editor/tools/sticker-lib';
import { CURSOR_DESIGNS, CURSOR_DESIGN_IDS, CURSOR_GROUPS, CURSOR_LOOKS, cursorBounds, cursorGroupOf } from '@/editor/tools/cursor';
import { TEXT_GROUPS, TEXT_LOOK_RESET, TEXT_DECOS } from '@/editor/tools/text-presets';
import { hasBox, textBounds } from '@/editor/tools/text';
import { WATERMARK_PRESETS } from '@/editor/tools/decorations';
import { SHAPE_GROUPS } from '@/editor/tools/shape-lib';
import { calloutTail, leaderColor, leaderPath } from '@/editor/tools/callouts';
import { describeAnnotation } from '@/editor/tools/annotations';
import { DEFAULT_FONT, type CalloutAnnotation, type CursorAnnotation, type MarkerAnnotation, type StrokeAnnotation, type TextAnnotation } from '@/editor/types';

const stroke = (patch: Partial<StrokeAnnotation> = {}): StrokeAnnotation => ({
  id: 's', type: 'pen', points: [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 100, y: 0 }], color: '#000000', width: 10, opacity: 1, ...patch,
});

describe('pen and highlighter designs', () => {
  it('offers every pen and highlighter category from the design sheets', () => {
    expect(PEN_GROUPS.map((g) => g.label)).toEqual(['Standard', 'Brush', 'Dotted & dashed', 'Sketch', 'Creative', 'Pressure', 'Textured', 'Special effects']);
    expect(HIGHLIGHT_GROUPS.map((g) => g.label)).toEqual(['Marker / brush', 'Rectangle', 'Underline', 'Scribble', 'Wavy', 'Circle & focus', 'Text box', 'Corner / tape', 'Spotlight', 'With arrow', 'Creative', 'Gradient']);
    expect(PEN_GROUPS.flatMap((g) => g.items).length).toBeGreaterThanOrEqual(50);
    expect(HIGHLIGHT_GROUPS.flatMap((g) => g.items).length).toBeGreaterThanOrEqual(70);
  });

  it('resamples the smoothed stroke evenly with normals', () => {
    const poly = flattenStroke(stroke().points);
    expect(poly[0]).toEqual({ x: 0, y: 0 });
    expect(poly.at(-1)).toEqual({ x: 100, y: 0 });
    const s = resample(poly, 10);
    expect(s.length).toBeGreaterThanOrEqual(10);
    expect(Math.abs(s[1]!.s - s[0]!.s - 10)).toBeLessThan(0.01);
    expect(s[3]!.ny).toBeCloseTo(1); // normal of a left-to-right line points down
  });

  it('grows bounds and hit areas for designs that spread wider than the line', () => {
    const plain = strokeBounds(stroke());
    const loops = strokeBounds(stroke({ design: 'loops' }));
    expect(loops.h).toBeGreaterThan(plain.h * 3);
    expect(hitStroke(stroke({ design: 'zigzag' }), { x: 50, y: 12 }, 0)).toBe(true);
    expect(hitStroke(stroke(), { x: 50, y: 12 }, 0)).toBe(false);
  });

  it('treats box highlights (rectangle, text box, circle) as boxes', () => {
    const box = stroke({ type: 'highlighter', design: 'box', width: 30 });
    expect(isBoxyStroke(box)).toBe(true);
    expect(hitStroke(box, { x: 50, y: 10 }, 0)).toBe(true);
    expect(strokeBoundsOf({ ...box, design: 'arrow' }).x).toBeLessThan(-60); // arrow comes in from the left
  });
});

describe('blur, pixelate and mask designs', () => {
  it('covers every section of the blur, pixelate and mask sheets', () => {
    expect(BLUR_GROUPS.flatMap((g) => g.items).length).toBeGreaterThanOrEqual(36);
    expect(PIXEL_GROUPS.flatMap((g) => g.items).length).toBeGreaterThanOrEqual(36);
    expect(MASK_GROUPS.flatMap((g) => g.items).length).toBeGreaterThanOrEqual(44);
    expect(BLUR_GROUPS.map((g) => g.id)).toEqual(expect.arrayContaining(['motion', 'gradient', 'focus', 'glass', 'privacy']));
    expect(MASK_GROUPS.find((g) => g.id === 'use')!.items.map((i) => i.patch.maskPattern)).toEqual(['person', 'card', 'id', 'address']);
  });

  it('places masks over the whole image, header, footer or middle band', () => {
    const r = Object.fromEntries(MASK_REGIONS.map((m) => [m.id, m.rect(1000, 500)]));
    expect(r.all).toEqual({ x: 0, y: 0, w: 1000, h: 500 });
    expect(r.top!.y).toBe(0);
    expect(r.bottom!.y + r.bottom!.h).toBe(500);
    expect(r.middle!.y).toBeGreaterThan(0);
  });

  it('can reset a look completely', () => {
    expect(Object.values(CLEAR_LOOK).every((v) => v === undefined)).toBe(true);
    expect(Object.keys(CLEAR_LOOK)).toEqual(expect.arrayContaining(['shape', 'mode', 'pattern', 'fade', 'invert', 'tone', 'glass', 'border', 'maskPattern']));
  });
});

describe('numbered marker designs', () => {
  const marker = (patch: Partial<MarkerAnnotation> = {}): MarkerAnnotation => ({ id: 'm', type: 'marker', x: 100, y: 100, n: 2, color: '#7C3AED', size: 40, opacity: 1, ...patch });

  it('counts as "Step N" and puts a label beside the number', () => {
    expect(markerLabel(3, 'step')).toBe('Step 3');
    const plain = markerBounds(marker());
    const labelled = markerBounds(marker({ label: 'Step One' }));
    expect(labelled.w).toBeGreaterThan(plain.w * 2);
    expect(hitMarker(marker({ label: 'Step One' }), { x: labelled.x + labelled.w - 6, y: 100 }, 0)).toBe(true);
  });

  it('sizes wide and pointed shapes by their outline', () => {
    expect(markerBounds(marker({ shape: 'ribbon' })).w).toBeGreaterThan(markerBounds(marker()).w * 1.4);
    expect(markerBounds(marker({ shape: 'pin-ring' })).h).toBeGreaterThan(markerBounds(marker()).h * 1.4);
  });
});

describe('sticker sheet', () => {
  it('has every category and draws every icon it lists', () => {
    expect(STICKER_GROUPS.map((g) => g.label)).toEqual(expect.arrayContaining([
      'Emojis & reactions', 'Badges & labels', 'Check & status', 'Arrows & pointers', 'Shapes & highlights', 'Callouts & speech',
      'Symbols & icons', 'People & expressions', 'Devices & UI', 'Objects & everyday', 'Decorative & fun', 'Seasonal & special',
    ]));
    for (const s of STICKER_GROUPS.flatMap((g) => g.items)) if (s.variant === 'icon') expect(STICKER_ICONS[s.glyph], s.glyph).toBeTypeOf('function');
  });

  it('tells badge styles apart and names icons in Layers', () => {
    expect(sameSticker({ glyph: 'NEW', variant: 'badge', badgeStyle: 'burst' }, { glyph: 'NEW', variant: 'badge' })).toBe(false);
    expect(describeAnnotation({ id: 's', type: 'sticker', x: 0, y: 0, size: 40, glyph: 'toggle-on', variant: 'icon', color: '#22C55E', opacity: 1 })).toBe('Sticker Toggle on');
  });
});

describe('cursor sheet', () => {
  it('groups every design (classic, themed, shape, recording, gesture, resize, action, creative)', () => {
    expect(CURSOR_GROUPS).toHaveLength(8);
    expect(CURSOR_DESIGN_IDS.length).toBeGreaterThanOrEqual(48);
    for (const g of CURSOR_GROUPS) expect(CURSOR_DESIGN_IDS.some((d) => cursorGroupOf(d) === g.id), g.id).toBe(true);
    expect(CURSOR_DESIGNS.pizza.emoji).toBe('🍕');
    expect(CURSOR_LOOKS.length).toBeGreaterThanOrEqual(30);
  });

  it('includes the motion trail in the cursor bounds', () => {
    const c: CursorAnnotation = { id: 'c', type: 'cursor', x: 100, y: 100, size: 40, design: 'arrow', color: '#fff', outline: '#000', click: 'none', clickColor: '#f00', effect: 'none', effectColor: '#f00', effectSize: 1, opacity: 1 };
    expect(cursorBounds({ ...c, trail: 'trail' }).x).toBeLessThan(cursorBounds(c).x - 30);
  });
});

describe('text designs', () => {
  const text = (patch: Partial<TextAnnotation> = {}): TextAnnotation => ({
    id: 't', type: 'text', x: 0, y: 0, text: 'Hello', color: '#111', fontFamily: DEFAULT_FONT, fontSize: 20, bold: true, italic: false, align: 'left', opacity: 1,
    background: 'transparent', borderColor: '#000', borderWidth: 0, borderStyle: 'solid', borderRadius: 6, ...patch,
  });

  it('has every section of the text sheet', () => {
    expect(TEXT_GROUPS.map((g) => g.label)).toEqual(['Quick', 'Title styles', 'Banner', 'Badge & label', 'Outline & stroke', 'Background highlight', 'Shadow & 3D', 'Handwritten', 'Callout text', 'Numbered & step', 'Decorative', 'Gradient & modern', 'Combinations']);
    expect(TEXT_DECOS.length).toBeGreaterThanOrEqual(18);
    expect(TEXT_LOOK_RESET.deco).toBe('none');
  });

  it('pads and grows the box for decorations, 3D depth and burst shapes', () => {
    expect(hasBox(text({ deco: 'brush' }))).toBe(true);
    const plain = textBounds(text());
    expect(textBounds(text({ deco: 'burst' })).w).toBeGreaterThan(plain.w + 30);
    expect(textBounds(text({ extrude: 6 })).h).toBeGreaterThan(plain.h + 5);
  });
});

describe('watermark designs', () => {
  it('covers text, logo, diagonal, pattern, opacity, background, stamp, ribbon, corner and custom', () => {
    expect([...new Set(WATERMARK_PRESETS.map((p) => p.group))]).toEqual(['Text', 'Logo', 'Diagonal', 'Pattern', 'Opacity', 'Background', 'Stamp', 'Ribbon', 'Corner', 'Custom']);
  });
});

describe('shapes and callout pointers', () => {
  it('starts with outlined shapes and has one rectangle and one ellipse', () => {
    const first = SHAPE_GROUPS[0]!;
    expect(first.label).toBe('Outlined');
    expect(first.items.every((i) => i.fill === 'transparent')).toBe(true);
    const all = SHAPE_GROUPS.flatMap((g) => g.items);
    expect(all.filter((i) => /^(square|rectangle)$/i.test(i.label))).toHaveLength(1);
    expect(all.some((i) => i.label === 'Square' || i.label === 'Circle')).toBe(false);
  });

  const callout = (patch: Partial<CalloutAnnotation> = {}): CalloutAnnotation => ({
    id: 'c', type: 'callout', x: 0, y: 0, w: 100, h: 40, tailX: 50, tailY: 120, text: 'Hi', fill: '#8B5CF6', stroke: 'transparent', strokeWidth: 0, radius: 10,
    fontFamily: DEFAULT_FONT, fontSize: 14, bold: false, italic: false, color: '#fff', align: 'left', opacity: 1, tail: 'leader', accent: '#C4B5FD', ...patch,
  });

  it('draws leader lines in a visible colour when the design has no outline', () => {
    expect(leaderColor(callout())).toBe('#C4B5FD');
    expect(leaderColor(callout({ accent: undefined }))).toBe('#8B5CF6');
    expect(leaderColor(callout({ stroke: '#111827', strokeWidth: 2 }))).toBe('#111827');
  });

  it('starts pointers on the shape edge facing the tip', () => {
    const lead = leaderPath(callout())!;
    expect(lead[0]!.y).toBeGreaterThan(35); // bottom edge
    expect(lead.at(-1)).toEqual({ x: 50, y: 120 });
    const tail = calloutTail(callout({ tail: 'speech' }))!;
    expect(tail[0].y).toBeGreaterThan(35);
    expect(tail[1].y).toBeGreaterThan(35);
  });
});
