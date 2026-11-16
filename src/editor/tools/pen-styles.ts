import type { HighlightDesign, PenDesign, Point, Rect, StrokeAnnotation } from '../types';
import { viewScale, type Ctx2D } from './common';
import { alpha, seeded, shade, shapeGeometry } from './shape-lib';

/**
 * Pen and highlighter designs. Every design is drawn from the stroke the user drew (smoothed and
 * evenly resampled), so they follow any path: brush / calligraphy ribbons, dotted and dashed pens,
 * sketchy and hatched strokes, creative trails (beads, hearts, stars, loops, zig-zag arrows),
 * pressure-style taper, textured chalk / spray, and neon / outlined / hollow effects. Highlighters
 * add marker, rectangle, underline, scribble, wavy, circle, text-box, tape, spotlight, arrow,
 * cloud, sketch-box and gradient looks.
 */

interface Sample extends Point {
  /** Unit tangent and normal. */
  tx: number;
  ty: number;
  nx: number;
  ny: number;
  /** Distance along the stroke. */
  s: number;
}

/** The smoothed stroke (same quadratic midpoint curve as the classic pen) as a dense polyline. */
export function flattenStroke(pts: Point[]): Point[] {
  if (pts.length < 3) return pts.slice();
  const out: Point[] = [pts[0]!];
  let start = pts[0]!;
  for (let i = 1; i < pts.length - 1; i++) {
    const c = pts[i]!;
    const n = pts[i + 1]!;
    const end = { x: (c.x + n.x) / 2, y: (c.y + n.y) / 2 };
    const len = Math.hypot(c.x - start.x, c.y - start.y) + Math.hypot(end.x - c.x, end.y - c.y);
    const steps = Math.max(2, Math.ceil(len / 3));
    for (let k = 1; k <= steps; k++) {
      const t = k / steps;
      const u = 1 - t;
      out.push({ x: u * u * start.x + 2 * u * t * c.x + t * t * end.x, y: u * u * start.y + 2 * u * t * c.y + t * t * end.y });
    }
    start = end;
  }
  out.push(pts[pts.length - 1]!);
  return out;
}

/** Points every `spacing` px along the polyline, with tangent and normal. */
export function resample(poly: Point[], spacing: number): Sample[] {
  const out: Sample[] = [];
  if (poly.length === 0) return out;
  if (poly.length === 1) return [{ ...poly[0]!, tx: 1, ty: 0, nx: 0, ny: 1, s: 0 }];
  const step = Math.max(0.5, spacing);
  let dist = 0;
  let next = 0;
  for (let i = 1; i < poly.length; i++) {
    const a = poly[i - 1]!;
    const b = poly[i]!;
    const seg = Math.hypot(b.x - a.x, b.y - a.y);
    if (seg < 1e-6) continue;
    const tx = (b.x - a.x) / seg;
    const ty = (b.y - a.y) / seg;
    while (next <= dist + seg) {
      const t = (next - dist) / seg;
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, tx, ty, nx: -ty, ny: tx, s: next });
      next += step;
    }
    dist += seg;
  }
  const last = poly[poly.length - 1]!;
  const prev = out[out.length - 1];
  if (!prev || Math.hypot(prev.x - last.x, prev.y - last.y) > step * 0.3) {
    const tx = prev?.tx ?? 1;
    const ty = prev?.ty ?? 0;
    out.push({ ...last, tx, ty, nx: -ty, ny: tx, s: dist });
  }
  return smoothNormals(out);
}

/** Averages tangents over neighbours so ribbons do not kink at polyline corners. */
function smoothNormals(s: Sample[]): Sample[] {
  return s.map((p, i) => {
    let tx = 0;
    let ty = 0;
    for (let k = Math.max(0, i - 2); k <= Math.min(s.length - 1, i + 2); k++) {
      tx += s[k]!.tx;
      ty += s[k]!.ty;
    }
    const l = Math.hypot(tx, ty) || 1;
    return { ...p, tx: tx / l, ty: ty / l, nx: -ty / l, ny: tx / l };
  });
}

function tracePolyline(ctx: Ctx2D, pts: Point[]): void {
  ctx.beginPath();
  pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
}

/** Filled ribbon along samples, half-width per sample (with round ends). */
function ribbon(ctx: Ctx2D, s: Sample[], hw: (p: Sample, i: number) => number): void {
  if (s.length < 2) {
    const p = s[0];
    if (p) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, Math.max(0.5, hw(p, 0)), 0, Math.PI * 2);
      ctx.fill();
    }
    return;
  }
  const w = s.map((p, i) => Math.max(0.3, hw(p, i)));
  ctx.beginPath();
  s.forEach((p, i) => (i ? ctx.lineTo(p.x + p.nx * w[i]!, p.y + p.ny * w[i]!) : ctx.moveTo(p.x + p.nx * w[i]!, p.y + p.ny * w[i]!)));
  const e = s[s.length - 1]!;
  ctx.arc(e.x, e.y, w[w.length - 1]!, Math.atan2(e.ny, e.nx), Math.atan2(e.ny, e.nx) - Math.PI, true);
  for (let i = s.length - 1; i >= 0; i--) ctx.lineTo(s[i]!.x - s[i]!.nx * w[i]!, s[i]!.y - s[i]!.ny * w[i]!);
  const b = s[0]!;
  ctx.arc(b.x, b.y, w[0]!, Math.atan2(-b.ny, -b.nx), Math.atan2(-b.ny, -b.nx) - Math.PI, true);
  ctx.closePath();
  ctx.fill();
}

/**
 * Draws into a temporary layer at the canvas's resolution, then composites it (lets a design cut
 * holes in itself, or keep overlapping parts at one even transparency).
 */
export function withLayer(ctx: Ctx2D, b: Rect, draw: (l: Ctx2D) => void): void {
  if (typeof OffscreenCanvas === 'undefined' || b.w <= 0 || b.h <= 0) {
    draw(ctx);
    return;
  }
  let k = Math.max(1, viewScale(ctx));
  k = Math.min(k, 8192 / Math.max(b.w, b.h, 1));
  const W = Math.max(1, Math.ceil(b.w * k) + 2);
  const H = Math.max(1, Math.ceil(b.h * k) + 2);
  const c = new OffscreenCanvas(W, H);
  const l = c.getContext('2d');
  if (!l) {
    draw(ctx);
    return;
  }
  l.scale(k, k);
  l.translate(-b.x, -b.y);
  draw(l);
  ctx.drawImage(c, b.x, b.y, W / k, H / k);
}

function star(ctx: Ctx2D, x: number, y: number, r: number, rot: number): void {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const rad = i % 2 ? r * 0.45 : r;
    const t = rot - Math.PI / 2 + (Math.PI / 5) * i;
    ctx.lineTo(x + Math.cos(t) * rad, y + Math.sin(t) * rad);
  }
  ctx.closePath();
}

function heart(ctx: Ctx2D, x: number, y: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x, y + r * 0.9);
  ctx.bezierCurveTo(x - r * 1.3, y + r * 0.1, x - r * 0.9, y - r * 1.05, x, y - r * 0.4);
  ctx.bezierCurveTo(x + r * 0.9, y - r * 1.05, x + r * 1.3, y + r * 0.1, x, y + r * 0.9);
  ctx.closePath();
}

function arrowHead(ctx: Ctx2D, tip: Point, dirX: number, dirY: number, len: number, filled: boolean): void {
  const l = Math.hypot(dirX, dirY) || 1;
  const ux = dirX / l;
  const uy = dirY / l;
  const a = { x: tip.x - ux * len - uy * len * 0.55, y: tip.y - uy * len + ux * len * 0.55 };
  const b = { x: tip.x - ux * len + uy * len * 0.55, y: tip.y - uy * len - ux * len * 0.55 };
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(tip.x, tip.y);
  ctx.lineTo(b.x, b.y);
  if (filled) {
    ctx.closePath();
    ctx.fill();
  } else ctx.stroke();
}

const seedOf = (a: StrokeAnnotation) => Math.round((a.points[0]?.x ?? 0) * 7 + (a.points[0]?.y ?? 0) * 13 + a.points.length);

/* ------------------------------------ pens ----------------------------------- */

function drawPen(ctx: Ctx2D, a: StrokeAnnotation, design: PenDesign): void {
  const w = a.width;
  const poly = flattenStroke(a.points);
  const rnd = seeded(seedOf(a));
  ctx.strokeStyle = a.color;
  ctx.fillStyle = a.color;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.lineWidth = w;
  const plain = () => {
    tracePolyline(ctx, poly);
    if (poly.length === 1) ctx.lineTo(poly[0]!.x + 0.01, poly[0]!.y);
    ctx.stroke();
  };
  switch (design) {
    case 'brush': {
      // Calligraphy nib at 45°: thick across, thin along; dry-brush streaks.
      const s = resample(poly, Math.max(1, w * 0.15));
      const L = s[s.length - 1]?.s || 1;
      ribbon(ctx, s, (p) => {
        const nib = Math.abs(Math.sin(Math.atan2(p.ty, p.tx) - Math.PI / 4));
        const ends = Math.min(1, p.s / (w * 1.2), (L - p.s) / (w * 1.2));
        return (w / 2) * (0.25 + 0.75 * nib) * (0.35 + 0.65 * Math.max(0, ends)) * (0.94 + rnd() * 0.06);
      });
      break;
    }
    case 'dotted': {
      for (const p of resample(poly, w * 1.9)) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, w / 2, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case 'dashed':
      ctx.lineCap = 'butt';
      ctx.setLineDash([w * 2.4, w * 1.4]);
      plain();
      break;
    case 'dashdot':
      ctx.setLineDash([w * 2.6, w * 1.5, 0.01, w * 1.5]);
      plain();
      break;
    case 'sketch':
    case 'sketch-arrow': {
      ctx.lineWidth = Math.max(1, w * 0.42);
      for (let pass = 0; pass < 3; pass++) {
        const s = resample(poly, Math.max(2, w * 1.5));
        const amp = w * 0.55;
        ctx.globalAlpha *= pass ? 0.8 : 1;
        tracePolyline(ctx, s.map((p) => ({ x: p.x + p.nx * (rnd() - 0.5) * amp, y: p.y + p.ny * (rnd() - 0.5) * amp })));
        ctx.stroke();
      }
      if (design === 'sketch-arrow' && poly.length > 1) {
        const s = resample(poly, 2);
        const e = s[s.length - 1]!;
        ctx.lineWidth = Math.max(1.5, w * 0.6);
        arrowHead(ctx, e, e.tx, e.ty, w * 3.2, false);
      }
      break;
    }
    case 'hatch': {
      // Scribble fill along the path.
      const s = resample(poly, Math.max(1.5, w * 0.42));
      ctx.lineWidth = Math.max(1, w * 0.2);
      const amp = w * 1.1;
      tracePolyline(ctx, s.map((p, i) => {
        const side = i % 2 ? 1 : -1;
        const j = 0.85 + rnd() * 0.3;
        return { x: p.x + p.nx * amp * side * j + p.tx * w * 0.35, y: p.y + p.ny * amp * side * j + p.ty * w * 0.35 };
      }));
      ctx.stroke();
      break;
    }
    case 'tube': {
      plain();
      ctx.strokeStyle = alpha(shade(a.color, 0.62), 0.9);
      ctx.lineWidth = w * 0.32;
      ctx.save();
      ctx.translate(-w * 0.1, -w * 0.16);
      tracePolyline(ctx, poly);
      ctx.stroke();
      ctx.restore();
      break;
    }
    case 'beads': {
      ctx.lineWidth = Math.max(1, w * 0.3);
      tracePolyline(ctx, poly);
      ctx.stroke();
      for (const p of resample(poly, w * 3)) {
        ctx.fillStyle = a.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, w * 0.62, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.55)';
        ctx.beginPath();
        ctx.arc(p.x - w * 0.2, p.y - w * 0.22, w * 0.18, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case 'hearts': {
      ctx.lineWidth = Math.max(1, w * 0.28);
      tracePolyline(ctx, poly);
      ctx.stroke();
      for (const p of resample(poly, w * 3.2)) {
        heart(ctx, p.x, p.y, w * 0.85);
        ctx.fill();
      }
      break;
    }
    case 'stars': {
      ctx.lineWidth = Math.max(1, w * 0.18);
      ctx.strokeStyle = a.accent ?? shade(a.color, -0.35);
      for (const p of resample(poly, w * 2.3)) {
        star(ctx, p.x, p.y, w * 1.05, Math.atan2(p.ty, p.tx) * 0.3);
        ctx.fill();
        ctx.stroke();
      }
      break;
    }
    case 'zigzag': {
      const s = resample(poly, Math.max(2, w * 2.2));
      ctx.lineWidth = Math.max(1.5, w * 0.55);
      ctx.lineJoin = 'miter';
      const z = s.map((p, i) => (i === 0 || i === s.length - 1 ? p : { x: p.x + p.nx * w * 1.25 * (i % 2 ? 1 : -1), y: p.y + p.ny * w * 1.25 * (i % 2 ? 1 : -1) }));
      tracePolyline(ctx, z);
      ctx.stroke();
      if (z.length > 1) {
        const e = z[z.length - 1]!;
        const b = z[z.length - 2]!;
        arrowHead(ctx, e, e.x - b.x, e.y - b.y, w * 2.6, true);
      }
      break;
    }
    case 'loops': {
      const s = resample(poly, 1.5);
      const R = w * 1.5;
      const k = w * 0.75;
      ctx.lineWidth = Math.max(1, w * 0.36);
      tracePolyline(ctx, s.map((p) => {
        const t = p.s / k;
        return { x: p.x - p.tx * R * Math.sin(t) + p.nx * R * (Math.cos(t) - 1) * 0.9, y: p.y - p.ty * R * Math.sin(t) + p.ny * R * (Math.cos(t) - 1) * 0.9 };
      }));
      ctx.stroke();
      break;
    }
    case 'taper': {
      const s = resample(poly, Math.max(1, w * 0.15));
      const L = s[s.length - 1]?.s || 1;
      ribbon(ctx, s, (p) => (w / 2) * Math.max(0.12, Math.pow(Math.sin(Math.PI * Math.min(1, Math.max(0, p.s / L))), 0.75)));
      break;
    }
    case 'chalk': {
      ctx.globalAlpha *= 0.35;
      plain();
      ctx.globalAlpha /= 0.35;
      for (const p of resample(poly, Math.max(1, w * 0.18))) {
        for (let i = 0; i < 3; i++) {
          const o = (rnd() - 0.5) * w;
          ctx.globalAlpha = 0.55 + rnd() * 0.45;
          ctx.fillRect(p.x + p.nx * o - w * 0.08, p.y + p.ny * o - w * 0.05, w * (0.12 + rnd() * 0.22), w * (0.06 + rnd() * 0.1));
        }
      }
      break;
    }
    case 'spray': {
      for (const p of resample(poly, Math.max(1, w * 0.2))) {
        for (let i = 0; i < 5; i++) {
          const r = Math.sqrt(rnd()) * w * 0.75;
          const t = rnd() * Math.PI * 2;
          ctx.beginPath();
          ctx.arc(p.x + Math.cos(t) * r, p.y + Math.sin(t) * r, Math.max(0.4, w * (0.04 + rnd() * 0.07)), 0, Math.PI * 2);
          ctx.fill();
        }
      }
      break;
    }
    case 'neon': {
      ctx.shadowColor = a.color;
      ctx.shadowBlur = w * 2.2 * Math.max(1, viewScale(ctx));
      plain();
      plain();
      ctx.shadowColor = 'transparent';
      ctx.strokeStyle = alpha('#FFFFFF', 0.92);
      ctx.lineWidth = Math.max(1, w * 0.38);
      tracePolyline(ctx, poly);
      ctx.stroke();
      break;
    }
    case 'outlined': {
      ctx.strokeStyle = a.accent ?? '#111827';
      ctx.lineWidth = w + Math.max(3, w * 0.45);
      tracePolyline(ctx, poly);
      ctx.stroke();
      ctx.strokeStyle = a.color;
      ctx.lineWidth = w;
      tracePolyline(ctx, poly);
      ctx.stroke();
      break;
    }
    case 'hollow': {
      const b = strokeBoundsOf(a);
      withLayer(ctx, b, (l) => {
        l.lineJoin = 'round';
        l.lineCap = 'round';
        l.strokeStyle = a.color;
        l.lineWidth = w;
        tracePolyline(l, poly);
        l.stroke();
        l.globalCompositeOperation = 'destination-out';
        l.lineWidth = w * 0.52;
        tracePolyline(l, poly);
        l.stroke();
      });
      break;
    }
    default:
      plain();
  }
}

/* -------------------------------- highlighters -------------------------------- */

/** Box around the stroke for box-like highlights (rectangle, text box, tape, circle…). */
function bandBox(a: StrokeAnnotation): Rect {
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
  const h = a.width;
  return { x: minX - h * 0.15, y: minY - h / 2, w: maxX - minX + h * 0.3, h: maxY - minY + h };
}

function roughRect(ctx: Ctx2D, r: Rect, amp: number, rnd: () => number, passes = 2): void {
  for (let i = 0; i < passes; i++) {
    const j = () => (rnd() - 0.5) * amp;
    ctx.beginPath();
    ctx.moveTo(r.x + j(), r.y + j());
    ctx.lineTo(r.x + r.w + j(), r.y + j());
    ctx.lineTo(r.x + r.w + j(), r.y + r.h + j());
    ctx.lineTo(r.x + j(), r.y + r.h + j());
    ctx.closePath();
    ctx.stroke();
  }
}

function hatchBox(ctx: Ctx2D, r: Rect, gap: number, rnd: () => number): void {
  ctx.save();
  ctx.beginPath();
  ctx.rect(r.x, r.y, r.w, r.h);
  ctx.clip();
  ctx.beginPath();
  for (let d = -r.h; d < r.w + r.h; d += gap) {
    ctx.moveTo(r.x + d + (rnd() - 0.5) * gap * 0.4, r.y + r.h);
    ctx.lineTo(r.x + d + r.h * 0.75 + (rnd() - 0.5) * gap * 0.4, r.y);
  }
  ctx.stroke();
  ctx.restore();
}

function drawHighlight(ctx: Ctx2D, a: StrokeAnnotation, design: HighlightDesign): void {
  const w = a.width;
  const poly = flattenStroke(a.points);
  const rnd = seeded(seedOf(a));
  const box = bandBox(a);
  const ink = a.accent ?? '#1F2937';
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.fillStyle = a.color;
  ctx.strokeStyle = a.color;
  const multiply = () => {
    ctx.globalCompositeOperation = 'multiply';
  };
  switch (design) {
    case 'marker': {
      // Dry marker: ragged ribbon with lighter streaks, at one even transparency.
      multiply();
      const s = resample(poly, Math.max(1, w * 0.12));
      const L = s[s.length - 1]?.s || 1;
      const solid = shade(a.color, 0).slice(0, 7);
      const op = (/^#[0-9a-f]{8}$/i.test(a.color) ? parseInt(a.color.slice(7), 16) / 255 : 1) || 1;
      const b = strokeBoundsOf(a);
      ctx.globalAlpha *= op;
      withLayer(ctx, b, (l) => {
        l.fillStyle = solid;
        ribbon(l, s, (p) => (w / 2) * (0.9 + rnd() * 0.1) * (p.s < w * 0.4 ? 0.8 : p.s > L - w * 0.4 ? 0.82 : 1));
        l.globalCompositeOperation = 'destination-out';
        l.lineCap = 'round';
        for (let i = 0; i < 4; i++) {
          const off = (rnd() - 0.5) * w * 0.8;
          l.lineWidth = Math.max(0.6, w * 0.035);
          l.globalAlpha = 0.5;
          tracePolyline(l, s.filter((_, k) => k % 2 === 0 || rnd() > 0.2).map((p) => ({ x: p.x + p.nx * off, y: p.y + p.ny * off })));
          l.stroke();
        }
      });
      break;
    }
    case 'rect':
      multiply();
      ctx.beginPath();
      ctx.roundRect(box.x, box.y, box.w, box.h, w * 0.12);
      ctx.fill();
      break;
    case 'underline': {
      const solid = a.color.length === 9 ? a.color.slice(0, 7) : a.color;
      ctx.strokeStyle = solid;
      ctx.lineWidth = Math.max(2, w * 0.3);
      tracePolyline(ctx, poly);
      ctx.stroke();
      const s = resample(poly, 2);
      const n = s.length;
      ctx.lineWidth = Math.max(1.5, w * 0.2);
      tracePolyline(ctx, s.slice(Math.floor(n * 0.12), Math.max(Math.floor(n * 0.12) + 2, Math.ceil(n * 0.9))).map((p) => ({ x: p.x, y: p.y + w * 0.42 })));
      ctx.stroke();
      break;
    }
    case 'scribble': {
      const solid = a.color.length === 9 ? a.color.slice(0, 7) : a.color;
      ctx.strokeStyle = solid;
      ctx.lineWidth = Math.max(1, w * 0.09);
      const s = resample(poly, Math.max(1.5, w * 0.2));
      tracePolyline(ctx, s.map((p, i) => {
        const side = i % 2 ? 1 : -1;
        return { x: p.x + p.nx * (w / 2) * side * (0.85 + rnd() * 0.2) + p.tx * w * 0.22 * side, y: p.y + p.ny * (w / 2) * side * (0.85 + rnd() * 0.2) + p.ty * w * 0.22 * side };
      }));
      ctx.stroke();
      break;
    }
    case 'wavy': {
      multiply();
      const s = resample(poly, Math.max(1, w * 0.1));
      const period = w * 1.15;
      const amp = w * 0.08;
      ctx.beginPath();
      s.forEach((p, i) => {
        const off = w / 2 + Math.sin((p.s / period) * Math.PI * 2) * amp;
        if (i) ctx.lineTo(p.x + p.nx * off, p.y + p.ny * off);
        else ctx.moveTo(p.x + p.nx * off, p.y + p.ny * off);
      });
      for (let i = s.length - 1; i >= 0; i--) {
        const p = s[i]!;
        const off = w / 2 + Math.sin((p.s / period) * Math.PI * 2 + Math.PI) * amp;
        ctx.lineTo(p.x - p.nx * off, p.y - p.ny * off);
      }
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'circle':
    case 'circle-double':
    case 'circle-dashed': {
      const solid = a.color.length === 9 ? a.color.slice(0, 7) : a.color;
      ctx.strokeStyle = solid;
      ctx.lineWidth = Math.max(2, w * 0.1);
      const cx = box.x + box.w / 2;
      const cy = box.y + box.h / 2;
      const rx = box.w / 2 + w * 0.35;
      const ry = box.h / 2 + w * 0.3;
      if (design === 'circle-dashed') ctx.setLineDash([ctx.lineWidth * 3, ctx.lineWidth * 2.2]);
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx, ry, -0.03, 0, Math.PI * 2);
      ctx.stroke();
      if (design === 'circle-double') {
        ctx.beginPath();
        ctx.ellipse(cx + w * 0.06, cy - w * 0.04, rx * 0.96, ry * 1.04, 0.06, Math.PI * 0.1, Math.PI * 2.05);
        ctx.stroke();
      }
      break;
    }
    case 'box': {
      multiply();
      ctx.beginPath();
      ctx.roundRect(box.x, box.y, box.w, box.h, w * 0.1);
      ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = ink;
      ctx.lineWidth = Math.max(1.5, w * 0.06);
      roughRect(ctx, box, w * 0.08, rnd, 2);
      break;
    }
    case 'tape': {
      multiply();
      const teeth = 5;
      const t = w * 0.14;
      ctx.beginPath();
      ctx.moveTo(box.x, box.y);
      ctx.lineTo(box.x + box.w, box.y + box.h * 0.04);
      for (let i = 1; i <= teeth; i++) ctx.lineTo(box.x + box.w + (i % 2 ? -t : 0), box.y + box.h * 0.04 + ((box.h * 0.96) / teeth) * i);
      ctx.lineTo(box.x, box.y + box.h);
      for (let i = teeth - 1; i >= 0; i--) ctx.lineTo(box.x + (i % 2 ? t : 0), box.y + (box.h / teeth) * i);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'spotlight': {
      multiply();
      const k = Math.max(1, viewScale(ctx));
      ctx.filter = `blur(${Math.max(1, w * 0.32 * k)}px)`;
      ctx.lineWidth = w * 0.95;
      tracePolyline(ctx, poly);
      if (poly.length === 1) ctx.lineTo(poly[0]!.x + 0.01, poly[0]!.y);
      ctx.stroke();
      ctx.filter = 'none';
      break;
    }
    case 'arrow': {
      ctx.save();
      multiply();
      ctx.lineCap = 'butt';
      ctx.lineWidth = w;
      tracePolyline(ctx, poly);
      ctx.stroke();
      ctx.restore();
      // Curved arrow coming in from the left of the start.
      const s0 = poly[0]!;
      const from = { x: s0.x - w * 2.3, y: s0.y + w * 0.7 };
      const to = { x: s0.x - w * 0.35, y: s0.y - w * 0.15 };
      ctx.strokeStyle = ink;
      ctx.fillStyle = ink;
      ctx.lineWidth = Math.max(1.5, w * 0.08);
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.quadraticCurveTo(from.x + w * 0.2, to.y - w * 0.4, to.x, to.y);
      ctx.stroke();
      arrowHead(ctx, to, to.x - (from.x + w * 0.2), to.y - (to.y - w * 0.4), w * 0.45, false);
      break;
    }
    case 'cloud': {
      const solid = a.color.length === 9 ? a.color.slice(0, 7) : a.color;
      const g = shapeGeometry('cloud', { x: box.x - w * 0.3, y: box.y - w * 0.35, w: box.w + w * 0.6, h: box.h + w * 0.7 });
      ctx.fillStyle = alpha(solid, 0.14);
      ctx.fill(g.outline);
      ctx.strokeStyle = solid;
      ctx.lineWidth = Math.max(2, w * 0.1);
      ctx.stroke(g.outline);
      break;
    }
    case 'sketch-box': {
      const solid = a.color.length === 9 ? a.color.slice(0, 7) : a.color;
      ctx.strokeStyle = solid;
      ctx.lineWidth = Math.max(2, w * 0.09);
      roughRect(ctx, box, w * 0.16, rnd, 3);
      break;
    }
    case 'hatch-box': {
      const solid = a.color.length === 9 ? a.color.slice(0, 7) : a.color;
      ctx.strokeStyle = solid;
      ctx.lineWidth = Math.max(1, w * 0.06);
      hatchBox(ctx, box, Math.max(4, w * 0.2), rnd);
      ctx.lineWidth = Math.max(1.5, w * 0.08);
      roughRect(ctx, box, w * 0.1, rnd, 2);
      break;
    }
    case 'gradient': {
      const solid = a.color.length === 9 ? a.color.slice(0, 7) : a.color;
      const g = ctx.createLinearGradient(box.x, 0, box.x + box.w, 0);
      g.addColorStop(0, alpha(solid, 0.95));
      g.addColorStop(1, alpha(shade(solid, 0.55), 0.85));
      ctx.strokeStyle = g;
      ctx.lineWidth = w;
      tracePolyline(ctx, poly);
      if (poly.length === 1) ctx.lineTo(poly[0]!.x + 0.01, poly[0]!.y);
      ctx.stroke();
      ctx.strokeStyle = alpha(shade(solid, -0.12), 0.75);
      ctx.lineWidth = Math.max(1, w * 0.06);
      ctx.save();
      ctx.translate(0, w * 0.4);
      tracePolyline(ctx, poly);
      ctx.stroke();
      ctx.restore();
      break;
    }
    default: {
      multiply();
      ctx.lineCap = 'butt';
      ctx.lineWidth = w;
      tracePolyline(ctx, poly);
      if (poly.length === 1) {
        ctx.beginPath();
        ctx.arc(poly[0]!.x, poly[0]!.y, w / 2, 0, Math.PI * 2);
        ctx.fill();
      } else ctx.stroke();
    }
  }
}

/** Highlighter designs that cover their box (hit anywhere inside it). */
const BOXY = new Set<string>(['rect', 'box', 'tape', 'circle', 'circle-double', 'circle-dashed', 'cloud', 'sketch-box', 'hatch-box']);

export function isBoxyStroke(a: StrokeAnnotation): boolean {
  return a.type === 'highlighter' && BOXY.has(a.design ?? '');
}

/** How far a design reaches beyond the stroke centre line (multiple of the width). */
function reach(a: StrokeAnnotation): number {
  const d = a.design ?? '';
  if (a.type === 'pen') {
    return ({ hatch: 1.25, zigzag: 1.4, loops: 2.6, stars: 1.15, hearts: 1, spray: 0.85, neon: 2.5, outlined: 0.8, sketch: 0.9, 'sketch-arrow': 3.2, beads: 0.7 } as Record<string, number>)[d] ?? 0.5;
  }
  return ({ circle: 0.95, 'circle-double': 1, 'circle-dashed': 0.95, cloud: 1.1, arrow: 2.6, spotlight: 1.3, underline: 0.8, 'sketch-box': 0.7, 'hatch-box': 0.65, box: 0.6, tape: 0.6 } as Record<string, number>)[d] ?? 0.5;
}

/** Bounds including everything the design draws. */
export function strokeBoundsOf(a: StrokeAnnotation): Rect {
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
  const pad = a.width * reach(a) + 1;
  return { x: minX - pad, y: minY - pad, w: maxX - minX + pad * 2, h: maxY - minY + pad * 2 };
}

/** Draws the stroke in its design; false when the classic renderer should draw it. */
export function renderStrokeDesign(ctx: Ctx2D, a: StrokeAnnotation): boolean {
  const d = a.design;
  if (!d || (a.type === 'pen' && d === 'standard') || (a.type === 'highlighter' && d === 'flat') || a.points.length === 0) return false;
  ctx.save();
  ctx.globalAlpha = a.opacity;
  if (a.type === 'pen') drawPen(ctx, a, d as PenDesign);
  else drawHighlight(ctx, a, d as HighlightDesign);
  ctx.restore();
  return true;
}

/* ----------------------------------- presets ---------------------------------- */

export interface StrokePreset {
  id: string;
  label: string;
  design: PenDesign | HighlightDesign;
  color: string;
  width?: number;
  accent?: string;
}

const P = (id: string, label: string, design: StrokePreset['design'], color: string, width?: number, accent?: string): StrokePreset => ({ id, label, design, color, width, accent });

/** Pen design sheet: standard, brush (calligraphy), dotted & dashed, sketch, creative, pressure, textured, special effects. */
export const PEN_GROUPS: Array<{ id: string; label: string; items: StrokePreset[] }> = [
  { id: 'standard', label: 'Standard', items: [P('p-black', 'Black pen', 'standard', '#111827', 6), P('p-blue', 'Blue pen', 'standard', '#2563EB', 6), P('p-red', 'Red pen', 'standard', '#E5484D', 6), P('p-green', 'Green pen', 'standard', '#16A34A', 6), P('p-purple', 'Purple pen', 'standard', '#7C3AED', 6), P('p-orange', 'Orange pen', 'standard', '#F59E0B', 6)] },
  { id: 'brush', label: 'Brush', items: [P('b-navy', 'Navy brush', 'brush', '#0F1E46', 14), P('b-blue', 'Blue brush', 'brush', '#1E90FF', 14), P('b-pink', 'Pink brush', 'brush', '#EC4899', 14), P('b-green', 'Green brush', 'brush', '#16A34A', 14), P('b-purple', 'Purple brush', 'brush', '#7C3AED', 14), P('b-orange', 'Orange brush', 'brush', '#F59E0B', 14)] },
  { id: 'dotted', label: 'Dotted & dashed', items: [P('d-black', 'Black dots', 'dotted', '#111827', 7), P('d-red', 'Red dots', 'dotted', '#E5484D', 7), P('d-blue', 'Blue dots', 'dotted', '#2563EB', 7), P('ds-black', 'Black dashes', 'dashed', '#111827', 5), P('ds-blue', 'Blue dashes', 'dashed', '#2563EB', 5), P('ds-purple', 'Purple dashes', 'dashed', '#7C3AED', 5), P('dd-red', 'Red dash-dot', 'dashdot', '#E5484D', 5), P('dd-green', 'Green dash-dot', 'dashdot', '#16A34A', 5), P('dd-orange', 'Orange dash-dot', 'dashdot', '#F59E0B', 5)] },
  { id: 'sketch', label: 'Sketch', items: [P('s-black', 'Black sketch', 'sketch', '#111827', 5), P('s-blue', 'Blue sketch', 'sketch', '#2563EB', 5), P('s-arrow', 'Red sketch arrow', 'sketch-arrow', '#E5484D', 5), P('h-yellow', 'Yellow hatch', 'hatch', '#F5C400', 10), P('h-purple', 'Purple hatch', 'hatch', '#7C3AED', 10), P('h-green', 'Green hatch', 'hatch', '#22C55E', 10)] },
  { id: 'creative', label: 'Creative', items: [P('c-tube', 'Purple tube', 'tube', '#8B5CF6', 12), P('c-beads', 'Blue beads', 'beads', '#3B82F6', 8), P('c-hearts', 'Pink hearts', 'hearts', '#EC4899', 9), P('c-stars', 'Gold stars', 'stars', '#FDE047', 10, '#D4A000'), P('c-zigzag', 'Red zig-zag arrow', 'zigzag', '#E5484D', 6), P('c-loops', 'Green loops', 'loops', '#22C55E', 6)] },
  { id: 'pressure', label: 'Pressure', items: [P('t-black', 'Black taper', 'taper', '#111827', 14), P('t-blue', 'Blue taper', 'taper', '#2563EB', 14), P('t-red', 'Red taper', 'taper', '#E5484D', 14), P('t-green', 'Green taper', 'taper', '#16A34A', 14), P('t-purple', 'Purple taper', 'taper', '#7C3AED', 14), P('t-orange', 'Orange taper', 'taper', '#F59E0B', 14)] },
  { id: 'textured', label: 'Textured', items: [P('x-blue', 'Blue chalk', 'chalk', '#2563EB', 12), P('x-red', 'Red chalk', 'chalk', '#E5484D', 12), P('x-green', 'Green chalk', 'chalk', '#22C55E', 12), P('y-purple', 'Purple spray', 'spray', '#7C3AED', 18), P('y-yellow', 'Yellow spray', 'spray', '#EAB308', 18), P('y-teal', 'Teal spray', 'spray', '#14B8A6', 18)] },
  { id: 'special', label: 'Special effects', items: [P('n-cyan', 'Cyan neon', 'neon', '#22D3EE', 6), P('n-pink', 'Pink neon', 'neon', '#F472B6', 6), P('n-yellow', 'Yellow neon', 'neon', '#FDE047', 6), P('o-yellow', 'Yellow outlined', 'outlined', '#FACC15', 12, '#111827'), P('o-lilac', 'Lilac outlined', 'outlined', '#C4B5FD', 12, '#6D28D9'), P('o-blue', 'Blue hollow', 'hollow', '#2563EB', 14)] },
];

/** Highlighter design sheet. Colours carry the highlighter's transparency (#rrggbbaa). */
const HY = '#FFE14DB3';
const HP = '#FF8CC6A6';
const HC = '#38E1F5A6';
const HG = '#8BEA4AA6';
const HV = '#B98CF5A6';
const HO = '#FFB13BA6';
export const HIGHLIGHT_GROUPS: Array<{ id: string; label: string; items: StrokePreset[] }> = [
  { id: 'marker', label: 'Marker / brush', items: [P('m-y', 'Yellow marker', 'marker', HY, 30), P('m-p', 'Pink marker', 'marker', HP, 30), P('m-c', 'Cyan marker', 'marker', HC, 30), P('m-g', 'Green marker', 'marker', HG, 30), P('m-v', 'Purple marker', 'marker', HV, 30), P('m-o', 'Orange marker', 'marker', HO, 30), P('m-b', 'Blue marker', 'marker', '#3B9BFFA6', 30), P('m-r', 'Rose marker', 'marker', '#FF9CB5A6', 30)] },
  { id: 'rect', label: 'Rectangle', items: [P('r-y', 'Yellow box', 'rect', HY, 30), P('r-p', 'Pink box', 'rect', HP, 30), P('r-c', 'Blue box', 'rect', '#9BDCFFB3', 30), P('r-g', 'Green box', 'rect', '#C8F7A0B3', 30), P('r-v', 'Lavender box', 'rect', '#D9C2FAB3', 30), P('r-o', 'Peach box', 'rect', '#FFD08AB3', 30)] },
  { id: 'underline', label: 'Underline', items: [P('u-y', 'Yellow underline', 'underline', '#FACC15', 18), P('u-p', 'Pink underline', 'underline', '#F472B6', 18), P('u-b', 'Blue underline', 'underline', '#0EA5E9', 18), P('u-g', 'Green underline', 'underline', '#4ADE80', 18), P('u-v', 'Purple wave', 'wavy', '#C084FCB3', 12), P('u-o', 'Orange underline', 'underline', '#F97316', 18)] },
  { id: 'scribble', label: 'Scribble', items: [P('s-y', 'Yellow scribble', 'scribble', '#FACC15', 28), P('s-p', 'Pink scribble', 'scribble', '#F472B6', 28), P('s-c', 'Cyan scribble', 'scribble', '#22D3EE', 28), P('s-g', 'Green scribble', 'scribble', '#65D63A', 28), P('s-v', 'Purple scribble', 'scribble', '#A855F7', 28), P('s-o', 'Orange scribble', 'scribble', '#FB923C', 28)] },
  { id: 'wavy', label: 'Wavy', items: [P('w-y', 'Yellow wave', 'wavy', HY, 30), P('w-p', 'Pink wave', 'wavy', HP, 30), P('w-c', 'Blue wave', 'wavy', '#7CC8FFA6', 30), P('w-g', 'Green wave', 'wavy', HG, 30), P('w-v', 'Purple wave', 'wavy', HV, 30), P('w-o', 'Orange wave', 'wavy', HO, 30)] },
  { id: 'circle', label: 'Circle & focus', items: [P('c-y', 'Yellow circle', 'circle', '#FACC15', 30), P('c-p', 'Pink circle', 'circle', '#EC4899', 30), P('c-b', 'Blue circle', 'circle', '#0EA5E9', 30), P('c-g', 'Green circle', 'circle', '#22C55E', 30), P('c-v', 'Purple double circle', 'circle-double', '#9333EA', 30), P('c-o', 'Orange dashed circle', 'circle-dashed', '#F97316', 30)] },
  { id: 'textbox', label: 'Text box', items: [P('t-y', 'Yellow text box', 'box', HY, 30, '#111827'), P('t-p', 'Pink text box', 'box', HP, 30, '#111827'), P('t-c', 'Cyan text box', 'box', HC, 30, '#111827'), P('t-g', 'Green text box', 'box', HG, 30, '#111827'), P('t-v', 'Purple text box', 'box', HV, 30, '#111827'), P('t-o', 'Orange text box', 'box', HO, 30, '#111827')] },
  { id: 'tape', label: 'Corner / tape', items: [P('tp-y', 'Yellow tape', 'tape', HY, 30), P('tp-p', 'Pink tape', 'tape', HP, 30), P('tp-b', 'Blue tape', 'tape', '#5AB4F5B3', 30), P('tp-g', 'Green tape', 'tape', HG, 30), P('tp-v', 'Purple tape', 'tape', HV, 30), P('tp-o', 'Orange tape', 'tape', HO, 30)] },
  { id: 'spotlight', label: 'Spotlight', items: [P('sp-y', 'Yellow glow', 'spotlight', '#FFE14DCC', 30), P('sp-p', 'Pink glow', 'spotlight', '#FF8CC6CC', 30), P('sp-c', 'Cyan glow', 'spotlight', '#38E1F5CC', 30), P('sp-g', 'Green glow', 'spotlight', '#8BEA4ACC', 30), P('sp-v', 'Purple glow', 'spotlight', '#B98CF5CC', 30), P('sp-o', 'Orange glow', 'spotlight', '#FFB13BCC', 30)] },
  { id: 'arrow', label: 'With arrow', items: [P('a-y', 'Yellow + arrow', 'arrow', HY, 26, '#111827'), P('a-p', 'Pink + arrow', 'arrow', HP, 26, '#111827'), P('a-c', 'Cyan + arrow', 'arrow', HC, 26, '#111827'), P('a-g', 'Green + arrow', 'arrow', HG, 26, '#111827'), P('a-v', 'Purple + arrow', 'arrow', HV, 26, '#111827'), P('a-o', 'Orange + arrow', 'arrow', HO, 26, '#111827')] },
  { id: 'mixed', label: 'Creative', items: [P('x-y', 'Yellow brush', 'marker', '#FFD400B3', 34), P('x-p', 'Pink brush', 'marker', '#FF7DB0A6', 34), P('x-hatch', 'Blue hatch box', 'hatch-box', '#1E9BF0', 30), P('x-cloud-g', 'Green cloud', 'cloud', '#4CC23A', 30), P('x-cloud-v', 'Purple cloud', 'cloud', '#8B3FD9', 30), P('x-sketch', 'Orange sketch box', 'sketch-box', '#F59E0B', 30)] },
  { id: 'gradient', label: 'Gradient', items: [P('g-y', 'Yellow gradient', 'gradient', '#FACC15', 28), P('g-p', 'Pink gradient', 'gradient', '#F472B6', 28), P('g-b', 'Blue gradient', 'gradient', '#38BDF8', 28), P('g-g', 'Green gradient', 'gradient', '#4ADE80', 28), P('g-v', 'Purple gradient', 'gradient', '#A78BFA', 28), P('g-o', 'Orange gradient', 'gradient', '#FB923C', 28)] },
];
