import type { Annotation, EditorDoc, Rect } from '../types';
import { clampRect, normalizeRect } from './common';
import { getBounds, transformAnnotation, type GeometryTransform } from './annotations';

/**
 * Document-level geometry operations. Each returns a NEW document with a derived base bitmap; the
 * previous document (and its bitmap) stays in history, so the operations are fully undoable.
 */

async function deriveBitmap(width: number, height: number, draw: (ctx: OffscreenCanvasRenderingContext2D) => void): Promise<ImageBitmap> {
  const canvas = new OffscreenCanvas(Math.max(1, Math.round(width)), Math.max(1, Math.round(height)));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D context unavailable');
  ctx.imageSmoothingQuality = 'high';
  draw(ctx);
  return createImageBitmap(canvas);
}

async function transformImages(annotations: Annotation[], fn: (bitmap: ImageBitmap) => Promise<ImageBitmap>): Promise<Annotation[]> {
  return Promise.all(annotations.map(async (a) => (a.type === 'image' ? { ...a, bitmap: await fn(a.bitmap) } : a)));
}

/**
 * Deletes a part of the picture: the marked area becomes white (like a paint program; white also
 * stays white in JPEG). Annotations over it stay.
 */
export async function applyClearArea(doc: EditorDoc, rect: Rect, fill = '#ffffff'): Promise<EditorDoc> {
  const r = clampRect(normalizeRect({ x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.w), h: Math.round(rect.h) }), doc.width, doc.height);
  if (r.w < 1 || r.h < 1) return doc;
  const base = await deriveBitmap(doc.width, doc.height, (ctx) => {
    ctx.drawImage(doc.base, 0, 0);
    ctx.fillStyle = fill;
    ctx.fillRect(r.x, r.y, r.w, r.h);
  });
  return { ...doc, base };
}

/** Erases the picture along a brush stroke (a click: a dot), painting white or making it see-through. */
export async function applyEraseImage(doc: EditorDoc, points: ReadonlyArray<{ x: number; y: number }>, size: number, fill: 'white' | 'transparent'): Promise<EditorDoc> {
  if (!points.length || size <= 0) return doc;
  const base = await deriveBitmap(doc.width, doc.height, (ctx) => {
    ctx.drawImage(doc.base, 0, 0);
    if (fill === 'transparent') ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = size;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (points.length === 1) {
      ctx.beginPath();
      ctx.arc(points[0]!.x, points[0]!.y, size / 2, 0, Math.PI * 2);
      ctx.fill();
      return;
    }
    ctx.beginPath();
    points.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.stroke();
  });
  return { ...doc, base };
}

export async function applyCrop(doc: EditorDoc, rect: Rect): Promise<EditorDoc> {
  const r = clampRect(normalizeRect({ x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.w), h: Math.round(rect.h) }), doc.width, doc.height);
  if (r.w < 2 || r.h < 2) return doc;
  const base = await deriveBitmap(r.w, r.h, (ctx) => ctx.drawImage(doc.base, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h));
  const t: GeometryTransform = {
    point: (p) => ({ x: p.x - r.x, y: p.y - r.y }),
    rect: (q) => ({ x: q.x - r.x, y: q.y - r.y, w: q.w, h: q.h }),
    scale: 1,
  };
  return { ...doc, base, width: r.w, height: r.h, annotations: doc.annotations.map((a) => transformAnnotation(a, t)) };
}

export async function applyRotate(doc: EditorDoc, direction: 'cw' | 'ccw'): Promise<EditorDoc> {
  const W = doc.width;
  const H = doc.height;
  const rotateBitmap = (b: ImageBitmap) =>
    deriveBitmap(b.height, b.width, (ctx) => {
      if (direction === 'cw') { ctx.translate(b.height, 0); ctx.rotate(Math.PI / 2); }
      else { ctx.translate(0, b.width); ctx.rotate(-Math.PI / 2); }
      ctx.drawImage(b, 0, 0);
    });
  const base = await rotateBitmap(doc.base);
  const t: GeometryTransform =
    direction === 'cw'
      ? { point: (p) => ({ x: H - p.y, y: p.x }), rect: (q) => ({ x: H - q.y - q.h, y: q.x, w: q.h, h: q.w }), scale: 1 }
      : { point: (p) => ({ x: p.y, y: W - p.x }), rect: (q) => ({ x: q.y, y: W - q.x - q.w, w: q.h, h: q.w }), scale: 1 };
  const annotations = await transformImages(doc.annotations.map((a) => transformAnnotation(a, t)), rotateBitmap);
  return { ...doc, base, width: H, height: W, annotations };
}

export async function applyFlip(doc: EditorDoc, axis: 'horizontal' | 'vertical'): Promise<EditorDoc> {
  const W = doc.width;
  const H = doc.height;
  const flipBitmap = (b: ImageBitmap) =>
    deriveBitmap(b.width, b.height, (ctx) => {
      if (axis === 'horizontal') { ctx.translate(b.width, 0); ctx.scale(-1, 1); }
      else { ctx.translate(0, b.height); ctx.scale(1, -1); }
      ctx.drawImage(b, 0, 0);
    });
  const base = await flipBitmap(doc.base);
  const t: GeometryTransform =
    axis === 'horizontal'
      ? { point: (p) => ({ x: W - p.x, y: p.y }), rect: (q) => ({ x: W - q.x - q.w, y: q.y, w: q.w, h: q.h }), scale: 1, mirror: true }
      : { point: (p) => ({ x: p.x, y: H - p.y }), rect: (q) => ({ x: q.x, y: H - q.y - q.h, w: q.w, h: q.h }), scale: 1, mirror: true };
  const annotations = await transformImages(doc.annotations.map((a) => transformAnnotation(a, t)), flipBitmap);
  return { ...doc, base, width: W, height: H, annotations };
}

export async function applyResize(doc: EditorDoc, width: number, height: number): Promise<EditorDoc> {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  if (w === doc.width && h === doc.height) return doc;
  const sx = w / doc.width;
  const sy = h / doc.height;
  const base = await deriveBitmap(w, h, (ctx) => ctx.drawImage(doc.base, 0, 0, w, h));
  const t: GeometryTransform = {
    point: (p) => ({ x: p.x * sx, y: p.y * sy }),
    rect: (q) => ({ x: q.x * sx, y: q.y * sy, w: q.w * sx, h: q.h * sy }),
    scale: Math.sqrt(sx * sy),
  };
  return { ...doc, base, width: w, height: h, annotations: doc.annotations.map((a) => transformAnnotation(a, t)) };
}

export type AspectRatio = 'free' | '1:1' | '4:3' | '3:2' | '16:9' | '9:16' | 'original';

export function aspectValue(ratio: AspectRatio, doc: { width: number; height: number }): number | null {
  switch (ratio) {
    case 'free':
      return null;
    case 'original':
      return doc.width / doc.height;
    default: {
      const [a, b] = ratio.split(':').map(Number);
      return a! / b!;
    }
  }
}

/** Constrains a crop rect to an aspect ratio, keeping its top-left corner and staying in bounds. */
export function constrainAspect(r: Rect, aspect: number | null, maxW: number, maxH: number): Rect {
  const n = clampRect(normalizeRect(r), maxW, maxH);
  if (!aspect) return n;
  let w = n.w;
  let h = w / aspect;
  if (n.y + h > maxH) {
    h = maxH - n.y;
    w = h * aspect;
  }
  if (n.x + w > maxW) {
    w = maxW - n.x;
    h = w / aspect;
  }
  return { x: n.x, y: n.y, w: Math.max(1, w), h: Math.max(1, h) };
}

export type CutAxis = 'rows' | 'columns';
export type CutSeam = 'none' | 'line' | 'torn';

export interface CutOutOptions {
  /** 'rows' removes a horizontal band (keeps top + bottom); 'columns' a vertical band (keeps left + right). */
  axis: CutAxis;
  /** Band to remove, in image pixels along the axis (order does not matter). */
  from: number;
  to: number;
  /** How the join looks: nothing, a thin line, or a torn-paper edge. */
  seam: CutSeam;
}

/** The band being chosen in the editor (before Apply). */
export interface CutBand {
  axis: CutAxis;
  from: number;
  to: number;
  seam: CutSeam;
}

/** A starting band in the middle of the image (40%–60% along the axis). */
export function defaultCutBand(axis: CutAxis, width: number, height: number, seam: CutSeam = 'none'): CutBand {
  const len = axis === 'rows' ? height : width;
  return { axis, from: Math.round(len * 0.4), to: Math.round(len * 0.6), seam };
}

/** The band actually removed (clamped, whole pixels), or null when nothing sensible would be left. */
export function cutBand(length: number, from: number, to: number): { start: number; end: number } | null {
  const start = Math.max(0, Math.min(length, Math.round(Math.min(from, to))));
  const end = Math.max(0, Math.min(length, Math.round(Math.max(from, to))));
  if (end - start < 1 || length - (end - start) < 2) return null;
  return { start, end };
}

/** Maps a coordinate along the cut axis: before the band unchanged, after it moved back, inside it onto the join. */
export function mapAcrossCut(v: number, start: number, end: number): number {
  if (v <= start) return v;
  if (v >= end) return v - (end - start);
  return start;
}

/**
 * Removes a band from the middle of the image and joins what is left ("split and join"): e.g. keep
 * the top and bottom of a long screenshot without the part in between. Annotations after the band
 * move with the image; annotations entirely inside the band are removed.
 */
export async function applyCutOut(doc: EditorDoc, opts: CutOutOptions): Promise<EditorDoc> {
  const rows = opts.axis === 'rows';
  const length = rows ? doc.height : doc.width;
  const band = cutBand(length, opts.from, opts.to);
  if (!band) return doc;
  const { start, end } = band;
  const removed = end - start;
  const W = rows ? doc.width : doc.width - removed;
  const H = rows ? doc.height - removed : doc.height;
  const base = await deriveBitmap(W, H, (ctx) => {
    if (rows) {
      if (start > 0) ctx.drawImage(doc.base, 0, 0, doc.width, start, 0, 0, doc.width, start);
      if (end < doc.height) ctx.drawImage(doc.base, 0, end, doc.width, doc.height - end, 0, start, doc.width, doc.height - end);
    } else {
      if (start > 0) ctx.drawImage(doc.base, 0, 0, start, doc.height, 0, 0, start, doc.height);
      if (end < doc.width) ctx.drawImage(doc.base, end, 0, doc.width - end, doc.height, start, 0, doc.width - end, doc.height);
    }
    drawSeam(ctx, rows, start, rows ? W : H, opts.seam);
  });
  const m = (v: number) => mapAcrossCut(v, start, end);
  const t: GeometryTransform = rows
    ? {
      point: (p) => ({ x: p.x, y: m(p.y) }),
      rect: (q) => { const y1 = m(q.y); const y2 = m(q.y + q.h); return { x: q.x, y: y1, w: q.w, h: Math.max(1, y2 - y1) }; },
      scale: 1,
    }
    : {
      point: (p) => ({ x: m(p.x), y: p.y }),
      rect: (q) => { const x1 = m(q.x); const x2 = m(q.x + q.w); return { x: x1, y: q.y, w: Math.max(1, x2 - x1), h: q.h }; },
      scale: 1,
    };
  const inside = (a: Annotation) => {
    const b = getBounds(a);
    const lo = rows ? b.y : b.x;
    const hi = rows ? b.y + b.h : b.x + b.w;
    return lo >= start && hi <= end;
  };
  const annotations = doc.annotations.filter((a) => !inside(a)).map((a) => transformAnnotation(a, t));
  return { ...doc, base, width: W, height: H, annotations };
}

/** Marks the join so viewers can tell part of the image was left out. */
function drawSeam(ctx: OffscreenCanvasRenderingContext2D, rows: boolean, at: number, span: number, seam: CutSeam): void {
  if (seam === 'none') return;
  ctx.save();
  if (!rows) {
    // Draw in a rotated frame so the same code serves vertical joins (local x runs down the image).
    ctx.translate(at, 0);
    ctx.rotate(Math.PI / 2);
    at = 0;
  }
  if (seam === 'line') {
    ctx.setLineDash([8, 6]);
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(100, 116, 139, 0.9)';
    ctx.beginPath();
    ctx.moveTo(0, at);
    ctx.lineTo(span, at);
    ctx.stroke();
  } else {
    // Torn paper: a light zigzag strip with a soft shadow across the join.
    const tooth = 10;
    const amp = 5;
    ctx.beginPath();
    ctx.moveTo(0, at - amp);
    for (let x = 0, up = true; x <= span + tooth; x += tooth, up = !up) ctx.lineTo(x, at - amp + (up ? -amp : amp));
    for (let x = Math.ceil((span + tooth) / tooth) * tooth, up = true; x >= 0; x -= tooth, up = !up) ctx.lineTo(x, at + amp + (up ? amp : -amp));
    ctx.closePath();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.35)';
    ctx.shadowBlur = 6;
    ctx.fillStyle = '#f8fafc';
    ctx.fill();
  }
  ctx.restore();
}
