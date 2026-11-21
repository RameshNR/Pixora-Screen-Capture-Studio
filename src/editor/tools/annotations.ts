import type { Annotation, Point, Rect, StrokeAnnotation } from '../types';
import { normalizeRect, inRect, type Ctx2D } from './common';
import { hitStroke, renderStroke, strokeBounds } from './pen';
import {
  hitBox, hitLine, hitMarker, lineBounds, markerBounds, markerLabel, renderBox, renderImage, renderLine, renderMarker, renderSticker, stickerBounds,
} from './shapes';
import { renderText, scaleText, textBounds } from './text';
import { calloutBounds, calloutTextGrips, hitCallout, renderCallout, tailOf } from './callouts';
import { renderRedact } from './blur';
import { stickerIconLabel } from './sticker-lib';
import { cursorBounds, hitCursor, renderCursor } from './cursor';
import { SHAPE_KIND_LABEL } from './shape-lib';
import { mapClip, moveClip, rotateClip, withClip } from './stroke-clip';

/** Central dispatch for per-type behaviour (render / bounds / hit-test / move / resize / rotate / transform). */

/* ---------------------------------- rotation ---------------------------------- */

const ROTATABLE = new Set<Annotation['type']>(['rect', 'ellipse', 'text', 'callout', 'sticker', 'image']);

export function canRotate(a: Annotation): boolean {
  return ROTATABLE.has(a.type) || a.type === 'pen' || a.type === 'highlighter';
}

export function rotationOf(a: Annotation): number {
  return ROTATABLE.has(a.type) ? a.rotation ?? 0 : 0;
}

export function rotatePoint(p: Point, deg: number, c: Point): Point {
  if (!deg) return p;
  const r = (deg * Math.PI) / 180;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  const dx = p.x - c.x;
  const dy = p.y - c.y;
  return { x: c.x + dx * cos - dy * sin, y: c.y + dx * sin + dy * cos };
}

function rotateVec(dx: number, dy: number, deg: number): Point {
  return rotatePoint({ x: dx, y: dy }, deg, { x: 0, y: 0 });
}

/** The object's own (unrotated) box: handles sit on it. */
export function localBox(a: Annotation): Rect {
  switch (a.type) {
    case 'pen':
    case 'highlighter':
      return strokeBounds(a);
    case 'line':
    case 'arrow':
      return lineBounds(a);
    case 'text':
      return textBounds(a);
    case 'marker':
      return markerBounds(a);
    case 'sticker':
      return stickerBounds(a);
    case 'cursor':
      return cursorBounds(a);
    default:
      return { x: a.x, y: a.y, w: a.w, h: a.h };
  }
}

export function pivotOf(a: Annotation): Point {
  const b = localBox(a);
  return { x: b.x + b.w / 2, y: b.y + b.h / 2 };
}

/** The annotation in its own rotated frame (only the callout tail, stored in page space, needs mapping). */
function toLocal(a: Annotation): Annotation {
  const rot = rotationOf(a);
  if (!rot || a.type !== 'callout') return a;
  const t = rotatePoint({ x: a.tailX, y: a.tailY }, -rot, pivotOf(a));
  return { ...a, tailX: t.x, tailY: t.y };
}

/* ---------------------------------- render ---------------------------------- */

function renderPlain(ctx: Ctx2D, base: ImageBitmap, a: Annotation): void {
  switch (a.type) {
    case 'pen':
    case 'highlighter':
      return withClip(ctx, a.clip, () => renderStroke(ctx, a));
    case 'rect':
    case 'ellipse':
      return renderBox(ctx, a);
    case 'line':
    case 'arrow':
      return renderLine(ctx, a);
    case 'text':
      return renderText(ctx, a);
    case 'callout':
      return renderCallout(ctx, a);
    case 'blur':
    case 'pixelate':
    case 'mask':
      return renderRedact(ctx, base, a);
    case 'marker':
      return renderMarker(ctx, a);
    case 'sticker':
      return renderSticker(ctx, a);
    case 'cursor':
      return renderCursor(ctx, a);
    case 'image':
      return renderImage(ctx, a);
  }
}

export function renderAnnotation(ctx: Ctx2D, base: ImageBitmap, a: Annotation): void {
  if (a.hidden) return;
  const rot = rotationOf(a);
  if (!rot) return renderPlain(ctx, base, a);
  const c = pivotOf(a);
  ctx.save();
  ctx.translate(c.x, c.y);
  ctx.rotate((rot * Math.PI) / 180);
  ctx.translate(-c.x, -c.y);
  renderPlain(ctx, base, toLocal(a));
  ctx.restore();
}

/* ---------------------------------- bounds ---------------------------------- */

function plainBounds(a: Annotation): Rect {
  if (a.type === 'callout') return calloutBounds(a);
  return localBox(a);
}

function corners(r: Rect): Point[] {
  return [{ x: r.x, y: r.y }, { x: r.x + r.w, y: r.y }, { x: r.x + r.w, y: r.y + r.h }, { x: r.x, y: r.y + r.h }];
}

/** Page-space outline of the object's box (rotated when the object is). */
export function selectionPolygon(a: Annotation): Point[] {
  const rot = rotationOf(a);
  const box = a.type === 'callout' ? localBox(a) : plainBounds(a);
  if (!rot) return corners(box);
  const c = pivotOf(a);
  return corners(box).map((p) => rotatePoint(p, rot, c));
}

/** Axis-aligned page-space bounds. */
export function getBounds(a: Annotation): Rect {
  const rot = rotationOf(a);
  if (!rot) return plainBounds(a);
  const c = pivotOf(a);
  const pts = corners(plainBounds(toLocal(a))).map((p) => rotatePoint(p, rot, c));
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
}

/* ---------------------------------- hit test ---------------------------------- */

function hitPlain(a: Annotation, p: Point, tolerance: number): boolean {
  switch (a.type) {
    case 'pen':
    case 'highlighter':
      return hitStroke(a, p, tolerance);
    case 'rect':
    case 'ellipse':
      return hitBox(a, p, tolerance);
    case 'line':
    case 'arrow':
      return hitLine(a, p, tolerance);
    case 'marker':
      return hitMarker(a, p, tolerance);
    case 'callout':
      return hitCallout(a, p, tolerance);
    case 'cursor':
      return hitCursor(a, p, tolerance);
    default:
      return inRect(p, localBox(a), tolerance);
  }
}

export function hitTest(a: Annotation, p: Point, tolerance: number): boolean {
  if (a.hidden) return false;
  const rot = rotationOf(a);
  if (!rot) return hitPlain(a, p, tolerance);
  return hitPlain(toLocal(a), rotatePoint(p, -rot, pivotOf(a)), tolerance);
}

/** Topmost visible annotation under the point. */
export function findAt(annotations: Annotation[], p: Point, tolerance: number): Annotation | null {
  for (let i = annotations.length - 1; i >= 0; i--) {
    const a = annotations[i]!;
    if (hitTest(a, p, tolerance)) return a;
  }
  return null;
}

/* ------------------------------------ move ------------------------------------ */

export function translate(a: Annotation, dx: number, dy: number): Annotation {
  switch (a.type) {
    case 'pen':
    case 'highlighter':
      return { ...a, points: a.points.map((p) => ({ x: p.x + dx, y: p.y + dy })), ...(a.clip ? { clip: moveClip(a.clip, dx, dy) } : {}) };
    case 'line':
    case 'arrow':
      return { ...a, x1: a.x1 + dx, y1: a.y1 + dy, x2: a.x2 + dx, y2: a.y2 + dy, bends: (a.bends ?? []).map((b) => ({ x: b.x + dx, y: b.y + dy })) };
    case 'callout':
      return { ...a, x: a.x + dx, y: a.y + dy, tailX: a.tailX + dx, tailY: a.tailY + dy };
    default:
      return { ...a, x: a.x + dx, y: a.y + dy };
  }
}

/** Moves the box but leaves a callout's tail where it points. */
function shiftBox(a: Annotation, dx: number, dy: number): Annotation {
  if (a.type === 'callout') return { ...a, x: a.x + dx, y: a.y + dy };
  return translate(a, dx, dy);
}

/* ----------------------------------- handles ----------------------------------- */

/** Box handles, line end points (p1/p2), bend points (b0–b5), callout tail (t), callout text (tt: title, tb: body) and rotation (rot). */
export type Handle =
  | 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'p1' | 'p2' | 'b0' | 'b1' | 'b2' | 'b3' | 'b4' | 'b5' | 't' | 'tt' | 'tb' | 'tg' | 'rot';

export function isRoundHandle(h: Handle): boolean {
  return h === 't' || h === 'rot' || h.startsWith('b') || isTextHandle(h);
}

/** The move handles of a callout's title and body text. */
export function isTextHandle(h: Handle): h is 'tt' | 'tb' | 'tg' {
  return h === 'tt' || h === 'tb' || h === 'tg';
}

/** Box shapes that Shift keeps square (or round) while resizing. */
const SQUARE_TYPES = new Set<Annotation['type']>(['rect', 'ellipse', 'callout', 'blur', 'pixelate', 'mask']);

/** Screen distance of the rotation handle above the box. */
export const ROTATE_HANDLE_OFFSET = 26;

const EDGE_TYPES = new Set(['rect', 'ellipse', 'blur', 'pixelate', 'mask', 'image', 'callout', 'pen', 'highlighter']);
const CORNER_TYPES = new Set(['text', 'sticker', 'marker', 'cursor']);

function handlePos(r: Rect, h: Handle): Point {
  const x = h.includes('w') ? r.x : h.includes('e') ? r.x + r.w : r.x + r.w / 2;
  const y = h.includes('n') ? r.y : h.includes('s') ? r.y + r.h : r.y + r.h / 2;
  return { x, y };
}

const CORNERS: Handle[] = ['nw', 'ne', 'se', 'sw'];
const EDGES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

/** Locked annotations stay as they are; "move only" ones can still be dragged. */
export const canMove = (a: Annotation): boolean => a.lock !== 'all';
export const canChange = (a: Annotation): boolean => !a.lock;

export function handlesFor(a: Annotation, zoom = 1): Array<{ handle: Handle; x: number; y: number }> {
  // Locked (or move only): no handles to resize, rotate or reshape it.
  if (a.lock) return [];
  if (a.type === 'line' || a.type === 'arrow') {
    const hs: Array<{ handle: Handle; x: number; y: number }> = [
      { handle: 'p1', x: a.x1, y: a.y1 },
      { handle: 'p2', x: a.x2, y: a.y2 },
    ];
    // An elbow always takes the same route: it has no curve points to drag.
    if (a.route !== 'elbow') (a.bends ?? []).forEach((b, i) => hs.push({ handle: `b${i}` as Handle, x: b.x, y: b.y }));
    return hs;
  }
  const list = EDGE_TYPES.has(a.type) ? EDGES : CORNER_TYPES.has(a.type) ? CORNERS : [];
  if (!list.length) return [];
  const box = localBox(a);
  const rot = rotationOf(a);
  const c = pivotOf(a);
  const out: Array<{ handle: Handle; x: number; y: number }> = [];
  // First, so a text handle next to the box's edge can still be grabbed.
  if (a.type === 'callout') for (const g of calloutTextGrips(a, zoom)) out.push({ handle: g.handle, ...rotatePoint(g, rot, c) });
  out.push(...list.map((handle) => ({ handle, ...rotatePoint(handlePos(box, handle), rot, c) })));
  if (a.type === 'callout' && tailOf(a) !== 'none') out.push({ handle: 't', x: a.tailX, y: a.tailY });
  if (canRotate(a)) out.push({ handle: 'rot', ...rotatePoint({ x: box.x + box.w / 2, y: box.y - ROTATE_HANDLE_OFFSET / zoom }, rot, c) });
  return out;
}

const OPPOSITE: Partial<Record<Handle, Handle>> = { nw: 'se', n: 's', ne: 'sw', e: 'w', se: 'nw', s: 'n', sw: 'ne', w: 'e' };

function scaleStroke(a: StrokeAnnotation, from: Rect, to: Rect): StrokeAnnotation {
  const pad = a.width / 2;
  const fi = { x: from.x + pad, y: from.y + pad, w: Math.max(0, from.w - pad * 2), h: Math.max(0, from.h - pad * 2) };
  const ti = { x: to.x + pad, y: to.y + pad, w: Math.max(0, to.w - pad * 2), h: Math.max(0, to.h - pad * 2) };
  const sx = fi.w > 0.5 ? ti.w / fi.w : 1;
  const sy = fi.h > 0.5 ? ti.h / fi.h : 1;
  const map = (p: Point) => ({ x: ti.x + (p.x - fi.x) * sx, y: ti.y + (p.y - fi.y) * sy });
  const clip = mapClip(a.clip, (r) => ({ ...map(r), w: r.w * sx, h: r.h * sy }));
  return { ...a, points: a.points.map(map), ...(clip ? { clip } : {}) };
}

/** Resize in the object's own frame (no rotation involved). */
function resizeLocal(o: Annotation, handle: Handle, dx: number, dy: number, square = false): Annotation {
  if (o.type === 'text' || o.type === 'sticker' || o.type === 'marker' || o.type === 'cursor') {
    const box = localBox(o);
    const grow = (handle.includes('e') ? dx : -dx) + (handle.includes('s') ? dy : -dy) * (box.w / Math.max(1, box.h));
    const k = Math.max(0.1, (box.w + grow / 2) / Math.max(1, box.w));
    if (o.type === 'text') return scaleText(o, k);
    return { ...o, size: Math.max(8, o.size * k) };
  }
  const box = localBox(o);
  let { x, y, w, h } = box;
  if (handle.includes('w')) { x += dx; w -= dx; }
  if (handle.includes('e')) w += dx;
  if (handle.includes('n')) { y += dy; h -= dy; }
  if (handle.includes('s')) h += dy;
  if (o.type === 'image' && handle.length === 2) {
    const aspect = o.w / o.h;
    const nh = w / aspect;
    if (handle.includes('n')) y += h - nh;
    h = nh;
  }
  if (square && SQUARE_TYPES.has(o.type)) {
    // Equal sides, with the opposite corner or side staying where it is.
    const size = Math.max(2, handle.length === 2 ? Math.min(Math.abs(w), Math.abs(h)) : handle === 'e' || handle === 'w' ? Math.abs(w) : Math.abs(h));
    const place = (from: number, len: number, low: boolean, high: boolean, raw: number) => {
      if (low) return raw >= 0 ? from + len - size : from + len;
      if (high) return raw >= 0 ? from : from - size;
      return from + len / 2 - size / 2;
    };
    return { ...o, x: place(box.x, box.w, handle.includes('w'), handle.includes('e'), w), y: place(box.y, box.h, handle.includes('n'), handle.includes('s'), h), w: size, h: size } as Annotation;
  }
  const r = normalizeRect({ x, y, w, h });
  const next = { ...r, w: Math.max(2, r.w), h: Math.max(2, r.h) };
  if (o.type === 'pen' || o.type === 'highlighter') return scaleStroke(o, box, next);
  if (!('w' in o)) return o;
  return { ...o, ...next };
}

/** Resizes `original` by dragging `handle` by (dx, dy) page pixels; `square`: Shift is held. */
export function resizeBy(original: Annotation, handle: Handle, dx: number, dy: number, square = false): Annotation {
  if (original.type === 'line' || original.type === 'arrow') {
    if (handle === 'p1') return { ...original, x1: original.x1 + dx, y1: original.y1 + dy };
    if (handle === 'p2') return { ...original, x2: original.x2 + dx, y2: original.y2 + dy };
    if (handle.startsWith('b')) {
      const i = Number(handle.slice(1));
      return { ...original, bends: (original.bends ?? []).map((b, j) => (j === i ? { x: b.x + dx, y: b.y + dy } : b)) };
    }
    return original;
  }
  if (original.type === 'callout' && handle === 't') return { ...original, tailX: original.tailX + dx, tailY: original.tailY + dy };
  if (original.type === 'callout' && isTextHandle(handle)) {
    const by = rotateVec(dx, dy, -rotationOf(original));
    const key = handle === 'tt' ? 'titleOffset' : handle === 'tg' ? 'badgeOffset' : 'textOffset';
    const was = original[key] ?? { x: 0, y: 0 };
    return { ...original, [key]: { x: was.x + by.x, y: was.y + by.y } };
  }
  if (handle === 'rot' || !OPPOSITE[handle]) return original;
  const rot = rotationOf(original);
  const local = rotateVec(dx, dy, -rot);
  let next = resizeLocal(original, handle, local.x, local.y, square);
  // The size set by hand is the callout's new own size.
  if (next.type === 'callout' && next.fitBase) next = { ...next, fitBase: undefined };
  const scaled = original.type === 'text' || original.type === 'sticker' || original.type === 'marker' || original.type === 'cursor';
  if (rot || scaled) {
    // Keep the opposite handle where it was.
    const opp = OPPOSITE[handle]!;
    const before = rotatePoint(handlePos(localBox(original), opp), rot, pivotOf(original));
    const after = rotatePoint(handlePos(localBox(next), opp), rot, pivotOf(next));
    next = shiftBox(next, before.x - after.x, before.y - after.y);
  }
  return next;
}

/** Rotates by `deg` degrees around the object's centre (pen strokes are rotated point by point). */
export function rotateBy(a: Annotation, deg: number): Annotation {
  if (a.type === 'pen' || a.type === 'highlighter') {
    const c = pivotOf(a);
    return { ...a, points: a.points.map((p) => rotatePoint(p, deg, c)), ...(a.clip ? { clip: rotateClip(a.clip, deg, c) } : {}) };
  }
  if (!ROTATABLE.has(a.type)) return a;
  let r = ((a.rotation ?? 0) + deg) % 360;
  if (r > 180) r -= 360;
  if (r <= -180) r += 360;
  // (A callout's tail is stored in page space, so it keeps pointing at the same place.)
  return { ...a, rotation: Math.abs(r) < 0.01 ? 0 : r };
}

/** Current page-space angle (degrees) from the object's centre to a point. */
export function angleFrom(a: Annotation, p: Point): number {
  const c = pivotOf(a);
  return (Math.atan2(p.y - c.y, p.x - c.x) * 180) / Math.PI;
}

/* ------------------------- geometry transforms (crop etc.) ------------------------- */

export interface GeometryTransform {
  point: (p: Point) => Point;
  rect: (r: Rect) => Rect;
  /** Uniform scale applied to stroke widths, font sizes, etc. */
  scale: number;
  /** Mirrors rotations (document flip). A 90° document rotation keeps them: boxes swap width and height. */
  mirror?: boolean;
}

function mapRotation(a: { rotation?: number }, t: GeometryTransform): number | undefined {
  if (!a.rotation) return a.rotation;
  return t.mirror ? -a.rotation : a.rotation;
}

/** Maps an annotation through a document-level transform (crop / rotate / flip / resize). */
export function transformAnnotation(a: Annotation, t: GeometryTransform): Annotation {
  const s = t.scale;
  switch (a.type) {
    case 'pen':
    case 'highlighter':
      return { ...a, points: a.points.map(t.point), width: a.width * s, ...(a.clip ? { clip: mapClip(a.clip, (r) => normalizeRect(t.rect(r))) } : {}) };
    case 'line':
    case 'arrow': {
      const p1 = t.point({ x: a.x1, y: a.y1 });
      const p2 = t.point({ x: a.x2, y: a.y2 });
      return { ...a, x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y, bends: (a.bends ?? []).map(t.point), width: a.width * s };
    }
    case 'marker': {
      const p = t.point({ x: a.x, y: a.y });
      return { ...a, x: p.x, y: p.y, size: a.size * s };
    }
    case 'sticker': {
      const p = t.point({ x: a.x, y: a.y });
      return { ...a, x: p.x, y: p.y, size: a.size * s, rotation: mapRotation(a, t) };
    }
    case 'cursor': {
      const p = t.point({ x: a.x, y: a.y });
      return { ...a, x: p.x, y: p.y, size: a.size * s };
    }
    case 'text': {
      // Text stays upright: its centre moves, the reading direction is kept.
      const b = textBounds(a);
      const c = t.point({ x: b.x + b.w / 2, y: b.y + b.h / 2 });
      const scaled = scaleText(a, s);
      const nb = textBounds(scaled);
      return { ...scaled, x: scaled.x + c.x - (nb.x + nb.w / 2), y: scaled.y + c.y - (nb.y + nb.h / 2), rotation: mapRotation(a, t) };
    }
    case 'callout': {
      const tail = t.point({ x: a.tailX, y: a.tailY });
      // Dragged text keeps its place on the callout.
      const origin = t.point({ x: a.x, y: a.y });
      const offset = (by: Point | undefined) => {
        if (!by) return by;
        const p = t.point({ x: a.x + by.x, y: a.y + by.y });
        return { x: p.x - origin.x, y: p.y - origin.y };
      };
      return {
        ...a, ...normalizeRect(t.rect(a)), tailX: tail.x, tailY: tail.y, fontSize: Math.max(4, a.fontSize * s), strokeWidth: a.strokeWidth * s,
        titleOffset: offset(a.titleOffset), textOffset: offset(a.textOffset), badgeOffset: offset(a.badgeOffset), fitBase: undefined,
        titleStyle: a.titleStyle ? { ...a.titleStyle, fontSize: Math.max(4, a.titleStyle.fontSize * s) } : a.titleStyle, rotation: mapRotation(a, t),
      };
    }
    case 'rect':
    case 'ellipse':
      return { ...a, ...normalizeRect(t.rect(a)), width: a.width * s, radius: (a.radius ?? 0) * s, rotation: mapRotation(a, t) };
    case 'blur':
    case 'pixelate':
    case 'mask':
      return { ...a, ...normalizeRect(t.rect(a)), intensity: Math.max(1, a.intensity * s) };
    case 'image':
      return { ...a, ...normalizeRect(t.rect(a)), rotation: mapRotation(a, t) };
  }
}

/** Human-readable layer name. */
export function describeAnnotation(a: Annotation): string {
  switch (a.type) {
    case 'pen':
      return 'Pen stroke';
    case 'highlighter':
      return 'Highlight';
    case 'rect':
    case 'ellipse':
      if (a.shape && a.shape !== 'rect' && a.shape !== 'ellipse') return SHAPE_KIND_LABEL[a.shape] ?? 'Shape';
      return a.type === 'rect' ? (a.shape === 'ellipse' ? 'Ellipse' : 'Rectangle') : 'Ellipse';
    case 'line':
    case 'arrow':
      if (a.headEnd === 'none' && a.headStart === 'none' && (a.body ?? 'line') === 'line') return a.bends?.length ? 'Curved line' : 'Line';
      return a.bends?.length ? 'Curved arrow' : 'Arrow';
    case 'text': {
      const t = a.text || a.header?.text || '';
      return `Text “${t.slice(0, 24)}${t.length > 24 ? '…' : ''}”`;
    }
    case 'callout': {
      const t = a.text || a.title || '';
      return `Callout “${t.slice(0, 20)}${t.length > 20 ? '…' : ''}”`;
    }
    case 'blur':
      return 'Blur';
    case 'pixelate':
      return 'Pixelate';
    case 'mask':
      return 'Mask';
    case 'marker':
      return `Marker ${markerLabel(a.n, a.counter)}`;
    case 'sticker':
      return `Sticker ${a.variant === 'icon' ? stickerIconLabel(a.glyph) : a.glyph}`;
    case 'cursor':
      return a.click === 'none' ? 'Cursor' : `Cursor (${a.click === 'double' ? 'double' : a.click} click)`;
    case 'image':
      return 'Image';
  }
}
