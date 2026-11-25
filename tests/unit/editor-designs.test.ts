import { describe, expect, it } from 'vitest';
import { getBounds, handlesFor, hitTest, localBox, pivotOf, resizeBy, rotateBy, rotatePoint, selectionPolygon } from '@/editor/tools/annotations';
import { renderLine, renderMarker, markerBounds, centredText, loopPath, lineBounds, MAX_BENDS, defaultBends } from '@/editor/tools/shapes';
import { CALLOUT_DESIGNS, calloutLayout, fitCallout, leaderPath, renderCallout, calloutTail } from '@/editor/tools/callouts';
import { renderText, scaleText, textBlock, textBounds, textPadding } from '@/editor/tools/text';
import type { BoxAnnotation, CalloutAnnotation, LineAnnotation, StrokeAnnotation, TextAnnotation } from '@/editor/types';
import { DEFAULT_FONT, DEFAULT_TOOL_STYLES } from '@/editor/types';
import { scaledSize } from '@/recording/services/video-size';
import { formatBadgeTime } from '@/background/badge';
import { parseZoom } from '@/editor/components/EditorToolbar';
import type { Ctx2D } from '@/editor/tools/common';

/** A 2D context that accepts every call, records them, and measures text at 0.5em per character. */
function fakeCtx(): Ctx2D & { calls: string[] } {
  const calls: string[] = [];
  const state: Record<string, unknown> = { font: '10px sans-serif' };
  const target = {
    calls,
    measureText: (t: string) => {
      const size = Number(/(\d+(?:\.\d+)?)px/.exec(String(state.font))?.[1] ?? 10);
      return { width: t.length * size * 0.5 };
    },
    createLinearGradient: () => ({ addColorStop() {} }),
  };
  return new Proxy(target, {
    get(t, key) {
      if (key in t) return (t as Record<string | symbol, unknown>)[key];
      if (typeof key === 'string' && key in state) return state[key];
      return (...args: unknown[]) => {
        calls.push(String(key));
        return args.length ? undefined : undefined;
      };
    },
    set(_t, key, value) {
      state[String(key)] = value;
      return true;
    },
  }) as unknown as Ctx2D & { calls: string[] };
}

const rect: BoxAnnotation = { id: 'r', type: 'rect', x: 100, y: 100, w: 200, h: 100, stroke: '#f00', fill: 'transparent', width: 2, opacity: 1, radius: 0, dash: 'solid' };
const baseCallout: CalloutAnnotation = {
  id: 'c', type: 'callout', x: 50, y: 50, w: 240, h: 90, tailX: 20, tailY: 220, text: 'Some callout text that wraps', fontFamily: DEFAULT_FONT, fontSize: 16,
  bold: false, italic: false, color: '#000', align: 'left', fill: '#fff', stroke: '#f00', strokeWidth: 2, radius: 8, opacity: 1, title: 'Title',
  titleStyle: { fontFamily: DEFAULT_FONT, fontSize: 20, bold: true, italic: false, align: 'left', color: '#111' },
};
const text: TextAnnotation = {
  id: 't', type: 'text', x: 10, y: 10, text: 'Body', fontFamily: DEFAULT_FONT, fontSize: 20, bold: false, italic: false, color: '#000', align: 'left',
  background: '#ffffff', borderColor: '#000', borderWidth: 2, borderStyle: 'solid', borderRadius: 4, opacity: 1,
};

describe('new defaults', () => {
  it('uses a thick pen, 10 px lines / arrows / shapes, a 35 px highlighter at 60 % opacity', () => {
    expect(DEFAULT_TOOL_STYLES.pen.width).toBe(14);
    expect(DEFAULT_TOOL_STYLES.line.width).toBe(10);
    expect(DEFAULT_TOOL_STYLES.shape.width).toBe(10);
    expect(DEFAULT_TOOL_STYLES.highlighter.width).toBe(35);
    // Opacity lives in the colour (0x99 / 255 = 60 %), so there is only one opacity control.
    expect(DEFAULT_TOOL_STYLES.highlighter.color.toLowerCase()).toBe('#ffd84d99');
    expect(DEFAULT_TOOL_STYLES.highlighter.opacity).toBe(1);
  });
});

describe('rotation', () => {
  it('hit-tests, outlines and bounds rotated objects', () => {
    const r = rotateBy(rect, 90) as BoxAnnotation;
    expect(r.rotation).toBe(90);
    const c = pivotOf(r);
    // A point inside the rotated (now tall) box but outside the original wide one.
    expect(hitTest({ ...r, fill: '#000' }, { x: c.x, y: c.y - 90 }, 1)).toBe(true);
    expect(hitTest({ ...rect, fill: '#000' }, { x: c.x, y: c.y - 90 }, 1)).toBe(false);
    const b = getBounds(r);
    expect(Math.round(b.w)).toBe(100);
    expect(Math.round(b.h)).toBe(200);
    expect(selectionPolygon(r)).toHaveLength(4);
  });

  it('normalises angles and rotates pen strokes point by point', () => {
    expect((rotateBy({ ...rect, rotation: 170 }, 30) as BoxAnnotation).rotation).toBe(-160);
    expect((rotateBy({ ...rect, rotation: 10 }, -10) as BoxAnnotation).rotation).toBe(0);
    const pen: StrokeAnnotation = { id: 'p', type: 'pen', points: [{ x: 0, y: 0 }, { x: 10, y: 0 }], color: '#000', width: 2, opacity: 1 };
    const turned = rotateBy(pen, 90) as StrokeAnnotation;
    expect(turned.points[0]!.x).toBeCloseTo(5);
    expect(turned.points[0]!.y).toBeCloseTo(-5);
  });

  it('places a rotation handle above the box and keeps the opposite corner fixed when resizing a rotated box', () => {
    const r = { ...rect, rotation: 30 };
    const rot = handlesFor(r, 1).find((h) => h.handle === 'rot')!;
    const top = rotatePoint({ x: 200, y: 100 }, 30, pivotOf(r));
    expect(Math.hypot(rot.x - top.x, rot.y - top.y)).toBeCloseTo(26, 0);
    const nwBefore = handlesFor(r).find((h) => h.handle === 'nw')!;
    const resized = resizeBy(r, 'se', 40, 10);
    const nwAfter = handlesFor(resized).find((h) => h.handle === 'nw')!;
    expect(nwAfter.x).toBeCloseTo(nwBefore.x, 5);
    expect(nwAfter.y).toBeCloseTo(nwBefore.y, 5);
  });

  it('resizes text, stickers and pen strokes by their corners', () => {
    const bigger = resizeBy(text, 'se', 40, 0) as TextAnnotation;
    expect(bigger.fontSize).toBeGreaterThan(text.fontSize);
    // The top-left corner stays put.
    expect(localBox(bigger).x).toBeCloseTo(localBox(text).x, 5);
    expect(localBox(bigger).y).toBeCloseTo(localBox(text).y, 5);
    const pen: StrokeAnnotation = { id: 'p', type: 'pen', points: [{ x: 0, y: 0 }, { x: 100, y: 50 }], color: '#000', width: 2, opacity: 1 };
    const wide = resizeBy(pen, 'e', 100, 0) as StrokeAnnotation;
    expect(wide.points[1]!.x).toBeCloseTo(200, 0);
    expect(wide.points[1]!.y).toBeCloseTo(50, 5);
  });
});

describe('text designs', () => {
  it('stacks header, body and footer and pads each side separately', () => {
    const t: TextAnnotation = {
      ...text,
      header: { ...text, text: 'Header', fontSize: 30 },
      footer: { ...text, text: 'Footer', fontSize: 12 },
      padding: [5, 20, 10, 40],
    };
    const block = textBlock(t);
    expect(block.parts.map((p) => p.kind)).toEqual(['header', 'body', 'footer']);
    expect(block.body.y).toBeGreaterThan(30);
    const b = textBounds(t);
    expect(b.x).toBe(t.x - 40 - 1);
    expect(b.y).toBe(t.y - 5 - 1);
    expect(textPadding(t)).toEqual([5, 20, 10, 40]);
    // Without a box there is no padding.
    expect(textPadding({ ...t, background: 'transparent', borderWidth: 0 })).toEqual([0, 0, 0, 0]);
  });

  it('draws underline, strike-through and outlines', () => {
    const ctx = fakeCtx();
    renderText(ctx, { ...text, underline: true, strike: true, outlineWidth: 2 });
    expect(ctx.calls.filter((c) => c === 'fillRect').length).toBeGreaterThanOrEqual(2);
    expect(ctx.calls).toContain('strokeText');
  });

  it('upper-cases with caps and scales every size together', () => {
    const block = textBlock({ ...text, caps: true, text: 'abc' });
    expect(block.body.lines[0]).toBe('ABC');
    const s = scaleText({ ...text, padding: [2, 4, 6, 8], header: { ...text, text: 'H', fontSize: 10 } }, 2);
    expect(s.fontSize).toBe(40);
    expect(s.padding).toEqual([4, 8, 12, 16]);
    expect(s.header?.fontSize).toBe(20);
  });
});

describe('callout designs', () => {
  it('renders every design with title and leader / speech pointers', () => {
    for (const d of CALLOUT_DESIGNS) {
      const a = fitCallout({ ...baseCallout, ...(d.patch as Partial<CalloutAnnotation>), design: d.id, titleStyle: { ...baseCallout.titleStyle!, ...(d.patch.titleStyle ?? {}) } });
      const ctx = fakeCtx();
      expect(() => renderCallout(ctx, a)).not.toThrow();
      expect(ctx.calls).toContain('fillText');
      const L = calloutLayout(a);
      expect(L.body.w).toBeGreaterThan(0);
      expect(L.body.h).toBeGreaterThan(0);
    }
  });

  it('grows to fit long text and points with a leader line', () => {
    const long = fitCallout({ ...baseCallout, text: 'word '.repeat(80) });
    expect(long.h).toBeGreaterThan(baseCallout.h);
    const leader = { ...baseCallout, tail: 'leader' as const };
    const path = leaderPath(leader)!;
    expect(path).toHaveLength(3);
    expect(path[2]).toEqual({ x: 20, y: 220 });
    // The last segment is at 45°.
    expect(Math.abs(path[2]!.x - path[1]!.x)).toBeCloseTo(Math.abs(path[2]!.y - path[1]!.y), 5);
    expect(calloutTail(leader)).toBeNull();
    expect(hitTest(leader, { x: 20, y: 220 }, 2)).toBe(true);
    expect(handlesFor({ ...baseCallout, tail: 'none' }).some((h) => h.handle === 't')).toBe(false);
  });
});

describe('arrow designs', () => {
  it('draws every line design with up to six bends', () => {
    const base: LineAnnotation = { id: 'l', type: 'arrow', x1: 0, y1: 0, x2: 300, y2: 40, color: '#f00', width: 14, opacity: 1, headStart: 'feather', headEnd: 'twin', dash: 'solid', bends: [] };
    for (const body of ['line', 'block', 'outline', 'tapered', 'double', 'chevrons', 'dash-tail'] as const) {
      for (const bends of [0, 1, MAX_BENDS]) {
        const ctx = fakeCtx();
        expect(() => renderLine(ctx, { ...base, body, bends: defaultBends(base, bends) })).not.toThrow();
        expect(ctx.calls.length).toBeGreaterThan(2);
      }
    }
    for (const head of ['chevron', 'twin-open', 'square', 'ring', 'harpoon', 'round', 'bar', 'circle', 'diamond', 'big', 'open', 'triangle'] as const) {
      expect(() => renderLine(fakeCtx(), { ...base, headEnd: head })).not.toThrow();
    }
  });
});

describe('round 11: new arrow designs and marker labels', () => {
  const base: LineAnnotation = { id: 'l', type: 'arrow', x1: 0, y1: 0, x2: 300, y2: 0, color: '#f00', width: 8, opacity: 1, headStart: 'none', headEnd: 'triangle', dash: 'solid', bends: [] };

  it('draws the new heads and bodies, straight and curved', () => {
    for (const body of ['notched', 'dots', 'squares', 'bars', 'loop', 'triple'] as const) {
      for (const bends of [0, 2]) {
        const ctx = fakeCtx();
        expect(() => renderLine(ctx, { ...base, body, bends: defaultBends(base, bends) })).not.toThrow();
        expect(ctx.calls.length).toBeGreaterThan(2);
      }
    }
    for (const head of ['stealth', 'triple', 'curved', 'echo', 'framed'] as const) {
      const ctx = fakeCtx();
      renderLine(ctx, { ...base, headEnd: head, headStart: head });
      expect(ctx.calls.length).toBeGreaterThan(4);
    }
    // Trails draw one mark per step, not a stroke.
    const dots = fakeCtx();
    renderLine(dots, { ...base, body: 'dots' });
    expect(dots.calls.filter((c) => c === 'arc').length).toBeGreaterThan(10);
    // The notched block is one filled polygon.
    const notched = fakeCtx();
    renderLine(notched, { ...base, body: 'notched' });
    expect(notched.calls).toContain('fill');
    expect(notched.calls).not.toContain('stroke');
  });

  it('loops once in the middle and grows the bounds to hold the loop', () => {
    const shaft = [{ x: 0, y: 0 }, { x: 300, y: 0 }];
    const loop = loopPath(shaft, 8);
    expect(loop[0]).toEqual({ x: 0, y: 0 });
    expect(loop[loop.length - 1]).toEqual({ x: 300, y: 0 });
    // It curls up (negative y for a rightward line) and travels backwards for part of the way.
    expect(Math.min(...loop.map((p) => p.y))).toBeLessThan(-20);
    expect(loop.some((p, i) => i > 0 && p.x < loop[i - 1]!.x)).toBe(true);
    // Too short for a loop: unchanged.
    expect(loopPath([{ x: 0, y: 0 }, { x: 40, y: 0 }], 8)).toHaveLength(2);
    expect(lineBounds({ ...base, body: 'loop' }).y).toBeLessThan(lineBounds(base).y);
  });

  it('centres the label ink in the marker', () => {
    const ctx = { textAlign: 'center', textBaseline: 'middle', measureText: () => ({ width: 20, actualBoundingBoxLeft: -2, actualBoundingBoxRight: 18, actualBoundingBoxAscent: 14, actualBoundingBoxDescent: 0 }) } as unknown as Ctx2D;
    // Ink spans x+2..x+18 and y-14..y: centred on (100, 50) means x = 90, y = 57.
    expect(centredText(ctx, '1', 100, 50)).toEqual({ x: 90, y: 57 });
    // Without ink metrics it falls back to centre/middle alignment.
    expect(centredText(fakeCtx(), '1', 100, 50)).toEqual({ x: 100, y: 50 });
  });

  it('draws the heart and keeps it inside its bounds', () => {
    const m = { id: 'm', type: 'marker' as const, x: 100, y: 100, n: 3, color: '#E05252', size: 40, shape: 'heart' as const, style: 'filled' as const, counter: 'roman' as const, opacity: 1 };
    const ctx = fakeCtx();
    renderMarker(ctx, m);
    expect(ctx.calls.filter((c) => c === 'bezierCurveTo')).toHaveLength(6);
    expect(ctx.calls).toContain('fillText');
    const b = markerBounds(m);
    expect(b.w).toBeCloseTo(50);
    expect(b.y).toBeLessThan(100 - 15);
    expect(b.y + b.h).toBeGreaterThan(100 + 20);
  });
});

describe('video export sizes', () => {
  it('scales by the short side, keeps the aspect ratio, uses even sizes and never upscales', () => {
    expect(scaledSize(1920, 1080, 720)).toEqual({ width: 1280, height: 720, scaled: true });
    expect(scaledSize(1080, 1920, 480)).toEqual({ width: 480, height: 854, scaled: true });
    expect(scaledSize(1280, 720, 2160)).toEqual({ width: 1280, height: 720, scaled: false });
    expect(scaledSize(3840, 2160, null).scaled).toBe(false);
    expect(scaledSize(3000, 1999, 1080).height % 2).toBe(0);
  });
});

describe('small helpers', () => {
  it('formats the recording badge time to fit the toolbar', () => {
    expect(formatBadgeTime(7_000)).toBe('0:07');
    expect(formatBadgeTime(12 * 60_000 + 45_000)).toBe('12:45');
    expect(formatBadgeTime(65 * 60_000)).toBe('1h05');
  });

  it('parses typed zoom levels', () => {
    expect(parseZoom('150')).toBe(1.5);
    expect(parseZoom('75%')).toBe(0.75);
    expect(parseZoom('2x')).toBe(2);
    expect(parseZoom('99999')).toBe(8);
    expect(parseZoom('abc')).toBeNull();
    expect(parseZoom('0')).toBeNull();
  });
});
