import type { Annotation, BoxAnnotation, Point, Rect, StrokeAnnotation, StrokeClip } from '../types';
import type { Ctx2D } from './common';
import { shapeGeometry, type ShapeKind } from './shape-lib';

/**
 * Cutting a pen or highlighter stroke with a shape: keep only what is inside the shape, or cut the
 * shape's area out of it. The shape's outline is copied onto the stroke, so the shape itself can
 * be moved or removed afterwards; "Undo cut" removes the copy again.
 */
export const isStroke = (a: Annotation): a is StrokeAnnotation => a.type === 'pen' || a.type === 'highlighter';
export const isCutShape = (a: Annotation): a is BoxAnnotation => a.type === 'rect' || a.type === 'ellipse';

export function clipFromShape(shape: BoxAnnotation, keep: StrokeClip['keep']): StrokeClip {
  return {
    from: shape.id, keep,
    kind: shape.shape ?? (shape.type === 'rect' ? 'rect' : 'ellipse'),
    x: shape.x, y: shape.y, w: shape.w, h: shape.h, radius: shape.radius ?? 0, rotation: shape.rotation ?? 0,
  };
}

function clipPath(c: StrokeClip): Path2D | null {
  if (typeof Path2D === 'undefined') return null;
  const outline = shapeGeometry(c.kind as ShapeKind, { x: c.x, y: c.y, w: c.w, h: c.h }, c.radius).outline;
  if (!c.rotation || typeof DOMMatrix === 'undefined') return outline;
  const cx = c.x + c.w / 2;
  const cy = c.y + c.h / 2;
  const p = new Path2D();
  p.addPath(outline, new DOMMatrix().translate(cx, cy).rotate(c.rotation).translate(-cx, -cy));
  return p;
}

/** Draws `draw` cut by the clip (unchanged when there is none). */
export function withClip(ctx: Ctx2D, clip: StrokeClip | undefined, draw: () => void): void {
  const path = clip ? clipPath(clip) : null;
  if (!clip || !path) return draw();
  ctx.save();
  if (clip.keep === 'inside') ctx.clip(path);
  else {
    const outside = new Path2D();
    outside.rect(-1e6, -1e6, 2e6, 2e6);
    outside.addPath(path);
    ctx.clip(outside, 'evenodd');
  }
  draw();
  ctx.restore();
}

/** The clip follows the stroke when it is moved, rotated or resized. */
export function moveClip(c: StrokeClip | undefined, dx: number, dy: number): StrokeClip | undefined {
  return c && { ...c, x: c.x + dx, y: c.y + dy };
}

export function rotateClip(c: StrokeClip | undefined, deg: number, pivot: Point): StrokeClip | undefined {
  if (!c) return c;
  const t = (deg * Math.PI) / 180;
  const cx = c.x + c.w / 2 - pivot.x;
  const cy = c.y + c.h / 2 - pivot.y;
  const nx = pivot.x + cx * Math.cos(t) - cy * Math.sin(t);
  const ny = pivot.y + cx * Math.sin(t) + cy * Math.cos(t);
  return { ...c, x: nx - c.w / 2, y: ny - c.h / 2, rotation: (c.rotation + deg) % 360 };
}

export function mapClip(c: StrokeClip | undefined, map: (r: Rect) => Rect): StrokeClip | undefined {
  return c && { ...c, ...map({ x: c.x, y: c.y, w: c.w, h: c.h }) };
}
