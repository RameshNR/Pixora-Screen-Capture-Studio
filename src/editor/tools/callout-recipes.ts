import type { CalloutAnnotation, CalloutDesign, Point, Rect } from '../types';
import { dashPattern, type Ctx2D, viewScale } from './common';
import { alpha, seeded, shade, shapeGeometry, isTransparent, type ShapeKind } from './shape-lib';

/**
 * Premium callout designs built from parts: a body shape, a fill (solid, gradient, brush), a line
 * (solid, sketch, double, open with gaps for quote marks), an offset layer, quote marks, a number
 * badge (seal, circle, corner chip, peel, title band, arc), an icon (compact badges), folds,
 * ribbon tails, scribble backgrounds and rule lines. Colours: `fill` body, `stroke` line,
 * `accent` second colour (offset, quotes, badge, fold).
 */

export type BadgeIcon = 'bulb' | 'info' | 'check' | 'check-filled' | 'warning' | 'error' | 'star' | 'flag' | 'bolt' | 'calendar' | 'sparkles';

export interface Recipe {
  body: ShapeKind;
  fill?: 'solid' | 'gradient' | 'brush' | 'none';
  line?: 'solid' | 'sketch' | 'double' | 'open' | 'none';
  offset?: 'fill' | 'outline';
  quotes?: 'serif' | 'block' | 'badge' | 'round';
  quotesAt?: 'outside' | 'inside' | 'gaps';
  /** Closing mark too (default true). */
  close?: boolean;
  badge?: 'seal' | 'circle' | 'chip' | 'peel' | 'band' | 'arc' | 'icon';
  ribbon?: boolean;
  sparks?: boolean;
  rules?: boolean;
  dots?: boolean;
  scribble?: boolean;
  accentBar?: boolean;
  shadow?: boolean;
  /** The speech tail starts on the ellipse around the box (round bodies). */
  round?: boolean;
}

export const RECIPES: Partial<Record<CalloutDesign, Recipe>> = {
  soft: { body: 'rounded', fill: 'gradient', line: 'solid', shadow: true },
  'pill-glow': { body: 'pill', fill: 'gradient', line: 'none', shadow: true },
  'speech-soft': { body: 'rounded', fill: 'gradient', line: 'solid', shadow: true },
  cloud: { body: 'cloud', fill: 'gradient', line: 'solid', shadow: true, round: true },
  'quote-card': { body: 'rounded', fill: 'solid', line: 'solid', quotes: 'serif', quotesAt: 'outside', close: false, shadow: true },
  highlight: { body: 'brush', fill: 'brush', line: 'none' },
  'fold-note': { body: 'folded', fill: 'gradient', line: 'solid', shadow: true },
  sketch: { body: 'rect', fill: 'solid', line: 'sketch', sparks: true },
  'ribbon-fold': { body: 'flag', fill: 'gradient', line: 'none', ribbon: true, shadow: true },
  'arrow-soft': { body: 'tag-arrow', fill: 'gradient', line: 'solid', shadow: true },
  'step-seal': { body: 'rounded', fill: 'gradient', line: 'solid', badge: 'seal', shadow: true },
  'step-circle': { body: 'rounded', fill: 'gradient', line: 'solid', badge: 'circle', shadow: true },
  'quote-bubble': { body: 'rounded', fill: 'solid', line: 'solid', quotes: 'serif', quotesAt: 'outside' },
  'quote-brush': { body: 'brush', fill: 'brush', line: 'none', quotes: 'block', quotesAt: 'outside' },
  'quote-frame': { body: 'rounded', fill: 'solid', line: 'open', quotes: 'round', quotesAt: 'gaps', shadow: true },
  slant: { body: 'slant', fill: 'gradient', line: 'solid', shadow: true },
  'arrow-tag': { body: 'tag-arrow', fill: 'solid', line: 'solid', shadow: true },
  parallelogram: { body: 'parallelogram', fill: 'solid', line: 'solid', shadow: true },
  hex: { body: 'hexagon', fill: 'solid', line: 'solid', shadow: true },
  'offset-card': { body: 'rounded', fill: 'solid', line: 'solid', offset: 'fill' },
  'quote-badge': { body: 'rounded', fill: 'solid', line: 'none', offset: 'outline', quotes: 'badge', quotesAt: 'outside', close: false, shadow: true },
  'double-frame': { body: 'rounded', fill: 'solid', line: 'double', quotes: 'block', quotesAt: 'gaps' },
  'circle-quote': { body: 'ellipse', fill: 'solid', line: 'solid', quotes: 'serif', quotesAt: 'outside', round: true },
  heart: { body: 'heart', fill: 'solid', line: 'solid', quotes: 'serif', quotesAt: 'inside', round: true },
  'flower-quote': { body: 'flower', fill: 'solid', line: 'none', quotes: 'serif', quotesAt: 'inside', round: true },
  'quote-open': { body: 'rect', fill: 'none', line: 'open', quotes: 'block', quotesAt: 'gaps' },
  'quote-lines': { body: 'rect', fill: 'none', line: 'none', rules: true, quotes: 'serif', quotesAt: 'gaps' },
  'quote-curve': { body: 'leaf', fill: 'none', line: 'open', quotes: 'block', quotesAt: 'gaps' },
  'quote-ring': { body: 'ellipse', fill: 'none', line: 'open', quotes: 'block', quotesAt: 'gaps', round: true },
  scribble: { body: 'rect', fill: 'solid', line: 'none', scribble: true, quotes: 'block', quotesAt: 'inside' },
  'step-box': { body: 'rounded', fill: 'solid', line: 'double', dots: true, shadow: true },
  'step-banner': { body: 'banner', fill: 'gradient', line: 'none', badge: 'seal', shadow: true },
  'corner-chip': { body: 'rounded', fill: 'solid', line: 'solid', badge: 'chip', shadow: true },
  'peel-card': { body: 'rounded', fill: 'solid', line: 'solid', badge: 'peel', dots: true, shadow: true },
  'top-band': { body: 'rounded', fill: 'solid', line: 'solid', badge: 'band', shadow: true },
  'circle-arc': { body: 'ellipse', fill: 'solid', line: 'solid', badge: 'arc', dots: true, shadow: true, round: true },
  badge: { body: 'pill', fill: 'gradient', line: 'solid', badge: 'icon' },
  'rule-box': { body: 'rounded', fill: 'solid', line: 'none', rules: true, quotes: 'block', quotesAt: 'outside' },
  'sketch-quote': { body: 'rect', fill: 'none', line: 'sketch', quotes: 'round', quotesAt: 'outside' },
  'offset-frame': { body: 'rect', fill: 'solid', line: 'none', offset: 'outline', quotes: 'block', quotesAt: 'outside', close: false },
};

export function recipeOf(a: Pick<CalloutAnnotation, 'design'>): Recipe | null {
  return (a.design && RECIPES[a.design]) || null;
}

/** Body shape: the annotation's own choice, else the design's. */
export function bodyOf(a: CalloutAnnotation, r: Recipe): ShapeKind {
  return a.shape ?? r.body;
}

const ROUND_BODIES = new Set<ShapeKind>(['ellipse', 'cloud', 'heart', 'flower', 'scallop', 'seal', 'starburst8', 'speech-cloud', 'thought']);

export function recipeRound(a: CalloutAnnotation): boolean {
  const r = recipeOf(a);
  return !!r && (r.round === true || ROUND_BODIES.has(bodyOf(a, r)));
}

/* ---------------------------------- layout ---------------------------------- */

/** Size of the quote marks. */
const quoteSize = (a: CalloutAnnotation) => Math.max(12, a.fontSize * 2.2);

/** Diameter of a seal / circle number badge. */
export function badgeDiameter(a: CalloutAnnotation): number {
  const ts = a.titleStyle?.fontSize ?? 24;
  return Math.max(a.fontSize * 3.2, ts * 2.3);
}

/** Inner content rectangle for the body shape (the part text can use). */
function bodyInset(kind: ShapeKind, b: Rect, pad: number): Rect {
  const { x, y, w, h } = b;
  const box = (l: number, t: number, r: number, bt: number): Rect => ({ x: x + l, y: y + t, w: Math.max(8, w - l - r), h: Math.max(8, h - t - bt) });
  switch (kind) {
    case 'ellipse':
      return box(w * 0.15 + pad * 0.3, h * 0.15 + pad * 0.3, w * 0.15 + pad * 0.3, h * 0.15 + pad * 0.3);
    case 'cloud':
    case 'speech-cloud':
    case 'thought':
      return box(w * 0.18, h * 0.22, w * 0.18, h * 0.24);
    case 'heart':
      return box(w * 0.22, h * 0.26, w * 0.22, h * 0.32);
    case 'flower':
    case 'scallop':
    case 'seal':
    case 'starburst8':
      return box(w * 0.22, h * 0.22, w * 0.22, h * 0.22);
    case 'hexagon':
      return box(w * 0.2, pad, w * 0.2, pad);
    case 'octagon':
      return box(w * 0.12 + pad * 0.5, h * 0.1 + pad * 0.5, w * 0.12 + pad * 0.5, h * 0.1 + pad * 0.5);
    case 'pentagon':
      return box(w * 0.16, h * 0.24, w * 0.16, pad);
    case 'diamond':
      return box(w * 0.25, h * 0.25, w * 0.25, h * 0.25);
    case 'triangle':
      return box(w * 0.25, h * 0.45, w * 0.25, pad);
    case 'slant': {
      const s = Math.min(h * 0.35, w * 0.2);
      return box(s + pad * 0.6, pad * 0.8, s + pad * 0.6, pad * 0.8);
    }
    case 'parallelogram': {
      const s = Math.min(w * 0.25, h * 0.5);
      return box(s * 0.7 + pad * 0.5, pad * 0.8, s * 0.7 + pad * 0.5, pad * 0.8);
    }
    case 'tag-arrow':
      return box(pad, pad * 0.8, Math.min(h * 0.5, w * 0.3) + pad * 0.4, pad * 0.8);
    case 'flag':
      return box(pad * 1.1, pad * 0.8, w * 0.16 + pad * 0.4, pad * 0.8);
    case 'banner':
      return box(w * 0.1 + pad * 0.4, pad * 0.8, w * 0.1 + pad * 0.4, pad * 0.8);
    case 'brush':
      return box(w * 0.04 + pad, h * 0.1 + pad * 0.5, w * 0.04 + pad, h * 0.1 + pad * 0.5);
    case 'pill':
      return box(Math.min(h, w) * 0.4, pad * 0.7, Math.min(h, w) * 0.4, pad * 0.7);
    default:
      return box(pad, pad, pad, pad);
  }
}

export interface RecipeLayout {
  /** Content area (title + body stack). */
  content: Rect;
  /** Number badge / icon area. */
  badge: Rect | null;
  /** Title drawn inside the badge band (band design). */
  titleInBand: Rect | null;
}

export function recipeLayout(a: CalloutAnnotation, pad: number, titleH: number): RecipeLayout {
  const r = recipeOf(a)!;
  const rect = { x: a.x, y: a.y, w: a.w, h: a.h };
  let c = bodyInset(bodyOf(a, r), rect, pad);
  let badge: Rect | null = null;
  let titleInBand: Rect | null = null;
  const q = quoteSize(a);
  if (r.quotes && r.quotesAt === 'inside') c = { x: c.x + q * 0.55, y: c.y + q * 0.35, w: Math.max(8, c.w - q * (r.close === false ? 0.55 : 1.1)), h: Math.max(8, c.h - q * (r.close === false ? 0.35 : 0.7)) };
  if (r.quotes && r.quotesAt === 'gaps') c = { x: c.x + q * 0.2, y: c.y + q * 0.25, w: Math.max(8, c.w - q * 0.4), h: Math.max(8, c.h - q * 0.5) };
  if (r.accentBar) c = { ...c, x: c.x + pad * 0.4, w: c.w - pad * 0.4 };
  if (r.line === 'double') {
    const i = Math.max(3, a.strokeWidth * 2.6) + pad * 0.25;
    c = { x: c.x + i * 0.5, y: c.y + i * 0.5, w: Math.max(8, c.w - i), h: Math.max(8, c.h - i) };
  }
  switch (r.badge) {
    case 'seal':
    case 'circle': {
      const d = Math.min(badgeDiameter(a), a.h - pad * 0.4);
      badge = { x: a.x + pad * 0.3, y: a.y + (a.h - d) / 2, w: d, h: d };
      const left = badge.x + d + pad * 0.7;
      c = { x: left, y: c.y, w: Math.max(8, a.x + a.w - left - pad), h: c.h };
      break;
    }
    case 'chip':
    case 'peel': {
      const s = r.badge === 'peel' ? Math.max((a.titleStyle?.fontSize ?? 24) * 2.8, Math.min(a.w, a.h) * 0.42) : Math.max((a.titleStyle?.fontSize ?? 24) * 2.1, Math.min(a.w, a.h) * 0.3);
      badge = { x: a.x, y: a.y, w: s, h: s };
      c = { x: c.x + s * 0.55, y: c.y + s * 0.2, w: Math.max(8, c.w - s * 0.55), h: Math.max(8, c.h - s * 0.2) };
      break;
    }
    case 'band': {
      const bandH = Math.max(titleH + pad * 1.2, pad * 1.6);
      badge = { x: a.x, y: a.y, w: a.w, h: bandH };
      titleInBand = { x: a.x + pad, y: a.y + (bandH - titleH) / 2, w: a.w - pad * 2, h: titleH };
      c = { x: c.x, y: a.y + bandH + pad * 0.8, w: c.w, h: Math.max(8, a.y + a.h - bandH - pad * 1.6 - a.y) };
      break;
    }
    case 'arc': {
      const R = Math.min(a.w, a.h) / 2;
      const cx = a.x + a.w / 2;
      const cy = a.y + a.h / 2;
      badge = { x: cx - R * 0.62, y: cy - R * 0.5, w: R * 0.58, h: R * 0.42 };
      titleInBand = { x: cx + R * 0.06, y: cy - R * 0.1 - titleH, w: R * 0.56, h: titleH };
      c = { x: cx - R * 0.6, y: cy + R * 0.06, w: R * 1.2, h: Math.max(8, R * 0.62) };
      break;
    }
    case 'icon': {
      const s = a.fontSize * 1.35;
      badge = { x: c.x - Math.min(a.h, a.w) * 0.12, y: a.y + (a.h - s) / 2, w: s, h: s };
      const left = badge.x + s + a.fontSize * 0.55;
      c = { x: left, y: c.y, w: Math.max(8, c.x + c.w - left + Math.min(a.h, a.w) * 0.1), h: c.h };
      break;
    }
    default:
      break;
  }
  return { content: c, badge, titleInBand };
}

/** Fraction of the box height that holds text (fitting the box to its text). */
export function recipeFitFactor(a: CalloutAnnotation): number {
  const r = recipeOf(a);
  if (!r) return 1;
  switch (bodyOf(a, r)) {
    case 'ellipse':
      return 0.68;
    case 'cloud':
    case 'speech-cloud':
    case 'thought':
      return 0.54;
    case 'heart':
      return 0.42;
    case 'flower':
    case 'scallop':
    case 'seal':
    case 'starburst8':
      return 0.56;
    case 'triangle':
      return 0.45;
    case 'diamond':
      return 0.5;
    default:
      return 1;
  }
}

/** Smallest box height for the design (badges must fit). */
export function recipeMinHeight(a: CalloutAnnotation, pad: number): number {
  const r = recipeOf(a);
  if (!r) return 0;
  if (r.badge === 'seal' || r.badge === 'circle') return Math.ceil(badgeDiameter(a) + pad * 0.6);
  if (r.badge === 'icon') return Math.ceil(a.fontSize * 1.35 + pad * 1.2);
  // Round bodies keep their shape instead of flattening into a thin oval.
  const body = bodyOf(a, r);
  const ratio: Partial<Record<ShapeKind, number>> = { ellipse: 0.62, cloud: 0.55, heart: 0.82, flower: 0.85, scallop: 0.85, seal: 0.85, starburst8: 0.85, hexagon: 0.42, octagon: 0.5, pentagon: 0.7, thought: 0.6 };
  if (r.badge === 'arc') return Math.ceil(a.w);
  return ratio[body] ? Math.ceil(a.w * ratio[body]!) : 0;
}

/* ---------------------------------- drawing ---------------------------------- */

function sketchRect(ctx: Ctx2D, r: Rect, lw: number, seed: number): void {
  const rnd = seeded(seed);
  const j = () => (rnd() - 0.5) * lw * 1.6;
  const o = Math.max(4, lw * 3);
  for (let pass = 0; pass < 2; pass++) {
    const d = pass ? lw * 1.2 : 0;
    ctx.beginPath();
    ctx.moveTo(r.x - o + j(), r.y + d + j());
    ctx.lineTo(r.x + r.w + o * 0.4 + j(), r.y - d * 0.3 + j());
    ctx.moveTo(r.x + r.w - d + j(), r.y - o + j());
    ctx.lineTo(r.x + r.w + d * 0.3 + j(), r.y + r.h + o * 0.4 + j());
    ctx.moveTo(r.x + r.w + o + j(), r.y + r.h - d + j());
    ctx.lineTo(r.x - o * 0.4 + j(), r.y + r.h + d * 0.3 + j());
    ctx.moveTo(r.x + d + j(), r.y + r.h + o + j());
    ctx.lineTo(r.x - d * 0.3 + j(), r.y - o * 0.4 + j());
    ctx.lineWidth = pass ? lw * 0.7 : lw;
    ctx.stroke();
  }
}

function drawQuote(ctx: Ctx2D, kind: NonNullable<Recipe['quotes']>, open: boolean, x: number, y: number, size: number, color: string, ink: string): void {
  ctx.save();
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  if (kind === 'badge') {
    const r = size * 0.42;
    ctx.fillStyle = ink;
    ctx.beginPath();
    ctx.arc(x + r, y + r, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = color;
    ctx.font = `900 ${size * 0.85}px Georgia, 'Times New Roman', serif`;
    ctx.textAlign = 'center';
    ctx.fillText(open ? '“' : '”', x + r, y + r - size * 0.2);
    ctx.restore();
    return;
  }
  ctx.fillStyle = color;
  ctx.font = kind === 'block' ? `900 ${size * 1.25}px 'Arial Black', Impact, sans-serif` : `900 ${size * 1.3}px Georgia, 'Times New Roman', serif`;
  ctx.fillText(open ? '“' : '”', x, y - size * (kind === 'block' ? 0.12 : 0.18));
  ctx.restore();
}

/** Quote mark boxes (open: top left, close: bottom right) for the recipe. */
function quoteSpots(a: CalloutAnnotation, r: Recipe): { open: Point; close: Point | null; size: number } {
  const q = quoteSize(a);
  const at = r.quotesAt ?? 'outside';
  const close: Point | null = null;
  // A round quote badge sits on the bottom edge, to the right.
  if (r.quotes === 'badge') return { open: { x: a.x + a.w * 0.72, y: a.y + a.h - q * 0.42 }, close: null, size: q };
  if (at === 'inside') {
    const c = recipeLayout(a, Math.max(6, a.fontSize * 0.6), 0).content;
    return {
      open: { x: c.x - q * 0.62, y: c.y - q * 0.42 },
      close: r.close === false ? close : { x: c.x + c.w + q * 0.02, y: c.y + c.h - q * 0.5 },
      size: q,
    };
  }
  if (at === 'gaps') {
    return { open: { x: a.x - q * 0.15, y: a.y - q * 0.45 }, close: r.close === false ? close : { x: a.x + a.w - q * 0.75, y: a.y + a.h - q * 0.45 }, size: q };
  }
  return { open: { x: a.x - q * 0.35, y: a.y - q * 0.55 }, close: r.close === false ? close : { x: a.x + a.w - q * 0.55, y: a.y + a.h - q * 0.4 }, size: q };
}

export function drawBadgeIcon(ctx: Ctx2D, icon: BadgeIcon, b: Rect, color: string): void {
  const s = Math.min(b.w, b.h);
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1.5, s * 0.12);
  const circle = () => { ctx.beginPath(); ctx.arc(cx, cy, s / 2, 0, Math.PI * 2); ctx.fill(); };
  const white = (draw: () => void) => { ctx.save(); ctx.strokeStyle = '#FFFFFF'; ctx.fillStyle = '#FFFFFF'; draw(); ctx.restore(); };
  switch (icon) {
    case 'bulb':
      ctx.beginPath();
      ctx.arc(cx, cy - s * 0.1, s * 0.3, Math.PI * 0.8, Math.PI * 2.2);
      ctx.lineTo(cx + s * 0.13, cy + s * 0.25);
      ctx.lineTo(cx - s * 0.13, cy + s * 0.25);
      ctx.closePath();
      ctx.fill();
      ctx.fillRect(cx - s * 0.12, cy + s * 0.3, s * 0.24, s * 0.12);
      break;
    case 'info':
      circle();
      white(() => {
        ctx.lineWidth = s * 0.13;
        ctx.beginPath(); ctx.moveTo(cx, cy - s * 0.02); ctx.lineTo(cx, cy + s * 0.24); ctx.stroke();
        ctx.beginPath(); ctx.arc(cx, cy - s * 0.2, s * 0.075, 0, Math.PI * 2); ctx.fill();
      });
      break;
    case 'check':
      ctx.lineWidth = s * 0.18;
      ctx.beginPath(); ctx.moveTo(b.x + s * 0.12, cy + s * 0.02); ctx.lineTo(b.x + s * 0.4, cy + s * 0.28); ctx.lineTo(b.x + s * 0.9, cy - s * 0.3); ctx.stroke();
      break;
    case 'check-filled':
      ctx.fillStyle = '#FFFFFF';
      circle();
      ctx.strokeStyle = color;
      ctx.lineWidth = s * 0.13;
      ctx.beginPath(); ctx.moveTo(cx - s * 0.2, cy + s * 0.01); ctx.lineTo(cx - s * 0.05, cy + s * 0.16); ctx.lineTo(cx + s * 0.22, cy - s * 0.14); ctx.stroke();
      break;
    case 'warning':
      ctx.beginPath();
      ctx.moveTo(cx, b.y + s * 0.04);
      ctx.lineTo(b.x + s * 0.98, b.y + s * 0.92);
      ctx.lineTo(b.x + s * 0.02, b.y + s * 0.92);
      ctx.closePath();
      ctx.lineWidth = s * 0.08;
      ctx.fill();
      ctx.stroke();
      white(() => {
        ctx.lineWidth = s * 0.12;
        ctx.beginPath(); ctx.moveTo(cx, cy - s * 0.12); ctx.lineTo(cx, cy + s * 0.14); ctx.stroke();
        ctx.beginPath(); ctx.arc(cx, cy + s * 0.3, s * 0.065, 0, Math.PI * 2); ctx.fill();
      });
      break;
    case 'error':
      circle();
      white(() => {
        ctx.lineWidth = s * 0.12;
        ctx.beginPath();
        ctx.moveTo(cx - s * 0.17, cy - s * 0.17); ctx.lineTo(cx + s * 0.17, cy + s * 0.17);
        ctx.moveTo(cx + s * 0.17, cy - s * 0.17); ctx.lineTo(cx - s * 0.17, cy + s * 0.17);
        ctx.stroke();
      });
      break;
    case 'star': {
      ctx.beginPath();
      for (let i = 0; i < 10; i++) {
        const t = (-90 + i * 36) * (Math.PI / 180);
        const k = i % 2 ? 0.21 : 0.5;
        ctx.lineTo(cx + Math.cos(t) * s * k, cy + Math.sin(t) * s * k + s * 0.03);
      }
      ctx.closePath();
      ctx.lineWidth = s * 0.08;
      ctx.fill();
      ctx.stroke();
      break;
    }
    case 'flag':
      ctx.lineWidth = s * 0.1;
      ctx.beginPath(); ctx.moveTo(b.x + s * 0.2, b.y + s * 0.95); ctx.lineTo(b.x + s * 0.2, b.y + s * 0.06); ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(b.x + s * 0.2, b.y + s * 0.08);
      ctx.quadraticCurveTo(b.x + s * 0.55, b.y - s * 0.02, b.x + s * 0.88, b.y + s * 0.12);
      ctx.lineTo(b.x + s * 0.88, b.y + s * 0.58);
      ctx.quadraticCurveTo(b.x + s * 0.55, b.y + s * 0.46, b.x + s * 0.2, b.y + s * 0.56);
      ctx.closePath();
      ctx.fill();
      break;
    case 'bolt':
      ctx.beginPath();
      ctx.moveTo(b.x + s * 0.6, b.y);
      ctx.lineTo(b.x + s * 0.18, b.y + s * 0.56);
      ctx.lineTo(b.x + s * 0.48, b.y + s * 0.56);
      ctx.lineTo(b.x + s * 0.38, b.y + s);
      ctx.lineTo(b.x + s * 0.84, b.y + s * 0.4);
      ctx.lineTo(b.x + s * 0.52, b.y + s * 0.4);
      ctx.closePath();
      ctx.fill();
      break;
    case 'calendar':
      ctx.lineWidth = s * 0.1;
      ctx.beginPath(); ctx.roundRect(b.x + s * 0.08, b.y + s * 0.16, s * 0.84, s * 0.76, s * 0.12); ctx.stroke();
      ctx.fillRect(b.x + s * 0.08, b.y + s * 0.16, s * 0.84, s * 0.2);
      ctx.beginPath(); ctx.moveTo(b.x + s * 0.3, b.y + s * 0.04); ctx.lineTo(b.x + s * 0.3, b.y + s * 0.24); ctx.moveTo(b.x + s * 0.7, b.y + s * 0.04); ctx.lineTo(b.x + s * 0.7, b.y + s * 0.24); ctx.stroke();
      for (const [u, v] of [[0.3, 0.55], [0.5, 0.55], [0.7, 0.55], [0.3, 0.74], [0.5, 0.74]] as const) ctx.fillRect(b.x + s * u - s * 0.05, b.y + s * v - s * 0.05, s * 0.1, s * 0.1);
      break;
    case 'sparkles': {
      const sparkle = (px: number, py: number, k: number) => {
        ctx.beginPath();
        for (let i = 0; i < 8; i++) {
          const t = (-90 + i * 45) * (Math.PI / 180);
          const rr = i % 2 ? k * 0.28 : k;
          ctx.lineTo(px + Math.cos(t) * rr, py + Math.sin(t) * rr);
        }
        ctx.closePath();
        ctx.fill();
      };
      sparkle(b.x + s * 0.4, b.y + s * 0.58, s * 0.4);
      sparkle(b.x + s * 0.8, b.y + s * 0.2, s * 0.2);
      sparkle(b.x + s * 0.82, b.y + s * 0.78, s * 0.13);
      break;
    }
  }
  ctx.restore();
}

function scallopBadge(ctx: Ctx2D, b: Rect, color: string, ring: boolean): void {
  const geo = shapeGeometry('scallop', { x: b.x - b.w * 0.06, y: b.y - b.h * 0.06, w: b.w * 1.12, h: b.h * 1.12 });
  ctx.save();
  ctx.shadowColor = 'rgba(15,23,42,0.28)';
  ctx.shadowBlur = b.w * 0.12 * viewScale(ctx);
  ctx.shadowOffsetY = b.w * 0.04 * viewScale(ctx);
  const g = ctx.createLinearGradient(b.x, b.y, b.x, b.y + b.h);
  g.addColorStop(0, shade(color, 0.28));
  g.addColorStop(1, shade(color, -0.12));
  ctx.fillStyle = g;
  ctx.fill(geo.outline);
  ctx.restore();
  if (ring) {
    ctx.save();
    ctx.strokeStyle = alpha('#F5B400', 0.9);
    ctx.lineWidth = Math.max(1, b.w * 0.02);
    ctx.setLineDash([b.w * 0.04, b.w * 0.03]);
    ctx.beginPath();
    ctx.arc(b.x + b.w / 2, b.y + b.h / 2, b.w * 0.4, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#F5B400';
    for (const t of [200, 160, 20, -20]) {
      const rad = (t * Math.PI) / 180;
      ctx.beginPath();
      ctx.arc(b.x + b.w / 2 + Math.cos(rad) * b.w * 0.3, b.y + b.h / 2 + Math.sin(rad) * b.w * 0.3, b.w * 0.022, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}

/** Text inside a badge, centred and sized to fit. */
function badgeText(ctx: Ctx2D, text: string, b: Rect, color: string, font: string, maxK = 0.5): void {
  if (!text) return;
  ctx.save();
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  let size = b.h * maxK;
  ctx.font = `800 ${size}px ${font}`;
  const w = ctx.measureText(text).width;
  if (w > b.w * 0.72) {
    size *= (b.w * 0.72) / w;
    ctx.font = `800 ${size}px ${font}`;
  }
  ctx.fillText(text, b.x + b.w / 2, b.y + b.h / 2 + size * 0.04);
  ctx.restore();
}

/** The callout's line style. Dots are zero-length dashes, which only show with round line ends. */
export function setCalloutDash(ctx: Ctx2D, a: Pick<CalloutAnnotation, 'dash'>, width: number): void {
  if (a.dash === 'dotted') ctx.lineCap = 'round';
  ctx.setLineDash(dashPattern(a.dash ?? 'solid', width));
}

/** True when what is behind the callout shows through its fill. */
export function seeThroughFill(fill: string | undefined): boolean {
  if (isTransparent(fill)) return true;
  const c = (fill ?? '').trim();
  if (/^#[0-9a-f]{8}$/i.test(c)) return !/ff$/i.test(c);
  if (/^#[0-9a-f]{4}$/i.test(c)) return !/f$/i.test(c);
  const rgba = c.match(/^rgba?\(.*[,/]\s*([\d.]+%?)\s*\)$/i);
  return rgba ? parseFloat(rgba[1]!) < (rgba[1]!.endsWith('%') ? 100 : 1) : false;
}

/** Everything except `shape`: for clipping with the 'evenodd' rule. */
function outsideOf(shape: Path2D): Path2D {
  const far = 1e5;
  const p = new Path2D();
  p.rect(-far, -far, far * 2, far * 2);
  p.addPath(shape);
  return p;
}

function tailShape(tail: [Point, Point], tip: Point): Path2D {
  const p = new Path2D();
  p.moveTo(tail[0].x, tail[0].y);
  p.lineTo(tip.x, tip.y);
  p.lineTo(tail[1].x, tail[1].y);
  p.closePath();
  return p;
}

/**
 * Strokes the body and its speech tail as one outline: the body's line opens where the tail starts
 * and the tail's lines stop at the body, so nothing crosses when the fill doesn't hide the overlap.
 */
export function strokeBodyWithTail(ctx: Ctx2D, body: Path2D, tail: [Point, Point], tip: Point): void {
  // A soft shadow would be cut off visibly across the opening.
  ctx.shadowColor = 'transparent';
  ctx.save();
  ctx.clip(outsideOf(tailShape(tail, tip)), 'evenodd');
  ctx.stroke(body);
  ctx.restore();
  ctx.save();
  ctx.clip(outsideOf(body), 'evenodd');
  ctx.beginPath();
  ctx.moveTo(tail[0].x, tail[0].y);
  ctx.lineTo(tip.x, tip.y);
  ctx.lineTo(tail[1].x, tail[1].y);
  ctx.stroke();
  ctx.restore();
}

/** Fills the body and tail once, so a see-through fill isn't darker where they overlap. */
export function fillBodyWithTail(ctx: Ctx2D, body: Path2D, tail: [Point, Point], tip: Point): void {
  ctx.fill(body);
  ctx.save();
  ctx.clip(outsideOf(body), 'evenodd');
  ctx.fill(tailShape(tail, tip));
  ctx.restore();
}

/**
 * Draws the design's body (offset layer, scribble, shadow, fill, line, tail) and its decorations.
 * Text is drawn afterwards by the caller.
 */
export function drawRecipe(ctx: Ctx2D, a: CalloutAnnotation, tail: [Point, Point] | null, layout: { title: Rect | null; band: Rect | null; body: Rect }): void {
  const r = recipeOf(a)!;
  const kind = bodyOf(a, r);
  const rect = { x: a.x, y: a.y, w: a.w, h: a.h };
  const geo = shapeGeometry(kind, rect, a.radius);
  const accent = a.accent ?? a.stroke;
  const lw = Math.max(0, a.strokeWidth);
  const pad = Math.max(6, a.fontSize * 0.6);
  const k = Math.max(0.6, Math.min(2.2, a.fontSize / 18));
  const fills = r.fill !== 'none' && !isTransparent(a.fill);
  const lined = r.line !== 'none' && lw > 0 && !isTransparent(a.stroke);
  const tailPath = (): Path2D | null => {
    if (!tail) return null;
    const p = new Path2D();
    p.moveTo(tail[0].x, tail[0].y);
    p.lineTo(a.tailX, a.tailY);
    p.lineTo(tail[1].x, tail[1].y);
    p.closePath();
    return p;
  };
  const tp = tailPath();
  const tip = { x: a.tailX, y: a.tailY };
  /** The fill doesn't hide where body and tail overlap: they are drawn as one shape. */
  const open = !fills || seeThroughFill(a.fill);

  // Scribble hatch around the body.
  if (r.scribble) {
    const o = pad * 1.6;
    const big = shapeGeometry(kind, { x: a.x - o, y: a.y - o, w: a.w + o * 2, h: a.h + o * 2 }, a.radius + o);
    ctx.save();
    ctx.clip(big.outline);
    ctx.strokeStyle = isTransparent(a.stroke) ? accent : a.stroke;
    ctx.lineWidth = Math.max(1, lw || 1.5);
    const rnd = seeded(Math.round(a.w) + Math.round(a.h) * 7);
    ctx.beginPath();
    const step = Math.max(5, a.fontSize * 0.45);
    let up = true;
    ctx.moveTo(a.x - o, a.y + a.h + o);
    for (let d = 0; d < a.w + a.h + o * 4; d += step) {
      const bx = a.x - o + d;
      if (up) ctx.lineTo(bx + (a.h + o * 2) * 0.6 + rnd() * step, a.y - o);
      else ctx.lineTo(bx - (rnd() - 0.5) * step, a.y + a.h + o);
      up = !up;
    }
    ctx.stroke();
    ctx.restore();
  }

  // Offset layer behind.
  if (r.offset) {
    const o = Math.max(4, pad * 0.7);
    ctx.save();
    ctx.translate(o, o);
    if (r.offset === 'fill') {
      ctx.fillStyle = accent;
      ctx.fill(geo.outline);
      if (tp) ctx.fill(tp);
    } else {
      ctx.strokeStyle = r.line === 'none' && !isTransparent(a.stroke) ? a.stroke : accent;
      ctx.lineWidth = Math.max(1.5, lw || 2);
      setCalloutDash(ctx, a, Math.max(1.5, lw || 2));
      ctx.stroke(geo.outline);
      if (tp) ctx.stroke(tp);
    }
    ctx.restore();
  }

  // Fill with shadow (the tail is part of the same fill, so they join seamlessly).
  const paint = (): string | CanvasGradient => {
    if (r.fill === 'gradient') {
      const g = ctx.createLinearGradient(a.x, a.y, a.x, a.y + a.h);
      g.addColorStop(0, shade(a.fill, 0.42));
      g.addColorStop(1, a.fill);
      return g;
    }
    return a.fill;
  };
  ctx.save();
  if (r.shadow) {
    ctx.shadowColor = 'rgba(15,23,42,0.16)';
    ctx.shadowBlur = 16 * k * viewScale(ctx);
    ctx.shadowOffsetY = 5 * k * viewScale(ctx);
  }
  if (lined && (r.line === 'solid' || r.line === 'double')) {
    ctx.lineWidth = lw;
    ctx.lineJoin = 'round';
    ctx.strokeStyle = a.stroke;
    setCalloutDash(ctx, a, lw);
    if (tail && open) {
      strokeBodyWithTail(ctx, geo.outline, tail, tip);
    } else {
      ctx.stroke(geo.outline);
      ctx.shadowColor = 'transparent';
      if (tp) ctx.stroke(tp);
    }
    ctx.setLineDash([]);
  }
  if (fills) {
    ctx.fillStyle = paint();
    if (tail && open) {
      fillBodyWithTail(ctx, geo.outline, tail, tip);
    } else {
      ctx.fill(geo.outline);
      ctx.shadowColor = 'transparent';
      if (tp) ctx.fill(tp);
    }
  } else if (tp && lined) {
    ctx.shadowColor = 'transparent';
  }
  ctx.restore();

  // Brush: dry streaks across the stroke.
  if (r.fill === 'brush' && fills) {
    ctx.save();
    ctx.clip(geo.outline);
    ctx.strokeStyle = alpha('#FFFFFF', 0.28);
    ctx.lineWidth = Math.max(1, a.h * 0.02);
    const rnd = seeded(Math.round(a.w) * 3 + Math.round(a.h));
    for (let i = 0; i < 5; i++) {
      const yy = a.y + a.h * (0.15 + rnd() * 0.7);
      ctx.beginPath();
      ctx.moveTo(a.x + a.w * rnd() * 0.3, yy);
      ctx.lineTo(a.x + a.w * (0.6 + rnd() * 0.4), yy + (rnd() - 0.5) * a.h * 0.05);
      ctx.stroke();
    }
    ctx.restore();
  }

  // Lines that are not plain outlines.
  ctx.save();
  ctx.strokeStyle = a.stroke;
  ctx.lineWidth = lw;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  if (lined && r.line === 'sketch') {
    sketchRect(ctx, rect, Math.max(1.5, lw), Math.round(a.w) * 11 + Math.round(a.h));
  }
  if (lined && r.line === 'double') {
    const i = Math.max(3, lw * 2.6);
    const inner = shapeGeometry(kind, { x: a.x + i, y: a.y + i, w: a.w - i * 2, h: a.h - i * 2 }, Math.max(0, a.radius - i));
    ctx.lineWidth = Math.max(1, lw * 0.7);
    ctx.stroke(inner.outline);
  }
  if (lined && r.line === 'open') {
    // Outline with gaps where the quote marks sit.
    const q = quoteSize(a);
    setCalloutDash(ctx, a, lw);
    ctx.beginPath();
    ctx.rect(a.x - a.w, a.y - a.h, a.w * 3, a.h * 3);
    ctx.rect(a.x - q * 0.5, a.y - q, q * 1.7, q * 1.8);
    if (r.close !== false) ctx.rect(a.x + a.w - q * 1.15, a.y + a.h - q * 0.8, q * 1.6, q * 1.8);
    ctx.clip('evenodd');
    ctx.stroke(geo.outline);
    if (tp) ctx.stroke(tp);
  }
  ctx.restore();

  // Folded corner / layered shapes from the shape library.
  for (const f of geo.front ?? []) {
    ctx.save();
    ctx.fillStyle = shade(isTransparent(a.fill) ? accent : a.fill, -0.16);
    ctx.fill(f.path);
    if (lined) { ctx.strokeStyle = a.stroke; ctx.lineWidth = lw; ctx.stroke(f.path); }
    ctx.restore();
  }
  if (geo.lines && lined) {
    ctx.save();
    ctx.strokeStyle = a.stroke;
    ctx.lineWidth = lw;
    ctx.stroke(geo.lines);
    ctx.restore();
  }

  // Ribbon fold-under at the bottom left.
  if (r.ribbon) {
    const f = Math.min(a.h * 0.42, a.w * 0.12);
    ctx.save();
    ctx.fillStyle = shade(a.fill, -0.38);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y + a.h);
    ctx.lineTo(a.x + f, a.y + a.h);
    ctx.lineTo(a.x + f, a.y + a.h + f * 0.9);
    ctx.quadraticCurveTo(a.x + f * 0.2, a.y + a.h + f * 0.4, a.x, a.y + a.h);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  if (r.accentBar) {
    ctx.save();
    ctx.clip(geo.outline);
    ctx.fillStyle = accent;
    ctx.fillRect(a.x, a.y, Math.max(4, lw * 2), a.h);
    ctx.restore();
  }

  // Rule lines above and below.
  if (r.rules) {
    ctx.save();
    ctx.strokeStyle = r.fill === 'none' ? a.stroke : shade(isTransparent(a.stroke) ? a.color : a.stroke, 0);
    ctx.lineWidth = Math.max(2, lw || 2.5);
    ctx.lineCap = 'round';
    const o = pad * 0.55;
    ctx.beginPath();
    ctx.moveTo(a.x + a.w * 0.18, a.y - o);
    ctx.lineTo(a.x + a.w * 0.92, a.y - o);
    ctx.moveTo(a.x + a.w * 0.08, a.y + a.h + o);
    ctx.lineTo(a.x + a.w * 0.82, a.y + a.h + o);
    ctx.stroke();
    ctx.restore();
  }

  // Sketch sparks at the top right.
  if (r.sparks) {
    ctx.save();
    ctx.strokeStyle = a.stroke;
    ctx.lineWidth = Math.max(1.5, lw);
    ctx.lineCap = 'round';
    const cx = a.x + a.w + pad * 0.4;
    const cy = a.y - pad * 0.4;
    for (const [t, l] of [[-100, 1], [-55, 1.1], [-15, 0.9]] as const) {
      const rad = (t * Math.PI) / 180;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(rad) * pad * 0.6, cy + Math.sin(rad) * pad * 0.6);
      ctx.lineTo(cx + Math.cos(rad) * pad * (0.6 + l), cy + Math.sin(rad) * pad * (0.6 + l));
      ctx.stroke();
    }
    ctx.restore();
  }

  // Number badges and icons (placed by the text layout, which knows the title size).
  const L = { badge: layout.band, content: layout.body };
  const font = a.titleStyle?.fontFamily ?? a.fontFamily;
  if (L.badge) {
    const b = L.badge;
    switch (r.badge) {
      case 'seal':
        scallopBadge(ctx, b, accent, kind === 'banner');
        badgeText(ctx, a.badge ?? '1', b, '#FFFFFF', font, 0.56);
        break;
      case 'circle': {
        ctx.save();
        const g = ctx.createLinearGradient(b.x, b.y, b.x, b.y + b.h);
        g.addColorStop(0, shade(accent, 0.3));
        g.addColorStop(1, shade(accent, -0.1));
        ctx.fillStyle = g;
        ctx.shadowColor = 'rgba(15,23,42,0.25)';
        ctx.shadowBlur = b.w * 0.12 * viewScale(ctx);
        ctx.beginPath();
        ctx.arc(b.x + b.w / 2, b.y + b.h / 2, b.w / 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        badgeText(ctx, a.badge ?? '1', b, '#FFFFFF', font, 0.56);
        break;
      }
      case 'chip': {
        ctx.save();
        ctx.clip(geo.outline);
        ctx.fillStyle = accent;
        ctx.beginPath();
        ctx.moveTo(b.x, b.y);
        ctx.lineTo(b.x + b.w, b.y);
        ctx.lineTo(b.x, b.y + b.h);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
        badgeText(ctx, a.badge ?? '01', { x: b.x, y: b.y, w: b.w * 0.62, h: b.h * 0.55 }, '#FFFFFF', font, 0.62);
        break;
      }
      case 'peel': {
        ctx.save();
        ctx.clip(geo.outline);
        const g = ctx.createLinearGradient(b.x, b.y, b.x + b.w * 0.6, b.y + b.h * 0.6);
        g.addColorStop(0, shade(accent, 0.25));
        g.addColorStop(0.7, accent);
        g.addColorStop(1, shade(accent, -0.25));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(b.x, b.y);
        ctx.lineTo(b.x + b.w, b.y);
        ctx.quadraticCurveTo(b.x + b.w * 0.55, b.y + b.h * 0.55, b.x, b.y + b.h);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
        ctx.save();
        ctx.translate(b.x + b.w * 0.3, b.y + b.h * 0.3);
        ctx.rotate(-Math.PI / 4);
        badgeText(ctx, a.badge ?? 'Step 01', { x: -b.w * 0.42, y: -b.h * 0.14, w: b.w * 0.84, h: b.h * 0.28 }, '#FFFFFF', font, 0.85);
        ctx.restore();
        break;
      }
      case 'band': {
        ctx.save();
        ctx.clip(geo.outline);
        const g = ctx.createLinearGradient(b.x, b.y, b.x, b.y + b.h);
        g.addColorStop(0, shade(accent, 0.2));
        g.addColorStop(1, accent);
        ctx.fillStyle = g;
        ctx.fillRect(b.x, b.y, b.w, b.h);
        ctx.restore();
        break;
      }
      case 'arc': {
        ctx.save();
        ctx.strokeStyle = accent;
        const cx = a.x + a.w / 2;
        const cy = a.y + a.h / 2;
        const rr = Math.min(a.w, a.h) / 2;
        for (let i = 0; i < 4; i++) {
          ctx.globalAlpha = 1 - i * 0.2;
          ctx.lineWidth = rr * 0.05;
          ctx.beginPath();
          ctx.arc(cx, cy - rr * 0.06, rr * (0.62 - i * 0.05), Math.PI, Math.PI * 1.5);
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
        // Divider between the number and the title, and a rule under them.
        ctx.lineWidth = Math.max(1, rr * 0.012);
        ctx.beginPath();
        ctx.moveTo(cx - rr * 0.02, cy - rr * 0.58);
        ctx.lineTo(cx - rr * 0.02, cy - rr * 0.06);
        ctx.lineTo(cx + rr * 0.6, cy - rr * 0.06);
        ctx.stroke();
        ctx.restore();
        badgeText(ctx, a.badge ?? '01', b, accent, font, 0.95);
        break;
      }
      case 'icon':
        drawBadgeIcon(ctx, a.icon ?? 'info', b, accent);
        break;
      default:
        break;
    }
  }

  // Dotted divider with a glossy dot (step boxes).
  if (r.dots && r.badge !== 'arc') {
    const c = L.content;
    const y = layout.title ? layout.title.y + layout.title.h + pad * 0.6 : -1;
    if (layout.title && y < a.y + a.h - pad) {
      ctx.save();
      ctx.fillStyle = accent;
      ctx.beginPath();
      ctx.arc(c.x + pad * 0.5, y, pad * 0.45, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = alpha('#FFFFFF', 0.55);
      ctx.beginPath();
      ctx.arc(c.x + pad * 0.4, y - pad * 0.12, pad * 0.18, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = accent;
      for (let x = c.x + pad * 1.3; x < c.x + c.w; x += pad * 0.45) {
        ctx.beginPath();
        ctx.arc(x, y, pad * 0.09, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  // Quote marks.
  if (r.quotes) {
    const spots = quoteSpots(a, r);
    const ink = '#101828';
    drawQuote(ctx, r.quotes, true, spots.open.x, spots.open.y, spots.size, accent, ink);
    if (spots.close) drawQuote(ctx, r.quotes, false, spots.close.x, spots.close.y, spots.size, accent, ink);
  }
}

/** Where a recipe's band title sits (band design), else null. */
export function recipeBandTitle(a: CalloutAnnotation, pad: number, titleH: number): Rect | null {
  return recipeLayout(a, pad, titleH).titleInBand;
}
