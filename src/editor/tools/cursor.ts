import type { CursorAnnotation, CursorClick, CursorDesign, CursorEffect, CursorTrail, Rect } from '../types';
import { viewScale, type Ctx2D } from './common';

/**
 * Mouse cursors drawn on a screenshot: a pointer design, an optional click indicator (a small
 * mouse with the pressed button and click marks) and an emphasis effect around the hot spot.
 *
 * Everything is drawn in "units": the design's height is 24 units, scaled so it is `size` pixels
 * tall. The hot spot (the exact point the cursor points at) is the annotation's x / y, so every
 * part scales around it and resizing keeps the cursor pointing at the same place.
 */

const UNITS = 24;

interface DesignDef {
  label: string;
  /** Box of the drawing around the hot spot, in units. */
  box: Rect;
  /** Builds the shape (several overlapping parts are fine: the outline is drawn behind the fill). */
  path?: () => Path2D;
  /** Colours a new cursor of this design starts with. */
  fill: string;
  outline: string;
  /** Fill drawn see-through (touch point). */
  translucent?: boolean;
  /** Line icon: `path` is stroked (outline behind, colour on top) instead of filled. */
  lines?: boolean;
  /** Fully custom drawing in units (multi-colour cursors: pencil, magnifier, recording badge…). */
  draw?: (ctx: Ctx2D, color: string, outline: string) => void;
  /** Emoji cursor (pizza, rocket…), drawn with its point at the hot spot. */
  emoji?: string;
  /** Group in the design picker. */
  group?: CursorGroup;
}

export type CursorGroup = 'classic' | 'gesture' | 'resize' | 'action' | 'shape' | 'themed' | 'recording' | 'creative';

export const CURSOR_GROUPS: Array<{ id: CursorGroup; label: string }> = [
  { id: 'classic', label: 'Classic & system' },
  { id: 'themed', label: 'Themed' },
  { id: 'shape', label: 'Shape' },
  { id: 'recording', label: 'Recording & tutorial' },
  { id: 'gesture', label: 'Hand & gesture' },
  { id: 'resize', label: 'Resize' },
  { id: 'action', label: 'UI & action' },
  { id: 'creative', label: 'Custom & creative' },
];

const ARROW_PTS: Array<[number, number]> = [[0, 0], [0, 21], [5, 16.5], [8.6, 24], [12, 22.6], [8.4, 15.2], [15, 15.2]];

/** Double-headed arrow along +x, centred, `len` long (units). */
function dblArrow(len: number, rot: number): Path2D {
  const h = len / 2;
  const pts: Array<[number, number]> = [[-h, 0], [-h + 5, -4.6], [-h + 5, -1.5], [h - 5, -1.5], [h - 5, -4.6], [h, 0], [h - 5, 4.6], [h - 5, 1.5], [-h + 5, 1.5], [-h + 5, 4.6]];
  const p = new Path2D();
  p.addPath(poly(pts), new DOMMatrix().rotate(rot));
  return p;
}

function handPath(kind: 'open' | 'grab' | 'fist'): Path2D {
  const p = new Path2D();
  const fingers: Array<[number, number]> = kind === 'open' ? [[-6.5, 9], [-2.5, 11], [1.5, 10.5], [5.5, 8.5]] : kind === 'grab' ? [[-6.5, 4.5], [-2.5, 5.5], [1.5, 5.3], [5.5, 4.4]] : [[-6.5, 2.2], [-2.5, 2.6], [1.5, 2.5], [5.5, 2.1]];
  for (const [fx, len] of fingers) rr(p, fx - 1.8, -len, 3.6, len + 3, 1.8);
  rr(p, -8.6, -1, 16.4, 12, 4.4);
  const thumb = new Path2D();
  thumb.roundRect(-13, 1.5, 7, 3.8, 1.9);
  p.addPath(thumb, new DOMMatrix().translate(-8, 4).rotate(kind === 'fist' ? 10 : -30).translate(8, -4));
  return p;
}

function ringPath(r: number, w: number): Path2D {
  const p = new Path2D();
  p.arc(0, 0, r, 0, Math.PI * 2);
  p.moveTo(r - w, 0);
  p.arc(0, 0, r - w, 0, Math.PI * 2, true);
  return p;
}

function arcArrow(full: boolean): Path2D {
  const p = new Path2D();
  const r = 8;
  p.arc(0, 0, r, Math.PI * (full ? 0.15 : 0.1), Math.PI * (full ? 0.95 : 1.75));
  if (full) {
    p.moveTo(-r - 2.6, 2.4);
    p.lineTo(-r, -0.5 + 1.4);
    p.lineTo(-r + 2.8, 2.6);
    p.moveTo(Math.cos(Math.PI * 1.15) * r, Math.sin(Math.PI * 1.15) * r);
    p.arc(0, 0, r, Math.PI * 1.15, Math.PI * 1.95);
    p.moveTo(r + 2.6, -2.4);
    p.lineTo(r, 0.5 - 1.4);
    p.lineTo(r - 2.8, -2.6);
  } else {
    const t = Math.PI * 1.75;
    const ex = Math.cos(t) * r;
    const ey = Math.sin(t) * r;
    p.moveTo(ex - 3.6, ey - 1.2);
    p.lineTo(ex, ey);
    p.lineTo(ex - 0.4, ey + 3.8);
  }
  return p;
}

const fillArrowWith = (paint: (ctx: Ctx2D) => string | CanvasGradient, outline: string | null, glow?: string) => (ctx: Ctx2D, color: string, ol: string) => {
  const path = poly(ARROW_PTS);
  ctx.save();
  if (glow) {
    ctx.shadowColor = glow;
    ctx.shadowBlur = 6 * Math.max(1, viewScale(ctx));
  }
  ctx.strokeStyle = outline ?? ol;
  ctx.lineWidth = 2.4;
  ctx.lineJoin = 'round';
  ctx.stroke(path);
  ctx.shadowColor = 'transparent';
  ctx.fillStyle = paint(ctx) || color;
  ctx.fill(path);
  ctx.restore();
};

function grad(ctx: Ctx2D, a: string, b: string): CanvasGradient {
  const g = ctx.createLinearGradient(0, 0, 12, 22);
  g.addColorStop(0, a);
  g.addColorStop(1, b);
  return g;
}

/** Small arrow with a badge (recording dot, pause bars). */
const arrowWithBadge = (badge: (ctx: Ctx2D) => void) => (ctx: Ctx2D, color: string, outline: string) => {
  const path = poly(ARROW_PTS);
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.strokeStyle = outline;
  ctx.lineWidth = 2.4;
  ctx.stroke(path);
  ctx.fillStyle = color;
  ctx.fill(path);
  badge(ctx);
  ctx.restore();
};

const poly = (pts: Array<[number, number]>): Path2D => {
  const p = new Path2D();
  pts.forEach(([x, y], i) => (i ? p.lineTo(x, y) : p.moveTo(x, y)));
  p.closePath();
  return p;
};

const rr = (p: Path2D, x: number, y: number, w: number, h: number, r: number) => {
  p.roundRect(x, y, w, h, r);
};

export const CURSOR_DESIGNS: Record<CursorDesign, DesignDef> = {
  arrow: {
    label: 'Classic arrow',
    box: { x: 0, y: 0, w: 15, h: 24 },
    path: () => poly([[0, 0], [0, 21], [5, 16.5], [8.6, 24], [12, 22.6], [8.4, 15.2], [15, 15.2]]),
    fill: '#FFFFFF',
    outline: '#000000',
  },
  modern: {
    label: 'Modern arrow',
    box: { x: 0, y: 0, w: 14.5, h: 22.5 },
    path: () => poly([[0, 0], [0, 19.6], [4.7, 15.3], [7.8, 22.5], [10.9, 21.2], [7.9, 14.2], [14.5, 14.2]]),
    fill: '#101828',
    outline: '#FFFFFF',
  },
  pointer: {
    label: 'Pointer',
    box: { x: 0, y: 0, w: 19, h: 19 },
    path: () => poly([[0, 0], [19, 7.4], [10.2, 10.2], [7.4, 19]]),
    fill: '#4F6BED',
    outline: '#FFFFFF',
  },
  hand: {
    label: 'Hand (link)',
    box: { x: -8, y: 0, w: 18, h: 23 },
    path: () => {
      const p = new Path2D();
      rr(p, -2, 0, 4, 13, 2); // index finger
      rr(p, 2, 6, 3.6, 8, 1.8);
      rr(p, 5.6, 7, 3.4, 7.5, 1.7);
      rr(p, 9, 8.5, 1, 6, 0.5);
      rr(p, -4, 11, 14, 12, 4); // palm
      const thumb = new Path2D();
      thumb.roundRect(-8, 11.5, 7, 4.4, 2.2);
      p.addPath(thumb, new DOMMatrix().translate(-4.5, 13.7).rotate(35).translate(4.5, -13.7));
      return p;
    },
    fill: '#FFFFFF',
    outline: '#000000',
  },
  ibeam: {
    label: 'Text (I-beam)',
    box: { x: -4.5, y: -12, w: 9, h: 24 },
    path: () => {
      const p = new Path2D();
      rr(p, -4.5, -12, 9, 2, 0.6);
      rr(p, -4.5, 10, 9, 2, 0.6);
      rr(p, -1, -12, 2, 24, 0.6);
      return p;
    },
    fill: '#101828',
    outline: '#FFFFFF',
  },
  crosshair: {
    label: 'Crosshair',
    box: { x: -12, y: -12, w: 24, h: 24 },
    path: () => {
      const p = new Path2D();
      rr(p, -12, -1, 9.5, 2, 0.6);
      rr(p, 2.5, -1, 9.5, 2, 0.6);
      rr(p, -1, -12, 2, 9.5, 0.6);
      rr(p, -1, 2.5, 2, 9.5, 0.6);
      p.arc(0, 0, 1.4, 0, Math.PI * 2);
      return p;
    },
    fill: '#E05252',
    outline: '#FFFFFF',
  },
  dot: {
    label: 'Presenter dot',
    box: { x: -6, y: -6, w: 12, h: 12 },
    path: () => {
      const p = new Path2D();
      p.arc(0, 0, 6, 0, Math.PI * 2);
      return p;
    },
    fill: '#E05252',
    outline: '#FFFFFF',
  },
  touch: {
    label: 'Touch point',
    box: { x: -10, y: -10, w: 20, h: 20 },
    path: () => {
      const p = new Path2D();
      p.arc(0, 0, 10, 0, Math.PI * 2);
      return p;
    },
    fill: '#4F6BED',
    outline: '#FFFFFF',
    translucent: true,
  },
  outlined: { label: 'Outlined arrow', box: { x: 0, y: 0, w: 15, h: 24 }, path: () => poly(ARROW_PTS), fill: '#FFFFFF', outline: '#9CA3AF', group: 'classic' },
  /* hand & gesture */
  grab: { label: 'Grab', box: { x: -10, y: -6.5, w: 18, h: 18 }, path: () => handPath('grab'), fill: '#FFFFFF', outline: '#111827', group: 'gesture' },
  pan: { label: 'Pan (open hand)', box: { x: -11, y: -11, w: 19, h: 22 }, path: () => handPath('open'), fill: '#FFFFFF', outline: '#111827', group: 'gesture' },
  drag: { label: 'Drag (fist)', box: { x: -10, y: -4, w: 18, h: 15 }, path: () => handPath('fist'), fill: '#FFFFFF', outline: '#111827', group: 'gesture' },
  move: {
    label: 'Move', box: { x: -12, y: -12, w: 24, h: 24 }, group: 'gesture', fill: '#111827', outline: '#FFFFFF',
    path: () => { const p = dblArrow(24, 0); p.addPath(dblArrow(24, 90)); return p; },
  },
  'not-allowed': {
    label: 'Not allowed', box: { x: -10, y: -10, w: 20, h: 20 }, group: 'gesture', fill: '#E5484D', outline: '#FFFFFF',
    path: () => { const p = ringPath(10, 3); const s = new Path2D(); s.rect(-8.5, -1.6, 17, 3.2); p.addPath(s, new DOMMatrix().rotate(45)); return p; },
  },
  /* resize */
  'resize-h': { label: 'Resize horizontal', box: { x: -12, y: -5, w: 24, h: 10 }, path: () => dblArrow(24, 0), fill: '#111827', outline: '#FFFFFF', group: 'resize' },
  'resize-v': { label: 'Resize vertical', box: { x: -5, y: -12, w: 10, h: 24 }, path: () => dblArrow(24, 90), fill: '#111827', outline: '#FFFFFF', group: 'resize' },
  'resize-ne': { label: 'Resize ↗', box: { x: -10, y: -10, w: 20, h: 20 }, path: () => dblArrow(26, -45), fill: '#111827', outline: '#FFFFFF', group: 'resize' },
  'resize-nw': { label: 'Resize ↖', box: { x: -10, y: -10, w: 20, h: 20 }, path: () => dblArrow(26, 45), fill: '#111827', outline: '#FFFFFF', group: 'resize' },
  'resize-corner': {
    label: 'Resize corner', box: { x: 0, y: 0, w: 16, h: 16 }, group: 'resize', fill: '#111827', outline: '#FFFFFF',
    path: () => { const p = new Path2D(); p.rect(0, 0, 16, 3); p.rect(0, 0, 3, 16); return p; },
  },
  'resize-all': {
    label: 'Resize all', box: { x: -12, y: -12, w: 24, h: 24 }, group: 'resize', fill: '#111827', outline: '#FFFFFF',
    path: () => { const p = dblArrow(30, 45); p.addPath(dblArrow(30, -45)); return p; },
  },
  /* UI & action (line icons) */
  add: { label: 'Add', box: { x: -9, y: -9, w: 18, h: 18 }, lines: true, path: () => { const p = new Path2D(); p.moveTo(-8, 0); p.lineTo(8, 0); p.moveTo(0, -8); p.lineTo(0, 8); return p; }, fill: '#111827', outline: '#FFFFFF', group: 'action' },
  remove: { label: 'Remove', box: { x: -9, y: -2, w: 18, h: 4 }, lines: true, path: () => { const p = new Path2D(); p.moveTo(-8, 0); p.lineTo(8, 0); return p; }, fill: '#111827', outline: '#FFFFFF', group: 'action' },
  rotate: { label: 'Rotate', box: { x: -11, y: -11, w: 22, h: 22 }, lines: true, path: () => arcArrow(true), fill: '#1D4ED8', outline: '#FFFFFF', group: 'action' },
  refresh: { label: 'Refresh', box: { x: -10, y: -10, w: 20, h: 20 }, lines: true, path: () => arcArrow(false), fill: '#1D4ED8', outline: '#FFFFFF', group: 'action' },
  link: {
    label: 'Link', box: { x: -11, y: -11, w: 22, h: 22 }, lines: true, group: 'action', fill: '#1E3A8A', outline: '#FFFFFF',
    path: () => { const p = new Path2D(); const l = new Path2D(); l.roundRect(-9, -3.5, 11, 7, 3.5); p.addPath(l, new DOMMatrix().rotate(-45).translate(-2, 0)); p.addPath(l, new DOMMatrix().rotate(-45).translate(9, 0)); return p; },
  },
  picker: {
    label: 'Colour picker', box: { x: 0, y: -16, w: 16, h: 16 }, group: 'action', fill: '#111827', outline: '#FFFFFF',
    draw: (ctx, color, outline) => {
      ctx.save();
      ctx.rotate(-Math.PI / 4);
      ctx.lineJoin = 'round';
      const body = new Path2D();
      body.moveTo(0, 0);
      body.lineTo(3, -1.6);
      body.lineTo(15, -1.6);
      body.lineTo(15, 1.6);
      body.lineTo(3, 1.6);
      body.closePath();
      body.roundRect(15, -3.6, 7, 7.2, 2);
      ctx.strokeStyle = outline;
      ctx.lineWidth = 2.4;
      ctx.stroke(body);
      ctx.fillStyle = '#CBD5E1';
      ctx.fill(body);
      ctx.fillStyle = color;
      ctx.fillRect(15, -3.6, 7, 7.2);
      ctx.fillStyle = '#38BDF8';
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(4, -1.6);
      ctx.lineTo(4, 1.6);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    },
  },
  /* shapes */
  heart: {
    label: 'Heart', box: { x: -11, y: -10, w: 22, h: 20 }, group: 'shape', fill: '#F43F5E', outline: '#FFFFFF',
    path: () => { const p = new Path2D(); p.moveTo(0, 9); p.bezierCurveTo(-14, 0, -10, -13, 0, -5); p.bezierCurveTo(10, -13, 14, 0, 0, 9); p.closePath(); return p; },
  },
  star: {
    label: 'Star', box: { x: -11, y: -11, w: 22, h: 21 }, group: 'shape', fill: '#FACC15', outline: '#B45309',
    path: () => poly(Array.from({ length: 10 }, (_, i) => { const r = i % 2 ? 4.6 : 11; const t = -Math.PI / 2 + (Math.PI / 5) * i; return [Math.cos(t) * r, Math.sin(t) * r] as [number, number]; })),
  },
  pencil: {
    label: 'Pencil', box: { x: 0, y: -18, w: 18, h: 18 }, group: 'shape', fill: '#FACC15', outline: '#111827',
    draw: (ctx, color, outline) => {
      ctx.save();
      ctx.rotate(-Math.PI / 4);
      ctx.lineJoin = 'round';
      const all = new Path2D();
      all.moveTo(0, 0);
      all.lineTo(6, -3);
      all.lineTo(22, -3);
      all.lineTo(22, 3);
      all.lineTo(6, 3);
      all.closePath();
      ctx.strokeStyle = outline;
      ctx.lineWidth = 2.2;
      ctx.stroke(all);
      ctx.fillStyle = color;
      ctx.fillRect(6, -3, 13, 6);
      ctx.fillStyle = '#F9A8D4';
      ctx.fillRect(19, -3, 3, 6);
      ctx.fillStyle = '#F5D0A9';
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(6, -3);
      ctx.lineTo(6, 3);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#111827';
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(2.2, -1.1);
      ctx.lineTo(2.2, 1.1);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    },
  },
  eraser: {
    label: 'Eraser', box: { x: 0, y: -16, w: 18, h: 18 }, group: 'shape', fill: '#F9A8D4', outline: '#111827',
    draw: (ctx, color, outline) => {
      ctx.save();
      ctx.rotate(-Math.PI / 4);
      const b = new Path2D();
      b.roundRect(0, -4.5, 20, 9, 2);
      ctx.strokeStyle = outline;
      ctx.lineWidth = 2.2;
      ctx.stroke(b);
      ctx.fillStyle = '#FFFFFF';
      ctx.fill(b);
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.roundRect(0, -4.5, 8, 9, [2, 0, 0, 2]);
      ctx.fill();
      ctx.restore();
    },
  },
  magnify: {
    label: 'Magnify', box: { x: -8, y: -8, w: 20, h: 20 }, group: 'shape', fill: '#BFDBFE', outline: '#111827',
    draw: (ctx, color, outline) => {
      ctx.save();
      ctx.lineCap = 'round';
      ctx.strokeStyle = outline;
      ctx.lineWidth = 3.6;
      ctx.beginPath();
      ctx.moveTo(5.5, 5.5);
      ctx.lineTo(11, 11);
      ctx.stroke();
      ctx.fillStyle = alphaOf(color, 0.7);
      ctx.beginPath();
      ctx.arc(0, 0, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = 2.2;
      ctx.stroke();
      ctx.restore();
    },
  },
  target: {
    label: 'Target', box: { x: -11, y: -11, w: 22, h: 22 }, group: 'shape', fill: '#E5484D', outline: '#FFFFFF',
    draw: (ctx, color, outline) => {
      ctx.save();
      ctx.lineCap = 'round';
      for (const [w, c] of [[4.2, outline], [2.2, color]] as Array<[number, string]>) {
        ctx.strokeStyle = c;
        ctx.lineWidth = w;
        ctx.beginPath();
        ctx.arc(0, 0, 7, 0, Math.PI * 2);
        ctx.moveTo(0, -11); ctx.lineTo(0, -4);
        ctx.moveTo(0, 4); ctx.lineTo(0, 11);
        ctx.moveTo(-11, 0); ctx.lineTo(-4, 0);
        ctx.moveTo(4, 0); ctx.lineTo(11, 0);
        ctx.stroke();
      }
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(0, 0, 1.8, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    },
  },
  /* themed */
  gradient: { label: 'Gradient', box: { x: 0, y: 0, w: 15, h: 24 }, path: () => poly(ARROW_PTS), fill: '#7C3AED', outline: '#FFFFFF', group: 'themed', draw: fillArrowWith((ctx) => grad(ctx, '#A855F7', '#3B82F6'), null) },
  neon: { label: 'Neon', box: { x: -3, y: -3, w: 21, h: 30 }, path: () => poly(ARROW_PTS), fill: '#0B1220', outline: '#22D3EE', group: 'themed', draw: fillArrowWith(() => '', null, '#22D3EE') },
  pastel: { label: 'Pastel', box: { x: 0, y: 0, w: 15, h: 24 }, path: () => poly(ARROW_PTS), fill: '#FBCFE8', outline: '#FFFFFF', group: 'themed', draw: fillArrowWith((ctx) => grad(ctx, '#C4B5FD', '#FDBA74'), null) },
  gaming: {
    label: 'Gaming', box: { x: 0, y: 0, w: 16, h: 22 }, group: 'themed', fill: '#E11D48', outline: '#111827',
    path: () => poly([[0, 0], [16, 13], [9, 13.5], [12.5, 21], [9.5, 22], [6.2, 14.6], [1.5, 19.5]]),
    draw: (ctx, color, outline) => {
      const p = poly([[0, 0], [16, 13], [9, 13.5], [12.5, 21], [9.5, 22], [6.2, 14.6], [1.5, 19.5]]);
      ctx.lineJoin = 'round';
      ctx.strokeStyle = outline;
      ctx.lineWidth = 2.4;
      ctx.stroke(p);
      ctx.fillStyle = grad(ctx, '#FB7185', color);
      ctx.fill(p);
    },
  },
  pixel: {
    label: 'Pixel', box: { x: 0, y: 0, w: 12, h: 19 }, group: 'themed', fill: '#FFFFFF', outline: '#111827',
    path: () => poly([[0, 0], [0, 16], [3, 13], [3, 14], [5, 18], [7, 18], [7, 17], [6, 14], [5, 13], [5, 12], [10, 12], [10, 11], [1, 2], [1, 1]]),
  },
  plane: {
    label: 'Paper plane', box: { x: 0, y: -4, w: 22, h: 18 }, group: 'themed', fill: '#3B82F6', outline: '#FFFFFF',
    draw: (ctx, color, outline) => {
      const p = poly([[0, 0], [22, -4], [8, 13], [6, 6]]);
      ctx.lineJoin = 'round';
      ctx.strokeStyle = outline;
      ctx.lineWidth = 2.2;
      ctx.stroke(p);
      ctx.fillStyle = color;
      ctx.fill(p);
      ctx.fillStyle = shadeOf(color, -0.3);
      ctx.fill(poly([[6, 6], [22, -4], [8, 13]]));
    },
  },
  /* recording & tutorial */
  recording: {
    label: 'Recording', box: { x: 0, y: -8, w: 23, h: 32 }, path: () => poly(ARROW_PTS), fill: '#FFFFFF', outline: '#111827', group: 'recording',
    draw: arrowWithBadge((ctx) => {
      ctx.fillStyle = '#EF4444';
      ctx.beginPath();
      ctx.arc(15.5, -1, 6.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#FFFFFF';
      ctx.beginPath();
      ctx.moveTo(13.6, -4);
      ctx.lineTo(18.4, -1);
      ctx.lineTo(13.6, 2);
      ctx.closePath();
      ctx.fill();
    }),
  },
  pause: {
    label: 'Pause', box: { x: 0, y: -8, w: 21, h: 32 }, path: () => poly(ARROW_PTS), fill: '#FFFFFF', outline: '#111827', group: 'recording',
    draw: arrowWithBadge((ctx) => {
      ctx.fillStyle = '#3B82F6';
      ctx.beginPath();
      ctx.roundRect(12, -7, 3, 9, 1);
      ctx.roundRect(17, -7, 3, 9, 1);
      ctx.fill();
    }),
  },
  play: { label: 'Play', box: { x: -7, y: -9, w: 17, h: 18 }, path: () => poly([[-7, -9], [10, 0], [-7, 9]]), fill: '#FFFFFF', outline: '#111827', group: 'recording' },
  focus: {
    label: 'Focus ring', box: { x: -11, y: -11, w: 22, h: 22 }, group: 'recording', fill: '#EF4444', outline: '#FFFFFF',
    path: () => ringPath(11, 3.4),
  },
  /* custom & creative (emoji) */
  pizza: { label: 'Pizza', box: { x: -2, y: -2, w: 24, h: 24 }, path: () => new Path2D(), fill: '#FFFFFF', outline: '#000000', emoji: '🍕', group: 'creative' },
  rocket: { label: 'Rocket', box: { x: -2, y: -2, w: 24, h: 24 }, path: () => new Path2D(), fill: '#FFFFFF', outline: '#000000', emoji: '🚀', group: 'creative' },
  sword: { label: 'Sword', box: { x: -2, y: -2, w: 24, h: 24 }, path: () => new Path2D(), fill: '#FFFFFF', outline: '#000000', emoji: '🗡️', group: 'creative' },
  dart: { label: 'Dart', box: { x: -2, y: -2, w: 24, h: 24 }, path: () => new Path2D(), fill: '#FFFFFF', outline: '#000000', emoji: '🎯', group: 'creative' },
  leaf: { label: 'Leaf', box: { x: -2, y: -2, w: 24, h: 24 }, path: () => new Path2D(), fill: '#FFFFFF', outline: '#000000', emoji: '🍃', group: 'creative' },
  lightning: { label: 'Lightning', box: { x: -2, y: -2, w: 24, h: 24 }, path: () => new Path2D(), fill: '#FFFFFF', outline: '#000000', emoji: '⚡', group: 'creative' },
};

function alphaOf(color: string, a: number): string {
  return rgba(color, a);
}

function shadeOf(color: string, amount: number): string {
  const m = /^#?([0-9a-f]{6})/i.exec(color);
  if (!m) return color;
  const n = parseInt(m[1]!, 16);
  const t = amount > 0 ? 255 : 0;
  const k = Math.abs(amount);
  const mix = (v: number) => Math.round(v + (t - v) * k);
  return `rgb(${mix((n >> 16) & 255)}, ${mix((n >> 8) & 255)}, ${mix(n & 255)})`;
}

/** Picker group of a design (the original eight are classic). */
export function cursorGroupOf(d: CursorDesign): CursorGroup {
  return CURSOR_DESIGNS[d]?.group ?? 'classic';
}

export const CURSOR_TRAILS: Array<{ value: CursorTrail; label: string }> = [
  { value: 'none', label: 'None' }, { value: 'trail', label: 'Trail' }, { value: 'dots', label: 'Dotted trail' }, { value: 'ghost', label: 'Ghost' },
  { value: 'bounce', label: 'Bounce' }, { value: 'wave', label: 'Wavy' }, { value: 'loading', label: 'Loading' }, { value: 'signal', label: 'Signal' },
];

export const CURSOR_DESIGN_IDS = Object.keys(CURSOR_DESIGNS) as CursorDesign[];

/** One-click looks (design + click + effect + colours), as in the Cursor & Click Effects sheet. */
export const CURSOR_LOOKS: Array<{ id: string; label: string; patch: Partial<CursorAnnotation> }> = [
  { id: 'plain', label: 'Plain arrow', patch: { design: 'arrow', color: '#FFFFFF', outline: '#111827', click: 'none', effect: 'none' } },
  { id: 'soft', label: 'Soft halo', patch: { design: 'arrow', color: '#FFFFFF', outline: '#6D3FE0', click: 'none', effect: 'glow', effectColor: '#C4B5FD', effectSize: 1.1 } },
  { id: 'purple-ring', label: 'Purple rings', patch: { design: 'arrow', color: '#FFFFFF', outline: '#111827', click: 'none', effect: 'ripple', effectColor: '#8B5CF6', effectSize: 1.1 } },
  { id: 'red-ring', label: 'Red rings', patch: { design: 'arrow', color: '#FFFFFF', outline: '#111827', click: 'none', effect: 'ripple', effectColor: '#F05252', effectSize: 1.1 } },
  { id: 'hand-yellow', label: 'Hand · yellow rays', patch: { design: 'hand', color: '#FFFFFF', outline: '#111827', click: 'none', effect: 'rays', effectColor: '#F5B400', effectSize: 1 } },
  { id: 'hand-red', label: 'Hand · red rays', patch: { design: 'hand', color: '#FFFFFF', outline: '#111827', click: 'none', effect: 'rays', effectColor: '#E5484D', effectSize: 1 } },
  { id: 'dot-purple', label: 'Purple target', patch: { design: 'dot', color: '#7C3AED', outline: '#FFFFFF', click: 'none', effect: 'target', effectColor: '#8B5CF6', effectSize: 1.3 } },
  { id: 'dot-red', label: 'Red target', patch: { design: 'dot', color: '#E5484D', outline: '#FFFFFF', click: 'none', effect: 'target', effectColor: '#F87171', effectSize: 1.3 } },
  { id: 'click-pink', label: 'Pink click', patch: { design: 'arrow', color: '#FFFFFF', outline: '#111827', click: 'left', clickColor: '#F43F5E', effect: 'glow', effectColor: '#FDA4AF', effectSize: 1 } },
  { id: 'click-blue', label: 'Blue rings', patch: { design: 'arrow', color: '#FFFFFF', outline: '#111827', click: 'none', effect: 'target', effectColor: '#38BDF8', effectSize: 1.2 } },
  // Highlight cursors
  { id: 'glow-red', label: 'Red glow', patch: { design: 'arrow', color: '#FFFFFF', outline: '#111827', click: 'none', effect: 'glow', effectColor: '#F87171', effectSize: 1.1, trail: 'none' } },
  { id: 'glow-yellow', label: 'Yellow glow', patch: { design: 'arrow', color: '#FFFFFF', outline: '#111827', click: 'none', effect: 'glow', effectColor: '#FDE047', effectSize: 1.1, trail: 'none' } },
  { id: 'glow-blue', label: 'Blue glow', patch: { design: 'arrow', color: '#FFFFFF', outline: '#111827', click: 'none', effect: 'glow', effectColor: '#60A5FA', effectSize: 1.1, trail: 'none' } },
  { id: 'glow-green', label: 'Green glow', patch: { design: 'arrow', color: '#FFFFFF', outline: '#111827', click: 'none', effect: 'glow', effectColor: '#4ADE80', effectSize: 1.1, trail: 'none' } },
  { id: 'halo-pink', label: 'Halo', patch: { design: 'arrow', color: '#FFFFFF', outline: '#111827', click: 'none', effect: 'halo', effectColor: '#E879F9', effectSize: 1.1, trail: 'none' } },
  // Click effect cursors
  { id: 'rays-red', label: 'Click (red)', patch: { design: 'arrow', color: '#FFFFFF', outline: '#111827', click: 'none', effect: 'burst', effectColor: '#EF4444', effectSize: 0.9, trail: 'none' } },
  { id: 'rays-blue', label: 'Click (blue)', patch: { design: 'arrow', color: '#FFFFFF', outline: '#111827', click: 'none', effect: 'burst', effectColor: '#38BDF8', effectSize: 0.9, trail: 'none' } },
  { id: 'rays-yellow', label: 'Click (yellow)', patch: { design: 'arrow', color: '#FFFFFF', outline: '#111827', click: 'none', effect: 'burst', effectColor: '#FACC15', effectSize: 0.9, trail: 'none' } },
  { id: 'ripple-green', label: 'Ripple', patch: { design: 'arrow', color: '#FFFFFF', outline: '#111827', click: 'none', effect: 'pulse', effectColor: '#22C55E', effectSize: 1, trail: 'none' } },
  { id: 'pulse-pink', label: 'Pulse', patch: { design: 'arrow', color: '#FFFFFF', outline: '#111827', click: 'none', effect: 'emphasis', effectColor: '#F472B6', effectSize: 1, trail: 'none' } },
  // Animated looks (still frame)
  { id: 'trail', label: 'Trail', patch: { design: 'arrow', color: '#FFFFFF', outline: '#111827', click: 'none', effect: 'none', effectColor: '#F43F5E', trail: 'trail' } },
  { id: 'dots', label: 'Dotted trail', patch: { design: 'arrow', color: '#FFFFFF', outline: '#111827', click: 'none', effect: 'none', effectColor: '#9CA3AF', trail: 'dots' } },
  { id: 'ghost', label: 'Ghost', patch: { design: 'arrow', color: '#FFFFFF', outline: '#111827', click: 'none', effect: 'none', effectColor: '#A78BFA', trail: 'ghost' } },
  { id: 'signal', label: 'Bounce', patch: { design: 'arrow', color: '#FFFFFF', outline: '#111827', click: 'none', effect: 'none', effectColor: '#A855F7', trail: 'signal' } },
  { id: 'wavy', label: 'Wavy', patch: { design: 'arrow', color: '#FFFFFF', outline: '#111827', click: 'none', effect: 'none', effectColor: '#D946EF', trail: 'wave' } },
  { id: 'loading', label: 'Loading', patch: { design: 'arrow', color: '#FFFFFF', outline: '#111827', click: 'none', effect: 'none', effectColor: '#A855F7', trail: 'loading' } },
  // Use cases
  { id: 'tutorial', label: 'Tutorial', patch: { design: 'arrow', color: '#FFFFFF', outline: '#111827', click: 'none', effect: 'ripple', effectColor: '#C026D3', effectSize: 1.2, trail: 'none' } },
  { id: 'presentation', label: 'Presentation', patch: { design: 'arrow', color: '#FFFFFF', outline: '#111827', click: 'none', effect: 'spotlight', effectColor: '#FACC15', effectSize: 1, trail: 'none' } },
  { id: 'spotlight-y', label: 'Spotlight', patch: { design: 'arrow', color: '#FFFFFF', outline: '#111827', click: 'none', effect: 'glow', effectColor: '#FEF08A', effectSize: 1.6, trail: 'none' } },
  { id: 'emphasis', label: 'Emphasis', patch: { design: 'arrow', color: '#FFFFFF', outline: '#111827', click: 'none', effect: 'emphasis', effectColor: '#EC4899', effectSize: 1.1, trail: 'none' } },
];

export const CURSOR_CLICKS: Array<{ value: CursorClick; label: string }> = [
  { value: 'none', label: 'None' },
  { value: 'left', label: 'Left click' },
  { value: 'right', label: 'Right click' },
  { value: 'double', label: 'Double click' },
];

export const CURSOR_EFFECTS: Array<{ value: CursorEffect; label: string; description: string }> = [
  { value: 'none', label: 'None', description: 'Just the cursor' },
  { value: 'ring', label: 'Click ring', description: 'One ring around the click point' },
  { value: 'ripple', label: 'Ripple', description: 'Rings spreading from the click' },
  { value: 'glow', label: 'Glow', description: 'Soft coloured highlight' },
  { value: 'halo', label: 'Halo', description: 'Tinted circle with a ring' },
  { value: 'burst', label: 'Burst', description: 'Rays around the click point' },
  { value: 'spotlight', label: 'Spotlight', description: 'Dims everything except the area around the cursor' },
  { value: 'target', label: 'Target', description: 'Soft filled rings with a centre ring' },
  { value: 'rays', label: 'Click rays', description: 'Short rays above the click point' },
  { value: 'pulse', label: 'Pulse', description: 'Filled rings fading outwards' },
  { value: 'emphasis', label: 'Emphasis', description: 'Bold double ring with a soft centre' },
];

/** How far each effect reaches, as a multiple of the effect radius. */
const EFFECT_REACH: Record<CursorEffect, number> = { none: 0, ring: 1.05, ripple: 1.1, glow: 1.25, halo: 1.05, burst: 1.35, spotlight: 1.6, target: 1.05, rays: 1.2, pulse: 1.1, emphasis: 1.1 };

/** Pixels per unit. */
const unit = (a: Pick<CursorAnnotation, 'size'>) => Math.max(1, a.size) / UNITS;

/** Radius of the effect around the hot spot (pixels). */
export function effectRadius(a: Pick<CursorAnnotation, 'size' | 'effectSize'>): number {
  return Math.max(1, a.size) * 0.62 * (a.effectSize ?? 1);
}

/** Where the small mouse of the click indicator sits (units, relative to the hot spot). */
function mouseBox(design: CursorDesign): Rect {
  const b = CURSOR_DESIGNS[design].box;
  return { x: b.x + b.w + 2, y: Math.max(b.y, 0) + 7, w: 11, h: 16 };
}

/** Click marks (three short strokes up-left of the hot spot): start radius and length, in units. */
function marksReach(design: CursorDesign): { from: number; len: number } {
  const b = CURSOR_DESIGNS[design].box;
  // Centred designs (dot, I-beam, crosshair, touch) get their marks outside the shape.
  const from = b.x < 0 && b.y < 0 ? Math.hypot(b.x, b.y) * 0.75 + 1.5 : 3.2;
  return { from, len: 4.6 };
}

function unionRect(a: Rect, b: Rect): Rect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}

/** Everything the cursor draws (design, click indicator and effect), in page pixels. */
export function cursorBounds(a: CursorAnnotation): Rect {
  const k = unit(a);
  const toPage = (r: Rect): Rect => ({ x: a.x + r.x * k, y: a.y + r.y * k, w: r.w * k, h: r.h * k });
  const def = CURSOR_DESIGNS[a.design] ?? CURSOR_DESIGNS.arrow;
  let box = toPage(def.box);
  if (a.click !== 'none') {
    box = unionRect(box, toPage(mouseBox(a.design)));
    const m = marksReach(a.design);
    const r = m.from + m.len + 1;
    box = unionRect(box, toPage({ x: -r, y: -r, w: r, h: r })); // click marks
  }
  if (a.effect !== 'none') {
    const r = effectRadius(a) * (EFFECT_REACH[a.effect] ?? 1.2);
    box = unionRect(box, { x: a.x - r, y: a.y - r, w: r * 2, h: r * 2 });
  }
  if (a.trail && a.trail !== 'none') {
    const r = Math.max(1, a.size) * 1.1;
    box = unionRect(box, { x: a.x - r, y: a.y - r, w: r * 2, h: r * 2 });
  }
  return box;
}

function rgba(color: string, alpha: number): string {
  const m = /^#?([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(color);
  if (!m) return color;
  const n = parseInt(m[1]!, 16);
  const base = m[2] ? parseInt(m[2], 16) / 255 : 1;
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${+(alpha * base).toFixed(3)})`;
}

function drawEffect(ctx: Ctx2D, a: CursorAnnotation): void {
  const R = effectRadius(a);
  const c = a.effectColor;
  const lw = Math.max(1.5, a.size * 0.06);
  ctx.save();
  switch (a.effect) {
    case 'ring':
      ctx.strokeStyle = c;
      ctx.lineWidth = lw;
      ctx.beginPath();
      ctx.arc(a.x, a.y, R, 0, Math.PI * 2);
      ctx.stroke();
      break;
    case 'ripple':
      [0.42, 0.72, 1.02].forEach((f, i) => {
        ctx.strokeStyle = rgba(c, [0.95, 0.6, 0.3][i]!);
        ctx.lineWidth = lw * [1.1, 0.9, 0.7][i]!;
        ctx.beginPath();
        ctx.arc(a.x, a.y, R * f, 0, Math.PI * 2);
        ctx.stroke();
      });
      break;
    case 'glow': {
      const g = ctx.createRadialGradient(a.x, a.y, 0, a.x, a.y, R * 1.25);
      g.addColorStop(0, rgba(c, 0.6));
      g.addColorStop(0.55, rgba(c, 0.3));
      g.addColorStop(1, rgba(c, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(a.x, a.y, R * 1.25, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'halo':
      ctx.fillStyle = rgba(c, 0.3);
      ctx.strokeStyle = c;
      ctx.lineWidth = lw * 0.8;
      ctx.beginPath();
      ctx.arc(a.x, a.y, R, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      break;
    case 'target':
      // Concentric tinted discs and a bold inner ring.
      ctx.fillStyle = rgba(c, 0.16);
      ctx.beginPath();
      ctx.arc(a.x, a.y, R, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = rgba(c, 0.22);
      ctx.beginPath();
      ctx.arc(a.x, a.y, R * 0.68, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = rgba(c, 0.9);
      ctx.lineWidth = lw;
      ctx.beginPath();
      ctx.arc(a.x, a.y, R * 0.42, 0, Math.PI * 2);
      ctx.stroke();
      break;
    case 'rays':
      ctx.strokeStyle = c;
      ctx.lineWidth = lw;
      ctx.lineCap = 'round';
      for (let i = 0; i < 5; i++) {
        const t = ((-160 + i * 35) * Math.PI) / 180;
        ctx.beginPath();
        ctx.moveTo(a.x + Math.cos(t) * R * 0.62, a.y + Math.sin(t) * R * 0.62);
        ctx.lineTo(a.x + Math.cos(t) * R * 1.15, a.y + Math.sin(t) * R * 1.15);
        ctx.stroke();
      }
      break;
    case 'burst':
      ctx.strokeStyle = c;
      ctx.lineWidth = lw;
      ctx.lineCap = 'round';
      for (let i = 0; i < 8; i++) {
        const t = (i / 8) * Math.PI * 2 + Math.PI / 8;
        ctx.beginPath();
        ctx.moveTo(a.x + Math.cos(t) * R * 0.75, a.y + Math.sin(t) * R * 0.75);
        ctx.lineTo(a.x + Math.cos(t) * R * 1.3, a.y + Math.sin(t) * R * 1.3);
        ctx.stroke();
      }
      break;
    case 'spotlight': {
      // Dim everything outside a soft circle (annotations are clipped to the image, so the
      // oversized rectangle never spills into the frame).
      const r = R * 1.6;
      const g = ctx.createRadialGradient(a.x, a.y, r * 0.85, a.x, a.y, r);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, 'rgba(0,0,0,0.55)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(a.x, a.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.beginPath();
      ctx.rect(a.x - 1e5, a.y - 1e5, 2e5, 2e5);
      ctx.arc(a.x, a.y, r, 0, Math.PI * 2, true);
      ctx.fill('evenodd');
      ctx.strokeStyle = rgba(c, 0.9);
      ctx.lineWidth = lw * 0.6;
      ctx.beginPath();
      ctx.arc(a.x, a.y, r * 0.86, 0, Math.PI * 2);
      ctx.stroke();
      break;
    }
    case 'pulse':
      [1, 0.72, 0.46].forEach((f, i) => {
        ctx.fillStyle = rgba(c, [0.18, 0.28, 0.5][i]!);
        ctx.beginPath();
        ctx.arc(a.x, a.y, R * f, 0, Math.PI * 2);
        ctx.fill();
      });
      break;
    case 'emphasis':
      ctx.fillStyle = rgba(c, 0.2);
      ctx.beginPath();
      ctx.arc(a.x, a.y, R, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = c;
      ctx.lineWidth = lw * 1.3;
      ctx.beginPath();
      ctx.arc(a.x, a.y, R * 0.75, 0, Math.PI * 2);
      ctx.stroke();
      ctx.lineWidth = lw;
      ctx.beginPath();
      ctx.arc(a.x, a.y, R * 0.42, 0, Math.PI * 2);
      ctx.stroke();
      break;
    case 'none':
      break;
  }
  ctx.restore();
}

/** Motion drawn behind the cursor (a still frame of an animated cursor). */
function drawTrail(ctx: Ctx2D, a: CursorAnnotation, k: number): void {
  const t = a.trail ?? 'none';
  if (t === 'none' || t === 'ghost') return;
  const S = Math.max(1, a.size);
  const c = a.effectColor;
  ctx.save();
  ctx.lineCap = 'round';
  switch (t) {
    case 'trail':
      for (let i = 0; i < 3; i++) {
        const g = ctx.createLinearGradient(a.x - S * 0.9, a.y + S * 0.1, a.x, a.y + S * 0.3);
        g.addColorStop(0, rgba(c, 0));
        g.addColorStop(1, rgba(c, 0.85 - i * 0.2));
        ctx.strokeStyle = g;
        ctx.lineWidth = S * (0.16 - i * 0.04);
        ctx.beginPath();
        ctx.moveTo(a.x - S * 0.95, a.y + S * (0.05 + i * 0.22));
        ctx.lineTo(a.x + S * 0.05, a.y + S * (0.18 + i * 0.16));
        ctx.stroke();
      }
      break;
    case 'dots':
      for (let i = 0; i < 6; i++) {
        ctx.fillStyle = rgba(c, 0.9 - i * 0.13);
        ctx.beginPath();
        ctx.arc(a.x - S * (0.18 + i * 0.15), a.y + S * (0.75 + i * 0.05), S * (0.06 - i * 0.007), 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    case 'bounce':
    case 'signal':
      ctx.strokeStyle = c;
      ctx.lineWidth = Math.max(1.5, S * 0.06);
      for (let i = 0; i < 2; i++) {
        ctx.beginPath();
        ctx.arc(a.x + 15 * k, a.y, S * (0.22 + i * 0.16), -Math.PI * 0.5, -Math.PI * 0.05);
        ctx.stroke();
      }
      if (t === 'bounce') {
        ctx.beginPath();
        ctx.moveTo(a.x - S * 0.5, a.y + S * 0.6);
        ctx.quadraticCurveTo(a.x - S * 0.3, a.y - S * 0.3, a.x - S * 0.05, a.y + S * 0.05);
        ctx.setLineDash([S * 0.06, S * 0.08]);
        ctx.stroke();
      }
      break;
    case 'wave':
      ctx.strokeStyle = c;
      ctx.lineWidth = Math.max(1.5, S * 0.07);
      ctx.beginPath();
      for (let i = 0; i <= 30; i++) {
        const u = i / 30;
        const px = a.x - S * 1.05 + u * S * 1.05;
        const py = a.y + S * 0.12 + Math.sin(u * Math.PI * 3) * S * 0.1;
        if (i) ctx.lineTo(px, py);
        else ctx.moveTo(px, py);
      }
      ctx.stroke();
      break;
    case 'loading':
      for (let i = 0; i < 8; i++) {
        const ang = -Math.PI * 0.95 + (i / 8) * Math.PI * 1.2;
        ctx.fillStyle = rgba(c, 0.25 + (i / 8) * 0.75);
        ctx.beginPath();
        ctx.arc(a.x - S * 0.3 + Math.cos(ang) * S * 0.42, a.y - S * 0.15 + Math.sin(ang) * S * 0.42, S * 0.055, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    default:
      break;
  }
  ctx.restore();
}

const EMOJI_FONT = '"Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif';

/** The pointer itself, in units around the hot spot. */
function drawDesign(ctx: Ctx2D, def: DesignDef, a: CursorAnnotation, k: number): void {
  ctx.lineJoin = 'round';
  ctx.shadowColor = 'rgba(0,0,0,0.3)';
  ctx.shadowBlur = 2.5 * k;
  ctx.shadowOffsetY = 0.8 * k;
  if (def.emoji) {
    ctx.font = `20px ${EMOJI_FONT}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(def.emoji, -1, -1);
    return;
  }
  if (def.draw) {
    def.draw(ctx, a.color, a.outline);
    return;
  }
  const path = def.path?.() ?? new Path2D();
  if (def.lines) {
    ctx.lineCap = 'round';
    ctx.strokeStyle = a.outline;
    ctx.lineWidth = 4.6;
    ctx.stroke(path);
    ctx.shadowColor = 'transparent';
    ctx.strokeStyle = a.color;
    ctx.lineWidth = 2.4;
    ctx.stroke(path);
    return;
  }
  // Outline drawn behind the fill (so overlapping parts show one outline).
  ctx.strokeStyle = a.outline;
  ctx.lineWidth = 2.6;
  ctx.stroke(path);
  ctx.shadowColor = 'transparent';
  ctx.fillStyle = def.translucent ? rgba(a.color, 0.55) : a.color;
  ctx.fill(path);
}

/** Small mouse with the pressed button coloured, and click marks at the hot spot. */
function drawClick(ctx: Ctx2D, a: CursorAnnotation, k: number): void {
  const m = mouseBox(a.design);
  const lw = 1.3;
  ctx.save();
  ctx.translate(a.x, a.y);
  ctx.scale(k, k);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  // Click marks: three short strokes above-left of the hot spot.
  ctx.strokeStyle = a.clickColor;
  ctx.lineWidth = 1.6;
  const reach = marksReach(a.design);
  for (const deg of [200, 235, 270]) {
    const t = (deg * Math.PI) / 180;
    ctx.beginPath();
    ctx.moveTo(Math.cos(t) * reach.from, Math.sin(t) * reach.from);
    ctx.lineTo(Math.cos(t) * (reach.from + reach.len), Math.sin(t) * (reach.from + reach.len));
    ctx.stroke();
  }
  // Mouse body.
  const body = new Path2D();
  body.roundRect(m.x, m.y, m.w, m.h, 5.5);
  ctx.fillStyle = '#FFFFFF';
  ctx.strokeStyle = '#101828';
  ctx.lineWidth = lw;
  ctx.fill(body);
  // Pressed button(s).
  const split = m.y + m.h * 0.42;
  ctx.save();
  ctx.clip(body);
  ctx.fillStyle = a.clickColor;
  if (a.click === 'left' || a.click === 'double') ctx.fillRect(m.x, m.y, m.w / 2, split - m.y);
  if (a.click === 'right') ctx.fillRect(m.x + m.w / 2, m.y, m.w / 2, split - m.y);
  ctx.restore();
  ctx.stroke(body);
  ctx.beginPath();
  ctx.moveTo(m.x, split);
  ctx.lineTo(m.x + m.w, split);
  ctx.moveTo(m.x + m.w / 2, m.y);
  ctx.lineTo(m.x + m.w / 2, split);
  ctx.stroke();
  if (a.click === 'double') {
    ctx.fillStyle = a.clickColor;
    ctx.font = '800 5.2px Inter Variable, Inter, Segoe UI, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('2×', m.x + m.w / 2, m.y + m.h * 0.72);
  }
  ctx.restore();
}

export function renderCursor(ctx: Ctx2D, a: CursorAnnotation): void {
  const def = CURSOR_DESIGNS[a.design] ?? CURSOR_DESIGNS.arrow;
  const k = unit(a);
  ctx.save();
  ctx.globalAlpha *= a.opacity;
  if (a.effect !== 'none') drawEffect(ctx, a);
  drawTrail(ctx, a, k);
  if (a.click !== 'none') drawClick(ctx, a, k);
  if (a.trail === 'ghost') {
    // Fading copies trailing up-left.
    [0.15, 0.3, 0.48].forEach((op, i) => {
      ctx.save();
      ctx.globalAlpha *= op;
      ctx.translate(a.x - (3 - i) * 4.5 * k, a.y - (3 - i) * 2.5 * k);
      ctx.scale(k, k);
      drawDesign(ctx, def, a, k);
      ctx.restore();
    });
  }
  ctx.translate(a.x, a.y);
  ctx.scale(k, k);
  drawDesign(ctx, def, a, k);
  ctx.restore();
}

export function hitCursor(a: CursorAnnotation, p: { x: number; y: number }, tol: number): boolean {
  const b = cursorBounds(a);
  if (a.effect === 'spotlight') {
    // The dimmed area covers the whole image: only the bright circle selects it.
    return Math.hypot(p.x - a.x, p.y - a.y) <= effectRadius(a) * 1.6 + tol;
  }
  return p.x >= b.x - tol && p.x <= b.x + b.w + tol && p.y >= b.y - tol && p.y <= b.y + b.h + tol;
}
