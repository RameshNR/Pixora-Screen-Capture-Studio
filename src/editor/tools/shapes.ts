import type { BoxAnnotation, HeadStyle, ImageAnnotation, LineAnnotation, MarkerAnnotation, Point, Rect, StickerAnnotation } from '../types';
import { dashPattern, distToSegment, getMeasureContext, inRect, type Ctx2D } from './common';
import { alpha, paintShape, shade } from './shape-lib';
import { drawCutout, drawStickerIcon } from './sticker-lib';

/* ----------------------------- rectangle / ellipse ----------------------------- */
export function renderBox(ctx: Ctx2D, a: BoxAnnotation): void {
  if ((a.shape && a.shape !== 'rect' && a.shape !== 'ellipse') || (a.look && a.look !== 'flat')) {
    ctx.save();
    ctx.globalAlpha = a.opacity;
    const kind = a.shape ?? (a.type === 'rect' ? 'rect' : 'ellipse');
    paintShape(ctx, kind, { x: a.x, y: a.y, w: a.w, h: a.h }, a.radius ?? 0, { fill: a.fill, stroke: a.stroke, width: a.width, dash: dashPattern(a.dash ?? 'solid', a.width), look: a.look });
    ctx.restore();
    return;
  }
  ctx.save();
  ctx.globalAlpha = a.opacity;
  ctx.lineWidth = a.width;
  ctx.strokeStyle = a.stroke;
  ctx.lineJoin = 'round';
  ctx.lineCap = a.dash === 'dotted' ? 'round' : 'butt';
  ctx.setLineDash(dashPattern(a.dash ?? 'solid', a.width));
  ctx.beginPath();
  if (a.type === 'rect' && a.shape !== 'ellipse') {
    ctx.roundRect(a.x, a.y, a.w, a.h, Math.max(0, Math.min(a.radius ?? 0, a.w / 2, a.h / 2)));
  } else {
    ctx.ellipse(a.x + a.w / 2, a.y + a.h / 2, Math.max(0.5, a.w / 2), Math.max(0.5, a.h / 2), 0, 0, Math.PI * 2);
  }
  if (a.fill !== 'transparent') {
    ctx.fillStyle = a.fill;
    ctx.fill();
  }
  if (a.width > 0 && a.stroke !== 'transparent') ctx.stroke();
  ctx.restore();
}

export function hitBox(a: BoxAnnotation, p: Point, tol: number): boolean {
  const filled = a.fill !== 'transparent';
  const reach = a.width / 2 + tol;
  if (a.shape && a.shape !== 'ellipse' && a.shape !== 'rect') {
    // Library shapes: the box (filled or with lines inside, like icons) or near its edge.
    if (!inRect(p, a, reach)) return false;
    if (filled || a.shape.startsWith('icon-') || a.shape === 'layers' || a.shape === 'brush') return true;
    const inner = { x: a.x + reach * 2, y: a.y + reach * 2, w: a.w - reach * 4, h: a.h - reach * 4 };
    return !(inner.w > 0 && inner.h > 0 && inRect(p, inner));
  }
  if (a.type === 'rect' && a.shape !== 'ellipse') {
    if (!inRect(p, a, reach)) return false;
    if (filled) return true;
    const inner = { x: a.x + reach, y: a.y + reach, w: a.w - reach * 2, h: a.h - reach * 2 };
    return !(inner.w > 0 && inner.h > 0 && inRect(p, inner));
  }
  const rx = a.w / 2;
  const ry = a.h / 2;
  if (rx <= 0 || ry <= 0) return false;
  const nx = (p.x - (a.x + rx)) / rx;
  const ny = (p.y - (a.y + ry)) / ry;
  const d = Math.sqrt(nx * nx + ny * ny);
  if (filled) return d <= 1 + reach / Math.min(rx, ry);
  return Math.abs(d - 1) * Math.min(rx, ry) <= reach;
}

/* -------------------------------- line / arrow -------------------------------- */

const SAMPLES_PER_SEGMENT = 24;
export const MAX_BENDS = 6;

/** Points the line passes through: start, bends…, end. */
export function linePoints(a: Pick<LineAnnotation, 'x1' | 'y1' | 'x2' | 'y2' | 'bends'>): Point[] {
  return [{ x: a.x1, y: a.y1 }, ...(a.bends ?? []), { x: a.x2, y: a.y2 }];
}

/**
 * Samples the line as a polyline. With bends it is a Catmull-Rom spline through every point
 * (converted to cubic Béziers), so dragging a bend handle moves the curve exactly there.
 */
export function samplePath(a: Pick<LineAnnotation, 'x1' | 'y1' | 'x2' | 'y2' | 'bends'> & { route?: LineAnnotation['route'] }): Point[] {
  if (a.route === 'elbow') return elbowPath(a);
  const P = linePoints(a);
  if (P.length === 2) return P;
  const out: Point[] = [P[0]!];
  for (let i = 0; i < P.length - 1; i++) {
    const p0 = P[i - 1] ?? P[i]!;
    const p1 = P[i]!;
    const p2 = P[i + 1]!;
    const p3 = P[i + 2] ?? p2;
    const c1 = { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 };
    const c2 = { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 };
    for (let k = 1; k <= SAMPLES_PER_SEGMENT; k++) {
      const t = k / SAMPLES_PER_SEGMENT;
      const u = 1 - t;
      out.push({
        x: u * u * u * p1.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * p2.x,
        y: u * u * u * p1.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * p2.y,
      });
    }
  }
  return out;
}

/** Right-angle connector: vertical from the start, then across to the end, with a rounded corner. */
function elbowPath(a: Pick<LineAnnotation, 'x1' | 'y1' | 'x2' | 'y2'>): Point[] {
  const dx = a.x2 - a.x1;
  const dy = a.y2 - a.y1;
  if (Math.abs(dx) < 1 || Math.abs(dy) < 1) return [{ x: a.x1, y: a.y1 }, { x: a.x2, y: a.y2 }];
  const r = Math.min(Math.abs(dx), Math.abs(dy), 40) * 0.5;
  const sx = Math.sign(dx);
  const sy = Math.sign(dy);
  const out: Point[] = [{ x: a.x1, y: a.y1 }, { x: a.x1, y: a.y2 - sy * r }];
  for (let k = 1; k <= 8; k++) {
    const t = (k / 8) * (Math.PI / 2);
    out.push({ x: a.x1 + sx * r * (1 - Math.cos(t)), y: a.y2 - sy * r * (1 - Math.sin(t)) });
  }
  out.push({ x: a.x2, y: a.y2 });
  return out;
}

function pathLength(path: Point[]): number {
  let len = 0;
  for (let i = 1; i < path.length; i++) len += Math.hypot(path[i]!.x - path[i - 1]!.x, path[i]!.y - path[i - 1]!.y);
  return len;
}

/** Point `dist` back along the polyline from its end ('end') or forward from its start ('start'). */
function pointAlong(path: Point[], dist: number, from: 'start' | 'end'): Point {
  const pts = from === 'end' ? [...path].reverse() : path;
  let left = dist;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    const seg = Math.hypot(b.x - a.x, b.y - a.y);
    if (seg >= left && seg > 0) return { x: a.x + ((b.x - a.x) * left) / seg, y: a.y + ((b.y - a.y) * left) / seg };
    left -= seg;
  }
  return pts[pts.length - 1]!;
}

/** Point and direction at distance `d` from the start. */
function frameAt(path: Point[], d: number): { p: Point; angle: number } {
  let left = d;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1]!;
    const b = path[i]!;
    const seg = Math.hypot(b.x - a.x, b.y - a.y);
    if (seg >= left && seg > 0) return { p: { x: a.x + ((b.x - a.x) * left) / seg, y: a.y + ((b.y - a.y) * left) / seg }, angle: Math.atan2(b.y - a.y, b.x - a.x) };
    left -= seg;
  }
  const a = path[path.length - 2] ?? path[0]!;
  const b = path[path.length - 1]!;
  return { p: b, angle: Math.atan2(b.y - a.y, b.x - a.x) };
}

/** Removes `dist` of length from one end of a polyline. */
function trim(path: Point[], dist: number, from: 'start' | 'end'): Point[] {
  if (dist <= 0 || path.length < 2) return path;
  const pts = from === 'end' ? [...path].reverse() : [...path];
  let left = dist;
  while (pts.length > 1) {
    const a = pts[0]!;
    const b = pts[1]!;
    const seg = Math.hypot(b.x - a.x, b.y - a.y);
    if (seg > left) {
      pts[0] = { x: a.x + ((b.x - a.x) * left) / seg, y: a.y + ((b.y - a.y) * left) / seg };
      break;
    }
    left -= seg;
    pts.shift();
  }
  return from === 'end' ? pts.reverse() : pts;
}

/** Splits a polyline at distance `d` from the start. */
function splitAt(path: Point[], d: number): [Point[], Point[]] {
  const first: Point[] = [path[0]!];
  let left = d;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1]!;
    const b = path[i]!;
    const seg = Math.hypot(b.x - a.x, b.y - a.y);
    if (seg >= left) {
      const m = seg > 0 ? { x: a.x + ((b.x - a.x) * left) / seg, y: a.y + ((b.y - a.y) * left) / seg } : a;
      first.push(m);
      return [first, [m, ...path.slice(i)]];
    }
    first.push(b);
    left -= seg;
  }
  return [first, [path[path.length - 1]!]];
}

/** Direction the line travels at an end (radians), used to orient the heads. */
export function endAngle(a: LineAnnotation, end: 'start' | 'end'): number {
  const path = samplePath(a);
  const tip = end === 'end' ? path[path.length - 1]! : path[0]!;
  const back = pointAlong(path, Math.max(4, a.width * 3), end);
  return Math.atan2(tip.y - back.y, tip.x - back.x);
}

/** Head length; grows with the stroke but less than linearly, so thick lines keep sensible heads. */
export function headLength(style: HeadStyle, width: number): number {
  const base = Math.max(12, width * 2.6 + 8);
  switch (style) {
    case 'big':
      return Math.max(22, width * 4.2 + 14);
    case 'triangle':
    case 'open':
    case 'diamond':
    case 'chevron':
    case 'harpoon':
    case 'round':
      return base;
    case 'twin':
    case 'twin-open':
      return base * 1.7;
    case 'stealth':
      return base * 1.15;
    case 'triple':
      return base * 2.1;
    case 'curved':
      return base * 1.5;
    case 'echo':
      return base * 1.45;
    case 'framed':
      return base * 1.8;
    case 'feather':
      return base * 1.2;
    case 'circle':
    case 'ring':
    case 'square':
      return Math.max(5, width * 1.3 + 3);
    case 'bar':
      return Math.max(6, width * 1.6 + 3);
    default:
      return 0;
  }
}

/** How far the shaft must stop short of the tip so heads stay sharp. */
function shaftInset(style: HeadStyle, width: number): number {
  const len = headLength(style, width);
  switch (style) {
    case 'triangle':
    case 'big':
    case 'diamond':
    case 'round':
      return len * 0.8;
    case 'twin':
      return len * 0.9;
    case 'circle':
    case 'ring':
    case 'square':
      return len;
    case 'chevron':
      return Math.min(len * 0.35, width * 0.6);
    case 'stealth':
      return len * 0.55;
    case 'curved':
      return Math.min(len * 0.2, width * 0.6);
    case 'echo':
      return len * 0.3;
    case 'framed':
      return len * 0.28;
    default:
      return 0;
  }
}

function drawHead(ctx: Ctx2D, tip: Point, angle: number, style: HeadStyle, width: number): void {
  if (style === 'none') return;
  const len = headLength(style, width);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const at = (back: number, side: number): Point => ({ x: tip.x - back * cos - side * sin, y: tip.y - back * sin + side * cos });
  const tri = (back: number, tipBack: number, spread: number) => {
    const t = at(tipBack, 0);
    const l = at(back, spread);
    const r = at(back, -spread);
    ctx.beginPath();
    ctx.moveTo(t.x, t.y);
    ctx.lineTo(l.x, l.y);
    ctx.lineTo(r.x, r.y);
    ctx.closePath();
    ctx.fill();
  };
  const vee = (back: number, tipBack: number, spread: number, lw: number) => {
    const t = at(tipBack, 0);
    const l = at(back, spread);
    const r = at(back, -spread);
    ctx.save();
    ctx.setLineDash([]);
    ctx.lineWidth = lw;
    ctx.beginPath();
    ctx.moveTo(l.x, l.y);
    ctx.lineTo(t.x, t.y);
    ctx.lineTo(r.x, r.y);
    ctx.stroke();
    ctx.restore();
  };
  ctx.setLineDash([]);
  switch (style) {
    case 'triangle':
      tri(len, 0, len * 0.45);
      break;
    case 'big': {
      const spread = len * 0.62;
      const l = at(len, spread);
      const r = at(len, -spread);
      const notch = at(len * 0.75, 0);
      ctx.beginPath();
      ctx.moveTo(tip.x, tip.y);
      ctx.lineTo(l.x, l.y);
      ctx.lineTo(notch.x, notch.y);
      ctx.lineTo(r.x, r.y);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'round': {
      // Filled triangle with soft corners.
      ctx.save();
      ctx.lineJoin = 'round';
      ctx.lineWidth = Math.max(2, width * 0.6);
      const t = at(ctx.lineWidth / 2, 0);
      const l = at(len - ctx.lineWidth / 2, len * 0.42);
      const r = at(len - ctx.lineWidth / 2, -len * 0.42);
      ctx.beginPath();
      ctx.moveTo(t.x, t.y);
      ctx.lineTo(l.x, l.y);
      ctx.lineTo(r.x, r.y);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
      break;
    }
    case 'twin':
      tri(len * 0.55, 0, len * 0.3);
      tri(len, len * 0.45, len * 0.3);
      break;
    case 'open':
      vee(len, 0, len * 0.55, width);
      break;
    case 'chevron':
      vee(len, 0, len * 0.6, Math.max(width * 1.35, 3));
      break;
    case 'twin-open':
      vee(len * 0.6, 0, len * 0.35, Math.max(width, 2));
      vee(len, len * 0.4, len * 0.35, Math.max(width, 2));
      break;
    case 'stealth': {
      // Swept-back barbs with concave edges.
      const l = at(len, len * 0.6);
      const r = at(len, -len * 0.6);
      const notch = at(len * 0.62, 0);
      const c1 = at(len * 0.55, len * 0.24);
      const c2 = at(len * 0.55, -len * 0.24);
      ctx.beginPath();
      ctx.moveTo(tip.x, tip.y);
      ctx.quadraticCurveTo(c1.x, c1.y, l.x, l.y);
      ctx.lineTo(notch.x, notch.y);
      ctx.lineTo(r.x, r.y);
      ctx.quadraticCurveTo(c2.x, c2.y, tip.x, tip.y);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'triple': {
      const lw = Math.max(2, Math.min(width, len * 0.12));
      ctx.save();
      ctx.lineCap = 'butt';
      ctx.lineJoin = 'miter';
      for (let i = 0; i < 3; i++) vee(len * (0.4 + i * 0.3), len * i * 0.3, len * 0.3, lw);
      ctx.restore();
      break;
    }
    case 'curved': {
      // Two bowed chevrons, the front one at the tip.
      const lw = Math.max(3, Math.min(width * 1.2, len * 0.14));
      ctx.save();
      ctx.setLineDash([]);
      ctx.lineWidth = lw;
      ctx.lineCap = 'round';
      for (const off of [0, len * 0.48]) {
        const t = at(off, 0);
        const l = at(off + len * 0.58, len * 0.45);
        const r = at(off + len * 0.58, -len * 0.45);
        const cl = at(off + len * 0.12, len * 0.38);
        const cr = at(off + len * 0.12, -len * 0.38);
        ctx.beginPath();
        ctx.moveTo(l.x, l.y);
        ctx.quadraticCurveTo(cl.x, cl.y, t.x, t.y);
        ctx.quadraticCurveTo(cr.x, cr.y, r.x, r.y);
        ctx.stroke();
      }
      ctx.restore();
      break;
    }
    case 'echo': {
      // A small open head with a wide bowed chevron around it.
      const lw = Math.max(2, Math.min(width, len * 0.13));
      vee(len * 0.75, len * 0.3, len * 0.3, lw);
      const l = at(len, len * 0.62);
      const r = at(len, -len * 0.62);
      const cl = at(len * 0.15, len * 0.45);
      const cr = at(len * 0.15, -len * 0.45);
      ctx.save();
      ctx.setLineDash([]);
      ctx.lineWidth = lw;
      ctx.beginPath();
      ctx.moveTo(l.x, l.y);
      ctx.quadraticCurveTo(cl.x, cl.y, tip.x, tip.y);
      ctx.quadraticCurveTo(cr.x, cr.y, r.x, r.y);
      ctx.stroke();
      ctx.restore();
      break;
    }
    case 'framed': {
      // An open head inside a pointed frame.
      const lw = Math.max(2, Math.min(width * 0.8, len * 0.11));
      vee(len * 0.62, len * 0.28, len * 0.24, lw);
      const top = at(len * 0.5, len * 0.5);
      const bottom = at(len * 0.5, -len * 0.5);
      const back = at(len, 0);
      ctx.save();
      ctx.setLineDash([]);
      ctx.lineWidth = lw;
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(tip.x, tip.y);
      ctx.lineTo(top.x, top.y);
      ctx.lineTo(back.x, back.y);
      ctx.lineTo(bottom.x, bottom.y);
      ctx.closePath();
      ctx.stroke();
      ctx.restore();
      break;
    }
    case 'harpoon': {
      const l = at(len, len * 0.55);
      ctx.save();
      ctx.lineWidth = width;
      ctx.beginPath();
      ctx.moveTo(l.x, l.y);
      ctx.lineTo(tip.x, tip.y);
      ctx.stroke();
      ctx.restore();
      break;
    }
    case 'diamond': {
      const back = at(len, 0);
      const l = at(len / 2, len * 0.35);
      const r = at(len / 2, -len * 0.35);
      ctx.beginPath();
      ctx.moveTo(tip.x, tip.y);
      ctx.lineTo(l.x, l.y);
      ctx.lineTo(back.x, back.y);
      ctx.lineTo(r.x, r.y);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'circle': {
      const c = at(len, 0);
      ctx.beginPath();
      ctx.arc(c.x, c.y, len, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'ring': {
      const c = at(len, 0);
      ctx.save();
      ctx.lineWidth = Math.max(1.5, width * 0.5);
      ctx.beginPath();
      ctx.arc(c.x, c.y, len - ctx.lineWidth / 2, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
      break;
    }
    case 'square': {
      const c = at(len, 0);
      ctx.save();
      ctx.translate(c.x, c.y);
      ctx.rotate(angle);
      ctx.fillRect(-len, -len, len * 2, len * 2);
      ctx.restore();
      break;
    }
    case 'bar': {
      const l = at(0, len * 1.6);
      const r = at(0, -len * 1.6);
      ctx.save();
      ctx.lineWidth = Math.max(width, 2);
      ctx.beginPath();
      ctx.moveTo(l.x, l.y);
      ctx.lineTo(r.x, r.y);
      ctx.stroke();
      ctx.restore();
      break;
    }
    case 'feather': {
      // Fletching: angled vanes behind the tip (best used at the start of an arrow).
      ctx.save();
      ctx.lineWidth = Math.max(1.5, width * 0.6);
      for (let i = 0; i < 3; i++) {
        const b = (len / 3) * i;
        const s1 = at(b, 0);
        const l = at(b - len * 0.35, len * 0.4);
        const r = at(b - len * 0.35, -len * 0.4);
        ctx.beginPath();
        ctx.moveTo(l.x, l.y);
        ctx.lineTo(s1.x, s1.y);
        ctx.lineTo(r.x, r.y);
        ctx.stroke();
      }
      ctx.restore();
      break;
    }
  }
}

/** Polygon around a polyline with a varying half width (used by block / tapered bodies). */
function ribbon(path: Point[], halfWidth: (t: number) => number): { left: Point[]; right: Point[] } {
  const total = pathLength(path) || 1;
  const left: Point[] = [];
  const right: Point[] = [];
  let acc = 0;
  for (let i = 0; i < path.length; i++) {
    const p = path[i]!;
    if (i > 0) acc += Math.hypot(p.x - path[i - 1]!.x, p.y - path[i - 1]!.y);
    const a = path[Math.max(0, i - 1)]!;
    const b = path[Math.min(path.length - 1, i + 1)]!;
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const nx = -(b.y - a.y) / len;
    const ny = (b.x - a.x) / len;
    const hw = halfWidth(acc / total);
    left.push({ x: p.x + nx * hw, y: p.y + ny * hw });
    right.push({ x: p.x - nx * hw, y: p.y - ny * hw });
  }
  return { left, right };
}

/** Offsets a polyline sideways by `d`. */
function offsetPath(path: Point[], d: number): Point[] {
  return ribbon(path, () => d).left;
}

function strokePath(ctx: Ctx2D, pts: Point[]): void {
  ctx.beginPath();
  pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
  ctx.stroke();
}

/**
 * "Pointer" arrow: one filled shape — a sharp tail that widens towards a large head whose barbs reach
 * back past the end of the body (a notch on each side). Corners are rounded by stroking the outline.
 */
export function pointerOutline(path: Point[], width: number): Point[] {
  const w = Math.max(2, width);
  const total = pathLength(path);
  // Proportions of a classic "pointer": the head is about twice as long as it is half-wide; the body
  // widens from a thin rounded tail to about half the head's width where it meets the head.
  const headHalf = Math.max(w * 3, 12);
  const headLen = Math.min(headHalf * 1.9, total * 0.5);
  const bodyEnd = headHalf * 0.52;
  const tail = Math.max(0.75, headHalf * 0.09);
  // The body ends exactly at the head's straight back edge, and the barbs stick out beyond it on
  // both sides — so the outline never crosses itself (crossing left white triangles in the fill).
  const shaft = trim(path, headLen, 'end');
  const { left, right } = ribbon(shaft, (t) => tail + (bodyEnd - tail) * t);
  const tip = path[path.length - 1]!;
  const base = shaft[shaft.length - 1] ?? pointAlong(path, headLen, 'end');
  const angle = Math.atan2(tip.y - base.y, tip.x - base.x);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const barb = (side: number) => ({ x: base.x - side * sin, y: base.y + side * cos });
  // The body ends exactly on the head's back edge (on a curve the body's own end edge is turned a
  // little): drop body points past that edge and finish on it, so nothing crosses.
  const behind = (p: Point) => (p.x - base.x) * cos + (p.y - base.y) * sin < -0.01;
  const l = left.slice(0, -1).filter(behind);
  const r = right.slice(0, -1).filter(behind);
  // (ribbon's `left` is on the positive side of the direction, like `barb(+…)`.)
  return [...l, barb(bodyEnd), barb(headHalf), tip, barb(-headHalf), barb(-bodyEnd), ...[...r].reverse()];
}

/** Block arrows: one filled (or outlined) polygon made of shaft and heads. */
function blockOutline(a: LineAnnotation, path: Point[]): Point[] {
  const hw = Math.max(3, a.width * 0.75);
  const headLen = Math.max(hw * 3.2, 16);
  const headHalf = hw * 2.4;
  const total = pathLength(path);
  const startHead = a.headStart !== 'none';
  const endHead = a.headEnd !== 'none' || !startHead;
  const sh = Math.min(headLen, total * 0.45);
  let shaft = path;
  if (endHead) shaft = trim(shaft, sh, 'end');
  if (startHead) shaft = trim(shaft, sh, 'start');
  const { left, right } = ribbon(shaft, () => hw);
  const out: Point[] = [];
  const headPts = (tip: Point, angle: number): Point[] => {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const at = (back: number, side: number) => ({ x: tip.x - back * cos - side * sin, y: tip.y - back * sin + side * cos });
    return [at(sh, headHalf), tip, at(sh, -headHalf)];
  };
  if (startHead) {
    const h = headPts(path[0]!, frameAt(path, 0).angle + Math.PI);
    out.push(h[0]!, h[1]!, h[2]!);
  } else if (a.body === 'notched') {
    // A V cut into the tail.
    out.push(pointAlong(shaft, Math.min(hw * 2, pathLength(shaft) * 0.4), 'start'));
  }
  out.push(...left);
  if (endHead) {
    const h = headPts(path[path.length - 1]!, endAngle(a, 'end'));
    out.push(h[2]!, h[1]!, h[0]!);
  }
  out.push(...[...right].reverse());
  return out;
}

export function renderLine(ctx: Ctx2D, a: LineAnnotation): void {
  ctx.save();
  ctx.globalAlpha = a.opacity;
  ctx.strokeStyle = a.color;
  ctx.fillStyle = a.color;
  ctx.lineWidth = a.width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const path = samplePath(a);
  const body = a.body ?? 'line';

  if (body === 'pointer') {
    const poly = pointerOutline(path, a.width);
    ctx.beginPath();
    poly.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    ctx.closePath();
    ctx.fill();
    // Rounded corners (tail, barbs, tip).
    ctx.lineWidth = Math.max(2, a.width * 0.35);
    ctx.stroke();
    if (a.outline && a.outline !== 'transparent') {
      ctx.strokeStyle = a.outline;
      ctx.lineWidth = Math.max(2, a.width * 0.12);
      ctx.stroke();
    }
    ctx.restore();
    return;
  }

  if (body === 'block' || body === 'outline' || body === 'notched') {
    const poly = blockOutline(a, path);
    ctx.beginPath();
    poly.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    ctx.closePath();
    if (body === 'block' || body === 'notched') {
      ctx.fill();
      if (a.outline && a.outline !== 'transparent') {
        ctx.strokeStyle = a.outline;
        ctx.lineWidth = Math.max(2, a.width * 0.12);
        ctx.stroke();
      }
    } else {
      ctx.lineWidth = Math.max(1.5, a.width * 0.3);
      ctx.setLineDash(dashPattern(a.dash ?? 'solid', ctx.lineWidth));
      ctx.stroke();
    }
    ctx.restore();
    return;
  }

  const startAngle = endAngle(a, 'start');
  const finishAngle = endAngle(a, 'end');
  const shaft = trim(trim(path, shaftInset(a.headStart, a.width), 'start'), shaftInset(a.headEnd, a.width), 'end');

  switch (body) {
    case 'tapered': {
      const { left, right } = ribbon(shaft, (t) => Math.max(0.5, a.width * (0.08 + 0.5 * t)));
      ctx.beginPath();
      [...left, ...[...right].reverse()].forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'double': {
      const gap = Math.max(2, a.width * 0.55);
      ctx.lineWidth = Math.max(1, a.width * 0.4);
      ctx.setLineDash(dashPattern(a.dash ?? 'solid', ctx.lineWidth));
      const inner = trim(trim(shaft, a.width * 0.6, 'end'), a.headStart !== 'none' ? a.width * 0.6 : 0, 'start');
      strokePath(ctx, offsetPath(inner, gap));
      strokePath(ctx, offsetPath(inner, -gap));
      ctx.setLineDash([]);
      ctx.lineWidth = a.width;
      break;
    }
    case 'chevrons': {
      // A trail of chevrons along the path.
      const total = pathLength(shaft);
      const step = Math.max(10, a.width * 2.4);
      const size = Math.max(6, a.width * 1.3);
      ctx.lineWidth = Math.max(1.5, a.width * 0.55);
      ctx.lineCap = 'butt';
      ctx.lineJoin = 'miter';
      for (let d = size; d <= total; d += step) {
        const { p, angle } = frameAt(shaft, d);
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        const at = (back: number, side: number) => ({ x: p.x - back * cos - side * sin, y: p.y - back * sin + side * cos });
        const l = at(size, size);
        const r = at(size, -size);
        ctx.beginPath();
        ctx.moveTo(l.x, l.y);
        ctx.lineTo(p.x, p.y);
        ctx.lineTo(r.x, r.y);
        ctx.stroke();
      }
      ctx.lineWidth = a.width;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      break;
    }
    case 'triple': {
      const gap = Math.max(2.5, a.width * 0.8);
      ctx.lineWidth = Math.max(1, a.width * 0.4);
      ctx.setLineDash(dashPattern(a.dash ?? 'solid', ctx.lineWidth));
      const inner = trim(trim(shaft, a.width * 0.6, 'end'), a.headStart !== 'none' ? a.width * 0.6 : 0, 'start');
      for (const d of [-gap, 0, gap]) strokePath(ctx, d ? offsetPath(inner, d) : inner);
      ctx.setLineDash([]);
      ctx.lineWidth = a.width;
      break;
    }
    case 'dots':
    case 'squares':
    case 'bars': {
      // A trail of round dots, squares or upright bars ("• • • >", "▪ ▪ ▶", "▮▮▶").
      const total = pathLength(shaft);
      const size = Math.max(3, a.width * (body === 'dots' ? 1.25 : 1.2));
      const step = body === 'bars' ? Math.max(6, a.width * 1.9) : Math.max(6, size * 1.9);
      for (let d = size / 2; d <= total - size / 2 + 0.01; d += step) {
        const { p, angle } = frameAt(shaft, d);
        ctx.beginPath();
        if (body === 'dots') ctx.arc(p.x, p.y, size / 2, 0, Math.PI * 2);
        else {
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(angle);
          if (body === 'squares') ctx.rect(-size / 2, -size / 2, size, size);
          else ctx.rect(-a.width * 0.45, -a.width * 1.3, a.width * 0.9, a.width * 2.6);
          ctx.restore();
        }
        ctx.fill();
      }
      break;
    }
    case 'loop': {
      strokePath(ctx, loopPath(shaft, a.width));
      break;
    }
    case 'dash-tail': {
      // Dashes that turn into a solid line near the head ("- - ——>").
      const total = pathLength(shaft);
      const [tail, head] = splitAt(shaft, total * 0.55);
      ctx.lineCap = 'butt';
      ctx.setLineDash([a.width * 1.6, a.width * 1.2]);
      strokePath(ctx, tail);
      ctx.setLineDash([]);
      ctx.lineCap = 'round';
      strokePath(ctx, head);
      break;
    }
    default:
      ctx.lineCap = a.dash === 'dashed' ? 'butt' : 'round';
      ctx.setLineDash(dashPattern(a.dash ?? 'solid', a.width));
      strokePath(ctx, shaft);
      ctx.setLineDash([]);
      ctx.lineCap = 'round';
  }

  drawHead(ctx, path[path.length - 1]!, finishAngle, a.headEnd, a.width);
  drawHead(ctx, path[0]!, startAngle, a.headStart, a.width);
  ctx.restore();
}

/** Loop radius of the 'loop' body. */
function loopRadius(width: number, total: number): number {
  return Math.min(Math.max(9, width * 3.2), total * 0.18);
}

/**
 * The shaft with one smooth cursive loop in the middle, curling up (for a rightward line) and
 * back over itself: forward f(t) = D(t - ½) + R·sin 2πt, up g(t) = R(1 − cos 2πt).
 */
export function loopPath(shaft: Point[], width: number): Point[] {
  const total = pathLength(shaft);
  const R = loopRadius(width, total);
  const D = R * 2.2;
  if (total < D + R * 4) return shaft;
  const [first] = splitAt(shaft, total / 2 - D / 2);
  const [, second] = splitAt(shaft, total / 2 + D / 2);
  const { p, angle } = frameAt(shaft, total / 2);
  const fx = Math.cos(angle);
  const fy = Math.sin(angle);
  const ux = Math.sin(angle);
  const uy = -Math.cos(angle);
  const loop: Point[] = [];
  for (let k = 1; k < 48; k++) {
    const t = k / 48;
    const f = D * (t - 0.5) + R * 1.15 * Math.sin(Math.PI * 2 * t);
    const g = R * (1 - Math.cos(Math.PI * 2 * t));
    loop.push({ x: p.x + fx * f + ux * g, y: p.y + fy * f + uy * g });
  }
  return [...first, ...loop, ...second];
}

export function lineBounds(a: LineAnnotation): Rect {
  const pts = samplePath(a);
  const block = a.body === 'block' || a.body === 'outline' || a.body === 'notched';
  const loop = a.body === 'loop' ? loopRadius(a.width, pathLength(pts)) * 2 + a.width : 0;
  const pad = Math.max(headLength(a.headStart, a.width), headLength(a.headEnd, a.width), a.width * (a.body === 'bars' ? 1.4 : 1), block ? a.width * 2 : 0, loop);
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const x = Math.min(...xs) - pad;
  const y = Math.min(...ys) - pad;
  return { x, y, w: Math.max(...xs) - Math.min(...xs) + pad * 2, h: Math.max(...ys) - Math.min(...ys) + pad * 2 };
}

export function hitLine(a: LineAnnotation, p: Point, tol: number): boolean {
  const block = a.body === 'block' || a.body === 'outline' || a.body === 'notched';
  const reach = (block ? a.width * 0.9 : a.width / 2) + tol + 3;
  const pts = a.body === 'loop' ? loopPath(samplePath(a), a.width) : samplePath(a);
  for (let i = 1; i < pts.length; i++) if (distToSegment(p, pts[i - 1]!, pts[i]!) <= reach) return true;
  return false;
}

/**
 * Default bend points, evenly spaced along the line. By default they sit on the straight line (the
 * line keeps its shape; the user drags a point to bend it). With `curved` (the curved presets) they
 * are offset to alternate sides: one bend is an arc, two an S-curve, more a wave.
 */
export function defaultBends(a: Pick<LineAnnotation, 'x1' | 'y1' | 'x2' | 'y2'>, count: number, curved = false): Point[] {
  const n = Math.max(0, Math.min(MAX_BENDS, Math.round(count)));
  const dx = a.x2 - a.x1;
  const dy = a.y2 - a.y1;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  const amp = curved ? len * (n === 1 ? 0.25 : n <= 3 ? 0.16 : 0.1) : 0;
  return Array.from({ length: n }, (_, i) => {
    const t = (i + 1) / (n + 1);
    const side = i % 2 === 0 ? 1 : -1;
    return { x: a.x1 + dx * t + nx * amp * side, y: a.y1 + dy * t + ny * amp * side };
  });
}

/** Snaps `end` so the segment from `start` is at a multiple of 45°. */
export function snap45(start: Point, end: Point): Point {
  const ang = Math.round(Math.atan2(end.y - start.y, end.x - start.x) / (Math.PI / 4)) * (Math.PI / 4);
  const len = Math.hypot(end.x - start.x, end.y - start.y);
  return { x: start.x + Math.cos(ang) * len, y: start.y + Math.sin(ang) * len };
}

/* ------------------------------ numbered marker ------------------------------ */
/** Marker label for a count: 1, A, a or i (roman). */
export function markerLabel(n: number, counter: MarkerAnnotation['counter'] = 'number'): string {
  if (counter === 'step') return `Step ${n}`;
  if (counter === 'upper' || counter === 'lower') {
    let s = '';
    let k = n;
    while (k > 0) {
      k -= 1;
      s = String.fromCharCode(65 + (k % 26)) + s;
      k = Math.floor(k / 26);
    }
    return counter === 'lower' ? s.toLowerCase() : s;
  }
  if (counter === 'roman') {
    const map: Array<[number, string]> = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
    let k = Math.max(1, Math.min(3999, n));
    let out = '';
    for (const [v, sym] of map) while (k >= v) { out += sym; k -= v; }
    return out.toLowerCase();
  }
  return String(n);
}

/** Grid row of the heart's centre (the label's middle). */
const HEART_CY = 10.4;

/** Where the label's centre goes, relative to the marker's anchor (fraction of the radius). */
const LABEL_OFFSET: Partial<Record<NonNullable<MarkerAnnotation['shape']>, [number, number]>> = {
  tag: [-0.22, 0],
  shield: [0, 0.08],
  heart: [0, -0.04],
  triangle: [0, 0.22],
  chevron: [-0.05, 0],
  'ribbon-curved': [0, -0.12],
  stack: [-0.06, -0.06],
};
/** How large the label may be in each shape (fraction of the marker size for one character). */
const LABEL_FIT: Partial<Record<NonNullable<MarkerAnnotation['shape']>, number>> = {
  star: 0.4, heart: 0.42, diamond: 0.44, pin: 0.48, triangle: 0.4, speech: 0.48, cloud: 0.42, 'pin-ring': 0.48, ring: 0.44, brush: 0.5, blob: 0.5, ribbon: 0.46, 'ribbon-curved': 0.42, rosette: 0.44,
};
/** Shapes wide enough for "Step 1" labels. */
const WIDE_MARKERS = new Set<string>(['chevron', 'ribbon', 'ribbon-curved', 'parallelogram']);

/** Rounded box with a pointer on its bottom edge (one outline, so the border has no seam). */
function boxWithTail(ctx: Ctx2D, l: number, t: number, w: number, h: number, rad: number, tx1: number, tx2: number, tip: Point): void {
  const r = Math.min(rad, w / 2, h / 2);
  const b = t + h;
  ctx.moveTo(l + r, t);
  ctx.lineTo(l + w - r, t);
  ctx.arcTo(l + w, t, l + w, t + r, r);
  ctx.lineTo(l + w, b - r);
  ctx.arcTo(l + w, b, l + w - r, b, r);
  ctx.lineTo(tx2, b);
  ctx.lineTo(tip.x, tip.y);
  ctx.lineTo(tx1, b);
  ctx.lineTo(l + r, b);
  ctx.arcTo(l, b, l, b - r, r);
  ctx.lineTo(l, t + r);
  ctx.arcTo(l, t, l + r, t, r);
}

function bumpyCircle(ctx: Ctx2D, x: number, y: number, r: number, n: number, k: number, wobble?: (i: number) => number): void {
  const pts: Array<[number, number]> = Array.from({ length: n }, (_, i) => {
    const t = -Math.PI / 2 + ((Math.PI * 2) / n) * i;
    const rr = r * (wobble ? wobble(i) : 1);
    return [x + Math.cos(t) * rr, y + Math.sin(t) * rr];
  });
  ctx.moveTo(pts[0]![0], pts[0]![1]);
  for (let i = 0; i < n; i++) {
    const a = pts[i]!;
    const b = pts[(i + 1) % n]!;
    const mx = (a[0] + b[0]) / 2;
    const my = (a[1] + b[1]) / 2;
    ctx.quadraticCurveTo(x + (mx - x) * k, y + (my - y) * k, b[0], b[1]);
  }
}

function markerPath(ctx: Ctx2D, shape: NonNullable<MarkerAnnotation['shape']>, x: number, y: number, r: number): void {
  ctx.beginPath();
  const poly = (pts: Array<[number, number]>) => pts.forEach(([px, py], i) => (i ? ctx.lineTo(x + px, y + py) : ctx.moveTo(x + px, y + py)));
  switch (shape) {
    case 'square':
      ctx.rect(x - r * 0.9, y - r * 0.9, r * 1.8, r * 1.8);
      break;
    case 'rounded':
      ctx.roundRect(x - r * 0.92, y - r * 0.92, r * 1.84, r * 1.84, r * 0.45);
      break;
    case 'diamond':
      poly([[0, -r * 1.12], [r * 1.12, 0], [0, r * 1.12], [-r * 1.12, 0]]);
      break;
    case 'hexagon':
      poly(Array.from({ length: 6 }, (_, i) => [Math.cos((Math.PI / 3) * i) * r * 1.05, Math.sin((Math.PI / 3) * i) * r * 1.05] as [number, number]));
      break;
    case 'star': {
      const pts: Array<[number, number]> = [];
      for (let i = 0; i < 10; i++) {
        const rad = i % 2 === 0 ? r * 1.25 : r * 0.62;
        const t = -Math.PI / 2 + (Math.PI / 5) * i;
        pts.push([Math.cos(t) * rad, Math.sin(t) * rad]);
      }
      poly(pts);
      break;
    }
    case 'shield':
      ctx.moveTo(x - r * 0.95, y - r * 0.85);
      ctx.lineTo(x + r * 0.95, y - r * 0.85);
      ctx.lineTo(x + r * 0.95, y);
      ctx.quadraticCurveTo(x + r * 0.9, y + r * 0.85, x, y + r * 1.15);
      ctx.quadraticCurveTo(x - r * 0.9, y + r * 0.85, x - r * 0.95, y);
      break;
    case 'seal': {
      // Scalloped badge (14 soft bumps).
      const n = 14;
      const pts: Array<[number, number]> = Array.from({ length: n }, (_, i) => {
        const t = -Math.PI / 2 + ((Math.PI * 2) / n) * i;
        return [x + Math.cos(t) * r * 1.02, y + Math.sin(t) * r * 1.02];
      });
      ctx.moveTo(pts[0]![0], pts[0]![1]);
      for (let i = 0; i < n; i++) {
        const a = pts[i]!;
        const b = pts[(i + 1) % n]!;
        const mx = (a[0] + b[0]) / 2;
        const my = (a[1] + b[1]) / 2;
        const k = 1.16;
        ctx.quadraticCurveTo(x + (mx - x) * k, y + (my - y) * k, b[0], b[1]);
      }
      break;
    }
    case 'pin':
      // Teardrop: the round part holds the label, the point marks the spot just below.
      ctx.arc(x, y, r, Math.PI * 0.8, Math.PI * 0.2);
      ctx.lineTo(x, y + r * 1.75);
      break;
    case 'tag':
      poly([[-r * 1.15, -r * 0.8], [r * 0.6, -r * 0.8], [r * 1.25, 0], [r * 0.6, r * 0.8], [-r * 1.15, r * 0.8]]);
      break;
    case 'speech':
      // Round bubble with a tail at the bottom left, as one outline.
      ctx.arc(x, y, r, Math.PI * 0.86, Math.PI * 0.6);
      ctx.lineTo(x - r * 0.98, y + r * 1.2);
      break;
    case 'speech-square':
      boxWithTail(ctx, x - r * 0.95, y - r * 0.9, r * 1.9, r * 1.8, r * 0.35, x - r * 0.42, x - r * 0.02, { x: x - r * 0.35, y: y + r * 1.35 });
      break;
    case 'cloud':
      bumpyCircle(ctx, x, y, r * 0.9, 9, 1.32);
      break;
    case 'pin-ring':
      ctx.arc(x, y, r, Math.PI * 0.8, Math.PI * 0.2);
      ctx.lineTo(x, y + r * 1.75);
      break;
    case 'pin-square':
      boxWithTail(ctx, x - r * 0.95, y - r * 0.95, r * 1.9, r * 1.9, r * 0.28, x - r * 0.38, x + r * 0.38, { x, y: y + r * 1.5 });
      break;
    case 'chevron':
      poly([[-r * 1.3, -r * 0.78], [r * 0.95, -r * 0.78], [r * 1.5, 0], [r * 0.95, r * 0.78], [-r * 1.3, r * 0.78], [-r * 0.82, 0]]);
      break;
    case 'triangle':
      poly([[0, -r * 1.2], [r * 1.2, r * 0.9], [-r * 1.2, r * 0.9]]);
      break;
    case 'parallelogram':
      poly([[-r * 0.8, -r * 0.78], [r * 1.4, -r * 0.78], [r * 0.8, r * 0.78], [-r * 1.4, r * 0.78]]);
      break;
    case 'brush': {
      const w = [1.12, 0.92, 1.18, 0.88, 1.08, 0.95, 1.2, 0.86, 1.1, 0.93, 1.16, 0.9, 1.05, 0.97];
      bumpyCircle(ctx, x, y, r * 1.02, w.length, 1.08, (i) => w[i]!);
      break;
    }
    case 'blob': {
      const w = [1.05, 0.94, 1.08, 0.96, 1.04, 0.92];
      bumpyCircle(ctx, x, y, r * 0.98, w.length, 1.18, (i) => w[i]!);
      break;
    }
    case 'note':
      poly([[-r * 0.95, -r * 0.95], [r * 0.95, -r * 0.95], [r * 0.95, r * 0.6], [r * 0.6, r * 0.95], [-r * 0.95, r * 0.95]]);
      break;
    case 'folded':
      ctx.moveTo(x - r * 0.95 + r * 0.25, y - r * 0.95);
      ctx.lineTo(x + r * 0.95, y - r * 0.95);
      ctx.lineTo(x + r * 0.95, y + r * 0.55);
      ctx.lineTo(x + r * 0.55, y + r * 0.95);
      ctx.lineTo(x - r * 0.95, y + r * 0.95);
      ctx.lineTo(x - r * 0.95, y - r * 0.7);
      ctx.arcTo(x - r * 0.95, y - r * 0.95, x - r * 0.7, y - r * 0.95, r * 0.25);
      break;
    case 'stack':
      ctx.roundRect(x - r * 0.95, y - r * 0.95, r * 1.8, r * 1.8, r * 0.3);
      break;
    case 'rosette':
      bumpyCircle(ctx, x, y, r * 0.98, 16, 1.12);
      break;
    case 'ribbon':
      poly([[-r * 1.55, -r * 0.62], [r * 1.55, -r * 0.62], [r * 1.18, 0], [r * 1.55, r * 0.62], [-r * 1.55, r * 0.62], [-r * 1.18, 0]]);
      break;
    case 'ribbon-curved':
      ctx.moveTo(x - r * 1.6, y - r * 0.2);
      ctx.quadraticCurveTo(x, y - r * 1.15, x + r * 1.6, y - r * 0.2);
      ctx.lineTo(x + r * 1.35, y + r * 0.25);
      ctx.lineTo(x + r * 1.6, y + r * 0.7);
      ctx.quadraticCurveTo(x, y - r * 0.15, x - r * 1.6, y + r * 0.7);
      ctx.lineTo(x - r * 1.35, y + r * 0.25);
      break;
    case 'heart': {
      // Classic heart on a 20-unit grid (lobes 2..22 wide, 3..21.35 tall), centred on the lobes'
      // widest part so the label sits in the middle of the heart.
      const s = r / 8;
      const P = (u: number, v: number): [number, number] => [x + (u - 12) * s, y + (v - HEART_CY) * s];
      const m = (u: number, v: number) => ctx.moveTo(...P(u, v));
      const l = (u: number, v: number) => ctx.lineTo(...P(u, v));
      const c = (a: number, b: number, cc: number, d: number, e: number, f: number) => ctx.bezierCurveTo(...P(a, b), ...P(cc, d), ...P(e, f));
      m(12, 21.35);
      l(10.55, 20.03);
      c(5.4, 15.36, 2, 12.28, 2, 8.5);
      c(2, 5.42, 4.42, 3, 7.5, 3);
      c(9.24, 3, 10.91, 3.81, 12, 5.09);
      c(13.09, 3.81, 14.76, 3, 16.5, 3);
      c(19.58, 3, 22, 5.42, 22, 8.5);
      c(22, 12.28, 18.6, 15.36, 13.45, 20.04);
      l(12, 21.35);
      break;
    }
    default:
      ctx.arc(x, y, r, 0, Math.PI * 2);
  }
  ctx.closePath();
}

/** The colours a marker uses without custom colours: shape background and number colour. */
export function markerAutoColors(a: Pick<MarkerAnnotation, 'color' | 'style'>): { fill: string; text: string; border: string } {
  const style = a.style ?? 'filled';
  if (style === 'filled' || style === 'gradient') return { fill: a.color, text: isLight(a.color) ? '#202938' : '#FFFFFF', border: '#FFFFFF' };
  return { fill: '#FFFFFF', text: a.color, border: a.color };
}

export function renderMarker(ctx: Ctx2D, a: MarkerAnnotation): void {
  const r = a.size / 2;
  const shape = a.shape ?? 'circle';
  const style = a.style ?? 'filled';
  const label = markerLabel(a.n, a.counter);
  ctx.save();
  ctx.globalAlpha = a.opacity;
  const base = a.fillColor ?? a.color;
  if (a.label?.trim()) drawMarkerLabel(ctx, a);
  // Parts behind the shape: rosette ribbons, stacked layers.
  if (shape === 'rosette') {
    ctx.fillStyle = shade(base, -0.15);
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(a.x + s * r * 0.25, a.y + r * 0.5);
      ctx.lineTo(a.x + s * r * 0.85, a.y + r * 1.7);
      ctx.lineTo(a.x + s * r * 0.5, a.y + r * 1.45);
      ctx.lineTo(a.x + s * r * 0.3, a.y + r * 1.75);
      ctx.lineTo(a.x + s * r * -0.1, a.y + r * 0.6);
      ctx.closePath();
      ctx.fill();
    }
  }
  if (shape === 'stack' || style === 'layered') {
    ctx.save();
    ctx.translate(r * 0.16, r * 0.16);
    markerPath(ctx, shape, a.x, a.y, r);
    ctx.fillStyle = shade(base, 0.55);
    ctx.fill();
    ctx.lineWidth = Math.max(1, r * 0.07);
    ctx.strokeStyle = base;
    ctx.stroke();
    ctx.restore();
  }
  if (shape === 'pin-ring') {
    ctx.save();
    ctx.strokeStyle = base;
    ctx.lineWidth = Math.max(1, r * 0.09);
    for (const k of [0.55, 0.85]) {
      ctx.beginPath();
      ctx.ellipse(a.x, a.y + r * 1.75, r * k, r * k * 0.3, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }
  markerPath(ctx, shape, a.x, a.y, r);
  const auto = markerAutoColors(a);
  if (shape === 'ring') {
    // Progress ring: light track, coloured three-quarter arc, white centre.
    ctx.fillStyle = a.fillColor ?? '#FFFFFF';
    ctx.fill();
    ctx.lineWidth = Math.max(2, r * 0.2);
    ctx.strokeStyle = shade(a.color, 0.75);
    ctx.beginPath();
    ctx.arc(a.x, a.y, r * 0.9, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = a.borderColor ?? a.color;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(a.x, a.y, r * 0.9, -Math.PI / 2, Math.PI * 1.05);
    ctx.stroke();
  } else if (style === 'dashed') {
    ctx.fillStyle = a.fillColor ?? '#FFFFFF';
    ctx.fill();
    ctx.lineWidth = Math.max(1.5, r * 0.1);
    ctx.strokeStyle = a.borderColor ?? a.color;
    ctx.setLineDash([r * 0.28, r * 0.18]);
    ctx.stroke();
    ctx.setLineDash([]);
  } else if (style === 'layered') {
    ctx.shadowColor = alpha(shade(a.color, -0.4), 0.35);
    ctx.shadowBlur = r * 0.4;
    ctx.shadowOffsetY = r * 0.1;
    ctx.fillStyle = a.fillColor ?? '#FFFFFF';
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.lineWidth = Math.max(2, r * 0.2);
    ctx.strokeStyle = a.borderColor ?? a.color;
    ctx.lineJoin = 'round';
    ctx.stroke();
  } else if (a.fillColor !== undefined && style !== 'filled') {
    // Custom background for outline / soft markers: solid fill inside the coloured ring.
    ctx.fillStyle = a.fillColor;
    ctx.fill();
    ctx.lineWidth = Math.max(2, r * (style === 'soft' ? 0.08 : 0.16));
    ctx.strokeStyle = a.borderColor ?? a.color;
    ctx.lineJoin = 'round';
    ctx.stroke();
  } else if (style === 'gradient') {
    // Premium glossy look: light-to-deep gradient, soft drop shadow and a shine on top.
    const base = a.fillColor ?? a.color;
    const top = a.y - r * (shape === 'pin' ? 1 : 1.1);
    const g = ctx.createLinearGradient(a.x, top, a.x, a.y + r * (shape === 'pin' ? 1.75 : 1.1));
    g.addColorStop(0, shade(base, 0.32));
    g.addColorStop(0.55, base);
    g.addColorStop(1, shade(base, -0.22));
    ctx.shadowColor = alpha(shade(base, -0.4), 0.45);
    ctx.shadowBlur = r * 0.45;
    ctx.shadowOffsetY = r * 0.14;
    ctx.fillStyle = g;
    ctx.fill();
    ctx.shadowColor = 'transparent';
    if (a.borderColor) {
      ctx.lineWidth = Math.max(1.5, r * 0.1);
      ctx.strokeStyle = a.borderColor;
      ctx.lineJoin = 'round';
      ctx.stroke();
    }
    ctx.save();
    ctx.clip();
    const shine = ctx.createLinearGradient(a.x, a.y - r, a.x, a.y);
    shine.addColorStop(0, 'rgba(255,255,255,0.45)');
    shine.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = shine;
    ctx.beginPath();
    ctx.ellipse(a.x, a.y - r * 0.45, r * 0.72, r * 0.48, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  } else if (style === 'filled') {
    ctx.shadowColor = 'rgba(0,0,0,0.25)';
    ctx.shadowBlur = r * 0.25;
    ctx.shadowOffsetY = r * 0.06;
    ctx.fillStyle = a.fillColor ?? a.color;
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.lineWidth = Math.max(1.5, r * 0.12);
    ctx.strokeStyle = a.borderColor ?? '#fff';
    ctx.lineJoin = 'round';
    ctx.stroke();
  } else if (style === 'soft') {
    ctx.fillStyle = a.color;
    ctx.globalAlpha = a.opacity * 0.2;
    ctx.fill();
    ctx.globalAlpha = a.opacity;
    ctx.lineWidth = Math.max(1, r * 0.08);
    ctx.strokeStyle = a.borderColor ?? a.color;
    ctx.stroke();
  } else {
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.lineWidth = Math.max(2, r * 0.16);
    ctx.strokeStyle = a.borderColor ?? a.color;
    ctx.lineJoin = 'round';
    ctx.stroke();
  }
  // Details on top: sticky-note clip, folded corner.
  if (shape === 'note' || shape === 'folded') {
    ctx.save();
    ctx.fillStyle = shade(base, -0.2);
    ctx.beginPath();
    if (shape === 'note') {
      ctx.moveTo(a.x + r * 0.95, a.y + r * 0.6);
      ctx.lineTo(a.x + r * 0.6, a.y + r * 0.6);
      ctx.lineTo(a.x + r * 0.6, a.y + r * 0.95);
    } else {
      ctx.moveTo(a.x + r * 0.95, a.y + r * 0.55);
      ctx.lineTo(a.x + r * 0.55, a.y + r * 0.55);
      ctx.lineTo(a.x + r * 0.55, a.y + r * 0.95);
    }
    ctx.closePath();
    ctx.fill();
    if (shape === 'note') {
      ctx.strokeStyle = '#6B7280';
      ctx.lineWidth = Math.max(1, r * 0.08);
      ctx.beginPath();
      ctx.roundRect(a.x - r * 0.1, a.y - r * 1.25, r * 0.22, r * 0.62, r * 0.11);
      ctx.stroke();
    }
    ctx.restore();
  }
  const light = style === 'dashed' || style === 'layered' || shape === 'ring';
  ctx.fillStyle = a.textColor ?? (light ? a.color : auto.text);
  const one = (LABEL_FIT[shape] ?? 0.5) * (WIDE_MARKERS.has(shape) && label.length > 2 ? 1.5 : 1);
  const fit = label.length > 4 ? one * 0.5 : label.length > 2 ? one * 0.68 : label.length > 1 ? one * 0.84 : one;
  ctx.font = `700 ${Math.round(a.size * fit)}px Inter Variable, Inter, Segoe UI, sans-serif`;
  const [ox, oy] = LABEL_OFFSET[shape] ?? [0, 0];
  const at = centredText(ctx, label, a.x + r * ox, a.y + r * oy);
  ctx.fillText(label, at.x, at.y);
  ctx.restore();
}

/**
 * Draw position that puts the ink of `text` exactly at (cx, cy). Glyph boxes ("middle" baseline,
 * advance widths) are not centred on the ink, which left numbers sitting off-centre.
 */
export function centredText(ctx: Ctx2D, text: string, cx: number, cy: number): Point {
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  const m = ctx.measureText(text);
  const left = m.actualBoundingBoxLeft;
  const right = m.actualBoundingBoxRight;
  const asc = m.actualBoundingBoxAscent;
  const desc = m.actualBoundingBoxDescent;
  if (![left, right, asc, desc].every((n) => typeof n === 'number' && Number.isFinite(n)) || asc + desc <= 0) {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    return { x: cx, y: cy };
  }
  return { x: cx - (right - left) / 2, y: cy + (asc - desc) / 2 };
}

/** Text label beside the marker: where it sits and how big it is. */
function markerLabelBox(a: MarkerAnnotation): { x: number; y: number; w: number; h: number; font: string } | null {
  const text = a.label?.trim();
  if (!text) return null;
  const r = a.size / 2;
  const h = r * 1.35;
  const font = `600 ${Math.round(r * 0.62)}px Inter Variable, Inter, Segoe UI, sans-serif`;
  const m = getMeasureContext();
  let tw = text.length * r * 0.36;
  if (m) {
    m.save();
    m.font = font;
    tw = m.measureText(text).width;
    m.restore();
  }
  const x = a.x + r * 0.35;
  return { x, y: a.y - h / 2, w: tw + r * 1.15 + r * 0.6, h, font };
}

function drawMarkerLabel(ctx: Ctx2D, a: MarkerAnnotation): void {
  const b = markerLabelBox(a);
  if (!b) return;
  const style = a.labelStyle ?? 'pill';
  const base = a.fillColor ?? a.color;
  ctx.save();
  ctx.beginPath();
  if (style === 'slant') {
    const s = b.h * 0.3;
    ctx.moveTo(b.x + s, b.y);
    ctx.lineTo(b.x + b.w + s, b.y);
    ctx.lineTo(b.x + b.w - s, b.y + b.h);
    ctx.lineTo(b.x - s, b.y + b.h);
    ctx.closePath();
  } else ctx.roundRect(b.x, b.y, b.w, b.h, style === 'tag' ? b.h * 0.18 : b.h / 2);
  ctx.fillStyle = style === 'slant' ? '#FFFFFF' : shade(base, 0.86);
  ctx.fill();
  ctx.lineWidth = Math.max(1, b.h * 0.05);
  ctx.strokeStyle = shade(base, style === 'slant' ? 0 : 0.45);
  ctx.stroke();
  ctx.fillStyle = shade(base, -0.35);
  ctx.font = b.font;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(a.label!.trim(), b.x + a.size / 2 * 1.15, b.y + b.h / 2 + 0.5);
  ctx.restore();
}

export function markerBounds(a: MarkerAnnotation): Rect {
  const own = markerShapeBounds(a);
  const lb = markerLabelBox(a);
  if (!lb) return own;
  const x = Math.min(own.x, lb.x - lb.h * 0.3);
  const y = Math.min(own.y, lb.y);
  return { x, y, w: Math.max(own.x + own.w, lb.x + lb.w + lb.h * 0.3) - x, h: Math.max(own.y + own.h, lb.y + lb.h) - y };
}

const SHAPE_EXTENT: Partial<Record<string, [number, number, number, number]>> = {
  // left, top, right, bottom (multiples of the radius)
  speech: [1.05, 1, 1, 1.25], 'speech-square': [0.95, 0.9, 0.95, 1.35], cloud: [1.15, 1.15, 1.15, 1.15], 'pin-ring': [1, 1, 1, 2.05],
  'pin-square': [0.95, 0.95, 0.95, 1.5], chevron: [1.3, 0.78, 1.5, 0.78], triangle: [1.2, 1.2, 1.2, 0.9], parallelogram: [1.4, 0.78, 1.4, 0.78],
  brush: [1.3, 1.3, 1.3, 1.3], blob: [1.2, 1.2, 1.2, 1.2], note: [0.95, 1.3, 0.95, 0.95], folded: [0.95, 0.95, 0.95, 0.95], stack: [0.95, 0.95, 1.05, 1.05],
  rosette: [1.15, 1.15, 1.15, 1.8], ribbon: [1.55, 0.62, 1.55, 0.62], 'ribbon-curved': [1.6, 0.72, 1.6, 0.75], ring: [1, 1, 1, 1],
};

function markerShapeBounds(a: MarkerAnnotation): Rect {
  const r = a.size / 2;
  const ext = SHAPE_EXTENT[a.shape ?? ''];
  if (ext) {
    const lay = a.style === 'layered' ? 0.16 : 0;
    return { x: a.x - r * ext[0], y: a.y - r * ext[1], w: r * (ext[0] + ext[2] + lay), h: r * (ext[1] + ext[3] + lay) };
  }
  const k = a.shape === 'star' ? 1.25 : a.shape === 'tag' ? 1.25 : a.shape === 'diamond' ? 1.12 : 1.05;
  if (a.shape === 'heart') {
    const s = r / 8;
    return { x: a.x - r * 1.25, y: a.y - (HEART_CY - 3) * s, w: r * 2.5, h: 18.35 * s };
  }
  const bottom = a.shape === 'pin' ? r * 1.75 : a.shape === 'shield' ? r * 1.15 : r * k;
  return { x: a.x - r * k, y: a.y - r * k, w: r * k * 2, h: r * k + bottom };
}

export function hitMarker(a: MarkerAnnotation, p: Point, tol: number): boolean {
  if (a.label?.trim() || SHAPE_EXTENT[a.shape ?? '']) return inRect(p, markerBounds(a), tol);
  return Math.hypot(p.x - a.x, p.y - a.y) <= a.size / 2 + tol;
}

/* ---------------------------------- stickers --------------------------------- */
const EMOJI_FONT = '"Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif';

function badgeMetrics(a: StickerAnnotation): { w: number; h: number; font: string; textW: number; iconW: number } {
  const style = a.badgeStyle ?? 'pill';
  const h = a.size * (style === 'burst' ? 0.78 : 0.55);
  const font = `800 ${Math.round(a.size * 0.55 * 0.52)}px Inter Variable, Inter, Segoe UI, sans-serif`;
  const m = getMeasureContext();
  let textW = a.glyph.length * h * 0.38;
  if (m) {
    m.save();
    m.font = font;
    textW = m.measureText(a.glyph).width;
    m.restore();
  }
  const iconW = a.badgeIcon ? a.size * 0.55 * 0.62 : 0;
  const pad = style === 'burst' ? h * 0.75 : h * 0.9;
  return { w: textW + iconW + pad, h, font, textW, iconW };
}

export function stickerBounds(a: StickerAnnotation): Rect {
  const edge = a.cutout ? stickerEdge(a) : 0;
  if (a.variant === 'badge') {
    const { w, h } = badgeMetrics(a);
    const tilt = a.badgeStyle === 'tilted' ? h * 0.25 : 0;
    return { x: a.x - w / 2 - edge, y: a.y - h / 2 - edge - tilt, w: w + edge * 2, h: h + edge * 2 + tilt * 2 };
  }
  return { x: a.x - a.size / 2 - edge, y: a.y - a.size / 2 - edge, w: a.size + edge * 2, h: a.size + edge * 2 };
}

function stickerEdge(a: StickerAnnotation): number {
  return Math.max(2, a.size * 0.06);
}

function drawBadge(ctx: Ctx2D, a: StickerAnnotation): void {
  const style = a.badgeStyle ?? 'pill';
  const { w, h, font, textW, iconW } = badgeMetrics(a);
  ctx.save();
  ctx.translate(a.x, a.y);
  if (style === 'tilted') ctx.rotate(-0.08);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.beginPath();
  if (style === 'burst') {
    const n = 14;
    for (let i = 0; i < n * 2; i++) {
      const t = (i / (n * 2)) * Math.PI * 2;
      const rx = (w / 2) * (i % 2 ? 0.86 : 1);
      const ry = (h / 2) * (i % 2 ? 0.8 : 1);
      ctx.lineTo(Math.cos(t) * rx, Math.sin(t) * ry);
    }
    ctx.closePath();
  } else if (style === 'tilted') {
    const s = h * 0.18;
    ctx.moveTo(-w / 2 + s, -h / 2);
    ctx.lineTo(w / 2, -h / 2);
    ctx.lineTo(w / 2 - s, h / 2);
    ctx.lineTo(-w / 2, h / 2);
    ctx.closePath();
  } else ctx.roundRect(-w / 2, -h / 2, w, h, h / 2);
  let text = isLight(a.color) ? '#202938' : '#fff';
  if (style === 'soft') {
    ctx.fillStyle = shade(a.color, 0.82);
    ctx.fill();
    text = shade(a.color, -0.25);
  } else if (style === 'outline') {
    ctx.fillStyle = '#FFFFFF';
    ctx.fill();
    ctx.lineWidth = Math.max(1.5, h * 0.08);
    ctx.strokeStyle = a.color;
    ctx.stroke();
    text = a.color;
  } else {
    ctx.shadowColor = 'rgba(0,0,0,0.25)';
    ctx.shadowBlur = h * 0.2;
    ctx.shadowOffsetY = h * 0.06;
    const g = ctx.createLinearGradient(0, -h / 2, 0, h / 2);
    g.addColorStop(0, shade(a.color, 0.18));
    g.addColorStop(1, shade(a.color, -0.1));
    ctx.fillStyle = g;
    ctx.fill();
    ctx.shadowColor = 'transparent';
  }
  const startX = -(textW + iconW) / 2;
  if (a.badgeIcon) {
    ctx.font = `${Math.round(iconW * 0.95)}px ${EMOJI_FONT}`;
    ctx.fillText(a.badgeIcon, startX + iconW / 2 - iconW * 0.08, h * 0.03);
  }
  ctx.fillStyle = text;
  ctx.font = font;
  ctx.fillText(a.glyph, startX + iconW + textW / 2, h * 0.04);
  ctx.restore();
}

function drawStickerArt(ctx: Ctx2D, a: StickerAnnotation): void {
  if (a.variant === 'badge') drawBadge(ctx, a);
  else if (a.variant === 'icon') drawStickerIcon(ctx, a);
  else {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `${Math.round(a.size * 0.86)}px ${EMOJI_FONT}`;
    ctx.fillText(a.glyph, a.x, a.y + a.size * 0.06);
    ctx.restore();
  }
}

export function renderSticker(ctx: Ctx2D, a: StickerAnnotation): void {
  ctx.save();
  ctx.globalAlpha = a.opacity;
  if (a.cutout) {
    const edge = stickerEdge(a);
    const b = stickerBounds({ ...a, cutout: false });
    drawCutout(ctx, b, edge, (l) => drawStickerArt(l, a));
  } else drawStickerArt(ctx, a);
  ctx.restore();
}

/* ------------------------------- inserted image ------------------------------ */
export function renderImage(ctx: Ctx2D, a: ImageAnnotation): void {
  ctx.save();
  ctx.globalAlpha = a.opacity;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(a.bitmap, a.x, a.y, a.w, a.h);
  ctx.restore();
}

export function isLight(color: string): boolean {
  const m = /^#?([0-9a-f]{6})(?:[0-9a-f]{2})?$/i.exec(color);
  if (!m) return false;
  const n = parseInt(m[1]!, 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return 0.299 * r + 0.587 * g + 0.114 * b > 170;
}
