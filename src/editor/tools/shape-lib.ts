import type { Rect } from '../types';
import type { Ctx2D } from './common';

/**
 * Shape library shared by the shape tool, callouts and badges: outlines for every shape kind,
 * detail lines (cylinder rims, icon glyphs, folds), 3D layers, and premium finishes
 * (shadow, glow, gradient, 3D extrude, glass). All geometry fits the given rectangle.
 */

export type ShapeKind =
  // basic
  | 'rect' | 'rounded' | 'pill' | 'ellipse' | 'triangle' | 'diamond' | 'pentagon' | 'hexagon' | 'octagon' | 'star' | 'heart'
  // soft
  | 'cloud' | 'clover' | 'wavy'
  // speech
  | 'speech-rect' | 'speech-round' | 'speech-oval' | 'thought' | 'speech-slant' | 'speech-cloud'
  // highlight
  | 'brush'
  // badges & labels
  | 'badge-pentagon' | 'bookmark' | 'banner' | 'banner-curved' | 'seal' | 'scallop' | 'starburst8' | 'shield' | 'tag-arrow' | 'slant'
  // geometric
  | 'trapezoid' | 'parallelogram' | 'cylinder' | 'octahedron' | 'cone' | 'leaf'
  // frames
  | 'ticket' | 'scallop-frame' | 'brackets' | 'chamfer' | 'notched' | 'cut-corner' | 'folded'
  // flowchart
  | 'document' | 'multi-document' | 'display'
  // decorative
  | 'burst' | 'star4' | 'flower'
  // icons
  | 'icon-check' | 'icon-x' | 'icon-plus' | 'icon-minus' | 'icon-warning' | 'icon-info' | 'icon-stop'
  // ribbons
  | 'flag' | 'flag-wavy'
  // layered
  | 'layers';

export type ShapeLook = 'flat' | 'shadow' | 'glow' | 'gradient' | '3d' | 'glass';

type Pt = [number, number];

/* ---------------------------------- colours ---------------------------------- */

export function parseHex(c: string): { r: number; g: number; b: number; a: number } | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(c.trim());
  if (!m) return null;
  let h = m[1]!;
  if (h.length === 3) h = h.split('').map((x) => x + x).join('');
  const n = parseInt(h.slice(0, 6), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: h.length === 8 ? parseInt(h.slice(6), 16) / 255 : 1 };
}

const toHex = (v: number) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0');

/** Mixes a colour toward white (amount > 0) or black (amount < 0). Non-hex colours pass through. */
export function shade(c: string, amount: number): string {
  const p = parseHex(c);
  if (!p) return c;
  const t = amount > 0 ? 255 : 0;
  const k = Math.abs(amount);
  const mix = (v: number) => v + (t - v) * k;
  return `#${toHex(mix(p.r))}${toHex(mix(p.g))}${toHex(mix(p.b))}${p.a < 1 ? toHex(p.a * 255) : ''}`;
}

/** The colour with a new alpha (0–1). */
export function alpha(c: string, a: number): string {
  const p = parseHex(c);
  if (!p) return c;
  return `rgba(${p.r}, ${p.g}, ${p.b}, ${+(a * p.a).toFixed(3)})`;
}

export function isTransparent(c: string | undefined): boolean {
  if (!c || c === 'transparent') return true;
  const p = parseHex(c);
  return !!p && p.a === 0;
}

/* ---------------------------------- helpers ---------------------------------- */

function polyPath(pts: Pt[], p = new Path2D()): Path2D {
  pts.forEach(([x, y], i) => (i ? p.lineTo(x, y) : p.moveTo(x, y)));
  p.closePath();
  return p;
}

const at = (r: Rect, u: number, v: number): Pt => [r.x + r.w * u, r.y + r.h * v];
const norm = (r: Rect, list: Pt[]): Pt[] => list.map(([u, v]) => at(r, u, v));

function ellipsePoints(r: Rect, n: number, rot = -90, scale = 1): Pt[] {
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  const out: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const t = ((rot + (360 / n) * i) * Math.PI) / 180;
    out.push([cx + Math.cos(t) * (r.w / 2) * scale, cy + Math.sin(t) * (r.h / 2) * scale]);
  }
  return out;
}

function starPoints(r: Rect, n: number, inner: number, rot = -90): Pt[] {
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  const out: Pt[] = [];
  for (let i = 0; i < n * 2; i++) {
    const t = ((rot + (180 / n) * i) * Math.PI) / 180;
    const k = i % 2 ? inner : 1;
    out.push([cx + Math.cos(t) * (r.w / 2) * k, cy + Math.sin(t) * (r.h / 2) * k]);
  }
  return out;
}

/**
 * Closed outline through clockwise points where every edge bulges outward (clouds, scallops,
 * flowers). `tail` replaces one edge with a pointer to `tip`.
 */
function bumpy(pts: Pt[], bulge: number, tail?: { edge: number; tip: Pt }): Path2D {
  const p = new Path2D();
  p.moveTo(pts[0]![0], pts[0]![1]);
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]!;
    const b = pts[(i + 1) % pts.length]!;
    if (tail && tail.edge === i) {
      p.lineTo(tail.tip[0], tail.tip[1]);
      p.lineTo(b[0], b[1]);
      continue;
    }
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.hypot(dx, dy) || 1;
    const nx = dy / len;
    const ny = -dx / len;
    p.quadraticCurveTo((a[0] + b[0]) / 2 + nx * len * bulge, (a[1] + b[1]) / 2 + ny * len * bulge, b[0], b[1]);
  }
  p.closePath();
  return p;
}

/** Points evenly spaced along a rectangle's edge, clockwise from the top-left corner. */
function rectPerimeter(r: Rect, step: number): Pt[] {
  const nx = Math.max(2, Math.round(r.w / step));
  const ny = Math.max(2, Math.round(r.h / step));
  const out: Pt[] = [];
  for (let i = 0; i < nx; i++) out.push([r.x + (r.w * i) / nx, r.y]);
  for (let i = 0; i < ny; i++) out.push([r.x + r.w, r.y + (r.h * i) / ny]);
  for (let i = 0; i < nx; i++) out.push([r.x + r.w - (r.w * i) / nx, r.y + r.h]);
  for (let i = 0; i < ny; i++) out.push([r.x, r.y + r.h - (r.h * i) / ny]);
  return out;
}

/** Small deterministic random generator (shapes look the same on every redraw). */
export function seeded(seed: number): () => number {
  let s = (Math.abs(Math.floor(seed)) % 2147483646) + 1;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

function roundedRectPath(r: Rect, radius: number, p = new Path2D()): Path2D {
  p.roundRect(r.x, r.y, r.w, r.h, Math.max(0, Math.min(radius, r.w / 2, r.h / 2)));
  return p;
}

/** Rounded rectangle body with a speech tail on the bottom edge (one outline, no seams). */
function speechRect(r: Rect, radius: number, bodyFrac = 0.8): Path2D {
  const h = r.h * bodyFrac;
  const rr = Math.max(0, Math.min(radius, r.w / 2, h / 2));
  const { x, y, w } = r;
  const yb = y + h;
  const p = new Path2D();
  p.moveTo(x + rr, y);
  p.arcTo(x + w, y, x + w, yb, rr);
  p.arcTo(x + w, yb, x, yb, rr);
  p.lineTo(x + w * 0.34, yb);
  p.lineTo(x + w * 0.16, y + r.h);
  p.lineTo(x + w * 0.2, yb);
  p.arcTo(x, yb, x, y, rr);
  p.arcTo(x, y, x + w, y, rr);
  p.closePath();
  return p;
}

function wavyRect(r: Rect, amp: number, waves: number, top = true, bottom = true): Path2D {
  const p = new Path2D();
  const n = Math.max(2, waves) * 12;
  const yAt = (base: number, i: number, sign: number) => base + Math.sin((i / n) * Math.PI * 2 * waves) * amp * sign;
  p.moveTo(r.x, top ? yAt(r.y + amp, 0, 1) : r.y);
  for (let i = 1; i <= n; i++) p.lineTo(r.x + (r.w * i) / n, top ? yAt(r.y + amp, i, 1) : r.y);
  for (let i = 0; i <= n; i++) p.lineTo(r.x + r.w - (r.w * i) / n, bottom ? yAt(r.y + r.h - amp, i, -1) : r.y + r.h);
  p.closePath();
  return p;
}

function documentPath(r: Rect, p = new Path2D()): Path2D {
  const { x, y, w, h } = r;
  p.moveTo(x, y);
  p.lineTo(x + w, y);
  p.lineTo(x + w, y + h * 0.86);
  p.bezierCurveTo(x + w * 0.75, y + h * 0.72, x + w * 0.45, y + h * 1.06, x, y + h * 0.9);
  p.closePath();
  return p;
}

/** Brush-stroke highlight: ragged top and bottom edges and dry-brush ends. */
function brushPath(r: Rect): Path2D {
  const rnd = seeded(Math.round(r.w) * 31 + Math.round(r.h) * 17);
  const p = new Path2D();
  const n = Math.max(16, Math.round(r.w / Math.max(3, r.h * 0.16)));
  const j = r.h * 0.06;
  const end = Math.min(r.w * 0.04, r.h * 0.5);
  const top: Pt[] = [];
  const bottom: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    // Edges taper in at the ends like a brush stroke.
    const taper = Math.min(1, t / 0.06, (1 - t) / 0.06);
    top.push([r.x + end + (r.w - end * 2) * t, r.y + j + (1 - taper) * r.h * 0.12 + (rnd() - 0.5) * j * 1.4]);
    bottom.push([r.x + end + (r.w - end * 2) * t, r.y + r.h - j - (1 - taper) * r.h * 0.1 + (rnd() - 0.5) * j * 1.4]);
  }
  p.moveTo(top[0]![0], top[0]![1]);
  for (let i = 1; i < top.length; i++) p.lineTo(top[i]![0], top[i]![1]);
  // ragged ends (dry bristles)
  for (let i = 1; i < 7; i++) p.lineTo(r.x + r.w - end + (i % 2 ? end * (0.6 + rnd() * 0.4) : end * rnd() * 0.3), r.y + j + ((r.h - j * 2) * i) / 7);
  for (let i = bottom.length - 1; i >= 0; i--) p.lineTo(bottom[i]![0], bottom[i]![1]);
  for (let i = 6; i > 0; i--) p.lineTo(r.x + end - (i % 2 ? end * (0.6 + rnd() * 0.4) : end * rnd() * 0.3), r.y + j + ((r.h - j * 2) * i) / 7);
  p.closePath();
  return p;
}

/* ---------------------------------- outlines ---------------------------------- */

export interface ShapeGeometry {
  /** Main outline (fill + stroke). */
  outline: Path2D;
  /** Extra shapes drawn behind the outline (3D faces, stacked pages), back to front, with a shade. */
  back?: Array<{ path: Path2D; shade: number }>;
  /** Extra shapes drawn after the outline with a shade (cube top, fold flap). */
  front?: Array<{ path: Path2D; shade: number }>;
  /** Lines drawn in the stroke colour on top (rims, glyphs). */
  lines?: Path2D;
  /** Glyph lines are thicker than the outline (icons). */
  glyph?: boolean;
  /** Outline is only lines (no fill), like corner brackets. */
  open?: boolean;
}

export function shapeGeometry(kind: ShapeKind, r: Rect, radius = 0): ShapeGeometry {
  const { x, y, w, h } = r;
  const m = Math.min(w, h);
  switch (kind) {
    case 'rect':
      return { outline: roundedRectPath(r, radius) };
    case 'rounded':
      return { outline: roundedRectPath(r, radius || m * 0.22) };
    case 'pill':
      return { outline: roundedRectPath(r, m / 2) };
    case 'ellipse': {
      const p = new Path2D();
      p.ellipse(x + w / 2, y + h / 2, Math.max(0.5, w / 2), Math.max(0.5, h / 2), 0, 0, Math.PI * 2);
      return { outline: p };
    }
    case 'triangle':
      return { outline: polyPath(norm(r, [[0.5, 0], [1, 1], [0, 1]])) };
    case 'diamond':
      return { outline: polyPath(norm(r, [[0.5, 0], [1, 0.5], [0.5, 1], [0, 0.5]])) };
    case 'pentagon':
      return { outline: polyPath(ellipsePoints(r, 5)) };
    case 'hexagon':
      return { outline: polyPath(ellipsePoints(r, 6, 0)) };
    case 'octagon':
      return { outline: polyPath(ellipsePoints(r, 8, 22.5)) };
    case 'star':
      return { outline: polyPath(starPoints(r, 5, 0.45)) };
    case 'heart': {
      const p = new Path2D();
      p.moveTo(x + w / 2, y + h * 0.28);
      p.bezierCurveTo(x + w * 0.5, y + h * 0.05, x + w * 0.1, y - h * 0.02, x + w * 0.04, y + h * 0.3);
      p.bezierCurveTo(x - w * 0.02, y + h * 0.55, x + w * 0.3, y + h * 0.72, x + w / 2, y + h);
      p.bezierCurveTo(x + w * 0.7, y + h * 0.72, x + w * 1.02, y + h * 0.55, x + w * 0.96, y + h * 0.3);
      p.bezierCurveTo(x + w * 0.9, y - h * 0.02, x + w * 0.5, y + h * 0.05, x + w / 2, y + h * 0.28);
      p.closePath();
      return { outline: p };
    }
    case 'cloud':
      return { outline: bumpy(ellipsePoints({ x: x + w * 0.06, y: y + h * 0.1, w: w * 0.88, h: h * 0.8 }, 10, -90), 0.42) };
    case 'speech-cloud': {
      const body = { x: x + w * 0.06, y: y + h * 0.08, w: w * 0.88, h: h * 0.66 };
      return { outline: bumpy(ellipsePoints(body, 10, -90), 0.42, { edge: 6, tip: [x + w * 0.22, y + h] }) };
    }
    case 'clover':
      return { outline: bumpy(ellipsePoints({ x: x + w * 0.2, y: y + h * 0.2, w: w * 0.6, h: h * 0.6 }, 4, -45), 1.0) };
    case 'flower': {
      const lines = new Path2D();
      lines.ellipse(x + w / 2, y + h / 2, w * 0.13, h * 0.13, 0, 0, Math.PI * 2);
      return { outline: bumpy(ellipsePoints({ x: x + w * 0.15, y: y + h * 0.15, w: w * 0.7, h: h * 0.7 }, 6, -90), 0.85), lines };
    }
    case 'wavy':
      return { outline: wavyRect(r, h * 0.07, Math.max(2, Math.round(w / Math.max(20, h * 0.8)))) };
    case 'speech-rect':
      return { outline: speechRect(r, radius || m * 0.08) };
    case 'speech-round':
      return { outline: speechRect(r, m * 0.3) };
    case 'speech-oval': {
      const p = new Path2D();
      const cx = x + w / 2;
      const cy = y + h * 0.42;
      p.ellipse(cx, cy, w / 2, h * 0.42, 0, (125 * Math.PI) / 180, ((100 + 360) * Math.PI) / 180);
      p.lineTo(x + w * 0.16, y + h);
      p.closePath();
      return { outline: p };
    }
    case 'thought': {
      const p = bumpy(ellipsePoints({ x: x + w * 0.08, y, w: w * 0.86, h: h * 0.72 }, 10, -90), 0.42);
      p.moveTo(x + w * 0.24 + h * 0.07, y + h * 0.84);
      p.ellipse(x + w * 0.24, y + h * 0.84, h * 0.07, h * 0.07, 0, 0, Math.PI * 2);
      p.moveTo(x + w * 0.13 + h * 0.04, y + h * 0.96);
      p.ellipse(x + w * 0.13, y + h * 0.96, h * 0.04, h * 0.04, 0, 0, Math.PI * 2);
      return { outline: p };
    }
    case 'speech-slant':
      return { outline: polyPath(norm(r, [[0.02, 0.06], [0.98, 0], [1, 0.72], [0.66, 0.74], [0.7, 1], [0.44, 0.76], [0, 0.8]])) };
    case 'brush':
      return { outline: brushPath(r) };
    case 'badge-pentagon':
      return { outline: polyPath(norm(r, [[0, 0], [1, 0], [1, 0.68], [0.5, 1], [0, 0.68]])) };
    case 'bookmark':
      return { outline: polyPath(norm(r, [[0, 0], [1, 0], [1, 1], [0.5, 0.76], [0, 1]])) };
    case 'banner':
      return { outline: polyPath(norm(r, [[0, 0], [1, 0], [0.9, 0.5], [1, 1], [0, 1], [0.1, 0.5]])) };
    case 'banner-curved': {
      const p = new Path2D();
      p.moveTo(...at(r, 0, 0.22));
      p.quadraticCurveTo(...at(r, 0.5, -0.12), ...at(r, 1, 0.22));
      p.lineTo(...at(r, 0.93, 0.56));
      p.lineTo(...at(r, 1, 0.92));
      p.quadraticCurveTo(...at(r, 0.5, 0.58), ...at(r, 0, 0.92));
      p.lineTo(...at(r, 0.07, 0.56));
      p.closePath();
      return { outline: p };
    }
    case 'seal':
      return { outline: polyPath(starPoints(r, 22, 0.86)) };
    case 'scallop':
      return { outline: bumpy(ellipsePoints({ x: x + w * 0.08, y: y + h * 0.08, w: w * 0.84, h: h * 0.84 }, 12, -90), 0.32) };
    case 'starburst8':
      return { outline: bumpy(ellipsePoints({ x: x + w * 0.1, y: y + h * 0.1, w: w * 0.8, h: h * 0.8 }, 8, -90), 0.22) };
    case 'shield': {
      const p = new Path2D();
      p.moveTo(...at(r, 0.5, 0));
      p.lineTo(...at(r, 1, 0.14));
      p.bezierCurveTo(...at(r, 1, 0.62), ...at(r, 0.78, 0.86), ...at(r, 0.5, 1));
      p.bezierCurveTo(...at(r, 0.22, 0.86), ...at(r, 0, 0.62), ...at(r, 0, 0.14));
      p.closePath();
      return { outline: p };
    }
    case 'tag-arrow': {
      const t = Math.min(h * 0.5, w * 0.3);
      return { outline: polyPath([[x, y], [x + w - t, y], [x + w, y + h / 2], [x + w - t, y + h], [x, y + h]]) };
    }
    case 'slant': {
      const s = Math.min(h * 0.35, w * 0.2);
      return { outline: polyPath([[x + s, y], [x + w, y], [x + w - s, y + h], [x, y + h]]) };
    }
    case 'trapezoid':
      return { outline: polyPath(norm(r, [[0.2, 0], [0.8, 0], [1, 1], [0, 1]])) };
    case 'parallelogram': {
      const s = Math.min(w * 0.25, h * 0.5);
      return { outline: polyPath([[x + s, y], [x + w, y], [x + w - s, y + h], [x, y + h]]) };
    }
    case 'cylinder': {
      const ry = Math.min(h * 0.14, w * 0.25);
      const cx = x + w / 2;
      const p = new Path2D();
      p.moveTo(x, y + ry);
      p.lineTo(x, y + h - ry);
      p.ellipse(cx, y + h - ry, w / 2, ry, 0, Math.PI, 0, true);
      p.lineTo(x + w, y + ry);
      p.ellipse(cx, y + ry, w / 2, ry, 0, 0, Math.PI, true);
      p.closePath();
      const lines = new Path2D();
      lines.ellipse(cx, y + ry, w / 2, ry, 0, 0, Math.PI, false);
      return { outline: p, lines };
    }
    case 'cone': {
      const ry = Math.min(h * 0.12, w * 0.22);
      const p = new Path2D();
      p.moveTo(x + w / 2, y);
      p.lineTo(x + w, y + h - ry);
      p.ellipse(x + w / 2, y + h - ry, w / 2, ry, 0, 0, Math.PI, false);
      p.closePath();
      const lines = new Path2D();
      lines.ellipse(x + w / 2, y + h - ry, w / 2, ry, 0, Math.PI, 0, false);
      return { outline: p, lines };
    }
    case 'octahedron': {
      const lines = new Path2D();
      const mid: Pt = at(r, 0.42, 0.56);
      lines.moveTo(...at(r, 0.5, 0));
      lines.lineTo(...mid);
      lines.lineTo(...at(r, 0.5, 1));
      lines.moveTo(...at(r, 0, 0.5));
      lines.lineTo(...mid);
      lines.lineTo(...at(r, 1, 0.5));
      return { outline: polyPath(norm(r, [[0.5, 0], [1, 0.5], [0.5, 1], [0, 0.5]])), lines };
    }
    case 'leaf': {
      const p = new Path2D();
      const k = m * 0.42;
      p.moveTo(x + k, y);
      p.lineTo(x + w, y);
      p.lineTo(x + w, y + h - k);
      p.quadraticCurveTo(x + w, y + h, x + w - k, y + h);
      p.lineTo(x, y + h);
      p.lineTo(x, y + k);
      p.quadraticCurveTo(x, y, x + k, y);
      p.closePath();
      return { outline: p };
    }
    case 'ticket': {
      const n = Math.min(h * 0.16, w * 0.12);
      const cy = y + h / 2;
      const rr = Math.min(radius || m * 0.08, n);
      const p = new Path2D();
      p.moveTo(x + rr, y);
      p.arcTo(x + w, y, x + w, cy, rr);
      p.lineTo(x + w, cy - n);
      p.arc(x + w, cy, n, -Math.PI / 2, Math.PI / 2, true);
      p.arcTo(x + w, y + h, x, y + h, rr);
      p.arcTo(x, y + h, x, cy, rr);
      p.lineTo(x, cy + n);
      p.arc(x, cy, n, Math.PI / 2, -Math.PI / 2, true);
      p.arcTo(x, y, x + w, y, rr);
      p.closePath();
      return { outline: p };
    }
    case 'scallop-frame':
      return { outline: bumpy(rectPerimeter({ x: x + m * 0.05, y: y + m * 0.05, w: w - m * 0.1, h: h - m * 0.1 }, Math.max(8, m / 6)), 0.32) };
    case 'brackets': {
      const c = Math.max(6, m * 0.24);
      const p = new Path2D();
      p.moveTo(x, y + c); p.lineTo(x, y); p.lineTo(x + c, y);
      p.moveTo(x + w - c, y); p.lineTo(x + w, y); p.lineTo(x + w, y + c);
      p.moveTo(x + w, y + h - c); p.lineTo(x + w, y + h); p.lineTo(x + w - c, y + h);
      p.moveTo(x + c, y + h); p.lineTo(x, y + h); p.lineTo(x, y + h - c);
      return { outline: p, open: true };
    }
    case 'chamfer': {
      const c = m * 0.2;
      return { outline: polyPath([[x + c, y], [x + w - c, y], [x + w, y + c], [x + w, y + h - c], [x + w - c, y + h], [x + c, y + h], [x, y + h - c], [x, y + c]]) };
    }
    case 'notched': {
      const c = m * 0.18;
      const p = new Path2D();
      p.moveTo(x + c, y);
      p.lineTo(x + w - c, y);
      p.arc(x + w, y, c, Math.PI, Math.PI / 2, true);
      p.lineTo(x + w, y + h - c);
      p.arc(x + w, y + h, c, (3 * Math.PI) / 2, Math.PI, true);
      p.lineTo(x + c, y + h);
      p.arc(x, y + h, c, 0, -Math.PI / 2, true);
      p.lineTo(x, y + c);
      p.arc(x, y, c, Math.PI / 2, 0, true);
      p.closePath();
      return { outline: p };
    }
    case 'cut-corner': {
      const c = m * 0.26;
      return { outline: polyPath([[x, y], [x + w - c, y], [x + w, y + c], [x + w, y + h], [x, y + h]]) };
    }
    case 'folded': {
      const c = m * 0.26;
      const flap = polyPath([[x + w - c, y], [x + w - c, y + c], [x + w, y + c]]);
      return { outline: polyPath([[x, y], [x + w - c, y], [x + w, y + c], [x + w, y + h], [x, y + h]]), front: [{ path: flap, shade: -0.18 }] };
    }
    case 'document':
      return { outline: documentPath(r) };
    case 'multi-document': {
      const o = m * 0.08;
      const d = (k: number): Rect => ({ x: x + o * k, y: y + o * (2 - k), w: w - o * 2, h: h - o * 2 });
      return { outline: documentPath(d(0)), back: [{ path: documentPath(d(2)), shade: 0.35 }, { path: documentPath(d(1)), shade: 0.18 }] };
    }
    case 'display': {
      const p = new Path2D();
      p.moveTo(...at(r, 0.16, 0));
      p.lineTo(...at(r, 0.84, 0));
      p.quadraticCurveTo(...at(r, 1.02, 0.5), ...at(r, 0.84, 1));
      p.lineTo(...at(r, 0.16, 1));
      p.lineTo(...at(r, 0, 0.5));
      p.closePath();
      return { outline: p };
    }
    case 'burst': {
      const rnd = seeded(Math.round(w) * 13 + Math.round(h));
      const pts = starPoints(r, 12, 0.62).map(([px, py], i): Pt => {
        if (i % 2) return [px, py];
        const k = 0.86 + rnd() * 0.14;
        return [x + w / 2 + (px - x - w / 2) * k, y + h / 2 + (py - y - h / 2) * k];
      });
      return { outline: polyPath(pts) };
    }
    case 'star4':
      return { outline: polyPath(starPoints(r, 4, 0.32)) };
    case 'icon-check':
    case 'icon-x':
    case 'icon-plus':
    case 'icon-minus':
    case 'icon-info': {
      const p = new Path2D();
      p.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
      const g = new Path2D();
      const G = (u: number, v: number): Pt => at(r, u, v);
      if (kind === 'icon-check') { g.moveTo(...G(0.28, 0.52)); g.lineTo(...G(0.44, 0.67)); g.lineTo(...G(0.73, 0.36)); }
      if (kind === 'icon-x') { g.moveTo(...G(0.33, 0.33)); g.lineTo(...G(0.67, 0.67)); g.moveTo(...G(0.67, 0.33)); g.lineTo(...G(0.33, 0.67)); }
      if (kind === 'icon-plus' || kind === 'icon-minus') { g.moveTo(...G(0.28, 0.5)); g.lineTo(...G(0.72, 0.5)); }
      if (kind === 'icon-plus') { g.moveTo(...G(0.5, 0.28)); g.lineTo(...G(0.5, 0.72)); }
      if (kind === 'icon-info') { g.moveTo(...G(0.5, 0.45)); g.lineTo(...G(0.5, 0.72)); g.moveTo(...G(0.5, 0.3)); g.lineTo(...G(0.5, 0.305)); }
      return { outline: p, lines: g, glyph: true };
    }
    case 'icon-warning':
    case 'icon-stop': {
      const outline = kind === 'icon-warning' ? polyPath(norm(r, [[0.5, 0.04], [0.98, 0.94], [0.02, 0.94]])) : polyPath(ellipsePoints(r, 8, 22.5));
      const g = new Path2D();
      const top = kind === 'icon-warning' ? 0.36 : 0.26;
      const bottom = kind === 'icon-warning' ? 0.64 : 0.58;
      g.moveTo(...at(r, 0.5, top));
      g.lineTo(...at(r, 0.5, bottom));
      g.moveTo(...at(r, 0.5, bottom + 0.14));
      g.lineTo(...at(r, 0.5, bottom + 0.145));
      return { outline, lines: g, glyph: true };
    }
    case 'flag':
      return { outline: polyPath(norm(r, [[0, 0], [1, 0], [0.84, 0.5], [1, 1], [0, 1]])) };
    case 'flag-wavy':
      return { outline: wavyRect(r, h * 0.1, 1) };
    case 'layers': {
      const layer = (k: number) => polyPath([[x + w / 2, y + h * k * 0.22], [x + w, y + h * (0.28 + k * 0.22)], [x + w / 2, y + h * (0.56 + k * 0.22)], [x, y + h * (0.28 + k * 0.22)]]);
      return { outline: layer(0), back: [{ path: layer(2), shade: -0.12 }, { path: layer(1), shade: -0.05 }] };
    }
  }
}

/** Kinds whose box grows with a pointer drawn into the outline (speech shapes). */
export const SPEECH_KINDS = new Set<ShapeKind>(['speech-rect', 'speech-round', 'speech-oval', 'thought', 'speech-slant', 'speech-cloud']);

/* ---------------------------------- painting ---------------------------------- */

export interface ShapePaint {
  fill: string;
  stroke: string;
  width: number;
  dash: number[];
  look?: ShapeLook;
}

/** Fill / stroke a shape with its finish. Call with the context already set up (alpha, transform). */
export function paintShape(ctx: Ctx2D, kind: ShapeKind, r: Rect, radius: number, s: ShapePaint): void {
  const geo = shapeGeometry(kind, r, radius);
  const look = s.look ?? 'flat';
  const hasFill = !isTransparent(s.fill) && !geo.open;
  const hasStroke = s.width > 0 && !isTransparent(s.stroke);
  const m = Math.min(r.w, r.h);
  const base = hasFill ? s.fill : s.stroke;
  const fillPaint = (path: Path2D, k = 0) => {
    if (!hasFill) return;
    if (look === 'gradient') {
      const g = ctx.createLinearGradient(r.x, r.y, r.x, r.y + r.h);
      g.addColorStop(0, shade(s.fill, 0.38 + k));
      g.addColorStop(1, shade(s.fill, k - 0.05));
      ctx.fillStyle = g;
    } else ctx.fillStyle = k ? shade(s.fill, k) : s.fill;
    ctx.fill(path);
  };
  const strokePaint = (path: Path2D, k = 0) => {
    if (!hasStroke) return;
    if (look === 'gradient' && !hasFill && !k) {
      // An outline only: the gradient runs along the outline (light at the top, deeper below).
      const g = ctx.createLinearGradient(r.x, r.y, r.x, r.y + r.h);
      g.addColorStop(0, shade(s.stroke, 0.45));
      g.addColorStop(1, shade(s.stroke, -0.15));
      ctx.strokeStyle = g;
    } else ctx.strokeStyle = k ? shade(s.stroke, k) : s.stroke;
    ctx.stroke(path);
  };
  /** How see-through the shape's own colours are (0–1): its shadow / glow is as faint. */
  const strength = Math.max(parseHex(hasFill ? s.fill : s.stroke)?.a ?? 1, hasFill && hasStroke ? parseHex(s.stroke)?.a ?? 1 : 0);
  ctx.save();
  ctx.lineWidth = s.width;
  ctx.lineJoin = 'round';
  // Dots (near-zero dashes) need round line ends; dashes keep square ones.
  ctx.lineCap = geo.open ? 'round' : s.dash.some((d) => d < 0.1) ? 'round' : 'butt';
  ctx.setLineDash(s.dash);
  for (const b of geo.back ?? []) {
    fillPaint(b.path, b.shade);
    strokePaint(b.path);
  }
  if (look === '3d' && !geo.open) {
    const depth = Math.max(3, m * 0.08);
    ctx.save();
    ctx.translate(0, depth);
    if (hasFill) { ctx.fillStyle = shade(base, -0.28); ctx.fill(geo.outline); }
    if (hasStroke) strokePaint(geo.outline, -0.2);
    ctx.restore();
  }
  if (look === 'shadow' || look === 'glow' || look === 'glass') {
    // Only the shadow / glow is drawn here: the shape itself is drawn far off to the side and its
    // shadow brought back under it, so a see-through colour is never painted twice (it used to
    // look darker / another colour instead of more transparent).
    const away = 20000;
    const t = ctx.getTransform();
    const opaque = (c: string) => (parseHex(c) ? c.trim().slice(0, 7) : c);
    ctx.save();
    ctx.translate(-away, 0);
    let dy = 0;
    if (look === 'glow') {
      ctx.shadowColor = alpha(opaque(hasStroke ? s.stroke : base), 0.75 * strength);
      ctx.shadowBlur = Math.max(8, m * 0.3);
    } else {
      ctx.shadowColor = `rgba(15, 23, 42, ${+(0.22 * strength).toFixed(3)})`;
      ctx.shadowBlur = Math.max(6, m * 0.12);
      dy = Math.max(2, m * 0.04);
    }
    // Shadow offsets are in canvas pixels, the move to the side in the (scaled, rotated) drawing space.
    ctx.shadowOffsetX = away * t.a;
    ctx.shadowOffsetY = away * t.b + dy;
    ctx.fillStyle = '#000';
    ctx.strokeStyle = '#000';
    if (hasFill) ctx.fill(geo.outline);
    if (hasStroke) ctx.stroke(geo.outline);
    ctx.restore();
  }
  fillPaint(geo.outline);
  if (look === 'glass' && hasFill) {
    ctx.save();
    ctx.clip(geo.outline);
    const g = ctx.createLinearGradient(r.x, r.y, r.x, r.y + r.h * 0.6);
    g.addColorStop(0, 'rgba(255,255,255,0.65)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(r.x, r.y, r.w, r.h * 0.6);
    ctx.restore();
  }
  strokePaint(geo.outline);
  if (look === 'glass' && !hasFill && hasStroke) {
    // An outline only: a glassy shine along the outline (white, strongest at the top).
    ctx.save();
    const g = ctx.createLinearGradient(r.x, r.y, r.x, r.y + r.h);
    g.addColorStop(0, `rgba(255,255,255,${+(0.7 * strength).toFixed(3)})`);
    g.addColorStop(1, 'rgba(255,255,255,0.05)');
    ctx.strokeStyle = g;
    ctx.lineWidth = Math.max(1, s.width * 0.35);
    ctx.stroke(geo.outline);
    ctx.restore();
  }
  for (const f of geo.front ?? []) {
    fillPaint(f.path, f.shade);
    if (!hasFill) { ctx.fillStyle = alpha(s.stroke, 0.25); ctx.fill(f.path); }
    strokePaint(f.path);
  }
  if (geo.lines) {
    ctx.setLineDash([]);
    ctx.lineCap = 'round';
    ctx.lineWidth = geo.glyph ? Math.max(s.width * 1.4, m * 0.09) : Math.max(1, s.width * 0.8);
    ctx.strokeStyle = hasStroke ? s.stroke : shade(base, -0.4);
    ctx.stroke(geo.lines);
  }
  ctx.restore();
}

/** Picker catalogue: every shape with the colours and finish it starts with. */
export interface ShapePreset {
  id: string;
  label: string;
  kind: ShapeKind;
  stroke: string;
  fill: string;
  look?: ShapeLook;
  dash?: 'solid' | 'dashed' | 'dotted';
  width?: number;
}

const PURPLE = '#7C3AED';
const LAV = '#EFE7FF';
const p = (id: string, label: string, kind: ShapeKind, stroke: string, fill: string, look: ShapeLook = 'flat', dash: ShapePreset['dash'] = 'solid', width?: number): ShapePreset => ({ id, label, kind, stroke, fill, look, dash, width });

export const SHAPE_GROUPS: Array<{ id: string; label: string; items: ShapePreset[] }> = [
  {
    // Outlined shapes come first and are the default. One rectangle and one ellipse: drag a square
    // or a circle (or hold Shift) with the same shape.
    id: 'outlined', label: 'Outlined',
    items: [
      p('rect', 'Rectangle', 'rect', '#E05252', 'transparent'), p('rrect', 'Rounded rectangle', 'rounded', '#E05252', 'transparent'), p('ellipse', 'Ellipse / circle', 'ellipse', '#E05252', 'transparent'),
      p('o-pill', 'Pill', 'pill', PURPLE, 'transparent'), p('o-tri', 'Triangle', 'triangle', PURPLE, 'transparent'), p('o-dia', 'Diamond', 'diamond', PURPLE, 'transparent'),
      p('o-hex', 'Hexagon', 'hexagon', PURPLE, 'transparent'), p('o-star', 'Star', 'star', PURPLE, 'transparent'), p('o-heart', 'Heart', 'heart', PURPLE, 'transparent'),
      p('o-dash', 'Dashed box', 'rounded', '#4F46E5', 'transparent', 'flat', 'dashed', 3),
    ],
  },
  {
    id: 'filled', label: 'Filled',
    items: [
      p('f-sq', 'Blue square', 'rounded', '#3B82F6', '#4DA3FF', 'gradient', 'solid', 0), p('f-circle', 'Red circle', 'ellipse', '#E5484D', '#FF6B6B', 'gradient', 'solid', 0),
      p('f-tri', 'Orange triangle', 'triangle', '#F59E0B', '#FFB020', 'gradient', 'solid', 0), p('f-dia', 'Purple diamond', 'diamond', PURPLE, '#9B6BFF', 'gradient', 'solid', 0),
      p('f-pent', 'Green pentagon', 'pentagon', '#2E9E3E', '#3DBB4C', 'gradient', 'solid', 0), p('f-hex', 'Blue hexagon', 'hexagon', '#2563EB', '#3B82F6', 'gradient', 'solid', 0),
      p('f-star', 'Gold star', 'star', '#E0A800', '#FFC72C', 'gradient', 'solid', 0), p('f-heart', 'Red heart', 'heart', '#E11D48', '#F43F5E', 'gradient', 'solid', 0),
    ],
  },
  {
    id: 'soft-fill', label: 'Soft fill',
    items: [
      p('sf-rect', 'Lavender box', 'rounded', PURPLE, LAV), p('sf-ellipse', 'Lavender oval', 'ellipse', PURPLE, LAV), p('sf-tri', 'Lavender triangle', 'triangle', PURPLE, LAV),
      p('sf-dia', 'Lavender diamond', 'diamond', PURPLE, LAV), p('sf-blue', 'Blue box', 'rounded', '#3B82F6', '#DCEBFF'), p('sf-green', 'Green box', 'rounded', '#16A34A', '#DCFCE7'),
      p('sf-yellow', 'Yellow box', 'rounded', '#E0A800', '#FFF4C2'), p('sf-pink', 'Pink box', 'rounded', '#E11D48', '#FFE4EA'),
    ],
  },
  {
    id: 'soft', label: 'Rounded & soft',
    items: [
      p('s-pill-p', 'Lavender pill', 'pill', '#B79CF5', '#E3D7FF', 'flat', 'solid', 2), p('s-pill-b', 'Sky pill', 'pill', '#7FB5F5', '#CFE4FF', 'flat', 'solid', 2), p('s-pill-r', 'Pink pill', 'pill', '#F59BB5', '#FFD6E2', 'flat', 'solid', 2),
      p('s-cloud', 'Cloud', 'cloud', '#5AA2F0', '#BFDDFF', 'flat', 'solid', 2), p('s-clover', 'Clover', 'clover', '#59B84A', '#B8EBA8', 'flat', 'solid', 2), p('s-wavy', 'Wavy', 'wavy', '#B79CF5', '#E9DFFF', 'flat', 'solid', 2),
    ],
  },
  {
    id: 'speech', label: 'Callout & speech',
    items: [
      p('sp-rect', 'Speech box', 'speech-rect', '#3B82F6', '#DCEBFF', 'flat', 'solid', 2), p('sp-oval', 'Speech oval', 'speech-oval', '#A78BFA', '#EDE7FF', 'flat', 'solid', 2),
      p('sp-round', 'Rounded speech', 'speech-round', '#F2B705', '#FFE9A8', 'flat', 'solid', 2), p('sp-thought', 'Thought', 'thought', '#F472B6', '#FFE1EF', 'flat', 'solid', 2),
      p('sp-teal', 'Teal speech', 'speech-rect', '#14B8A6', '#CCF5EF', 'flat', 'solid', 2), p('sp-slant', 'Slanted speech', 'speech-slant', PURPLE, LAV, 'flat', 'solid', 2),
      p('sp-cloud', 'Cloud speech', 'speech-cloud', '#E8B400', '#FFE680', 'flat', 'solid', 2),
    ],
  },
  {
    id: 'highlight', label: 'Highlight',
    items: [
      p('h-yellow', 'Yellow brush', 'brush', 'transparent', '#FFE14DE6', 'flat', 'solid', 0), p('h-pink', 'Pink brush', 'brush', 'transparent', '#FF8CC6D9', 'flat', 'solid', 0), p('h-cyan', 'Cyan brush', 'brush', 'transparent', '#38E1F5D9', 'flat', 'solid', 0),
      p('h-soft-y', 'Soft yellow', 'rounded', 'transparent', '#FFE8808C', 'flat', 'solid', 0), p('h-soft-p', 'Soft pink', 'rounded', 'transparent', '#FFB3D18C', 'flat', 'solid', 0), p('h-soft-b', 'Soft blue', 'rounded', 'transparent', '#A9D4FF8C', 'flat', 'solid', 0),
      p('h-focus', 'Focus box', 'rounded', '#9B5CF6', '#9B5CF614', 'flat', 'dashed', 3), p('h-blue', 'Blue region', 'rounded', '#3B82F6', '#EAF3FF', 'gradient', 'solid', 3),
      p('h-green', 'Green region', 'rounded', '#86D99A', '#C9F2D3', 'flat', 'solid', 2), p('h-red', 'Red region', 'rounded', '#F2A0A8', '#FFD5DA', 'flat', 'solid', 2),
      p('h-glow', 'Glow pill', 'pill', '#C084FC', '#E9D5FF', 'glow', 'solid', 3), p('h-input', 'Input highlight', 'rounded', '#E5484D', 'transparent', 'flat', 'solid', 4),
      p('h-corners', 'Focus corners', 'brackets', '#4F46E5', 'transparent', 'flat', 'solid', 5),
    ],
  },
  {
    id: 'badge', label: 'Badge & label',
    items: [
      p('b-pent', 'Pentagon badge', 'badge-pentagon', PURPLE, '#E6D9FF', 'flat', 'solid', 2), p('b-bookmark', 'Bookmark', 'bookmark', '#E0A800', '#FFD84D', 'flat', 'solid', 2),
      p('b-banner', 'Ribbon banner', 'banner-curved', '#5AA2F0', '#BFDDFF', 'flat', 'solid', 2), p('b-banner2', 'Pink banner', 'banner-curved', '#F06B8B', '#FFB3C4', 'flat', 'solid', 2),
      p('b-seal', 'Green seal', 'seal', '#5BB532', '#9BE25A', 'gradient', 'solid', 1), p('b-scallop', 'Lavender badge', 'scallop', PURPLE, '#F1EAFF', 'flat', 'solid', 2),
      p('b-star8', 'Blue badge', 'starburst8', '#2563EB', '#3B82F6', 'gradient', 'solid', 1), p('b-shield', 'Shield', 'shield', '#E5484D', '#FFF1F2', 'flat', 'solid', 2),
    ],
  },
  {
    id: 'step', label: 'Step & number',
    items: [
      p('st-tag-b', 'Step tag blue', 'tag-arrow', '#3B82F6', '#EAF3FF', 'flat', 'solid', 2), p('st-tag-p', 'Step tag purple', 'tag-arrow', PURPLE, '#F1EAFF', 'flat', 'solid', 2),
      p('st-tag-r', 'Step tag pink', 'tag-arrow', '#E11D48', '#FFE4EA', 'flat', 'solid', 2), p('st-box', 'Number box', 'rounded', '#3B82F6', 'transparent', 'flat', 'solid', 3),
      p('st-circle', 'Number circle', 'ellipse', '#2563EB', '#3B82F6', 'gradient', 'solid', 0),
    ],
  },
  {
    id: 'geometric', label: 'Geometric',
    items: [
      p('g-trap', 'Trapezoid', 'trapezoid', PURPLE, LAV), p('g-para', 'Parallelogram', 'parallelogram', PURPLE, LAV), p('g-para2', 'Slanted', 'slant', PURPLE, LAV), p('g-hex', 'Hexagon', 'hexagon', PURPLE, LAV),
      p('g-oct', 'Octagon', 'octagon', PURPLE, LAV), p('g-cyl', 'Cylinder', 'cylinder', PURPLE, LAV), p('g-octa', 'Crystal', 'octahedron', PURPLE, LAV), p('g-cone', 'Cone', 'cone', PURPLE, LAV),
    ],
  },
  {
    id: 'frames', label: 'Frames',
    items: [
      p('fr-dash', 'Dashed frame', 'rounded', '#64748B', 'transparent', 'flat', 'dashed', 3), p('fr-pink', 'Pink frame', 'rounded', '#F06B8B', 'transparent', 'flat', 'dashed', 3),
      p('fr-scallop', 'Scalloped frame', 'scallop-frame', '#E0A800', '#FFF7D6', 'flat', 'solid', 2), p('fr-dashrect', 'Dashed box', 'rect', PURPLE, 'transparent', 'flat', 'dashed', 3),
      p('fr-blue', 'Soft frame', 'rounded', '#5AA2F0', '#EAF3FF', 'flat', 'solid', 2), p('fr-wavy', 'Wavy frame', 'wavy', '#F06B8B', '#FFF0F4', 'flat', 'solid', 2),
      p('fr-ticket', 'Ticket', 'ticket', '#14B8A6', '#E6FBF8', 'flat', 'solid', 2), p('fr-chamfer', 'Chamfered', 'chamfer', '#3B82F6', '#EAF3FF', 'flat', 'solid', 2),
    ],
  },
  {
    id: 'flow', label: 'Flowchart',
    items: [
      p('fc-term', 'Start / end', 'pill', PURPLE, '#E6D9FF', 'flat', 'solid', 2), p('fc-proc', 'Process', 'rect', '#3B82F6', '#DCEBFF', 'flat', 'solid', 2),
      p('fc-dec', 'Decision', 'diamond', '#E0A800', '#FFE680', 'flat', 'solid', 2), p('fc-data', 'Data', 'parallelogram', PURPLE, '#EDE7FF', 'flat', 'solid', 2),
      p('fc-db', 'Database', 'cylinder', '#3B82F6', '#DCEBFF', 'flat', 'solid', 2), p('fc-doc', 'Document', 'folded', PURPLE, '#F1EAFF', 'flat', 'solid', 2),
      p('fc-docs', 'Documents', 'multi-document', '#2E9E3E', '#D5F5DB', 'flat', 'solid', 2), p('fc-disp', 'Display', 'display', '#F06B8B', '#FFE1E8', 'flat', 'solid', 2),
    ],
  },
  {
    id: 'decor', label: 'Decorative',
    items: [
      p('d-burst', 'Starburst', 'burst', '#E0A800', '#FFD84D', 'flat', 'solid', 2), p('d-star4', 'Sparkle', 'star4', PURPLE, '#EDE7FF', 'flat', 'solid', 2),
      p('d-flower', 'Flower', 'flower', '#F06B8B', '#FFB3C4', 'flat', 'solid', 2), p('d-seal', 'Blue seal', 'seal', '#2563EB', '#DCEBFF', 'flat', 'solid', 2),
      p('d-scallop', 'Purple scallop', 'scallop', '#A78BFA', '#D9C9FF', 'flat', 'solid', 2), p('d-scallop2', 'Mint scallop', 'scallop', '#2BB3A3', '#BFF0E8', 'flat', 'solid', 2),
      p('d-stamp', 'Stamp', 'scallop-frame', '#E0A800', '#FFE680', 'flat', 'solid', 2), p('d-cloud', 'Sky cloud', 'cloud', '#5AA2F0', '#DCEBFF', 'flat', 'solid', 2),
    ],
  },
  {
    id: 'icons', label: 'Icons',
    items: [
      p('i-check', 'Check', 'icon-check', '#16A34A', 'transparent', 'flat', 'solid', 3), p('i-x', 'Cross', 'icon-x', '#E5484D', 'transparent', 'flat', 'solid', 3),
      p('i-plus', 'Plus', 'icon-plus', '#2563EB', 'transparent', 'flat', 'solid', 3), p('i-minus', 'Minus', 'icon-minus', '#F59E0B', 'transparent', 'flat', 'solid', 3),
      p('i-warn', 'Warning', 'icon-warning', '#F59E0B', '#FFF4D6', 'flat', 'solid', 3), p('i-info', 'Info', 'icon-info', '#2563EB', 'transparent', 'flat', 'solid', 3),
      p('i-stop', 'Stop', 'icon-stop', '#E5484D', '#FFE4E6', 'flat', 'solid', 3), p('i-star', 'Star', 'star', '#F59E0B', '#FFF4D6', 'flat', 'solid', 3),
    ],
  },
  {
    id: 'corner', label: 'Corners',
    items: [
      p('c-round', 'Soft corners', 'rounded', PURPLE, LAV, 'flat', 'solid', 2), p('c-notch', 'Notched', 'notched', PURPLE, LAV, 'flat', 'solid', 2),
      p('c-chamfer', 'Chamfered', 'chamfer', PURPLE, LAV, 'flat', 'solid', 2), p('c-fold', 'Folded corner', 'folded', PURPLE, LAV, 'flat', 'solid', 2),
      p('c-cut', 'Cut corner', 'cut-corner', PURPLE, LAV, 'flat', 'solid', 2), p('c-leaf', 'Leaf', 'leaf', PURPLE, LAV, 'flat', 'solid', 2),
    ],
  },
  {
    id: 'ribbon', label: 'Ribbons',
    items: [
      p('r-banner', 'Banner', 'banner', '#9B7BEA', '#D9C9FF', 'flat', 'solid', 2), p('r-curved', 'Curved banner', 'banner-curved', '#5AA2F0', '#BFDDFF', 'flat', 'solid', 2),
      p('r-wavy', 'Wavy flag', 'flag-wavy', '#F06B8B', '#FFB3C4', 'flat', 'solid', 2), p('r-flag', 'Flag', 'flag', '#E0A800', '#FFC72C', 'flat', 'solid', 2),
    ],
  },
  {
    id: '3d', label: '3D & layered',
    items: [
      p('3-box', '3D square', 'rounded', '#2563EB', '#4DA3FF', '3d', 'solid', 0), p('3-coin', '3D circle', 'ellipse', '#E11D48', '#FB7185', '3d', 'solid', 0),
      p('3-hex', '3D hexagon', 'hexagon', PURPLE, '#A78BFA', '3d', 'solid', 0), p('3-layers', 'Layers', 'layers', '#7C9CF5', '#C7D7FF', 'flat', 'solid', 2),
      p('3-glass', 'Glass card', 'rounded', '#FFFFFFB3', '#C7D2FE', 'glass', 'solid', 1.5),
    ],
  },
];

const KIND_NAMES: Partial<Record<ShapeKind, string>> = {
  'rounded': 'Rounded rectangle', 'speech-rect': 'Speech box', 'speech-round': 'Rounded speech', 'speech-oval': 'Speech oval', 'speech-slant': 'Slanted speech',
  'speech-cloud': 'Cloud speech', 'brush': 'Brush highlight', 'badge-pentagon': 'Pentagon badge', 'banner-curved': 'Curved banner', 'starburst8': 'Badge',
  'tag-arrow': 'Arrow tag', 'slant': 'Slanted label', 'octahedron': 'Crystal', 'scallop-frame': 'Scalloped frame', 'brackets': 'Focus corners',
  'cut-corner': 'Cut corner', 'folded': 'Folded corner', 'multi-document': 'Documents', 'star4': 'Sparkle', 'burst': 'Starburst', 'flag-wavy': 'Wavy flag',
  'icon-check': 'Check icon', 'icon-x': 'Cross icon', 'icon-plus': 'Plus icon', 'icon-minus': 'Minus icon', 'icon-warning': 'Warning icon', 'icon-info': 'Info icon', 'icon-stop': 'Stop icon',
};

/** Layer name of a shape kind (Hexagon, Speech box, Check icon…). */
export const SHAPE_KIND_LABEL = new Proxy(KIND_NAMES, {
  get: (t, k: string) => t[k as ShapeKind] ?? k.charAt(0).toUpperCase() + k.slice(1).replace(/-/g, ' '),
}) as Record<ShapeKind, string>;
