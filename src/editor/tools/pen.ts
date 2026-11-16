import type { Point, Rect, StrokeAnnotation } from '../types';
import { distToSegment, inRect, type Ctx2D } from './common';
import { isBoxyStroke, renderStrokeDesign, strokeBoundsOf } from './pen-styles';

/** Freehand pen and highlighter strokes, smoothed with quadratic curves through midpoints. */
export function renderStroke(ctx: Ctx2D, a: StrokeAnnotation): void {
  const pts = a.points;
  if (pts.length === 0) return;
  if (renderStrokeDesign(ctx, a)) return;
  ctx.save();
  ctx.globalAlpha = a.opacity;
  ctx.strokeStyle = a.color;
  ctx.fillStyle = a.color;
  ctx.lineWidth = a.width;
  ctx.lineJoin = 'round';
  ctx.lineCap = a.type === 'highlighter' ? 'butt' : 'round';
  if (a.type === 'highlighter') ctx.globalCompositeOperation = 'multiply';
  if (pts.length === 1) {
    const p = pts[0]!;
    ctx.beginPath();
    ctx.arc(p.x, p.y, a.width / 2, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.beginPath();
    ctx.moveTo(pts[0]!.x, pts[0]!.y);
    for (let i = 1; i < pts.length - 1; i++) {
      const p = pts[i]!;
      const n = pts[i + 1]!;
      ctx.quadraticCurveTo(p.x, p.y, (p.x + n.x) / 2, (p.y + n.y) / 2);
    }
    const last = pts[pts.length - 1]!;
    ctx.lineTo(last.x, last.y);
    ctx.stroke();
  }
  ctx.restore();
}

export function strokeBounds(a: StrokeAnnotation): Rect {
  if (a.design) return strokeBoundsOf(a);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of a.points) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  const pad = a.width / 2;
  return { x: minX - pad, y: minY - pad, w: maxX - minX + pad * 2, h: maxY - minY + pad * 2 };
}

export function hitStroke(a: StrokeAnnotation, p: Point, tolerance: number): boolean {
  if (isBoxyStroke(a)) return inRect(p, strokeBoundsOf(a), tolerance);
  // Designs that spread wider than the line (hatch, loops, zig-zag…) are hit across their full spread.
  const spread = a.design ? strokeBoundsOf({ ...a, points: [{ x: 0, y: 0 }] }).w / 2 - 1 : a.width / 2;
  const reach = Math.max(a.width / 2, spread) + tolerance;
  if (a.points.length === 1) return Math.hypot(p.x - a.points[0]!.x, p.y - a.points[0]!.y) <= reach;
  for (let i = 1; i < a.points.length; i++) {
    if (distToSegment(p, a.points[i - 1]!, a.points[i]!) <= reach) return true;
  }
  return false;
}

/** Drops points closer than `minDist` to keep strokes light. */
export function appendPoint(points: Point[], p: Point, minDist = 1.5): Point[] {
  const last = points[points.length - 1];
  if (last && Math.hypot(last.x - p.x, last.y - p.y) < minDist) return points;
  return [...points, p];
}
