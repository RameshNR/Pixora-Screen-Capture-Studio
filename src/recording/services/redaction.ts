import type { VideoRedaction } from '@/shared/types';

/** Regions active at a moment of the original video (seconds). */
export function activeRedactions(list: VideoRedaction[], t: number): VideoRedaction[] {
  return list.filter((r) => (r.start === null || t >= r.start - 1e-3) && (r.end === null || t <= r.end + 1e-3));
}

/** Pixel rectangle of a region inside a frame (clamped, at least 1 px). */
export function regionPixels(r: VideoRedaction, w: number, h: number): { x: number; y: number; w: number; h: number } {
  const x = Math.max(0, Math.min(w - 1, Math.round(r.rect.x * w)));
  const y = Math.max(0, Math.min(h - 1, Math.round(r.rect.y * h)));
  return { x, y, w: Math.max(1, Math.min(w - x, Math.round(r.rect.width * w))), h: Math.max(1, Math.min(h - y, Math.round(r.rect.height * h))) };
}

interface Drawable {
  displayWidth: number;
  displayHeight: number;
  draw(context: OffscreenCanvasRenderingContext2D, dx: number, dy: number, dWidth?: number, dHeight?: number): void;
}

let canvas: OffscreenCanvas | null = null;
let scratch: OffscreenCanvas | null = null;

/**
 * Burns privacy regions into a frame: Gaussian blur, pixelation (down- then up-scaling without
 * smoothing) or a solid mask. Runs entirely on this device during export.
 */
export function applyRedactions(sample: Drawable, active: VideoRedaction[]): OffscreenCanvas {
  const W = sample.displayWidth;
  const H = sample.displayHeight;
  if (!canvas || canvas.width !== W || canvas.height !== H) canvas = new OffscreenCanvas(W, H);
  if (!scratch) scratch = new OffscreenCanvas(1, 1);
  const ctx = canvas.getContext('2d')!;
  ctx.filter = 'none';
  sample.draw(ctx, 0, 0, W, H);
  const shorter = Math.min(W, H);
  for (const r of active) {
    const p = regionPixels(r, W, H);
    if (r.kind === 'mask') {
      ctx.fillStyle = r.color;
      ctx.fillRect(p.x, p.y, p.w, p.h);
      continue;
    }
    if (r.kind === 'pixelate') {
      const block = Math.max(2, Math.round(r.strength * shorter));
      const sw = Math.max(1, Math.round(p.w / block));
      const sh = Math.max(1, Math.round(p.h / block));
      scratch.width = sw;
      scratch.height = sh;
      const s = scratch.getContext('2d')!;
      s.imageSmoothingEnabled = true;
      s.drawImage(canvas, p.x, p.y, p.w, p.h, 0, 0, sw, sh);
      ctx.save();
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(scratch, 0, 0, sw, sh, p.x, p.y, p.w, p.h);
      ctx.restore();
      continue;
    }
    // Blur: copy the region (with a margin so edges blur evenly), blur it back in, clipped.
    const radius = Math.max(2, Math.round(r.strength * shorter));
    const m = radius * 2;
    const sx = Math.max(0, p.x - m);
    const sy = Math.max(0, p.y - m);
    const sw = Math.min(W - sx, p.w + m * 2);
    const sh = Math.min(H - sy, p.h + m * 2);
    scratch.width = sw;
    scratch.height = sh;
    scratch.getContext('2d')!.drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh);
    ctx.save();
    ctx.beginPath();
    ctx.rect(p.x, p.y, p.w, p.h);
    ctx.clip();
    ctx.filter = `blur(${radius}px)`;
    // Draw twice: a single pass leaves readable text at small radii.
    ctx.drawImage(scratch, sx, sy);
    ctx.drawImage(scratch, sx, sy);
    ctx.restore();
  }
  return canvas;
}
