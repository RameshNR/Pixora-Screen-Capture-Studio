import { describe, expect, it } from 'vitest';
import { fitCallout, calloutLayout } from '@/editor/tools/callouts';
import { CALLOUT_GROUPS, ALL_CALLOUT_PRESETS } from '@/editor/tools/callout-presets';
import { RECIPES, recipeLayout, recipeOf } from '@/editor/tools/callout-recipes';
import { SHAPE_GROUPS, shade, alpha, parseHex } from '@/editor/tools/shape-lib';
import { hitBox, samplePath } from '@/editor/tools/shapes';
import { frameLayout } from '@/editor/tools/decorations';
import { describeAnnotation } from '@/editor/tools/annotations';
import { PREMIUM_LINES } from '@/editor/tools/line-presets';
import { DEFAULT_SETTINGS } from '@/shared/constants/defaults';
import { EMPTY_FRAME, DEFAULT_FONT, type BoxAnnotation, type CalloutAnnotation, type Frame } from '@/editor/types';

const callout = (patch: Partial<CalloutAnnotation>): CalloutAnnotation => ({
  id: 'c', type: 'callout', x: 100, y: 100, w: 240, h: 60, tailX: 80, tailY: 220, text: 'Describe this step here.', fill: '#fff', stroke: '#7C3AED', strokeWidth: 2, radius: 12,
  fontFamily: DEFAULT_FONT, fontSize: 14, bold: false, italic: false, color: '#111', align: 'left', opacity: 1, tail: 'none',
  titleStyle: { fontFamily: DEFAULT_FONT, fontSize: 18, bold: true, italic: false, align: 'left', color: '#111' }, ...patch,
});

describe('premium callout designs', () => {
  it('has a recipe for every premium design in the picker, and every category is filled', () => {
    for (const p of ALL_CALLOUT_PRESETS) if (!p.key.startsWith('c-')) expect(recipeOf({ design: p.id }) || ['tooltip', 'card', 'glass'].includes(p.id)).toBeTruthy();
    expect(CALLOUT_GROUPS.map((g) => g.id)).toEqual(['premium', 'steps', 'quotes', 'speech', 'labels', 'badges', 'frames', 'classic']);
    expect(CALLOUT_GROUPS.find((g) => g.id === 'badges')!.items).toHaveLength(16);
    expect(Object.keys(RECIPES).length).toBeGreaterThanOrEqual(40);
  });

  it('keeps step text clear of the number badge and grows the box to fit it', () => {
    const a = fitCallout(callout({ design: 'step-seal', badge: '1', title: 'Step 1: Open Settings', h: 10 }));
    const L = calloutLayout(a);
    expect(L.band).not.toBeNull();
    expect(L.body.x).toBeGreaterThan(L.band!.x + L.band!.w);
    expect(a.h).toBeGreaterThanOrEqual(L.band!.h);
  });

  it('places the icon of compact badges before the text', () => {
    const a = fitCallout(callout({ design: 'badge', icon: 'warning', text: 'Warning', w: 140 }));
    const L = recipeLayout(a, 8, 0);
    expect(L.badge!.x + L.badge!.w).toBeLessThan(L.content.x);
  });

  it('keeps round bodies round instead of flattening them', () => {
    const a = fitCallout(callout({ design: 'circle-quote', text: 'Hi', w: 300, h: 20 }));
    expect(a.h).toBeGreaterThanOrEqual(300 * 0.6);
  });

  it('puts the band title inside the band and the body below it', () => {
    const a = fitCallout(callout({ design: 'top-band', title: 'Step 01' }));
    const L = calloutLayout(a);
    expect(L.title!.y).toBeGreaterThanOrEqual(a.y);
    expect(L.body.y).toBeGreaterThan(L.title!.y + L.title!.h);
  });
});

describe('shape library', () => {
  it('offers every category from the design sheet', () => {
    expect(SHAPE_GROUPS.map((g) => g.label)).toEqual(['Outlined', 'Filled', 'Soft fill', 'Rounded & soft', 'Callout & speech', 'Highlight', 'Badge & label', 'Step & number', 'Geometric', 'Frames', 'Flowchart', 'Decorative', 'Icons', 'Corners', 'Ribbons', '3D & layered']);
    expect(SHAPE_GROUPS.flatMap((g) => g.items).length).toBeGreaterThan(100);
  });

  it('mixes colours for gradients and soft fills', () => {
    expect(shade('#000000', 0.5)).toBe('#808080');
    expect(shade('#FFFFFF', -1)).toBe('#000000');
    expect(alpha('#FF0000', 0.5)).toBe('rgba(255, 0, 0, 0.5)');
    expect(parseHex('#abc')).toMatchObject({ r: 170, g: 187, b: 204, a: 1 });
  });

  it('hit-tests library shapes by their box and names them in Layers', () => {
    const hex: BoxAnnotation = { id: 'h', type: 'rect', x: 0, y: 0, w: 100, h: 80, stroke: '#000', fill: '#eee', width: 2, opacity: 1, radius: 0, dash: 'solid', shape: 'hexagon' };
    expect(hitBox(hex, { x: 50, y: 40 }, 2)).toBe(true);
    expect(hitBox({ ...hex, fill: 'transparent' }, { x: 50, y: 40 }, 2)).toBe(false);
    expect(hitBox({ ...hex, fill: 'transparent' }, { x: 1, y: 40 }, 2)).toBe(true);
    expect(describeAnnotation(hex)).toBe('Hexagon');
    expect(describeAnnotation({ ...hex, shape: undefined })).toBe('Rectangle');
  });
});

describe('arrows and connectors', () => {
  it('routes elbow connectors with right angles', () => {
    const pts = samplePath({ x1: 0, y1: 100, x2: 200, y2: 0, bends: [], route: 'elbow' });
    expect(pts[0]).toEqual({ x: 0, y: 100 });
    expect(pts[1]!.x).toBe(0); // straight up first
    expect(pts.at(-1)).toEqual({ x: 200, y: 0 });
    expect(pts.at(-2)!.y).toBeCloseTo(0); // then straight across
  });

  it('ships coloured ready-made arrows, connectors and an outlined block arrow', () => {
    expect(PREMIUM_LINES.length).toBeGreaterThanOrEqual(18);
    expect(PREMIUM_LINES.find((p) => p.id === 'pl-yellow')!.patch.outline).toBe('#111827');
    expect(PREMIUM_LINES.filter((p) => p.patch.route === 'elbow')).toHaveLength(2);
  });
});

describe('device mockups', () => {
  const doc = (frame: Partial<Frame>) => ({ width: 1280, height: 800, frame: { ...EMPTY_FRAME, padding: 60, ...frame } as Frame });

  it('puts a bezel and a base around the screenshot (laptop)', () => {
    const L = frameLayout(doc({ device: { kind: 'laptop', finish: 'space' } }));
    expect(L.device!.screen.x).toBeLessThan(0);
    expect(L.device!.base!.y).toBeGreaterThan(800);
    expect(L.device!.base!.w).toBeGreaterThan(L.device!.screen.w);
    expect(L.outer.w).toBeGreaterThan(L.device!.body.w);
  });

  it('adds a stand for desktops and moves the window with the position offset', () => {
    const L = frameLayout(doc({ device: { kind: 'desktop', finish: 'black' } }));
    expect(L.device!.neck).not.toBeNull();
    const left = frameLayout(doc({ offsetX: -1 }));
    const centre = frameLayout(doc({}));
    expect(left.outer.x).toBeGreaterThan(centre.outer.x); // less room on the left
    expect(left.outer.w).toBe(centre.outer.w);
  });

  it('gives Safari a single compact toolbar', () => {
    const safari = frameLayout(doc({ browser: { style: 'safari', position: 'top', theme: 'light', url: 'https://a.b', title: 'A' } }));
    const chrome = frameLayout(doc({ browser: { style: 'windows', position: 'top', theme: 'light', url: 'https://a.b', title: 'A' } }));
    expect(safari.bar!.h).toBeLessThan(chrome.bar!.h);
  });
});

describe('recording cursor', () => {
  it('has a styled cursor available (off by default), following the mouse exactly unless smoothing is chosen', () => {
    const fx = DEFAULT_SETTINGS.recording.cursorEffects;
    expect(fx.pointer).toBe(false);
    expect(fx.pointerDesign).toBe('arrow');
    expect(fx.smoothing).toBe(0);
  });
});
