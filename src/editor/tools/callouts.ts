import type { CalloutAnnotation, CalloutDesign, LeaderEnd, Point, Rect, TextStyle } from '../types';
import { DEFAULT_FONT } from '../types';
import { dashPattern, distToSegment, inRect, type Ctx2D } from './common';
import { drawTextLines, sectionPad, wrapText } from './text';
import { bodyOf, drawRecipe, recipeFitFactor, recipeLayout, recipeMinHeight, recipeOf } from './callout-recipes';
import { isTransparent, shapeGeometry } from './shape-lib';

/**
 * Callouts: a box in one of many designs, an optional title (own font, size and colour), body text,
 * and an optional pointer (speech-bubble tail or a leader line with an end cap).
 */

export const DEFAULT_TITLE_STYLE: TextStyle = { color: '#202938', fontFamily: DEFAULT_FONT, fontSize: 24, bold: true, italic: false, align: 'left' };

export function designOf(a: CalloutAnnotation): CalloutDesign {
  return a.design ?? 'bubble';
}

export function tailOf(a: CalloutAnnotation): 'none' | 'speech' | 'leader' {
  return a.tail ?? 'speech';
}

export function calloutPadding(a: Pick<CalloutAnnotation, 'fontSize'>): number {
  return Math.max(6, a.fontSize * 0.6);
}

export function titleStyleOf(a: CalloutAnnotation): TextStyle {
  return { ...DEFAULT_TITLE_STYLE, ...(a.titleStyle ?? {}) };
}

function hasTitle(a: CalloutAnnotation): boolean {
  return !!a.title && a.title.trim().length > 0;
}

export interface CalloutLayout {
  pad: number;
  /** Where the title is drawn (null = no title). */
  title: Rect | null;
  /** Where the body text is drawn. */
  body: Rect;
  /** Height of a coloured title band (titled, hexagon, underline, tag designs). */
  band: Rect | null;
}

/** Width the title needs on one line (capped to `max`). */
function titleWidth(a: CalloutAnnotation, max: number): number {
  if (!hasTitle(a)) return 0;
  return Math.min(max, wrapText(a.title!, titleStyleOf(a), max).width);
}

function titleHeight(a: CalloutAnnotation, width: number): number {
  if (!hasTitle(a)) return 0;
  return wrapText(a.title!, titleStyleOf(a), Math.max(10, width)).height;
}

/** Splits the box into title / body areas for the design. */
export function calloutLayout(a: CalloutAnnotation): CalloutLayout {
  const { x, y, w, h } = a;
  const pad = calloutPadding(a);
  const gap = hasTitle(a) ? pad * 0.5 : 0;
  // Content rectangle stacked as title + body.
  const stack = (cx: number, cy: number, cw: number, ch: number, extraGap = 0): CalloutLayout => {
    const th = titleHeight(a, cw);
    const title = th ? { x: cx, y: cy, w: cw, h: th } : null;
    const by = cy + th + (th ? gap + extraGap : 0);
    return { pad, title, body: { x: cx, y: by, w: cw, h: Math.max(4, cy + ch - by) }, band: null };
  };
  const ts = titleStyleOf(a);
  if (recipeOf(a)) {
    const th0 = titleHeight(a, Math.max(10, a.w - pad * 2));
    const R = recipeLayout(a, pad, th0);
    if (R.titleInBand) {
      return { pad, title: hasTitle(a) ? R.titleInBand : null, body: R.content, band: R.badge };
    }
    // Step boxes leave room for the dotted divider under the title.
    const rc = recipeOf(a)!;
    const out = stack(R.content.x, R.content.y, R.content.w, R.content.h, rc.dots && rc.badge !== 'arc' ? pad * 1.2 : 0);
    // Centre the text block vertically in the shape (round and tall bodies have room to spare).
    const used = (out.title ? out.body.y - out.title.y : 0) + wrapText(a.text || ' ', a, Math.max(10, out.body.w)).height;
    const spare = R.content.h - used;
    if (spare > 1 && !rc.dots) {
      const dy = spare / 2;
      return {
        ...out,
        title: out.title ? { ...out.title, y: out.title.y + dy } : null,
        body: { ...out.body, y: out.body.y + dy, h: Math.max(4, out.body.h - dy) },
        band: R.badge,
      };
    }
    return { ...out, band: R.badge };
  }
  switch (designOf(a)) {
    case 'card':
      return stack(x + pad + Math.max(4, a.strokeWidth * 1.5), y + pad, w - pad * 2 - Math.max(4, a.strokeWidth * 1.5), h - pad * 2);
    case 'tooltip':
    case 'glass':
      return stack(x + pad * 1.1, y + pad, w - pad * 2.2, h - pad * 2);
    case 'note':
      return stack(x + pad * 1.1, y + pad * 1.1, w - pad * 2.2, h - pad * 2.2);
    case 'pill':
      return stack(x + Math.min(h, w) * 0.4, y + pad * 0.9, w - Math.min(h, w) * 0.8, h - pad * 1.8);
    case 'step': {
      // The circle grows to fit its label (a number, or a short word).
      const d = stepDiameter(a);
      const inner = d - pad * 0.8;
      const th = titleHeight(a, inner);
      const top = y + Math.max(pad * 0.8, (h - d) / 2);
      return {
        pad,
        title: hasTitle(a) ? { x: x + pad * 0.8 + (d - inner) / 2, y: top + (d - th) / 2, w: inner, h: th } : null,
        body: { x: x + d + pad * 1.8, y: y + pad, w: w - d - pad * 2.8, h: h - pad * 2 },
        band: { x: x + pad * 0.8, y: top, w: d, h: d },
      };
    }
    case 'oval':
      return stack(x + w * 0.15 + pad * 0.3, y + h * 0.15 + pad * 0.3, w * 0.7 - pad * 0.6, h * 0.7 - pad * 0.6);
    case 'circle': {
      const th = titleHeight(a, w * 0.6);
      const top = y + h * 0.5;
      return {
        pad,
        title: th ? { x: x + w * 0.2, y: top - th - pad * 0.6, w: w * 0.6, h: th } : null,
        body: { x: x + w * 0.18, y: top + pad * 0.6, w: w * 0.64, h: h * 0.32 },
        band: null,
      };
    }
    case 'titled': {
      const th = titleHeight(a, w - pad * 2);
      const bandH = th ? th + pad * 1.2 : 0;
      return {
        pad,
        title: th ? { x: x + pad, y: y + pad * 0.6, w: w - pad * 2, h: th } : null,
        body: { x: x + pad, y: y + bandH + pad, w: w - pad * 2, h: Math.max(4, h - bandH - pad * 2) },
        band: bandH ? { x, y, w, h: bandH } : null,
      };
    }
    case 'quote': {
      const q = a.fontSize * 1.4;
      // Room for the opening mark (top left) and the closing mark (bottom right).
      return stack(x + q * 0.9, y + q * 0.75, w - q * 2.1, h - q * 1.75);
    }
    case 'divided':
      return stack(x + pad, y + pad * 0.85, w - pad * 2, h - pad * 1.7, Math.max(3, a.strokeWidth) + pad * 0.6);
    case 'sidebar': {
      const bar = Math.max(4, a.strokeWidth * 1.6);
      return stack(x + bar + pad, y + pad * 0.9, w - bar - pad * 2, h - pad * 1.8);
    }
    case 'brackets':
    case 'braces': {
      const arm = Math.max(pad, a.fontSize * 0.8);
      return stack(x + arm + pad * 0.5, y + pad * 0.9, w - arm * 2 - pad, h - pad * 1.8);
    }
    case 'arrow':
      return stack(x + h * 0.25 + pad * 0.6, y + pad * 0.9, w - h * 0.6 - pad * 1.2, h - pad * 1.8);
    case 'ribbon':
      return stack(x + h * 0.3 + pad * 0.4, y + pad * 0.9, w - h * 0.6 - pad * 0.8, h - pad * 1.8);
    case 'leader':
      return stack(x + pad * 0.4, y + pad * 0.6, w - pad * 0.8, h - pad * 1.1, Math.max(2, a.strokeWidth) + pad * 0.5);
    case 'tag':
    case 'underline':
    case 'hexagon': {
      const design = designOf(a);
      const th = titleHeight(a, w - pad * 2);
      const bandH = th ? th + pad * 0.9 : 0;
      const tw = titleWidth(a, w - pad * 2);
      const bandW = design === 'hexagon' ? w : Math.min(w, tw + pad * (design === 'tag' ? 3 : 2));
      const titleX = design === 'hexagon' ? x + pad * 1.5 : design === 'tag' ? x + pad * 1.5 : x + pad;
      const rules = design === 'underline' ? Math.max(3, a.strokeWidth) * 2.6 : 0;
      const by = y + bandH + (bandH ? pad * 0.6 + rules : pad * 0.4);
      return {
        pad,
        title: th ? { x: titleX, y: y + pad * 0.45, w: design === 'hexagon' ? w - pad * 3 : bandW - pad * 2, h: th } : null,
        body: { x: x + (design === 'hexagon' ? pad : pad * 0.3), y: by, w: w - (design === 'hexagon' ? pad * 2 : pad * 0.6), h: Math.max(4, y + h - by - pad * 0.3) },
        band: bandH ? { x, y, w: bandW, h: bandH } : null,
      };
    }
    case 'number': {
      const tw = titleWidth(a, w * 0.45);
      const col = hasTitle(a) ? Math.min(w * 0.45, Math.max(tw + pad * 2, ts.fontSize * 1.8)) : 0;
      const th = titleHeight(a, Math.max(10, col - pad));
      return {
        pad,
        title: col ? { x: x + pad * 0.5, y: y + (h - th) / 2, w: col - pad, h: th } : null,
        body: { x: x + col + pad, y: y + pad * 0.9, w: w - col - pad * 2.2, h: h - pad * 1.8 },
        band: col ? { x, y, w: col, h } : null,
      };
    }
    case 'banner': {
      const tw = titleWidth(a, w * 0.4);
      const col = hasTitle(a) ? Math.min(w * 0.4, tw + pad * 2) : 0;
      const th = titleHeight(a, Math.max(10, col - pad));
      return {
        pad,
        title: col ? { x: x + pad, y: y + (h - th) / 2, w: col - pad * 2, h: th } : null,
        body: { x: x + col + pad, y: y + h * 0.12 + pad * 0.7, w: w - col - h * 0.3 - pad * 1.5, h: h * 0.76 - pad * 1.4 },
        band: col ? { x, y, w: col, h } : null,
      };
    }
    case 'stripes': {
      const sw = Math.min(w * 0.22, h * 0.9);
      // Keep clear of the cut corner at the bottom right.
      const cut = Math.min(h * 0.35, w * 0.15);
      return stack(x + sw + pad * 0.6, y + pad * 0.9, w - sw - pad * 1.6 - cut * 0.5, h - pad * 1.8);
    }
    case 'corners':
    case 'bubble':
    default:
      return stack(x + pad, y + pad, w - pad * 2, h - pad * 2);
  }
}

/** Circle size of the step design: fits its label (a number or a short word). */
function stepDiameter(a: CalloutAnnotation): number {
  const pad = calloutPadding(a);
  const ts = titleStyleOf(a);
  return Math.min(a.w * 0.45, Math.max(ts.fontSize * 2, pad * 3, titleWidth(a, a.w * 0.4) + pad * 1.6));
}

/**
 * Grows the box so title and text fit (keeps the width). With `snug`, it first shrinks to the
 * smallest height, so switching to a more compact design does not leave empty space.
 */
export function fitCallout<T extends CalloutAnnotation>(c: T, snug = false): T {
  let out = snug ? { ...c, h: Math.max(24, c.fontSize * 1.5) } : c;
  for (let i = 0; i < 12; i++) {
    const L = calloutLayout(out);
    const needBody = wrapText(out.text || ' ', out, Math.max(10, L.body.w)).height;
    const overflow = needBody - L.body.h;
    if (overflow <= 0.5) break;
    const design = designOf(out);
    const factor = design === 'oval' ? 0.7 : design === 'circle' ? 0.32 : design === 'banner' ? 0.76 : recipeFitFactor(out);
    out = { ...out, h: Math.ceil(out.h + overflow / factor + 1) };
  }
  // Number badges and icons must fit inside the box.
  const minH = recipeMinHeight(out, calloutPadding(out));
  if (minH && out.h < minH) out = { ...out, h: minH };
  // The step circle must fit inside the box.
  if (designOf(out) === 'step') {
    const need = Math.ceil(stepDiameter(out) + calloutPadding(out) * 1.6);
    if (out.h < need) out = { ...out, h: need };
  }
  return out;
}

/* --------------------------------- pointers --------------------------------- */

/* The pointer is attached to the real outline of the design (pill ends, parallelogram slants,
 * clouds, hearts…), not to its bounding box, so tails and leader lines always touch the shape. */

type ProbeCtx = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;
let probe: ProbeCtx | null | undefined;
function probeCtx(): ProbeCtx | null {
  if (probe !== undefined) return probe;
  try {
    probe = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(2, 2).getContext('2d') : null;
  } catch {
    probe = null;
  }
  return probe;
}

/** Outline of the callout's body (the part the pointer attaches to), or null for the plain box. */
export function calloutOutline(a: CalloutAnnotation): Path2D | null {
  if (typeof Path2D === 'undefined') return null;
  const r = recipeOf(a);
  if (r) return shapeGeometry(bodyOf(a, r), { x: a.x, y: a.y, w: a.w, h: a.h }, a.radius).outline;
  const p = new Path2D();
  // Record the classic design's outline into a Path2D.
  const rec = {
    beginPath() {}, closePath: () => p.closePath(), moveTo: (x: number, y: number) => p.moveTo(x, y), lineTo: (x: number, y: number) => p.lineTo(x, y),
    rect: (x: number, y: number, w: number, h: number) => p.rect(x, y, w, h),
    roundRect: (x: number, y: number, w: number, h: number, rr: number) => p.roundRect(x, y, w, h, rr),
    ellipse: (...v: Parameters<Path2D['ellipse']>) => p.ellipse(...v), arc: (...v: Parameters<Path2D['arc']>) => p.arc(...v),
    quadraticCurveTo: (...v: Parameters<Path2D['quadraticCurveTo']>) => p.quadraticCurveTo(...v), bezierCurveTo: (...v: Parameters<Path2D['bezierCurveTo']>) => p.bezierCurveTo(...v),
  };
  try {
    return outlinePath(rec as unknown as Ctx2D, a) ? p : null;
  } catch {
    return null;
  }
}

/** Where a ray from the box centre towards `to` crosses the rectangle edge. */
function rectEdge(a: Rect, to: Point): Point {
  const cx = a.x + a.w / 2;
  const cy = a.y + a.h / 2;
  const dx = to.x - cx;
  const dy = to.y - cy;
  if (!dx && !dy) return { x: cx, y: a.y + a.h };
  const t = Math.min(dx ? a.w / 2 / Math.abs(dx) : Infinity, dy ? a.h / 2 / Math.abs(dy) : Infinity);
  return { x: cx + dx * t, y: cy + dy * t };
}

/**
 * Where a ray from the body's centre towards `to` leaves the outline (just inside it). Marches in
 * from outside and refines, so the outermost crossing is found even on bumpy shapes (clouds).
 */
export function outlineEdge(a: CalloutAnnotation, path: Path2D | null, to: Point): Point {
  const ctx = probeCtx();
  const cx = a.x + a.w / 2;
  const cy = a.y + a.h / 2;
  if (!ctx || !path || !ctx.isPointInPath(path, cx, cy)) return rectEdge(a, to);
  const dx = to.x - cx;
  const dy = to.y - cy;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const far = Math.hypot(a.w, a.h) / 2 + 2;
  const steps = 160;
  let outside = far;
  let inside = -1;
  for (let i = steps; i >= 0; i--) {
    const d = (far * i) / steps;
    if (ctx.isPointInPath(path, cx + ux * d, cy + uy * d)) { inside = d; break; }
    outside = d;
  }
  if (inside < 0) return rectEdge(a, to);
  for (let i = 0; i < 14; i++) {
    const m = (inside + outside) / 2;
    if (ctx.isPointInPath(path, cx + ux * m, cy + uy * m)) inside = m;
    else outside = m;
  }
  return { x: cx + ux * inside, y: cy + uy * inside };
}

function insideOutline(a: CalloutAnnotation, path: Path2D | null, p: Point): boolean {
  const ctx = probeCtx();
  if (ctx && path) return ctx.isPointInPath(path, p.x, p.y);
  return inRect(p, a);
}

/** Base points of a speech tail, on the design's outline where it faces the tail tip. */
export function calloutTail(a: CalloutAnnotation): [Point, Point] | null {
  const tip = { x: a.tailX, y: a.tailY };
  if (tailOf(a) !== 'speech') return null;
  const path = calloutOutline(a);
  if (insideOutline(a, path, tip)) return null;
  const cx = a.x + a.w / 2;
  const cy = a.y + a.h / 2;
  const half = Math.max(8, Math.min(a.w, a.h) * 0.14);
  const edge = outlineEdge(a, path, tip);
  const dx = tip.x - edge.x;
  const dy = tip.y - edge.y;
  const len = Math.hypot(dx, dy) || 1;
  // Across the pointing direction, then snapped back onto the outline (and slightly inside it so
  // the tail's fill overlaps the body's: no hairline seam, no gap).
  const px = -dy / len;
  const py = dx / len;
  const inset = Math.max(1, a.strokeWidth * 0.5 + 0.5);
  const base = (s: number): Point => {
    const e = outlineEdge(a, path, { x: edge.x + px * half * s, y: edge.y + py * half * s });
    const ex = cx - e.x;
    const ey = cy - e.y;
    const el = Math.hypot(ex, ey) || 1;
    return { x: e.x + (ex / el) * inset, y: e.y + (ey / el) * inset };
  };
  return [base(-1), base(1)];
}

/** Leader line: from the outline at the nearest anchor, along the box direction, then 45° to the tip. */
export function leaderPath(a: CalloutAnnotation): Point[] | null {
  const tip = { x: a.tailX, y: a.tailY };
  if (tailOf(a) !== 'leader') return null;
  const path = calloutOutline(a);
  if (insideOutline(a, path, tip)) return null;
  const { x, y, w, h } = a;
  const anchors = [
    { x, y: y + h }, { x: x + w, y: y + h }, { x, y }, { x: x + w, y },
    { x, y: y + h / 2 }, { x: x + w, y: y + h / 2 }, { x: x + w / 2, y: y + h }, { x: x + w / 2, y },
  ].map((p) => outlineEdge(a, path, p));
  let start = anchors[0]!;
  let best = Infinity;
  for (const p of anchors) {
    const d = Math.hypot(p.x - tip.x, p.y - tip.y);
    if (d < best) { best = d; start = p; }
  }
  const dx = tip.x - start.x;
  const dy = tip.y - start.y;
  let elbow: Point;
  if (Math.abs(dx) >= Math.abs(dy)) elbow = { x: tip.x - Math.sign(dx) * Math.abs(dy), y: start.y };
  else elbow = { x: start.x, y: tip.y - Math.sign(dy) * Math.abs(dx) };
  // A leader that would run back across the shape starts straight towards the tip instead.
  if (insideOutline(a, path, { x: (start.x + elbow.x) / 2, y: (start.y + elbow.y) / 2 }) && Math.hypot(start.x - elbow.x, start.y - elbow.y) > 2) {
    const s = outlineEdge(a, path, tip);
    return [s, { x: (s.x + tip.x) / 2, y: (s.y + tip.y) / 2 }, tip];
  }
  return [start, elbow, tip];
}

/** Colour of the leader line: the outline colour, or (designs without a line) the accent / fill. */
export function leaderColor(a: CalloutAnnotation): string {
  if (a.strokeWidth > 0 && !isTransparent(a.stroke)) return a.stroke;
  if (a.accent && !isTransparent(a.accent)) return a.accent;
  if (!isTransparent(a.fill)) return a.fill;
  return a.color;
}

function drawLeaderEnd(ctx: Ctx2D, tip: Point, from: Point, end: LeaderEnd, lw: number): void {
  const r = Math.max(4, lw * 2.2);
  const ang = Math.atan2(tip.y - from.y, tip.x - from.x);
  ctx.save();
  ctx.setLineDash([]);
  ctx.beginPath();
  switch (end) {
    case 'dot':
      ctx.arc(tip.x, tip.y, r, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'ring':
      ctx.arc(tip.x, tip.y, r * 1.4, 0, Math.PI * 2);
      ctx.lineWidth = Math.max(1.5, lw);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(tip.x, tip.y, r * 0.6, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'square':
      ctx.translate(tip.x, tip.y);
      ctx.rotate(ang);
      ctx.fillRect(-r, -r, r * 2, r * 2);
      break;
    case 'diamond':
      ctx.translate(tip.x, tip.y);
      ctx.rotate(ang + Math.PI / 4);
      ctx.lineWidth = Math.max(1.5, lw);
      ctx.strokeRect(-r, -r, r * 2, r * 2);
      break;
    case 'arrow': {
      const len = r * 2.4;
      ctx.moveTo(tip.x, tip.y);
      ctx.lineTo(tip.x - len * Math.cos(ang) + len * 0.5 * Math.sin(ang), tip.y - len * Math.sin(ang) - len * 0.5 * Math.cos(ang));
      ctx.lineTo(tip.x - len * Math.cos(ang) - len * 0.5 * Math.sin(ang), tip.y - len * Math.sin(ang) + len * 0.5 * Math.cos(ang));
      ctx.closePath();
      ctx.fill();
      break;
    }
    default:
      break;
  }
  ctx.restore();
}

/* ---------------------------------- shapes ---------------------------------- */

function poly(ctx: Ctx2D, pts: Array<[number, number]>): void {
  ctx.beginPath();
  pts.forEach(([px, py], i) => (i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py)));
  ctx.closePath();
}

/** Main outline of the design (used for fill, stroke and the speech tail). */
function outlinePath(ctx: Ctx2D, a: CalloutAnnotation): boolean {
  const { x, y, w, h } = a;
  const r = Math.max(0, Math.min(a.radius, w / 2, h / 2));
  switch (designOf(a)) {
    case 'pill':
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, Math.min(w, h) / 2);
      return true;
    case 'card':
    case 'tooltip':
    case 'glass':
    case 'step':
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, r);
      return true;
    case 'note': {
      const fold = Math.min(w, h) * 0.18;
      poly(ctx, [[x, y], [x + w, y], [x + w, y + h - fold], [x + w - fold, y + h], [x, y + h]]);
      return true;
    }
    case 'oval':
    case 'circle':
      ctx.beginPath();
      ctx.ellipse(x + w / 2, y + h / 2, Math.max(1, w / 2), Math.max(1, h / 2), 0, 0, Math.PI * 2);
      return true;
    case 'arrow': {
      const p = h * 0.35;
      const n = h * 0.25;
      poly(ctx, [[x, y], [x + w - p, y], [x + w, y + h / 2], [x + w - p, y + h], [x, y + h], [x + n, y + h / 2]]);
      return true;
    }
    case 'ribbon': {
      const n = h * 0.3;
      poly(ctx, [[x, y], [x + w, y], [x + w - n, y + h / 2], [x + w, y + h], [x, y + h], [x + n, y + h / 2]]);
      return true;
    }
    case 'stripes': {
      const c = Math.min(h * 0.35, w * 0.15);
      poly(ctx, [[x, y], [x + w, y], [x + w, y + h - c], [x + w - c, y + h], [x, y + h]]);
      return true;
    }
    case 'bubble':
    case 'titled':
    case 'number':
    case 'sidebar':
    case 'divided':
    case 'leader':
    case 'brackets':
    case 'braces':
    case 'corners':
    case 'tag':
    case 'hexagon':
    case 'underline':
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, r);
      return true;
    case 'banner': {
      const L = calloutLayout(a);
      const col = L.band?.w ?? 0;
      const p = h * 0.3;
      poly(ctx, [[x + col, y + h * 0.12], [x + w - p, y + h * 0.12], [x + w, y + h / 2], [x + w - p, y + h * 0.88], [x + col, y + h * 0.88]]);
      return true;
    }
    case 'quote': {
      const o = a.fontSize * 0.7;
      ctx.beginPath();
      ctx.rect(x + o, y + o, w - o, h - o);
      return true;
    }
    default:
      return false;
  }
}

/** Designs whose outline is drawn with the stroke colour (others use their own line art). */
const OUTLINED = new Set<CalloutDesign>(['bubble', 'oval', 'titled', 'arrow', 'ribbon', 'circle', 'number', 'stripes', 'card', 'tooltip', 'pill', 'glass', 'step', 'note']);
/** Designs drawn with a soft drop shadow, like cards in modern interfaces. */
const SHADOWED = new Set<CalloutDesign>(['bubble', 'oval', 'titled', 'card', 'tooltip', 'note', 'pill', 'glass', 'step']);

function braceSide(ctx: Ctx2D, x: number, y: number, h: number, arm: number, dir: 1 | -1): void {
  const m = y + h / 2;
  ctx.beginPath();
  ctx.moveTo(x + arm * dir, y);
  ctx.quadraticCurveTo(x + arm * 0.35 * dir, y, x + arm * 0.35 * dir, y + arm * 0.6);
  ctx.lineTo(x + arm * 0.35 * dir, m - arm * 0.5);
  ctx.quadraticCurveTo(x + arm * 0.35 * dir, m, x, m);
  ctx.quadraticCurveTo(x + arm * 0.35 * dir, m, x + arm * 0.35 * dir, m + arm * 0.5);
  ctx.lineTo(x + arm * 0.35 * dir, y + h - arm * 0.6);
  ctx.quadraticCurveTo(x + arm * 0.35 * dir, y + h, x + arm * dir, y + h);
  ctx.stroke();
}

function drawDecor(ctx: Ctx2D, a: CalloutAnnotation, L: CalloutLayout): void {
  const { x, y, w, h } = a;
  const accent = a.accent ?? a.stroke;
  const lw = Math.max(1, a.strokeWidth);
  const r = Math.max(0, Math.min(a.radius, w / 2, h / 2));
  switch (designOf(a)) {
    case 'card': {
      const stripe = Math.max(4, a.strokeWidth * 1.5);
      ctx.save();
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, r);
      ctx.clip();
      ctx.fillStyle = accent;
      ctx.fillRect(x, y, stripe, h);
      ctx.restore();
      break;
    }
    case 'note': {
      const fold = Math.min(w, h) * 0.18;
      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,0.12)';
      poly(ctx, [[x + w, y + h - fold], [x + w - fold, y + h - fold], [x + w - fold, y + h]]);
      ctx.fill();
      ctx.restore();
      break;
    }
    case 'step':
      if (L.band) {
        ctx.save();
        ctx.fillStyle = accent;
        ctx.beginPath();
        ctx.arc(L.band.x + L.band.w / 2, L.band.y + L.band.h / 2, L.band.w / 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
      break;
    case 'titled':
      if (L.band) {
        ctx.save();
        ctx.beginPath();
        ctx.roundRect(x, y, w, h, r);
        ctx.clip();
        ctx.fillStyle = accent;
        ctx.fillRect(L.band.x, L.band.y, L.band.w, L.band.h);
        ctx.restore();
      }
      break;
    case 'circle':
      ctx.save();
      ctx.beginPath();
      ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
      ctx.clip();
      ctx.fillStyle = accent;
      ctx.fillRect(x, y, w, h * 0.5);
      ctx.restore();
      break;
    case 'number':
    case 'banner':
      if (L.band) {
        ctx.save();
        if (designOf(a) === 'number') {
          ctx.beginPath();
          ctx.roundRect(x, y, w, h, r);
          ctx.clip();
        }
        ctx.fillStyle = accent;
        ctx.fillRect(L.band.x, L.band.y, L.band.w, L.band.h);
        ctx.restore();
      }
      break;
    case 'quote': {
      const o = a.fontSize * 0.7;
      const qw = a.fontSize * 1.6;
      const qh = a.fontSize * 1.3;
      ctx.save();
      ctx.strokeStyle = a.stroke;
      ctx.lineWidth = lw;
      ctx.setLineDash(dashPattern(a.dash ?? 'solid', lw));
      ctx.beginPath();
      ctx.moveTo(x + qw * 1.1, y);
      ctx.lineTo(x + w - o, y);
      ctx.lineTo(x + w - o, y + h - o - qh * 1.1);
      ctx.moveTo(x + w - o - qw * 1.2, y + h - o);
      ctx.lineTo(x, y + h - o);
      ctx.lineTo(x, y + qh);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = accent;
      ctx.font = `900 ${a.fontSize * 3}px Georgia, 'Times New Roman', serif`;
      ctx.textBaseline = 'top';
      ctx.fillText('“', x + qw * 0.05, y - a.fontSize * 0.55);
      ctx.fillText('”', x + w - o - qw * 1.05, y + h - o - qh * 0.95);
      ctx.restore();
      break;
    }
    case 'divided':
    case 'leader':
      if (L.title) {
        const ry = L.title.y + L.title.h + L.pad * 0.35;
        ctx.save();
        ctx.fillStyle = designOf(a) === 'divided' ? accent : a.stroke;
        const t = Math.max(designOf(a) === 'divided' ? 3 : 1.5, a.strokeWidth * (designOf(a) === 'divided' ? 1 : 0.6));
        ctx.fillRect(x + (designOf(a) === 'divided' ? 0 : L.pad * 0.4), ry, w - (designOf(a) === 'divided' ? 0 : L.pad * 0.4), t);
        if (designOf(a) === 'leader') {
          ctx.fillStyle = accent;
          ctx.fillRect(x + L.pad * 0.4, ry - t, Math.min(w * 0.3, L.pad * 4), t * 3);
        }
        ctx.restore();
      }
      break;
    case 'sidebar':
      ctx.fillStyle = accent;
      ctx.fillRect(x, y, Math.max(4, a.strokeWidth * 1.6), h);
      break;
    case 'brackets': {
      const arm = Math.max(L.pad, a.fontSize * 0.8);
      ctx.save();
      ctx.strokeStyle = a.stroke;
      ctx.lineWidth = lw;
      ctx.setLineDash(dashPattern(a.dash ?? 'solid', lw));
      ctx.beginPath();
      ctx.moveTo(x + arm, y);
      ctx.lineTo(x, y);
      ctx.lineTo(x, y + h);
      ctx.lineTo(x + arm, y + h);
      ctx.moveTo(x + w - arm, y);
      ctx.lineTo(x + w, y);
      ctx.lineTo(x + w, y + h);
      ctx.lineTo(x + w - arm, y + h);
      ctx.stroke();
      ctx.restore();
      break;
    }
    case 'braces': {
      const arm = Math.max(L.pad, a.fontSize * 0.8);
      ctx.save();
      ctx.strokeStyle = a.stroke;
      ctx.lineWidth = lw;
      braceSide(ctx, x, y, h, arm, 1);
      braceSide(ctx, x + w, y, h, arm, -1);
      ctx.restore();
      break;
    }
    case 'corners': {
      const c = Math.max(8, Math.min(w, h) * 0.2);
      ctx.save();
      ctx.strokeStyle = a.stroke;
      ctx.lineWidth = lw;
      ctx.beginPath();
      ctx.moveTo(x, y + c); ctx.lineTo(x, y); ctx.lineTo(x + c, y);
      ctx.moveTo(x + w - c, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w, y + c);
      ctx.moveTo(x + w, y + h - c); ctx.lineTo(x + w, y + h); ctx.lineTo(x + w - c, y + h);
      ctx.moveTo(x + c, y + h); ctx.lineTo(x, y + h); ctx.lineTo(x, y + h - c);
      ctx.stroke();
      ctx.restore();
      break;
    }
    case 'tag':
      if (L.band) {
        const b = L.band;
        const sk = b.h * 0.45;
        ctx.fillStyle = accent;
        poly(ctx, [[b.x + sk, b.y], [b.x + b.w, b.y], [b.x + b.w - sk, b.y + b.h], [b.x, b.y + b.h]]);
        ctx.fill();
      }
      ctx.fillStyle = a.stroke;
      ctx.fillRect(x, y + h - lw, w, lw);
      break;
    case 'hexagon':
      if (L.band) {
        const b = L.band;
        const c = b.h * 0.5;
        ctx.fillStyle = accent;
        poly(ctx, [[b.x, b.y + b.h / 2], [b.x + c, b.y], [b.x + b.w - c, b.y], [b.x + b.w, b.y + b.h / 2], [b.x + b.w - c, b.y + b.h], [b.x + c, b.y + b.h]]);
        ctx.fill();
      }
      break;
    case 'underline':
      if (L.band) {
        const b = L.band;
        const t = Math.max(3, a.strokeWidth);
        ctx.fillStyle = accent;
        ctx.fillRect(b.x, b.y, b.w, b.h);
        ctx.fillStyle = a.stroke;
        ctx.fillRect(x, b.y + b.h + L.pad * 0.3, w, t);
        ctx.fillRect(x, b.y + b.h + L.pad * 0.3 + t * 1.6, w, t * 0.6);
      }
      break;
    case 'stripes': {
      const sw = Math.min(w * 0.22, h * 0.9);
      ctx.save();
      poly(ctx, [[x, y], [x + sw, y], [x, y + h]]);
      ctx.clip();
      ctx.strokeStyle = accent;
      ctx.lineWidth = Math.max(1.5, lw * 0.8);
      const step = Math.max(4, lw * 2.4);
      ctx.beginPath();
      for (let d = -h; d < sw + h; d += step) {
        ctx.moveTo(x + d, y + h);
        ctx.lineTo(x + d + h, y);
      }
      ctx.stroke();
      ctx.restore();
      break;
    }
    default:
      break;
  }
}

export function renderCallout(ctx: Ctx2D, a: CalloutAnnotation): void {
  ctx.save();
  ctx.globalAlpha = a.opacity;
  const L = calloutLayout(a);
  const design = designOf(a);
  const tail = calloutTail(a);
  const leader = leaderPath(a);
  ctx.lineJoin = 'round';
  ctx.lineWidth = a.strokeWidth;
  ctx.strokeStyle = a.stroke;
  ctx.fillStyle = a.fill;
  const outlined = OUTLINED.has(design) && a.strokeWidth > 0 && a.stroke !== 'transparent';
  const fills = a.fill !== 'transparent';
  const tailPath = () => {
    if (!tail) return false;
    ctx.beginPath();
    ctx.moveTo(tail[0].x, tail[0].y);
    ctx.lineTo(a.tailX, a.tailY);
    ctx.lineTo(tail[1].x, tail[1].y);
    ctx.closePath();
    return true;
  };
  const recipe = recipeOf(a);
  if (recipe) {
    drawRecipe(ctx, a, tail, L);
  } else {
  if (SHADOWED.has(design)) {
    // Soft, layered-looking shadow scaled to the callout.
    const k = Math.max(0.6, Math.min(2, a.fontSize / 18));
    ctx.shadowColor = design === 'tooltip' ? 'rgba(10,14,22,0.35)' : 'rgba(15,23,42,0.18)';
    ctx.shadowBlur = 18 * k;
    ctx.shadowOffsetY = 6 * k;
  }
  // Stroke both shapes, then fill both: the fills hide the stroke where box and tail meet.
  if (outlined) {
    ctx.setLineDash(dashPattern(a.dash ?? 'solid', a.strokeWidth));
    if (outlinePath(ctx, a)) ctx.stroke();
    ctx.shadowColor = 'transparent';
    if (tailPath()) ctx.stroke();
    ctx.setLineDash([]);
  } else if (tail && !fills) {
    ctx.fillStyle = a.stroke;
    if (tailPath()) ctx.fill();
    ctx.fillStyle = a.fill;
  }
  ctx.shadowColor = 'transparent';
  if (fills) {
    if (outlinePath(ctx, a)) ctx.fill();
    if (tailPath()) ctx.fill();
  }
  drawDecor(ctx, a, L);
  }

  if (leader) {
    ctx.save();
    const lw = Math.max(1.5, a.strokeWidth);
    const lc = leaderColor(a);
    ctx.strokeStyle = lc;
    ctx.fillStyle = lc;
    ctx.lineWidth = lw;
    ctx.setLineDash(dashPattern(a.dash ?? 'solid', lw));
    ctx.beginPath();
    leader.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    ctx.stroke();
    ctx.setLineDash([]);
    drawLeaderEnd(ctx, leader[2]!, leader[1]!, a.leaderEnd ?? 'ring', lw);
    ctx.restore();
  }

  const sectionBg = (style: TextStyle, x: number, y: number, w: number, h: number) => {
    const pad = sectionPad(style);
    if (!style.sectionBg || style.sectionBg === 'transparent') return;
    ctx.save();
    ctx.fillStyle = style.sectionBg;
    ctx.beginPath();
    ctx.roundRect(x - pad, y - pad, w + pad * 2, h + pad * 2, Math.min(8, pad));
    ctx.fill();
    ctx.restore();
  };
  if (L.title && hasTitle(a)) {
    const ts = titleStyleOf(a);
    const tl = wrapText(a.title!, ts, Math.max(10, L.title.w), ctx);
    sectionBg(ts, L.title.x, L.title.y, L.title.w, tl.height);
    drawTextLines(ctx, tl, ts, L.title.x, L.title.y, L.title.w);
  }
  const body = wrapText(a.text, a, Math.max(10, L.body.w), ctx);
  if (a.text) sectionBg(a, L.body.x, L.body.y, L.body.w, body.height);
  drawTextLines(ctx, body, a, L.body.x, L.body.y, L.body.w);
  ctx.restore();
}

export function calloutBounds(a: CalloutAnnotation): Rect {
  if (tailOf(a) === 'none') return { x: a.x, y: a.y, w: a.w, h: a.h };
  const r = tailOf(a) === 'leader' ? Math.max(4, a.strokeWidth * 2.2) * 1.5 : 0;
  const x = Math.min(a.x, a.tailX - r);
  const y = Math.min(a.y, a.tailY - r);
  return { x, y, w: Math.max(a.x + a.w, a.tailX + r) - x, h: Math.max(a.y + a.h, a.tailY + r) - y };
}

export function hitCallout(a: CalloutAnnotation, p: Point, tolerance: number): boolean {
  if (inRect(p, a, tolerance)) return true;
  const tail = calloutTail(a);
  if (tail) {
    const mid = { x: (tail[0].x + tail[1].x) / 2, y: (tail[0].y + tail[1].y) / 2 };
    return distToSegment(p, mid, { x: a.tailX, y: a.tailY }) <= tolerance + Math.hypot(tail[0].x - tail[1].x, tail[0].y - tail[1].y) / 3;
  }
  const leader = leaderPath(a);
  if (leader) {
    for (let i = 1; i < leader.length; i++) if (distToSegment(p, leader[i - 1]!, leader[i]!) <= tolerance + a.strokeWidth + 4) return true;
  }
  return false;
}

/* --------------------------------- presets --------------------------------- */

export type DesignPatch = Omit<Partial<CalloutAnnotation>, 'titleStyle'> & { titleStyle?: Partial<TextStyle> };

/** Each design comes with matching colours; everything stays editable afterwards. */
export const CALLOUT_DESIGNS: Array<{ id: CalloutDesign; label: string; patch: DesignPatch }> = [
  { id: 'card', label: 'Card', patch: { fill: '#FFFFFF', stroke: '#E4E7EC', accent: '#4F6BED', color: '#475467', radius: 10, strokeWidth: 1, tail: 'none', titleStyle: { color: '#101828' } } },
  { id: 'tooltip', label: 'Tooltip', patch: { fill: '#1D2433', stroke: '#1D2433', accent: '#7C9CFF', color: '#E6EAF2', radius: 8, strokeWidth: 1, tail: 'speech', titleStyle: { color: '#FFFFFF' } } },
  { id: 'bubble', label: 'Bubble', patch: { fill: '#FFFFFF', stroke: '#D0D5DD', accent: '#4F6BED', color: '#344054', radius: 14, strokeWidth: 1.5, tail: 'speech', titleStyle: { color: '#101828' } } },
  { id: 'note', label: 'Sticky note', patch: { fill: '#FFF3B0', stroke: '#F2D46B', accent: '#E8B931', color: '#4A3B00', radius: 2, strokeWidth: 1, tail: 'none', titleStyle: { color: '#3A2E00' } } },
  { id: 'pill', label: 'Pill', patch: { fill: '#4F6BED', stroke: '#4F6BED', accent: '#3D57D6', color: '#FFFFFF', strokeWidth: 0, tail: 'speech', align: 'center', titleStyle: { color: '#FFFFFF' } } },
  { id: 'step', label: 'Step', patch: { fill: '#FFFFFF', stroke: '#E4E7EC', accent: '#4F6BED', color: '#475467', radius: 12, strokeWidth: 1, tail: 'leader', leaderEnd: 'dot', titleStyle: { color: '#FFFFFF', align: 'center' } } },
  { id: 'glass', label: 'Glass', patch: { fill: '#FFFFFFCC', stroke: '#FFFFFFE6', accent: '#4F6BED', color: '#1D2939', radius: 14, strokeWidth: 1, tail: 'none', titleStyle: { color: '#101828' } } },
  { id: 'titled', label: 'Title bar', patch: { fill: '#F5F8FF', stroke: '#C7D4FB', accent: '#4F6BED', color: '#344054', radius: 10, strokeWidth: 1, tail: 'speech', titleStyle: { color: '#FFFFFF' } } },
  { id: 'quote', label: 'Quote', patch: { fill: '#FFF6E5', stroke: '#1D2433', accent: '#F59E0B', color: '#1D2433', strokeWidth: 2, tail: 'none', align: 'center', titleStyle: { color: '#1D2433' } } },
  { id: 'leader', label: 'Leader', patch: { fill: 'transparent', stroke: '#1D2433', accent: '#F5B400', color: '#1D2433', strokeWidth: 2, tail: 'leader', leaderEnd: 'ring', titleStyle: { color: '#1D2433' } } },
  { id: 'tag', label: 'Tag', patch: { fill: 'transparent', stroke: '#1D2433', accent: '#F5B400', color: '#1D2433', strokeWidth: 2, tail: 'leader', leaderEnd: 'ring', titleStyle: { color: '#1D2433' } } },
  { id: 'number', label: 'Number', patch: { fill: '#FFFFFF', stroke: '#1D2433', accent: '#1D2433', color: '#1D2433', radius: 4, strokeWidth: 1.5, tail: 'leader', leaderEnd: 'dot', titleStyle: { color: '#FFFFFF' } } },
  { id: 'underline', label: 'Underline', patch: { fill: 'transparent', stroke: '#1D2433', accent: '#1D2433', color: '#1D2433', strokeWidth: 3, tail: 'leader', leaderEnd: 'square', titleStyle: { color: '#FFFFFF' } } },
  { id: 'divided', label: 'Divided', patch: { fill: 'transparent', stroke: '#4A6C8C', accent: '#7A95B0', color: '#3D5266', strokeWidth: 3, tail: 'none', align: 'center', titleStyle: { color: '#3D5266' } } },
  { id: 'sidebar', label: 'Side bar', patch: { fill: '#FFFFFFE6', stroke: '#4F6BED', accent: '#4F6BED', color: '#344054', radius: 0, strokeWidth: 3, tail: 'none', titleStyle: { color: '#101828' } } },
  { id: 'hexagon', label: 'Hexagon', patch: { fill: 'transparent', stroke: '#2B3442', accent: '#2B3442', color: '#2B3442', strokeWidth: 2, tail: 'leader', leaderEnd: 'ring', align: 'center', titleStyle: { color: '#FFFFFF' } } },
  { id: 'circle', label: 'Circle', patch: { fill: '#4F6BED', stroke: '#3D57D6', accent: '#F5C542', color: '#FFFFFF', strokeWidth: 2, tail: 'speech', align: 'center', titleStyle: { color: '#1D2433' } } },
  { id: 'oval', label: 'Oval', patch: { fill: '#FFFFFF', stroke: '#1D2433', accent: '#1D2433', color: '#1D2433', strokeWidth: 2, tail: 'speech', align: 'center', titleStyle: { color: '#1D2433' } } },
  { id: 'brackets', label: 'Brackets', patch: { fill: '#FFFFFFD9', stroke: '#1D2433', accent: '#1D2433', color: '#1D2433', radius: 0, strokeWidth: 2, tail: 'leader', leaderEnd: 'diamond', titleStyle: { color: '#1D2433' } } },
  { id: 'braces', label: 'Braces', patch: { fill: 'transparent', stroke: '#1D2433', accent: '#1D2433', color: '#1D2433', strokeWidth: 2, tail: 'none', align: 'center', titleStyle: { color: '#1D2433' } } },
  { id: 'corners', label: 'Corners', patch: { fill: 'transparent', stroke: '#1D2433', accent: '#1D2433', color: '#1D2433', strokeWidth: 2.5, tail: 'leader', leaderEnd: 'diamond', titleStyle: { color: '#1D2433' } } },
  { id: 'stripes', label: 'Stripes', patch: { fill: 'transparent', stroke: '#2E2A6B', accent: '#2E2A6B', color: '#2E2A6B', strokeWidth: 2, tail: 'leader', leaderEnd: 'ring', titleStyle: { color: '#2E2A6B' } } },
  { id: 'arrow', label: 'Arrow', patch: { fill: '#3E7CB1', stroke: '#2E6496', accent: '#2E6496', color: '#FFFFFF', strokeWidth: 0, tail: 'none', titleStyle: { color: '#FFFFFF' } } },
  { id: 'ribbon', label: 'Ribbon', patch: { fill: '#2E8B8B', stroke: '#1F6F6F', accent: '#1F6F6F', color: '#FFFFFF', strokeWidth: 0, tail: 'none', align: 'center', titleStyle: { color: '#FFFFFF' } } },
  { id: 'banner', label: 'Banner', patch: { fill: '#E06A8B', stroke: '#C0476B', accent: '#C0476B', color: '#FFFFFF', strokeWidth: 0, tail: 'none', titleStyle: { color: '#FFFFFF' } } },
];

