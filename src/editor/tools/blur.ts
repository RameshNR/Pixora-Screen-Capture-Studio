import type { MaskPattern, Rect, RedactAnnotation } from '../types';
import { viewScale, type Ctx2D } from './common';
import { alpha, seeded, shade, shapeGeometry, type ShapeKind } from './shape-lib';

/**
 * Blur / pixelate / mask regions. Blur and pixelate sample the *base image* under them (they render
 * beneath other annotations, which is what you want for redaction). Results are cached per base
 * bitmap + region + look, so dragging other objects never re-runs the filter.
 *
 * Looks: blur styles (gaussian, motion, zoom, spin, noise, bokeh), pixelate patterns (square,
 * rectangular, mixed, mosaic tiles, directional, radial, soft), any region shape (rounded, ellipse,
 * cloud, star, heart, hexagon…), gradient fades and tilt-shift, focus (blur everything else),
 * colour treatments (dim, grayscale, monochrome, tint), frosted glass and borders. Solid masks
 * also come as text lines, password dots, multi-block, grid, person, card, ID and address shapes.
 */

export type RedactSource = ImageBitmap | OffscreenCanvas;

const bitmapIds = new WeakMap<object, number>();
let nextBitmapId = 1;
const cache = new Map<string, { canvas: OffscreenCanvas; x: number; y: number }>();
const CACHE_LIMIT = 48;

function bitmapId(b: object): number {
  let id = bitmapIds.get(b);
  if (!id) {
    id = nextBitmapId++;
    bitmapIds.set(b, id);
  }
  return id;
}

function key(base: RedactSource, a: RedactAnnotation): string {
  return [
    bitmapId(base), a.type, Math.round(a.x), Math.round(a.y), Math.round(a.w), Math.round(a.h), a.intensity,
    a.mode ?? '', a.pattern ?? '', a.soft ? 1 : 0, a.fade ?? '', a.invert ? 1 : 0, a.tone ?? '', a.tint ?? '', a.invert ? `${a.shape ?? ''}${a.radius ?? 0}` : '',
  ].join('|');
}

/** Outline of the region (rectangle, rounded, ellipse, cloud, star…). */
export function redactOutline(a: Pick<RedactAnnotation, 'x' | 'y' | 'w' | 'h' | 'shape' | 'radius'>): Path2D {
  const kind: ShapeKind = a.shape ?? 'rect';
  return shapeGeometry(kind, { x: a.x, y: a.y, w: a.w, h: a.h }, a.radius ?? 0).outline;
}

function canvas(w: number, h: number): { c: OffscreenCanvas; ctx: OffscreenCanvasRenderingContext2D } | null {
  const c = new OffscreenCanvas(Math.max(1, Math.round(w)), Math.max(1, Math.round(h)));
  const ctx = c.getContext('2d');
  return ctx ? { c, ctx } : null;
}

/** Average of several copies of the source (motion / zoom / spin blur). */
function averageCopies(ctx: OffscreenCanvasRenderingContext2D, n: number, drawCopy: (i: number, t: number) => void): void {
  for (let i = 0; i < n; i++) {
    ctx.globalAlpha = 1 / (i + 1);
    drawCopy(i, n > 1 ? i / (n - 1) - 0.5 : 0);
  }
  ctx.globalAlpha = 1;
}

function blurInto(ctx: OffscreenCanvasRenderingContext2D, base: RedactSource, x: number, y: number, w: number, h: number, a: RedactAnnotation): void {
  const I = Math.max(1, a.intensity);
  const mode = a.mode ?? 'gaussian';
  const m = Math.ceil(I * 3);
  const src = (dx: number, dy: number) => ctx.drawImage(base, x - m + dx, y - m + dy, w + m * 2, h + m * 2, -m, -m, w + m * 2, h + m * 2);
  switch (mode) {
    case 'motion-h':
    case 'motion-v':
    case 'motion-d': {
      const span = I * 3;
      ctx.filter = `blur(${Math.max(0.5, I * 0.12)}px)`;
      averageCopies(ctx, 28, (_, t) => {
        const d = t * span;
        if (mode === 'motion-h') src(d, 0);
        else if (mode === 'motion-v') src(0, d);
        else src(d * 0.7, d * 0.7);
      });
      ctx.filter = 'none';
      break;
    }
    case 'zoom': {
      const cx = x + w / 2;
      const cy = y + h / 2;
      const maxS = 1 + Math.min(1.2, I / 40);
      averageCopies(ctx, 24, (_, t) => {
        const s = 1 + (t + 0.5) * (maxS - 1);
        const sw = w / s;
        const sh = h / s;
        ctx.drawImage(base, cx - sw / 2, cy - sh / 2, sw, sh, 0, 0, w, h);
      });
      break;
    }
    case 'spin': {
      const cx = w / 2;
      const cy = h / 2;
      const ang = (Math.min(40, I * 1.2) * Math.PI) / 180;
      averageCopies(ctx, 24, (_, t) => {
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(t * ang);
        ctx.translate(-cx, -cy);
        src(0, 0);
        ctx.restore();
      });
      break;
    }
    default: {
      ctx.filter = `blur(${mode === 'bokeh' ? I * 1.6 : I}px)`;
      src(0, 0);
      ctx.filter = 'none';
      if (mode === 'noise') {
        const img = ctx.getImageData(0, 0, Math.max(1, w), Math.max(1, h));
        const rnd = seeded(w * 31 + h);
        const amt = 26 + I;
        for (let i = 0; i < img.data.length; i += 4) {
          const n = (rnd() - 0.5) * amt;
          img.data[i] = img.data[i]! + n;
          img.data[i + 1] = img.data[i + 1]! + n;
          img.data[i + 2] = img.data[i + 2]! + n;
        }
        ctx.putImageData(img, 0, 0);
      }
      if (mode === 'bokeh') {
        const rnd = seeded(w * 7 + h * 3);
        ctx.globalCompositeOperation = 'screen';
        const count = Math.max(6, Math.round((w * h) / Math.max(1, (I * 9) ** 2)));
        for (let i = 0; i < Math.min(60, count); i++) {
          const r = I * (1 + rnd() * 1.6);
          const px = rnd() * w;
          const py = rnd() * h;
          const g = ctx.createRadialGradient(px, py, 0, px, py, r);
          g.addColorStop(0, 'rgba(255,240,210,0.35)');
          g.addColorStop(0.75, 'rgba(255,230,190,0.22)');
          g.addColorStop(1, 'rgba(255,230,190,0)');
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(px, py, r, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalCompositeOperation = 'source-over';
      }
    }
  }
}

function pixelBlocks(base: CanvasImageSource, x: number, y: number, w: number, h: number, bw: number, bh: number, smooth = false): OffscreenCanvas | null {
  const sw = Math.max(1, Math.ceil(w / bw));
  const sh = Math.max(1, Math.ceil(h / bh));
  const small = canvas(sw, sh);
  const out = canvas(w, h);
  if (!small || !out) return null;
  small.ctx.imageSmoothingEnabled = true;
  small.ctx.imageSmoothingQuality = 'high';
  small.ctx.drawImage(base, x, y, w, h, 0, 0, sw, sh);
  out.ctx.imageSmoothingEnabled = smooth;
  out.ctx.drawImage(small.c, 0, 0, sw, sh, 0, 0, sw * bw, sh * bh);
  return out.c;
}

function pixelateInto(ctx: OffscreenCanvasRenderingContext2D, base: RedactSource, x: number, y: number, w: number, h: number, a: RedactAnnotation): void {
  const B = Math.max(2, a.intensity);
  const pattern = a.pattern ?? 'square';
  switch (pattern) {
    case 'wide': {
      const c = pixelBlocks(base, x, y, w, h, B * 2, B);
      if (c) ctx.drawImage(c, 0, 0);
      break;
    }
    case 'mixed': {
      const big = pixelBlocks(base, x, y, w, h, B * 1.6, B * 1.6);
      const small = pixelBlocks(base, x, y, w, h, B * 0.6, B * 0.6);
      if (!big || !small) break;
      ctx.drawImage(big, 0, 0);
      const rnd = seeded(w + h * 17);
      const s = B * 1.6;
      for (let cy = 0; cy < h; cy += s) for (let cx = 0; cx < w; cx += s) if (rnd() < 0.38) ctx.drawImage(small, cx, cy, s, s, cx, cy, s, s);
      break;
    }
    case 'mosaic': {
      // Hexagon tiles in the average colour beneath each tile, with thin grout lines.
      const r = B * 0.62;
      const dx = r * Math.sqrt(3);
      const dy = r * 1.5;
      const cols = Math.ceil(w / dx) + 2;
      const rows = Math.ceil(h / dy) + 2;
      const small = canvas(cols, rows);
      if (!small) break;
      small.ctx.imageSmoothingQuality = 'high';
      small.ctx.drawImage(base, x - dx / 2, y - dy / 2, cols * dx, rows * dy, 0, 0, cols, rows);
      const data = small.ctx.getImageData(0, 0, cols, rows).data;
      for (let j = 0; j < rows; j++) {
        for (let i = 0; i < cols; i++) {
          const k = (j * cols + i) * 4;
          const px = i * dx + (j % 2 ? dx / 2 : 0);
          const py = j * dy;
          ctx.fillStyle = `rgb(${data[k]},${data[k + 1]},${data[k + 2]})`;
          ctx.beginPath();
          for (let s = 0; s < 6; s++) {
            const t = (Math.PI / 3) * s + Math.PI / 6;
            ctx.lineTo(px + Math.cos(t) * r, py + Math.sin(t) * r);
          }
          ctx.closePath();
          ctx.fill();
          ctx.strokeStyle = 'rgba(0,0,0,0.12)';
          ctx.lineWidth = Math.max(0.5, r * 0.08);
          ctx.stroke();
        }
      }
      break;
    }
    case 'dir-h': {
      const c = pixelBlocks(base, x, y, w, h, B * 5, Math.max(1, B / 3), true);
      if (c) ctx.drawImage(c, 0, 0);
      break;
    }
    case 'dir-v': {
      const c = pixelBlocks(base, x, y, w, h, Math.max(1, B / 3), B * 5, true);
      if (c) ctx.drawImage(c, 0, 0);
      break;
    }
    case 'dir-d': {
      // Rotate, streak horizontally, rotate back.
      const D = Math.ceil(Math.hypot(w, h));
      const rot = canvas(D, D);
      if (!rot) break;
      rot.ctx.translate(D / 2, D / 2);
      rot.ctx.rotate(Math.PI / 4);
      rot.ctx.drawImage(base, x, y, w, h, -w / 2, -h / 2, w, h);
      const streak = pixelBlocks(rot.c, 0, 0, D, D, B * 5, Math.max(1, B / 3), true);
      if (!streak) break;
      ctx.save();
      ctx.translate(w / 2, h / 2);
      ctx.rotate(-Math.PI / 4);
      ctx.drawImage(streak, -D / 2, -D / 2);
      ctx.restore();
      break;
    }
    case 'radial': {
      const zoom = canvas(w, h);
      if (!zoom) break;
      blurInto(zoom.ctx, base, x, y, w, h, { ...a, mode: 'zoom', intensity: B * 2 });
      const c = pixelBlocks(zoom.c, 0, 0, w, h, B * 0.7, B * 0.7);
      if (c) ctx.drawImage(c, 0, 0);
      break;
    }
    default: {
      const c = pixelBlocks(base, x, y, w, h, B, B);
      if (c) ctx.drawImage(c, 0, 0);
    }
  }
  if (a.soft) {
    const copy = canvas(w, h);
    if (!copy) return;
    copy.ctx.drawImage(ctx.canvas, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.filter = `blur(${Math.max(1, B * 0.35)}px)`;
    ctx.drawImage(copy.c, 0, 0);
    ctx.filter = 'none';
  }
}

function applyTone(ctx: OffscreenCanvasRenderingContext2D, w: number, h: number, a: RedactAnnotation): void {
  const tone = a.tone ?? 'none';
  if (tone === 'none') return;
  if (tone === 'gray' || tone === 'mono') {
    const copy = canvas(w, h);
    if (!copy) return;
    copy.ctx.drawImage(ctx.canvas, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.filter = tone === 'gray' ? 'grayscale(1)' : 'grayscale(1) contrast(1.7) brightness(1.05)';
    ctx.drawImage(copy.c, 0, 0);
    ctx.filter = 'none';
  } else if (tone === 'dim') {
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.fillRect(0, 0, w, h);
  } else if (tone === 'tint') {
    const t = a.tint ?? '#7C3AED';
    ctx.globalCompositeOperation = 'color';
    ctx.fillStyle = t;
    ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = alpha(t, 0.28);
    ctx.fillRect(0, 0, w, h);
  }
}

/** Fades the effect out across the region (gradient blur, tilt-shift, feathered edges). */
function applyFade(ctx: OffscreenCanvasRenderingContext2D, w: number, h: number, fade: RedactAnnotation['fade']): void {
  if (!fade || fade === 'none') return;
  ctx.globalCompositeOperation = 'destination-in';
  if (fade === 'edges') {
    const f = Math.max(2, Math.min(w, h) * 0.18);
    ctx.filter = `blur(${f * 0.6}px)`;
    ctx.fillStyle = '#000';
    ctx.fillRect(f, f, Math.max(1, w - f * 2), Math.max(1, h - f * 2));
    ctx.filter = 'none';
  } else {
    const g = fade === 'top' ? ctx.createLinearGradient(0, 0, 0, h)
      : fade === 'bottom' ? ctx.createLinearGradient(0, h, 0, 0)
      : fade === 'left' ? ctx.createLinearGradient(0, 0, w, 0)
      : fade === 'right' ? ctx.createLinearGradient(w, 0, 0, 0)
      : ctx.createLinearGradient(0, 0, 0, h);
    if (fade === 'tilt') {
      g.addColorStop(0, '#000');
      g.addColorStop(0.35, 'rgba(0,0,0,0)');
      g.addColorStop(0.65, 'rgba(0,0,0,0)');
      g.addColorStop(1, '#000');
    } else {
      g.addColorStop(0, '#000');
      g.addColorStop(1, 'rgba(0,0,0,0)');
    }
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }
  ctx.globalCompositeOperation = 'source-over';
}

function buildRegion(base: RedactSource, a: RedactAnnotation): { canvas: OffscreenCanvas; x: number; y: number } | null {
  // Focus ("blur others") works on the whole image and cuts the region out.
  const r = a.invert ? { x: 0, y: 0, w: base.width, h: base.height } : a;
  const x = Math.max(0, Math.floor(r.x));
  const y = Math.max(0, Math.floor(r.y));
  const w = Math.min(base.width - x, Math.ceil(r.w));
  const h = Math.min(base.height - y, Math.ceil(r.h));
  if (w < 1 || h < 1) return null;
  const out = canvas(w, h);
  if (!out) return null;
  const { ctx } = out;
  if (a.type === 'blur') blurInto(ctx, base, x, y, w, h, a);
  else pixelateInto(ctx, base, x, y, w, h, a);
  applyTone(ctx, w, h, a);
  if (!a.invert) applyFade(ctx, w, h, a.fade);
  else {
    // Soft-edged hole where the focus region is.
    const feather = Math.max(2, Math.min(a.w, a.h) * 0.06);
    ctx.globalCompositeOperation = 'destination-out';
    // An opaque paint: an earlier step (bokeh lights) may have left a see-through gradient set,
    // which would cut nothing and leave the area blurred too.
    ctx.fillStyle = '#000';
    ctx.globalAlpha = 1;
    ctx.filter = `blur(${feather}px)`;
    ctx.translate(-x, -y);
    ctx.fill(redactOutline(a));
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.filter = 'none';
    ctx.globalCompositeOperation = 'source-over';
  }
  return { canvas: out.c, x, y };
}

/* ---------------------------------- masks ---------------------------------- */

function bars(ctx: Ctx2D, r: Rect, rows: number[][], gap: number): void {
  const h = (r.h - gap * (rows.length - 1)) / rows.length;
  rows.forEach((row, j) => {
    let x = r.x;
    const y = r.y + j * (h + gap);
    for (const frac of row) {
      const w = (r.w - gap * (row.length - 1)) * frac;
      ctx.beginPath();
      ctx.roundRect(x, y, Math.max(1, w), Math.max(1, h), Math.min(h / 2, 6));
      ctx.fill();
      x += w + gap;
    }
  });
}

function drawMaskPattern(ctx: Ctx2D, a: RedactAnnotation, pattern: MaskPattern): void {
  const r = { x: a.x, y: a.y, w: a.w, h: a.h };
  const s = Math.min(r.w, r.h);
  const gap = Math.max(2, s * 0.12);
  switch (pattern) {
    case 'lines':
      bars(ctx, r, [[1], [0.86], [0.62]], gap);
      break;
    case 'multi':
      bars(ctx, r, [[0.56, 0.44], [0.3, 0.46, 0.24]], gap);
      break;
    case 'rows': {
      bars(ctx, r, [[1], [1], [0.78]], gap);
      const h = (r.h - gap * 2) / 3;
      ctx.beginPath();
      ctx.arc(r.x + r.w - h / 2, r.y + 2 * (h + gap) + h / 2, h / 2, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'grid':
      bars(ctx, r, [[1 / 3, 1 / 3, 1 / 3], [1 / 3, 1 / 3, 1 / 3]], gap);
      break;
    case 'dots': {
      ctx.beginPath();
      ctx.roundRect(r.x, r.y, r.w, r.h, r.h / 2);
      ctx.fill();
      // Dots spaced about half the height apart (like a password field).
      const dr = Math.min(r.h * 0.13, r.w * 0.06);
      const n = Math.max(3, Math.min(12, Math.floor((r.w - r.h * 0.6) / (dr * 3.2)) + 1));
      const step = (r.w - r.h * 0.9) / Math.max(1, n - 1);
      ctx.fillStyle = shade(a.color ?? '#000000', 0).toUpperCase() === '#FFFFFF' ? '#202938' : '#FFFFFF';
      for (let i = 0; i < n; i++) {
        ctx.beginPath();
        ctx.arc(r.x + r.h * 0.45 + step * i, r.y + r.h / 2, dr, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case 'mixed': {
      const d = r.h * 0.42;
      ctx.beginPath();
      ctx.arc(r.x + d / 2, r.y + d / 2, d / 2, 0, Math.PI * 2);
      ctx.fill();
      bars(ctx, { x: r.x + d + gap, y: r.y + d * 0.2, w: r.w - d - gap, h: d * 0.6 }, [[1]], gap);
      bars(ctx, { x: r.x + r.w * 0.35, y: r.y + d + gap, w: r.w * 0.65, h: r.h - d - gap }, [[1]], gap);
      break;
    }
    case 'person': {
      const cx = r.x + r.w / 2;
      const head = Math.min(r.w * 0.36, r.h * 0.4);
      ctx.beginPath();
      ctx.arc(cx, r.y + head / 2 + r.h * 0.04, head / 2, 0, Math.PI * 2);
      ctx.fill();
      const top = r.y + head + r.h * 0.1;
      const bw = Math.min(r.w, r.h * 0.95);
      ctx.beginPath();
      ctx.moveTo(cx - bw / 2, r.y + r.h);
      ctx.lineTo(cx - bw / 2, top + bw * 0.35);
      ctx.quadraticCurveTo(cx - bw / 2, top, cx, top);
      ctx.quadraticCurveTo(cx + bw / 2, top, cx + bw / 2, top + bw * 0.35);
      ctx.lineTo(cx + bw / 2, r.y + r.h);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'card': {
      bars(ctx, { x: r.x, y: r.y, w: r.w, h: r.h * 0.38 }, [[1]], gap);
      bars(ctx, { x: r.x, y: r.y + r.h * 0.52, w: r.w * 0.55, h: r.h * 0.3 }, [[1]], gap);
      const d = r.h * 0.3;
      for (let i = 0; i < 2; i++) {
        ctx.beginPath();
        ctx.arc(r.x + r.w - d / 2 - i * d * 1.15, r.y + r.h * 0.67, d / 2, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case 'id': {
      const pw = Math.min(r.w * 0.32, r.h * 0.85);
      ctx.beginPath();
      ctx.roundRect(r.x, r.y + (r.h - pw * 1.15) / 2, pw, pw * 1.15, Math.min(6, pw * 0.1));
      ctx.fill();
      bars(ctx, { x: r.x + pw + gap, y: r.y + r.h * 0.12, w: r.w - pw - gap, h: r.h * 0.76 }, [[1], [0.7], [0.85]], gap);
      break;
    }
    case 'address': {
      const ph = Math.min(r.h * 0.8, r.w * 0.22);
      const pr = ph * 0.38;
      const px = r.x + pr;
      const py = r.y + r.h * 0.12 + pr;
      ctx.beginPath();
      ctx.arc(px, py, pr, Math.PI * 0.82, Math.PI * 0.18);
      ctx.lineTo(px, py + ph - pr * 0.4);
      ctx.closePath();
      ctx.fill();
      ctx.save();
      ctx.globalCompositeOperation = 'destination-out';
      ctx.beginPath();
      ctx.arc(px, py, pr * 0.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      bars(ctx, { x: r.x + pr * 2 + gap, y: r.y + r.h * 0.12, w: r.w - pr * 2 - gap, h: r.h * 0.76 }, [[1], [0.75], [0.9]], gap);
      break;
    }
    default:
      ctx.fill(redactOutline(a));
  }
}

/* --------------------------------- rendering -------------------------------- */

/** The border's line: style ('white' / 'color' are older names for solid), colour and thickness. */
export function borderOf(a: Pick<RedactAnnotation, 'border' | 'borderColor' | 'borderWidth' | 'w' | 'h'>): { style: 'none' | 'solid' | 'dashed' | 'dotted' | 'glow'; color: string; width: number } {
  const b = a.border ?? 'none';
  const style = b === 'white' || b === 'color' ? 'solid' : b;
  const color = b === 'white' ? '#FFFFFF' : a.borderColor ?? (b === 'glow' ? '#A855F7' : '#FFFFFF');
  const width = a.borderWidth ?? Math.max(2, Math.round(Math.min(a.w, a.h) * 0.025));
  return { style, color, width };
}

function drawBorder(ctx: Ctx2D, a: RedactAnnotation, path: Path2D): void {
  const { style, color: col, width: lw } = borderOf(a);
  if (style === 'none') return;
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = style === 'dotted' ? 'round' : 'butt';
  ctx.lineWidth = lw;
  if (style === 'solid') ctx.strokeStyle = col;
  else if (style === 'dashed' || style === 'dotted') {
    ctx.strokeStyle = col;
    ctx.setLineDash(style === 'dashed' ? [lw * 3, lw * 2] : [0.01, lw * 2]);
  } else {
    ctx.strokeStyle = col;
    ctx.shadowColor = col;
    const k = Math.max(1, viewScale(ctx));
    ctx.shadowBlur = lw * 5 * k;
    ctx.stroke(path);
    ctx.lineWidth = lw * 0.6;
    ctx.strokeStyle = shade(col, 0.5);
  }
  ctx.stroke(path);
  ctx.restore();
}

function drawGlass(ctx: Ctx2D, a: RedactAnnotation, path: Path2D): void {
  ctx.save();
  ctx.clip(path);
  ctx.fillStyle = 'rgba(255,255,255,0.18)';
  ctx.fillRect(a.x, a.y, a.w, a.h);
  const g = ctx.createLinearGradient(a.x, a.y, a.x, a.y + a.h * 0.55);
  g.addColorStop(0, 'rgba(255,255,255,0.32)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(a.x, a.y, a.w, a.h * 0.55);
  ctx.restore();
  if ((a.border ?? 'none') === 'none') {
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
    ctx.lineWidth = Math.max(1.5, Math.min(a.w, a.h) * 0.012);
    ctx.stroke(path);
    ctx.restore();
  }
}

export function renderRedact(ctx: Ctx2D, base: RedactSource, a: RedactAnnotation): void {
  const path = typeof Path2D !== 'undefined' ? redactOutline(a) : null;
  if (a.type === 'mask') {
    ctx.save();
    ctx.globalAlpha = a.opacity;
    ctx.fillStyle = a.color ?? '#000000';
    if (a.invert && path) {
      // Everything except the area: the whole picture with the area's shape left open.
      const outside = new Path2D();
      outside.rect(0, 0, base?.width ?? ctx.canvas.width, base?.height ?? ctx.canvas.height);
      outside.addPath(path);
      ctx.fill(outside, 'evenodd');
    } else if (path) {
      // A content look (text lines, face…) inside a shape: drawn within that shape.
      if (a.shape && a.shape !== 'rect' && (a.maskPattern ?? 'solid') !== 'solid') ctx.clip(path);
      drawMaskPattern(ctx, a, a.maskPattern ?? 'solid');
    }
    else ctx.fillRect(a.x, a.y, a.w, a.h);
    ctx.restore();
    // The border outlines the area's shape, whatever is drawn inside it.
    if (path) drawBorder(ctx, a, path);
    return;
  }
  const k = key(base, a);
  let region = cache.get(k);
  if (!region) {
    const built = buildRegion(base, a);
    if (!built) return;
    region = built;
    cache.set(k, region);
    if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value!);
  }
  ctx.save();
  ctx.globalAlpha = a.opacity;
  if (path && !a.invert && (a.shape || a.radius)) ctx.clip(path);
  ctx.drawImage(region.canvas, region.x, region.y);
  ctx.restore();
  if (path && a.glass && !a.invert) drawGlass(ctx, a, path);
  if (path) drawBorder(ctx, a, path);
}

export function clearRedactCache(): void {
  cache.clear();
}

/* ---------------------------------- presets --------------------------------- */

export interface RedactPreset {
  id: string;
  label: string;
  patch: Partial<RedactAnnotation>;
}

const R = (id: string, label: string, patch: Partial<RedactAnnotation>): RedactPreset => ({ id, label, patch });
/** Resets every look field, so a preset fully replaces the previous look. */
export const CLEAR_LOOK: Partial<RedactAnnotation> = {
  shape: undefined, radius: undefined, mode: undefined, pattern: undefined, soft: undefined, fade: undefined, invert: undefined,
  tone: undefined, tint: undefined, glass: undefined, border: undefined, borderColor: undefined, maskPattern: undefined,
};

const BLUR_ALL: Array<{ id: string; label: string; items: RedactPreset[] }> = [
  { id: 'standard', label: 'Standard', items: [R('b-light', 'Light blur', { intensity: 5 }), R('b-medium', 'Medium blur', { intensity: 12 }), R('b-heavy', 'Heavy blur', { intensity: 26 })] },
  { id: 'shape', label: 'Area & shape', items: [R('b-rect', 'Rectangle', { shape: 'rect' }), R('b-rounded', 'Rounded', { shape: 'rounded', radius: 0 }), R('b-circle', 'Circle', { shape: 'ellipse' }), R('b-oval', 'Oval', { shape: 'ellipse' })] },
  { id: 'custom', label: 'Custom shape', items: [R('b-cloud', 'Cloud', { shape: 'cloud', border: 'white' }), R('b-star', 'Star', { shape: 'star', border: 'white' }), R('b-heart', 'Heart', { shape: 'heart', border: 'white' }), R('b-hex', 'Hexagon', { shape: 'hexagon', border: 'white' })] },
  { id: 'motion', label: 'Motion', items: [R('b-mh', 'Horizontal', { mode: 'motion-h' }), R('b-mv', 'Vertical', { mode: 'motion-v' }), R('b-md', 'Diagonal', { mode: 'motion-d' }), R('b-radial', 'Radial', { mode: 'zoom' })] },
  { id: 'gradient', label: 'Gradient', items: [R('b-ftop', 'Top fade', { fade: 'top' }), R('b-fbottom', 'Bottom fade', { fade: 'bottom' }), R('b-fleft', 'Left fade', { fade: 'left' }), R('b-fright', 'Right fade', { fade: 'right' })] },
  { id: 'glass', label: 'Glass & frosted', items: [R('b-frost', 'Frosted glass', { glass: true, shape: 'rounded', intensity: 14 }), R('b-glass', 'Glass (translucent)', { glass: true, shape: 'rounded', intensity: 6 }), R('b-glassblur', 'Glass + blur', { glass: true, shape: 'rounded', intensity: 22, tone: 'dim' })] },
  { id: 'advanced', label: 'Advanced', items: [R('b-tilt', 'Tilt-shift', { fade: 'tilt' }), R('b-depth', 'Depth blur', { mode: 'bokeh', fade: 'edges', intensity: 10 }), R('b-zoom', 'Zoom blur', { mode: 'zoom', intensity: 24 }), R('b-bokeh', 'Bokeh blur', { mode: 'bokeh' })] },
  { id: 'privacy', label: 'Redaction & privacy', items: [R('b-text', 'Blur text', { intensity: 8, shape: 'rounded', radius: 6 }), R('b-face', 'Blur face', { intensity: 18, shape: 'ellipse', fade: 'edges' }), R('b-strong', 'Strong redaction', { intensity: 30, tone: 'dim' })] },
  { id: 'creative', label: 'Creative', items: [R('b-spin', 'Spin blur', { mode: 'spin' }), R('b-lens', 'Lens blur', { mode: 'bokeh', intensity: 8 }), R('b-noise', 'Noise blur', { mode: 'noise' }), R('b-bw', 'Blur + B&W', { tone: 'gray' })] },
];

const PIXEL_ALL: Array<{ id: string; label: string; items: RedactPreset[] }> = [
  { id: 'size', label: 'Block size', items: [R('p-small', 'Small (4px)', { intensity: 4 }), R('p-medium', 'Medium (8px)', { intensity: 8 }), R('p-large', 'Large (16px)', { intensity: 16 }), R('p-xl', 'Extra large (28px)', { intensity: 28 })] },
  { id: 'shape', label: 'Shape', items: [R('p-rect', 'Rectangle', { shape: 'rect' }), R('p-rounded', 'Rounded', { shape: 'rounded' }), R('p-circle', 'Circle', { shape: 'ellipse' }), R('p-cloud', 'Cloud', { shape: 'cloud', border: 'white' }), R('p-star', 'Star', { shape: 'star', border: 'white' }), R('p-heart', 'Heart', { shape: 'heart', border: 'white' }), R('p-hex', 'Hexagon', { shape: 'hexagon', border: 'white' })] },
  { id: 'pattern', label: 'Patterns', items: [R('p-square', 'Square blocks', { pattern: 'square' }), R('p-wide', 'Rectangular', { pattern: 'wide' }), R('p-mixed', 'Mixed blocks', { pattern: 'mixed' }), R('p-mosaic', 'Mosaic tiles', { pattern: 'mosaic' })] },
  { id: 'border', label: 'Border & style', items: [R('p-noborder', 'No border', { border: 'none' }), R('p-white', 'White border', { border: 'white' }), R('p-color', 'Coloured border', { border: 'color', borderColor: '#7C3AED' }), R('p-dashed', 'Dashed border', { border: 'dashed', shape: 'rounded' }), R('p-glow', 'Glow border', { border: 'glow', borderColor: '#A855F7', shape: 'rounded' })] },
  { id: 'direction', label: 'Directional', items: [R('p-dh', 'Horizontal', { pattern: 'dir-h' }), R('p-dv', 'Vertical', { pattern: 'dir-v' }), R('p-dd', 'Diagonal', { pattern: 'dir-d' }), R('p-radial', 'Radial', { pattern: 'radial' })] },
  { id: 'advanced', label: 'Advanced', items: [R('p-heavy', 'Heavy pixelate', { intensity: 24 }), R('p-soft', 'Soft pixelate', { soft: true }), R('p-grad', 'Gradient pixelate', { fade: 'right' }), R('p-edge', 'Edge pixelate', { fade: 'edges' })] },
  { id: 'effects', label: 'Pixelate + effects', items: [R('p-blur', 'Pixelate + blur', { soft: true, intensity: 18 }), R('p-dim', 'Pixelate + dim', { tone: 'dim' }), R('p-bw', 'Pixelate + B&W', { tone: 'gray' }), R('p-tint', 'Pixelate + tint', { tone: 'tint', tint: '#7C3AED' })] },
  { id: 'colour', label: 'Colour', items: [R('p-classic', 'Classic (original colours)', { tone: 'none' }), R('p-gray', 'Grayscale', { tone: 'gray' }), R('p-brand', 'Tinted (brand colour)', { tone: 'tint', tint: '#6D28D9' }), R('p-mono', 'Monochrome (black & white)', { tone: 'mono' })] },
  { id: 'select', label: 'Selection marks', items: [R('p-dsel', 'Dashed select', { border: 'dashed' }), R('p-ssel', 'Solid select', { border: 'white' }), R('p-rsel', 'Rounded select', { shape: 'ellipse', border: 'dashed' }), R('p-fsel', 'Cloud select', { shape: 'cloud', border: 'dashed' })] },
];

const MASK_ALL: Array<{ id: string; label: string; items: RedactPreset[] }> = [
  { id: 'basic', label: 'Basic', items: [R('m-black', 'Black mask', { color: '#000000' }), R('m-white', 'White mask', { color: '#FFFFFF' }), R('m-gray', 'Gray mask', { color: '#6B7280' }), R('m-purple', 'Custom colour', { color: '#8B3FD9' })] },
  { id: 'colour', label: 'Coloured', items: [R('m-red', 'Red', { color: '#FF1F1F' }), R('m-blue', 'Blue', { color: '#1D2BFF' }), R('m-green', 'Green', { color: '#169A1E' }), R('m-yellow', 'Yellow', { color: '#FFE500' })] },
  { id: 'shape', label: 'Shape', items: [R('m-rect', 'Rectangle', { shape: 'rect' }), R('m-rounded', 'Rounded', { shape: 'rounded' }), R('m-circle', 'Circle', { shape: 'ellipse' }), R('m-oval', 'Oval', { shape: 'ellipse' })] },
  { id: 'geo', label: 'Geometric', items: [R('m-square', 'Square', { shape: 'rect' }), R('m-tri', 'Triangle', { shape: 'triangle' }), R('m-hex', 'Hexagon', { shape: 'hexagon' }), R('m-poly', 'Polygon', { shape: 'octagon' })] },
  { id: 'custom', label: 'Custom shape', items: [R('m-cloud', 'Cloud', { shape: 'cloud' }), R('m-star', 'Star', { shape: 'star' }), R('m-heart', 'Heart', { shape: 'heart' }), R('m-badge', 'Badge', { shape: 'burst' })] },
  { id: 'content', label: 'Text & content', items: [R('m-lines', 'Text redaction', { maskPattern: 'lines' }), R('m-block', 'Block mask', { maskPattern: 'solid', shape: 'rounded', radius: 6 }), R('m-multi', 'Multi-block', { maskPattern: 'multi' }), R('m-dots', 'Password mask', { maskPattern: 'dots' })] },
  { id: 'border', label: 'Border / outline', items: [R('m-wborder', 'White border', { border: 'white' }), R('m-cborder', 'Coloured border', { border: 'color', borderColor: '#A855F7' }), R('m-dborder', 'Dashed border', { border: 'dashed' }), R('m-glow', 'Glow border', { border: 'glow', borderColor: '#C084FC' })] },
  { id: 'corner', label: 'Corners', items: [R('m-sharp', 'Sharp (0 px)', { shape: 'rect', radius: 0 }), R('m-r8', 'Rounded (8 px)', { shape: 'rect', radius: 8 }), R('m-r16', 'Rounded (16 px)', { shape: 'rect', radius: 16 }), R('m-pill', 'Pill (full)', { shape: 'pill' })] },
  { id: 'stylized', label: 'Stylized', items: [R('m-slant', 'Slanted', { shape: 'slant' }), R('m-para', 'Parallelogram', { shape: 'parallelogram' }), R('m-trap', 'Trapezoid', { shape: 'trapezoid' }), R('m-wave', 'Wave', { shape: 'wavy' })] },
  { id: 'multi', label: 'Multi-element', items: [R('m-multiple', 'Multiple blocks', { maskPattern: 'multi' }), R('m-mixed', 'Mixed shapes', { maskPattern: 'mixed' }), R('m-rows', 'Structured (rows)', { maskPattern: 'rows' }), R('m-grid', 'Grid (cells)', { maskPattern: 'grid' })] },
  { id: 'use', label: 'Use cases', items: [R('m-face', 'Face (identity)', { maskPattern: 'person' }), R('m-card', 'Card info (payment)', { maskPattern: 'card' }), R('m-id', 'ID (document)', { maskPattern: 'id' }), R('m-address', 'Address (location)', { maskPattern: 'address' })] },
];

/**
 * Designs are the effect and its shape only: border and corners are set under Adjust (so picking a
 * design never adds or changes a border, and a border is found and changed in one place).
 */
const designsOnly = (groups: Array<{ id: string; label: string; items: RedactPreset[] }>) =>
  groups
    .filter((g) => !['border', 'corner', 'select'].includes(g.id))
    .map((g) => ({ ...g, items: g.items.map((i) => {
      const { border: _b, borderColor: _c, ...patch } = i.patch;
      return { ...i, patch };
    }) }));

export const BLUR_GROUPS = designsOnly(BLUR_ALL);
export const PIXEL_GROUPS = designsOnly(PIXEL_ALL);
export const MASK_GROUPS = designsOnly(MASK_ALL);

/** One-click mask placements on the image: cover all, header, footer or a middle band. */
export const MASK_REGIONS: Array<{ id: string; label: string; rect: (W: number, H: number) => Rect }> = [
  { id: 'all', label: 'Full area (cover all)', rect: (W, H) => ({ x: 0, y: 0, w: W, h: H }) },
  { id: 'top', label: 'Top (header)', rect: (W, H) => ({ x: 0, y: 0, w: W, h: Math.round(H * 0.18) }) },
  { id: 'bottom', label: 'Bottom (footer)', rect: (W, H) => ({ x: 0, y: Math.round(H * 0.82), w: W, h: Math.round(H * 0.18) }) },
  { id: 'middle', label: 'Center (middle band)', rect: (W, H) => ({ x: 0, y: Math.round(H * 0.4), w: W, h: Math.round(H * 0.2) }) },
];

/* ------------------------------ applying designs ------------------------------ */

/**
 * The parts a look is made of. A design replaces only the parts it is about (a colour design
 * keeps the shape; a style design keeps the colour treatment and border…), and never where the
 * effect applies (this area / everything else / whole picture), which the user sets on its own.
 */
export const LOOK_PARTS: Array<Array<keyof RedactAnnotation>> = [
  ['mode', 'pattern', 'soft', 'fade', 'glass'],
  // The shape, and a mask's content look drawn inside it (a design adds to the shape).
  ['shape', 'radius'],
  ['maskPattern'],
  ['tone', 'tint'],
  ['border', 'borderColor'],
  ['color'],
  ['intensity'],
];

const partsOf = (patch: Partial<RedactAnnotation>) => LOOK_PARTS.filter((part) => part.some((k) => k in patch));

/** The change a design makes: its own values, and the rest of each part it touches cleared. */
export function designPatch(patch: Partial<RedactAnnotation>): Partial<RedactAnnotation> {
  const out: Record<string, unknown> = {};
  for (const part of partsOf(patch)) for (const k of part) if (k !== 'intensity' && k !== 'color') out[k] = undefined;
  const { invert: _scope, ...rest } = patch;
  return { ...(out as Partial<RedactAnnotation>), ...rest };
}

/** True when the area already has this design (the size / strength the user changed does not count). */
export function designActive(current: Partial<RedactAnnotation>, patch: Partial<RedactAnnotation>): boolean {
  const onlyStrength = Object.keys(patch).every((k) => k === 'intensity');
  const want = designPatch(patch) as Record<string, unknown>;
  const cur = current as Record<string, unknown>;
  const norm = (k: string, v: unknown) => {
    if (v === undefined || v === null || v === '') return k === 'border' ? 'none' : k === 'tone' ? 'none' : k === 'mode' ? 'gaussian' : k === 'pattern' ? 'square' : k === 'maskPattern' ? 'solid' : k === 'radius' ? 0 : k === 'shape' ? 'rect' : false;
    if (k === 'color' || k === 'borderColor' || k === 'tint') return String(v).toUpperCase();
    return v;
  };
  return Object.entries(want).every(([k, v]) => (k === 'intensity' && !onlyStrength) || norm(k, cur[k]) === norm(k, v));
}

export type RedactScope = 'area' | 'outside' | 'whole';

/** Where the effect applies: only in the area, everywhere except the area, or the whole picture. */
export function redactScope(a: Pick<RedactAnnotation, 'x' | 'y' | 'w' | 'h' | 'invert'>, W: number, H: number): RedactScope {
  if (a.invert) return 'outside';
  return a.x <= 0.5 && a.y <= 0.5 && a.x + a.w >= W - 0.5 && a.y + a.h >= H - 0.5 ? 'whole' : 'area';
}

/** The change that applies an area's effect to `scope` (picture `W` × `H`). */
export function scopePatch(a: Pick<RedactAnnotation, 'x' | 'y' | 'w' | 'h' | 'invert'>, scope: RedactScope, W: number, H: number): Partial<RedactAnnotation> {
  if (scope === 'whole') return { x: 0, y: 0, w: W, h: H, invert: undefined };
  // Coming back from the whole picture: a centred area half its size, to move and resize.
  const area = redactScope({ ...a, invert: undefined }, W, H) === 'whole' ? { x: Math.round(W / 4), y: Math.round(H / 4), w: Math.round(W / 2), h: Math.round(H / 2) } : {};
  return { ...area, invert: scope === 'outside' ? true : undefined };
}

/* ------------------------- what works where, and in use ------------------------- */

/**
 * Whether a design works where the effect applies. Outside the area there is nothing to fade
 * or frost (the area stays clear), and a mask can only cover the rest in its colour (no text
 * lines, password dots or person shapes).
 */
export function designAvailable(type: RedactAnnotation['type'], patch: Partial<RedactAnnotation>, scope: RedactScope): boolean {
  if (scope !== 'outside') return true;
  if (type === 'mask') return !patch.maskPattern || patch.maskPattern === 'solid';
  return !patch.fade && !patch.glass;
}

/** Designs that also set the area's proportions: Circle and Square are square, Oval is not. */
export const SQUARE_DESIGNS = new Set(['b-circle', 'p-circle', 'm-circle', 'm-square']);
export const OVAL_DESIGNS = new Set(['b-oval', 'm-oval']);

const isSquare = (a: Pick<RedactAnnotation, 'w' | 'h'>) => Math.abs(a.w - a.h) <= Math.max(2, Math.min(a.w, a.h) * 0.02);

/** The size change a design makes to the selected area (same centre), if any. */
export function designSize(id: string, a: Pick<RedactAnnotation, 'x' | 'y' | 'w' | 'h'>): Partial<RedactAnnotation> {
  const cx = a.x + a.w / 2;
  const cy = a.y + a.h / 2;
  if (SQUARE_DESIGNS.has(id) && !isSquare(a)) {
    const s = Math.round(Math.min(a.w, a.h));
    return { x: Math.round(cx - s / 2), y: Math.round(cy - s / 2), w: s, h: s };
  }
  if (OVAL_DESIGNS.has(id) && isSquare(a)) {
    const w = Math.round(a.w * 1.5);
    return { x: Math.round(cx - w / 2), w };
  }
  return {};
}

/** Like `designActive`, and Circle / Square only on a square area, Oval only on a longer one. */
export function designInUse(id: string, current: Partial<RedactAnnotation>, patch: Partial<RedactAnnotation>): boolean {
  if (!designActive(current, patch)) return false;
  if (typeof current.w !== 'number' || typeof current.h !== 'number') return true;
  if (SQUARE_DESIGNS.has(id)) return isSquare(current as RedactAnnotation);
  if (OVAL_DESIGNS.has(id)) return !isSquare(current as RedactAnnotation);
  return true;
}

const NAMES: Record<string, Record<string, string>> = {
  mode: { 'motion-h': 'Motion ↔', 'motion-v': 'Motion ↕', 'motion-d': 'Motion ⤡', zoom: 'Zoom', spin: 'Spin', noise: 'Noise', bokeh: 'Bokeh' },
  pattern: { wide: 'Rectangular blocks', mixed: 'Mixed blocks', mosaic: 'Mosaic', 'dir-h': 'Directional ↔', 'dir-v': 'Directional ↕', 'dir-d': 'Directional ⤡', radial: 'Radial' },
  fade: { top: 'Top fade', bottom: 'Bottom fade', left: 'Left fade', right: 'Right fade', edges: 'Soft edges', tilt: 'Tilt-shift' },
  tone: { dim: 'Dim', gray: 'Grayscale', mono: 'Black & white', tint: 'Tint' },
  border: { white: 'Border', color: 'Border', solid: 'Border', dashed: 'Dashed border', dotted: 'Dotted border', glow: 'Glow border' },
  maskPattern: { lines: 'Text lines', multi: 'Multi-block', dots: 'Password dots', rows: 'Rows', grid: 'Grid', mixed: 'Mixed shapes', person: 'Face', card: 'Card info', id: 'ID document', address: 'Address' },
  shape: {
    rounded: 'Rounded', pill: 'Pill', ellipse: 'Circle / oval', cloud: 'Cloud', star: 'Star', heart: 'Heart', hexagon: 'Hexagon', octagon: 'Polygon', triangle: 'Triangle',
    diamond: 'Diamond', flower: 'Flower', burst: 'Badge', slant: 'Slanted', parallelogram: 'Parallelogram', trapezoid: 'Trapezoid', wavy: 'Wave',
  },
};

export interface LookChip {
  /** What it is ("Border", "Shape"…), for the remove button's name. */
  part: string;
  label: string;
  /** The change that removes it. */
  clear: Partial<RedactAnnotation>;
}

/** Each part of the look in use, so it can be seen and removed in one click. */
export function lookInUse(a: Partial<RedactAnnotation>): LookChip[] {
  const out: LookChip[] = [];
  const add = (part: string, key: string, value: unknown, clear: Partial<RedactAnnotation>) => {
    const label = NAMES[key]?.[String(value)];
    if (label) out.push({ part, label, clear });
  };
  add('Style', 'mode', a.mode, { mode: undefined });
  add('Pattern', 'pattern', a.pattern, { pattern: undefined });
  if (a.soft) out.push({ part: 'Soft', label: 'Soft', clear: { soft: undefined } });
  add('Fade', 'fade', a.fade, { fade: undefined });
  if (a.glass) out.push({ part: 'Glass', label: 'Frosted glass', clear: { glass: undefined } });
  add('Look', 'maskPattern', a.maskPattern, { maskPattern: undefined });
  if (a.shape && a.shape !== 'rect') add('Shape', 'shape', a.shape, { shape: undefined, radius: undefined });
  else if (a.radius) out.push({ part: 'Corners', label: `Corners ${a.radius}px`, clear: { radius: undefined } });
  add('Colour', 'tone', a.tone, { tone: undefined, tint: undefined });
  add('Border', 'border', a.border, { border: undefined, borderColor: undefined });
  return out;
}

/** What stops working outside the area, cleared when the user picks "Outside area". */
export function outsideClears(type: RedactAnnotation['type'], a: Partial<RedactAnnotation>): Partial<RedactAnnotation> {
  if (type === 'mask') return a.maskPattern && a.maskPattern !== 'solid' ? { maskPattern: undefined } : {};
  return { ...(a.fade ? { fade: undefined } : {}), ...(a.glass ? { glass: undefined } : {}) };
}

/* --------------------------- the look, one part at a time --------------------------- */

/** One choice in a section: what it sets, and (Circle / Oval) the proportions it gives the area. */
export interface LookOption {
  id: string;
  label: string;
  patch: Partial<RedactAnnotation>;
  size?: 'square' | 'oval';
}

/**
 * A part of the look the user picks on its own (effect, strength, shape, edges, colour, glass,
 * pattern, block size, mask look): each section changes only its own fields, so exactly one choice
 * per section is selected and nothing else changes with it.
 */
export interface LookSection {
  id: string;
  label: string;
  fields: Array<keyof RedactAnnotation>;
  options: LookOption[];
  /** Works only inside the area (greyed out — except its first, "none" choice — outside it). */
  insideOnly?: boolean;
}

const O = (id: string, label: string, patch: Partial<RedactAnnotation>, size?: 'square' | 'oval'): LookOption => ({ id, label, patch, ...(size ? { size } : {}) });

const SHAPE_SECTION: LookSection = {
  id: 'shape', label: 'Shape', fields: ['shape'],
  options: [
    O('rect', 'Rectangle', { shape: undefined }), O('rounded', 'Rounded', { shape: 'rounded' }), O('circle', 'Circle', { shape: 'ellipse' }, 'square'),
    O('oval', 'Oval', { shape: 'ellipse' }, 'oval'), O('pill', 'Pill', { shape: 'pill' }), O('cloud', 'Cloud', { shape: 'cloud' }), O('star', 'Star', { shape: 'star' }),
    O('heart', 'Heart', { shape: 'heart' }), O('hexagon', 'Hexagon', { shape: 'hexagon' }), O('diamond', 'Diamond', { shape: 'diamond' }),
    O('triangle', 'Triangle', { shape: 'triangle' }), O('badge', 'Badge', { shape: 'burst' }), O('slant', 'Slanted', { shape: 'slant' }), O('wave', 'Wave', { shape: 'wavy' }),
  ],
};

const EDGES_SECTION: LookSection = {
  id: 'edges', label: 'Edges', fields: ['fade'], insideOnly: true,
  options: [
    O('sharp', 'Sharp', { fade: undefined }), O('soft', 'Soft edges', { fade: 'edges' }), O('top', 'Fade top', { fade: 'top' }), O('bottom', 'Fade bottom', { fade: 'bottom' }),
    O('left', 'Fade left', { fade: 'left' }), O('right', 'Fade right', { fade: 'right' }), O('tilt', 'Tilt-shift', { fade: 'tilt' }),
  ],
};

const COLOUR_SECTION: LookSection = {
  id: 'colour', label: 'Colour', fields: ['tone'],
  options: [
    O('original', 'Original', { tone: undefined }), O('dim', 'Dim', { tone: 'dim' }), O('gray', 'Grayscale', { tone: 'gray' }),
    O('mono', 'Black & white', { tone: 'mono' }), O('tint', 'Tint', { tone: 'tint' }),
  ],
};

export const BLUR_SECTIONS: LookSection[] = [
  {
    id: 'effect', label: 'Effect', fields: ['mode'],
    options: [
      O('normal', 'Normal', { mode: undefined }), O('motion-h', 'Motion ↔', { mode: 'motion-h' }), O('motion-v', 'Motion ↕', { mode: 'motion-v' }), O('motion-d', 'Motion ⤡', { mode: 'motion-d' }),
      O('zoom', 'Zoom', { mode: 'zoom' }), O('spin', 'Spin', { mode: 'spin' }), O('noise', 'Noise', { mode: 'noise' }), O('bokeh', 'Bokeh', { mode: 'bokeh' }),
    ],
  },
  { id: 'strength', label: 'Strength', fields: ['intensity'], options: [O('light', 'Light', { intensity: 5 }), O('medium', 'Medium', { intensity: 12 }), O('heavy', 'Heavy', { intensity: 26 }), O('strong', 'Strong', { intensity: 40 })] },
  SHAPE_SECTION,
  EDGES_SECTION,
  COLOUR_SECTION,
  { id: 'glass', label: 'Glass', fields: ['glass'], insideOnly: true, options: [O('none', 'None', { glass: undefined }), O('frosted', 'Frosted glass', { glass: true })] },
];

export const PIXEL_SECTIONS: LookSection[] = [
  {
    id: 'pattern', label: 'Pattern', fields: ['pattern'],
    options: [
      O('square', 'Squares', { pattern: undefined }), O('wide', 'Rectangles', { pattern: 'wide' }), O('mixed', 'Mixed', { pattern: 'mixed' }), O('mosaic', 'Mosaic', { pattern: 'mosaic' }),
      O('dir-h', 'Streaks ↔', { pattern: 'dir-h' }), O('dir-v', 'Streaks ↕', { pattern: 'dir-v' }), O('dir-d', 'Streaks ⤡', { pattern: 'dir-d' }), O('radial', 'Radial', { pattern: 'radial' }),
    ],
  },
  { id: 'size', label: 'Block size', fields: ['intensity'], options: [O('small', 'Small', { intensity: 4 }), O('medium', 'Medium', { intensity: 8 }), O('large', 'Large', { intensity: 16 }), O('xl', 'Extra large', { intensity: 28 })] },
  { id: 'softness', label: 'Blocks', fields: ['soft'], options: [O('sharp', 'Sharp blocks', { soft: undefined }), O('soft', 'Soft blocks', { soft: true })] },
  SHAPE_SECTION,
  EDGES_SECTION,
  COLOUR_SECTION,
];

export const MASK_SECTIONS: LookSection[] = [
  SHAPE_SECTION,
  {
    id: 'content', label: 'Inside the mask', fields: ['maskPattern'], insideOnly: true,
    options: [
      O('solid', 'Solid', { maskPattern: undefined }), O('lines', 'Text lines', { maskPattern: 'lines' }), O('multi', 'Blocks', { maskPattern: 'multi' }), O('dots', 'Password', { maskPattern: 'dots' }),
      O('rows', 'Rows', { maskPattern: 'rows' }), O('grid', 'Grid', { maskPattern: 'grid' }), O('mixed', 'Mixed', { maskPattern: 'mixed' }), O('person', 'Face', { maskPattern: 'person' }),
      O('card', 'Card', { maskPattern: 'card' }), O('id', 'ID', { maskPattern: 'id' }), O('address', 'Address', { maskPattern: 'address' }),
    ],
  },
];

const DEFAULTS: Record<string, unknown> = { shape: 'rect', mode: 'gaussian', pattern: 'square', fade: 'none', tone: 'none', maskPattern: 'solid', glass: false, soft: false };
const valueOf = (k: string, v: unknown) => (v === undefined || v === null || v === '' ? DEFAULTS[k] : v);

/** The choice in use in a section (none when, e.g., the strength was set with the slider). */
export function sectionChoice(section: LookSection, a: Partial<RedactAnnotation>): LookOption | null {
  const cur = a as Record<string, unknown>;
  const square = typeof a.w === 'number' && typeof a.h === 'number' ? Math.abs(a.w - a.h) <= Math.max(2, Math.min(a.w, a.h) * 0.02) : null;
  return section.options.find((o) => {
    const p = o.patch as Record<string, unknown>;
    if (!section.fields.every((f) => valueOf(f, cur[f]) === valueOf(f, p[f]))) return false;
    if (o.size === 'square' && square === false) return false;
    if (o.size === 'oval' && square === true) return false;
    return true;
  }) ?? null;
}

/** The change a choice makes: its own fields, plus (Circle / Oval) the area's proportions. */
export function sectionPatch(option: LookOption, a?: Pick<RedactAnnotation, 'x' | 'y' | 'w' | 'h'>): Partial<RedactAnnotation> {
  const patch: Partial<RedactAnnotation> = { ...option.patch };
  if (!a || !option.size) return patch;
  return { ...patch, ...designSize(option.size === 'square' ? 'm-circle' : 'm-oval', a) };
}

/** Whether a choice works where the effect applies (outside the area: only the first, "none" choice of inside-only sections). */
export function choiceAvailable(section: LookSection, option: LookOption, scope: RedactScope): boolean {
  return scope !== 'outside' || !section.insideOnly || option === section.options[0];
}

