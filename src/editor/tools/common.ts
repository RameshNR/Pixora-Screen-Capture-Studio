import type { DashStyle, Point, Rect } from '../types';

export type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export function normalizeRect(r: Rect): Rect {
  return {
    x: r.w < 0 ? r.x + r.w : r.x,
    y: r.h < 0 ? r.y + r.h : r.y,
    w: Math.abs(r.w),
    h: Math.abs(r.h),
  };
}

export function rectFromPoints(a: Point, b: Point): Rect {
  return normalizeRect({ x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y });
}

export function inRect(p: Point, r: Rect, pad = 0): boolean {
  return p.x >= r.x - pad && p.x <= r.x + r.w + pad && p.y >= r.y - pad && p.y <= r.y + r.h + pad;
}

export function rectsIntersect(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

export function distToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

export function clampRect(r: Rect, width: number, height: number): Rect {
  const x = Math.max(0, Math.min(r.x, width));
  const y = Math.max(0, Math.min(r.y, height));
  return { x, y, w: Math.max(0, Math.min(r.w, width - x)), h: Math.max(0, Math.min(r.h, height - y)) };
}

/**
 * How many device pixels one drawing unit covers (zoom × screen density). Canvas shadows and
 * filters are measured in device pixels, so they are multiplied by this to look the same on screen
 * and in exports.
 */
export function viewScale(ctx: Ctx2D): number {
  try {
    const m = ctx.getTransform?.();
    return m ? Math.max(0.01, Math.hypot(m.a, m.b)) : 1;
  } catch {
    return 1;
  }
}

/** Line dash pattern for a stroke width. Dotted lines rely on round caps. */
export function dashPattern(style: DashStyle, width: number): number[] {
  if (style === 'dashed') return [width * 3, width * 2];
  if (style === 'dotted') return [0.01, width * 2];
  return [];
}

/**
 * Paint for backgrounds: a solid colour (`#rrggbb`, `transparent`) or a diagonal gradient written as
 * `linear:#from:#to`.
 */
export function makePaint(ctx: Ctx2D, value: string, rect: Rect): string | CanvasGradient {
  if (value.startsWith('linear:')) {
    const [, from = '#ffffff', to = '#000000'] = value.split(':');
    const g = ctx.createLinearGradient(rect.x, rect.y, rect.x + rect.w, rect.y + rect.h);
    g.addColorStop(0, from);
    g.addColorStop(1, to);
    return g;
  }
  return value;
}

let measureCtx: OffscreenCanvasRenderingContext2D | null = null;
/** Shared 2D context for text measurement. */
export function getMeasureContext(): OffscreenCanvasRenderingContext2D | null {
  if (measureCtx) return measureCtx;
  if (typeof OffscreenCanvas === 'undefined') return null;
  measureCtx = new OffscreenCanvas(1, 1).getContext('2d');
  return measureCtx;
}

let counter = 0;
export function annotationId(): string {
  counter += 1;
  return `a${Date.now().toString(36)}${counter.toString(36)}`;
}
