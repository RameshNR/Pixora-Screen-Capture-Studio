import { computeRects, dividers, placeImage, type Box, type CellView, type CollageNode } from './layout';
import { MAX_CANVAS_AREA, MAX_CANVAS_DIMENSION } from '@/shared/constants/media';

/** The collage is laid out at this width; the exported file is this layout scaled up (sharp at any size). */
export const LAYOUT_WIDTH = 1920;

/** Export size: 'original' keeps every picture at (at least) its own full resolution. */
export type OutputSize = 'original' | 1920 | 2560 | 3840 | 7680;

export const OUTPUT_SIZES: Array<{ value: OutputSize; label: string; description: string }> = [
  { value: 'original', label: 'Original detail', description: 'Every image at its full resolution (recommended)' },
  { value: 1920, label: 'Full HD · 1920 px', description: '1080p width' },
  { value: 2560, label: 'QHD · 2560 px', description: '1440p width' },
  { value: 3840, label: '4K UHD · 3840 px', description: '2160p width' },
  { value: 7680, label: '8K UHD · 7680 px', description: '4320p width' },
];

/** Largest bitmap the exporter will create (keeps clear of Chrome's canvas limits). */
const MAX_EXPORT_AREA = Math.floor(MAX_CANVAS_AREA / 2);
const MAX_EXPORT_SIDE = Math.min(MAX_CANVAS_DIMENSION, 16384);

/**
 * How much the layout is scaled up for export. 'original' picks the scale at which no picture is
 * shrunk (each one keeps all of its pixels); a fixed width scales the layout to that width. Either
 * way the result is limited to what the browser can encode, and `limited` says when that happened.
 */
export function exportScale(m: Pick<CollageModel, 'tree' | 'images' | 'style' | 'width' | 'height'>, size: OutputSize): { scale: number; width: number; height: number; limited: boolean } {
  let k: number;
  if (size === 'original') {
    k = 1;
    for (const { slot, box } of computeRects(m.tree, contentBox(m), m.style.gap)) {
      const img = m.images[slot];
      if (!img || box.w <= 0 || box.h <= 0) continue;
      const p = placeImage(img.bitmap.width, img.bitmap.height, box, img.view);
      if (p.w > 0) k = Math.max(k, img.bitmap.width / p.w);
    }
  } else {
    k = size / m.width;
  }
  const maxK = Math.min(MAX_EXPORT_SIDE / m.width, MAX_EXPORT_SIDE / m.height, Math.sqrt(MAX_EXPORT_AREA / (m.width * m.height)));
  const limited = k > maxK + 1e-9;
  const scale = Math.min(k, maxK);
  return { scale, width: Math.max(1, Math.round(m.width * scale)), height: Math.max(1, Math.round(m.height * scale)), limited };
}

export interface CollageImage {
  key: string;
  bitmap: ImageBitmap;
  name: string;
  view: CellView;
}

export interface SplitLines {
  show: boolean;
  color: string;
  width: number;
  dash: 'solid' | 'dashed' | 'dotted';
}

export interface CollageStyle {
  gap: number;
  padding: number;
  radius: number;
  background: string;
  lines: SplitLines;
}

export interface CollageModel {
  tree: CollageNode;
  images: CollageImage[];
  style: CollageStyle;
  width: number;
  height: number;
}

export function contentBox(m: Pick<CollageModel, 'width' | 'height' | 'style'>): Box {
  const p = m.style.padding;
  return { x: p, y: p, w: Math.max(1, m.width - p * 2), h: Math.max(1, m.height - p * 2) };
}

function paint(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, bg: string, w: number, h: number): string | CanvasGradient {
  if (!bg.startsWith('linear:')) return bg;
  const [, a = '#fff', b = '#000'] = bg.split(':');
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, a);
  g.addColorStop(1, b);
  return g;
}

/** Draws the collage in output pixels (scale the context for previews). */
export function renderCollage(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, m: CollageModel): Array<{ slot: number; box: Box }> {
  const { style } = m;
  if (style.background !== 'transparent') {
    ctx.fillStyle = paint(ctx, style.background, m.width, m.height);
    ctx.fillRect(0, 0, m.width, m.height);
  }
  const cells = computeRects(m.tree, contentBox(m), style.gap);
  ctx.imageSmoothingQuality = 'high';
  for (const { slot, box } of cells) {
    const img = m.images[slot];
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(box.x, box.y, box.w, box.h, Math.min(style.radius, box.w / 2, box.h / 2));
    ctx.clip();
    if (img) {
      const p = placeImage(img.bitmap.width, img.bitmap.height, box, img.view);
      ctx.drawImage(img.bitmap, p.x, p.y, p.w, p.h);
    } else {
      ctx.fillStyle = 'rgba(127,127,127,0.18)';
      ctx.fillRect(box.x, box.y, box.w, box.h);
    }
    ctx.restore();
  }
  if (style.lines.show && style.lines.width > 0) drawSplitLines(ctx, m);
  return cells;
}

/** Lines drawn along every split (in the middle of the gap), each spanning its own section. */
export function drawSplitLines(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, m: CollageModel): void {
  const { lines } = m.style;
  const w = lines.width;
  ctx.save();
  ctx.strokeStyle = lines.color;
  ctx.lineWidth = w;
  ctx.lineCap = lines.dash === 'dotted' ? 'round' : 'butt';
  ctx.setLineDash(lines.dash === 'dashed' ? [w * 3, w * 2] : lines.dash === 'dotted' ? [0.01, w * 2] : []);
  for (const d of dividers(m.tree, contentBox(m), m.style.gap)) {
    ctx.beginPath();
    if (d.dir === 'row') {
      ctx.moveTo(d.box.x, d.box.y);
      ctx.lineTo(d.box.x, d.box.y + d.box.h);
    } else {
      ctx.moveTo(d.box.x, d.box.y);
      ctx.lineTo(d.box.x + d.box.w, d.box.y);
    }
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * Renders the collage at `size` and encodes it as lossless PNG. The layout is drawn through a scale
 * transform, so every picture is resampled once, straight from its full-resolution source.
 */
export type CollageFormat = 'png' | 'jpeg' | 'webp';

/** Human-readable file size ("840 KB", "2.4 MB"). */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

export async function exportCollage(m: CollageModel, size: OutputSize = 'original', format: CollageFormat = 'png', quality = 0.9): Promise<Blob> {
  const out = exportScale(m, size);
  const canvas = new OffscreenCanvas(out.width, out.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D context unavailable');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  // JPEG has no transparency: a transparent background becomes white instead of black.
  if (format === 'jpeg') {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, out.width, out.height);
  }
  ctx.scale(out.width / m.width, out.height / m.height);
  renderCollage(ctx, m);
  return canvas.convertToBlob(format === 'png' ? { type: 'image/png' } : { type: `image/${format}`, quality: Math.max(0.1, Math.min(1, quality)) });
}
