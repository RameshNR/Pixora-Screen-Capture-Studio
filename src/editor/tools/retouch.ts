import type { EditorDoc } from '../types';
import { inpaint } from './inpaint';
import { graphicFill, knownFlatness } from './graphic-fill';
import { boxBlur, growMask, holeOf, maskBounds, refineToEdges } from './mask';

/*
 * Retouching the picture itself: filling erased parts with matching background, removing objects,
 * and removing / replacing the background behind a subject. Each one makes a new base bitmap (one
 * undo step); the old one stays in history.
 */

export type Point = { x: number; y: number };

/* ------------------------------- mask painting ------------------------------ */

/** A w × h canvas whose alpha is the mask. */
export function newMaskCanvas(w: number, h: number): OffscreenCanvas {
  const c = new OffscreenCanvas(Math.max(1, w), Math.max(1, h));
  // Masks are read back (undo steps, the fill): say so when the canvas is made — a later request
  // is ignored, and Chrome then lists a "willReadFrequently" warning on the Errors page.
  c.getContext('2d', { willReadFrequently: true });
  return c;
}

export function maskToCanvas(mask: Uint8ClampedArray, w: number, h: number): OffscreenCanvas {
  const c = newMaskCanvas(w, h);
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  const img = ctx.createImageData(w, h);
  for (let i = 0; i < mask.length; i++) {
    img.data[i * 4] = 255;
    img.data[i * 4 + 1] = 255;
    img.data[i * 4 + 2] = 255;
    img.data[i * 4 + 3] = mask[i]!;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

export function canvasToMask(c: OffscreenCanvas): Uint8ClampedArray {
  const d = c.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, c.width, c.height).data;
  const out = new Uint8ClampedArray(c.width * c.height);
  for (let i = 0; i < out.length; i++) out[i] = d[i * 4 + 3]!;
  return out;
}

/**
 * Paints a brush stroke into a mask canvas: `add` sets it, `remove` clears it. Hardness 100 is a
 * crisp edge; lower values fade the edge out over a wider band.
 */
export function paintStroke(mask: OffscreenCanvas, pts: readonly Point[], size: number, hardness: number, mode: 'add' | 'remove'): void {
  if (!pts.length || size <= 0) return;
  const soft = Math.max(0, Math.min(1, 1 - hardness / 100));
  const w = mask.width;
  const h = mask.height;
  const stroke = new OffscreenCanvas(w, h);
  const s = stroke.getContext('2d')!;
  s.fillStyle = '#fff';
  s.strokeStyle = '#fff';
  // A soft brush keeps its outer size: the solid core shrinks while the blur widens.
  const core = size * (1 - soft * 0.5);
  s.lineWidth = core;
  s.lineCap = 'round';
  s.lineJoin = 'round';
  s.beginPath();
  if (pts.length === 1) {
    s.arc(pts[0]!.x, pts[0]!.y, core / 2, 0, Math.PI * 2);
    s.fill();
  } else {
    pts.forEach((p, i) => (i ? s.lineTo(p.x, p.y) : s.moveTo(p.x, p.y)));
    s.stroke();
  }
  const ctx = mask.getContext('2d')!;
  ctx.save();
  if (mode === 'remove') ctx.globalCompositeOperation = 'destination-out';
  if (soft > 0) ctx.filter = `blur(${(size * soft) / 4}px)`;
  ctx.drawImage(stroke, 0, 0);
  ctx.restore();
}

/** Adds a 0–255 mask (e.g. an object found by the AI) to a mask canvas, grown by `grow` px. */
export function addMask(mask: OffscreenCanvas, m: Uint8ClampedArray, grow = 0): void {
  const w = mask.width;
  const h = mask.height;
  const bin = new Uint8ClampedArray(m.length);
  for (let i = 0; i < m.length; i++) bin[i] = m[i]! > 110 ? 255 : 0;
  const c = maskToCanvas(grow ? growMask(bin, w, h, grow) : bin, w, h);
  mask.getContext('2d')!.drawImage(c, 0, 0);
}

export function maskIsEmpty(mask: OffscreenCanvas): boolean {
  // Looked at on a small copy (a 20-megapixel mask read in full made each click stall); any mark
  // still shows there (scaling down averages it in).
  const k = Math.min(1, 512 / Math.max(mask.width, mask.height));
  const c = k < 1 ? new OffscreenCanvas(Math.max(1, Math.round(mask.width * k)), Math.max(1, Math.round(mask.height * k))) : mask;
  if (c !== mask) {
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    // 'high' averages every pixel (a low-quality scale could skip a thin mark).
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(mask, 0, 0, c.width, c.height);
  }
  const d = c.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, c.width, c.height).data;
  for (let i = 3; i < d.length; i += 4) if (d[i]! > 0) return false;
  return true;
}

/** The mask drawn as a tinted overlay (for showing what will be removed). */
export function tintMask(mask: OffscreenCanvas, color: string): OffscreenCanvas {
  const c = new OffscreenCanvas(mask.width, mask.height);
  const ctx = c.getContext('2d')!;
  ctx.drawImage(mask, 0, 0);
  ctx.globalCompositeOperation = 'source-in';
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, c.width, c.height);
  return c;
}

/** The mask as red / white diagonal hatching with a red edge (shows on red things too). */
export function hatchMask(mask: OffscreenCanvas): OffscreenCanvas {
  const c = new OffscreenCanvas(mask.width, mask.height);
  const ctx = c.getContext('2d')!;
  const s = Math.max(10, Math.round(Math.min(mask.width, mask.height) / 70));
  const tile = new OffscreenCanvas(s * 2, s * 2);
  const t = tile.getContext('2d')!;
  t.fillStyle = '#ff2d2d';
  t.fillRect(0, 0, s * 2, s * 2);
  t.strokeStyle = '#ffffff';
  t.lineWidth = s * 0.7;
  t.beginPath();
  for (let k = -2; k <= 2; k++) { t.moveTo(k * s * 2 - s, -s); t.lineTo(k * s * 2 + s * 3, s * 3); }
  t.stroke();
  ctx.fillStyle = ctx.createPattern(tile, 'repeat')!;
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.globalCompositeOperation = 'destination-in';
  ctx.drawImage(mask, 0, 0);
  return c;
}

/* ------------------------------ background fill ----------------------------- */

let worker: Worker | null = null;
let jobs = 0;

/** Runs the fill in a background worker (the page stays responsive), or here if that fails. */
export async function runInpaint(data: Uint8ClampedArray, w: number, h: number, hole: Uint8Array, onProgress?: (p: number) => void): Promise<Uint8ClampedArray> {
  try {
    worker ??= new Worker(new URL('./inpaint.worker.ts', import.meta.url), { type: 'module' });
  } catch {
    return inpaint(data, w, h, hole, { onProgress });
  }
  const id = ++jobs;
  const wk = worker;
  return new Promise((resolve, reject) => {
    const onMsg = (e: MessageEvent<{ id: number; out?: Uint8ClampedArray; progress?: number; error?: string }>) => {
      if (e.data.id !== id) return;
      if (e.data.progress !== undefined) { onProgress?.(e.data.progress); return; }
      wk.removeEventListener('message', onMsg);
      wk.removeEventListener('error', onErr);
      if (e.data.out) resolve(e.data.out);
      else reject(new Error(e.data.error ?? 'Fill failed'));
    };
    const onErr = () => {
      wk.removeEventListener('message', onMsg);
      wk.removeEventListener('error', onErr);
      worker = null;
      // The worker could not start (or crashed): do the work here instead.
      try { resolve(inpaint(data, w, h, hole, { onProgress })); } catch (err) { reject(err); }
    };
    wk.addEventListener('message', onMsg);
    wk.addEventListener('error', onErr);
    wk.postMessage({ id, data, w, h, hole });
  });
}

/** Above this many pixels to rebuild, the work is done at a smaller size. */
const MAX_FILL_PIXELS = 60_000;

export interface FillOptions {
  /** 0–100: how fully the rebuilt background replaces what was there. */
  strength: number;
  /** Soft edge (px) where the fill meets the picture. */
  feather: number;
  /** Rebuild only from the area close by, and only exactly where painted (no extra margin). */
  preserve: boolean;
}

/** Separate parts of a hole (things far apart), as boxes; boxes that come close are joined. */
function holeParts(hole: Uint8Array, W: number, H: number, join: number): Array<{ x: number; y: number; w: number; h: number }> {
  const seen = new Uint8Array(hole.length);
  const boxes: Array<{ x0: number; y0: number; x1: number; y1: number }> = [];
  for (let s = 0; s < hole.length; s++) {
    if (!hole[s] || seen[s]) continue;
    let x0 = W, y0 = H, x1 = -1, y1 = -1;
    const stack = [s];
    seen[s] = 1;
    while (stack.length) {
      const p = stack.pop()!;
      const x = p % W;
      const y = (p - x) / W;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const q = ny * W + nx;
        if (hole[q] && !seen[q]) { seen[q] = 1; stack.push(q); }
      }
    }
    boxes.push({ x0, y0, x1, y1 });
  }
  // Join boxes closer than `join` (their fills would overlap anyway).
  for (let merged = true; merged;) {
    merged = false;
    for (let i = 0; i < boxes.length && !merged; i++) for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i]!, b = boxes[j]!;
      if (a.x0 - join <= b.x1 && b.x0 - join <= a.x1 && a.y0 - join <= b.y1 && b.y0 - join <= a.y1) {
        boxes[i] = { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) };
        boxes.splice(j, 1);
        merged = true;
        break;
      }
    }
  }
  return boxes.map((b) => ({ x: b.x0, y: b.y0, w: b.x1 - b.x0 + 1, h: b.y1 - b.y0 + 1 }));
}

/**
 * The one colour around a hole, when the area just around it (a ring a few px wide) is plain:
 * at least 90 % of it within a small tolerance of the same colour. Null for textured surroundings.
 */
export function flatSurround(d: Uint8ClampedArray, hole: Uint8Array, w: number, h: number): [number, number, number] | null {
  const R = 4;
  const counts = new Map<number, { n: number; r: number; g: number; b: number }>();
  let total = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (hole[i]) continue;
      // In the ring: a hole pixel within R px.
      let near = false;
      for (let dy = -R; dy <= R && !near; dy += 2) for (let dx = -R; dx <= R; dx += 2) {
        const nx = x + dx, ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < w && ny < h && hole[ny * w + nx]) { near = true; break; }
      }
      if (!near) continue;
      const key = ((d[i * 4]! >> 3) << 10) | ((d[i * 4 + 1]! >> 3) << 5) | (d[i * 4 + 2]! >> 3);
      const c = counts.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
      c.n++; c.r += d[i * 4]!; c.g += d[i * 4 + 1]!; c.b += d[i * 4 + 2]!;
      counts.set(key, c);
      total++;
    }
  }
  if (total < 8) return null;
  let best: { n: number; r: number; g: number; b: number } | null = null;
  for (const c of counts.values()) if (!best || c.n > best.n) best = c;
  if (!best || best.n < total * 0.9) return null;
  return [Math.round(best.r / best.n), Math.round(best.g / best.n), Math.round(best.b / best.n)];
}

/** Rebuilds the hole pixels inside box `b` (with room around it) on the `work` canvas. */
async function fillPart(work: OffscreenCanvas, hole: Uint8Array, b: { x: number; y: number; w: number; h: number }, preserve: boolean, onProgress?: (p: number) => void): Promise<void> {
  const W = work.width;
  const H = work.height;
  // Where matching patches are looked for: close by (Preserve surrounding details) or wider.
  const span = Math.max(b.w, b.h);
  const margin = Math.round(preserve ? Math.max(32, span * 0.8) : Math.max(48, span * 1.6));
  const rx = Math.max(0, b.x - margin);
  const ry = Math.max(0, b.y - margin);
  const rw = Math.min(W, b.x + b.w + margin) - rx;
  const rh = Math.min(H, b.y + b.h + margin) - ry;
  const region = new OffscreenCanvas(rw, rh);
  const rctx = region.getContext('2d', { willReadFrequently: true })!;
  rctx.drawImage(work, -rx, -ry);
  const rhole = new Uint8Array(rw * rh);
  let holeCount = 0;
  for (let y = 0; y < rh; y++) for (let x = 0; x < rw; x++) {
    const v = hole[(y + ry) * W + x + rx]!;
    rhole[y * rw + x] = v;
    holeCount += v;
  }
  // On a plain background (a dark page header, a white page) the hole gets exactly that colour:
  // rebuilding from patches would bring in nearby text, buttons or a search box.
  const regionData = rctx.getImageData(0, 0, rw, rh);
  const flat = flatSurround(regionData.data, rhole, rw, rh);
  // Big areas are rebuilt at a smaller size and scaled up (big fills are mostly plain
  // background; this keeps them to a second or two).
  const k = Math.min(1, Math.sqrt(MAX_FILL_PIXELS / Math.max(1, holeCount)));
  if (knownFlatness(regionData.data, rhole, rw, rh) > 0.6) {
    // A screenshot / graphic around the hole: continue the colours and edges straight through it
    // (patches would copy nearby text and buttons into it; one colour would spill a card's white
    // onto the page beside it).
    rctx.putImageData(new ImageData(new Uint8ClampedArray(graphicFill(regionData.data, rhole, rw, rh)), rw, rh), 0, 0);
  } else if (flat) {
    rctx.fillStyle = `rgb(${flat[0]}, ${flat[1]}, ${flat[2]})`;
    rctx.fillRect(0, 0, rw, rh);
  } else if (k < 0.98) {
    const sw = Math.max(8, Math.round(rw * k));
    const sh = Math.max(8, Math.round(rh * k));
    const sc = new OffscreenCanvas(sw, sh);
    const sctx = sc.getContext('2d', { willReadFrequently: true })!;
    sctx.imageSmoothingQuality = 'high';
    sctx.drawImage(region, 0, 0, sw, sh);
    const sdata = sctx.getImageData(0, 0, sw, sh);
    const shole = new Uint8Array(sw * sh);
    for (let y = 0; y < sh; y++) {
      for (let x = 0; x < sw; x++) {
        // Any hole pixel under this small pixel makes it a hole (nothing of the object leaks in).
        const x0 = Math.floor(x / k), x1 = Math.min(rw - 1, Math.ceil((x + 1) / k));
        const y0 = Math.floor(y / k), y1 = Math.min(rh - 1, Math.ceil((y + 1) / k));
        let hit = 0;
        for (let yy = y0; yy <= y1 && !hit; yy++) for (let xx = x0; xx <= x1; xx++) if (rhole[yy * rw + xx]) { hit = 1; break; }
        shole[y * sw + x] = hit;
      }
    }
    const filled = await runInpaint(sdata.data, sw, sh, shole, onProgress);
    sctx.putImageData(new ImageData(new Uint8ClampedArray(filled), sw, sh), 0, 0);
    rctx.drawImage(sc, 0, 0, rw, rh);
  } else {
    const data = rctx.getImageData(0, 0, rw, rh);
    const filled = await runInpaint(data.data, rw, rh, rhole, onProgress);
    rctx.putImageData(new ImageData(new Uint8ClampedArray(filled), rw, rh), 0, 0);
  }
  // Only the hole changes on the work canvas.
  const keep = maskToCanvas(Uint8ClampedArray.from(rhole, (v) => v * 255), rw, rh);
  const piece = new OffscreenCanvas(rw, rh);
  const pctx = piece.getContext('2d')!;
  pctx.drawImage(keep, 0, 0);
  pctx.globalCompositeOperation = 'source-in';
  pctx.drawImage(region, 0, 0);
  work.getContext('2d')!.drawImage(piece, rx, ry);
}

/**
 * Removes what the mask covers and rebuilds the background there from the surrounding picture
 * (colours, texture and patterns), blended in at the edges. Things far apart are rebuilt one by
 * one, each from its own surroundings (faster, and a better match).
 */
export async function applyFill(doc: EditorDoc, mask: OffscreenCanvas, opts: FillOptions, onProgress?: (p: number) => void): Promise<EditorDoc> {
  // Let the page show "Rebuilding the background…" before the work starts.
  await new Promise((r) => setTimeout(r, 30));
  const W = doc.width;
  const H = doc.height;
  const soft = canvasToMask(mask);
  let hole = holeOf(soft);
  // Cover the object's outline too (a halo left around a removed object gives it away).
  const extra = opts.preserve ? 0 : Math.max(2, Math.round(Math.min(W, H) / 300));
  if (extra) hole = holeOf(growMask(Uint8ClampedArray.from(hole, (v) => v * 255), W, H, extra));
  if (!maskBounds(hole, W, H)) return doc;

  const work = new OffscreenCanvas(W, H);
  work.getContext('2d')!.drawImage(doc.base, 0, 0);
  const parts = holeParts(hole, W, H, 24);
  for (let i = 0; i < parts.length; i++) {
    await fillPart(work, hole, parts[i]!, opts.preserve, onProgress && ((p) => onProgress((i + p) / parts.length)));
  }

  // Blend: the painted mask (soft where the brush was soft) plus the covered outline, feathered.
  const alpha = new Uint8ClampedArray(W * H);
  // Everything painted is replaced fully (a half-replaced edge left a ghost of the old text);
  // Feather softens the join outside it.
  for (let i = 0; i < alpha.length; i++) alpha[i] = hole[i] ? 255 : 0;
  // Grown first by the feather width, so the softened band lies outside what was painted
  // (where the work canvas still has the original picture) and the inside stays fully replaced.
  const grown = opts.feather > 0 ? growMask(alpha, W, H, Math.ceil(opts.feather)) : alpha;
  const blend = new OffscreenCanvas(W, H);
  const bctx = blend.getContext('2d')!;
  if (opts.feather > 0) bctx.filter = `blur(${opts.feather / 2}px)`;
  bctx.drawImage(maskToCanvas(grown, W, H), 0, 0);
  bctx.filter = 'none';
  bctx.globalCompositeOperation = 'source-in';
  bctx.drawImage(work, 0, 0);

  const out = new OffscreenCanvas(W, H);
  const octx = out.getContext('2d')!;
  octx.drawImage(doc.base, 0, 0);
  octx.globalAlpha = Math.max(0, Math.min(1, opts.strength / 100));
  octx.drawImage(blend, 0, 0);
  return { ...doc, base: await createImageBitmap(out) };
}

/* --------------------------- background removal ---------------------------- */

/**
 * The photo with the old background's colour taken out of the subject's soft edge pixels (no
 * green glow around a dragonfly's wings on a leafy background). The background colour near each
 * edge pixel is estimated from the clear background around it (worked out on a small copy), and
 * each partly see-through pixel is un-mixed: pixel = a·subject + (1 − a)·background.
 */
export function decontaminate(base: CanvasImageSource, mask: Uint8ClampedArray, w: number, h: number): OffscreenCanvas {
  const k = Math.min(1, Math.sqrt(1_000_000 / (w * h)));
  const sw = Math.max(1, Math.round(w * k));
  const sh = Math.max(1, Math.round(h * k));
  const sc = new OffscreenCanvas(sw, sh);
  const sctx = sc.getContext('2d', { willReadFrequently: true })!;
  sctx.imageSmoothingQuality = 'high';
  sctx.drawImage(base, 0, 0, sw, sh);
  const small = sctx.getImageData(0, 0, sw, sh).data;
  const mc = new OffscreenCanvas(sw, sh);
  const mctx = mc.getContext('2d', { willReadFrequently: true })!;
  mctx.imageSmoothingQuality = 'high';
  mctx.drawImage(maskToCanvas(mask, w, h), 0, 0, sw, sh);
  const ms = mctx.getImageData(0, 0, sw, sh).data;
  // Weighted average of the clear background around each spot (normalised blur).
  const n = sw * sh;
  const wt = new Float32Array(n);
  const ch = [new Float32Array(n), new Float32Array(n), new Float32Array(n)];
  for (let i = 0; i < n; i++) {
    const a = ms[i * 4 + 3]! / 255;
    const v = a < 0.35 ? (1 - a) * (1 - a) : 0;
    wt[i] = v;
    for (let c = 0; c < 3; c++) ch[c]![i] = small[i * 4 + c]! * v;
  }
  const r = Math.max(3, Math.round(Math.min(sw, sh) / 60));
  let W2 = boxBlur(boxBlur(wt, sw, sh, r), sw, sh, r);
  let C = ch.map((x) => boxBlur(boxBlur(x, sw, sh, r), sw, sh, r));
  // Spots far from any background: a wider look-around.
  const W3 = boxBlur(W2, sw, sh, r * 4);
  const C3 = C.map((x) => boxBlur(x, sw, sh, r * 4));
  const est = sctx.createImageData(sw, sh);
  for (let i = 0; i < n; i++) {
    const near = W2[i]! > 0.02;
    const ww = near ? W2[i]! : W3[i]!;
    for (let c = 0; c < 3; c++) est.data[i * 4 + c] = ww > 1e-4 ? (near ? C[c]![i]! : C3[c]![i]!) / ww : small[i * 4 + c]!;
    est.data[i * 4 + 3] = 255;
  }
  W2 = new Float32Array(0);
  C = [];
  sctx.putImageData(est, 0, 0);
  // Full size: the picture, and the background estimate scaled up.
  const out = new OffscreenCanvas(w, h);
  const octx = out.getContext('2d', { willReadFrequently: true })!;
  octx.imageSmoothingQuality = 'high';
  octx.drawImage(sc, 0, 0, w, h);
  const bg = octx.getImageData(0, 0, w, h).data;
  octx.drawImage(base, 0, 0, w, h);
  const img = octx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < mask.length; i++) {
    const m = mask[i]!;
    if (m <= 6 || m >= 249) continue;
    const a = Math.max(0.15, m / 255);
    const p = i * 4;
    for (let c = 0; c < 3; c++) d[p + c] = (d[p + c]! - (1 - a) * bg[p + c]!) / a;
  }
  octx.putImageData(img, 0, 0);
  return out;
}

export type BackgroundFill = 'transparent' | 'white' | 'color' | 'image' | 'blur';

export interface BackgroundOptions {
  fill: BackgroundFill;
  color: string;
  /** Blur of the original background (px at 100). */
  blur: number;
  /** 0–100: how closely the edge follows the picture (hair, fur, fine edges). */
  edge: number;
  /** Soft edge (px). */
  feather: number;
  /** Grow (+) or shrink (−) the subject's outline (px). */
  shift: number;
}

const MAX_REFINE_PIXELS = 1_200_000;

/** The subject's mask fitted to the picture's edges and grown / shrunk. */
export function refineSubject(rawSoft: Uint8ClampedArray, base: CanvasImageSource, w: number, h: number, edge: number, shift: number, exact = false): Uint8ClampedArray {
  // Graphics come with exact edges already: only grow / shrink.
  if (exact) return shift ? growMask(rawSoft, w, h, shift) : rawSoft;
  // Large pictures: the edge work is done on a smaller copy (seconds become a fraction of one).
  if (edge > 0 && w * h > MAX_REFINE_PIXELS) {
    // A little under the limit, so the smaller copy never comes out over it after rounding.
    const k = Math.sqrt((MAX_REFINE_PIXELS * 0.9) / (w * h));
    const sw = Math.max(1, Math.round(w * k));
    const sh = Math.max(1, Math.round(h * k));
    const sc = new OffscreenCanvas(sw, sh);
    const sctx = sc.getContext('2d', { willReadFrequently: true })!;
    sctx.imageSmoothingQuality = 'high';
    sctx.drawImage(maskToCanvas(rawSoft, w, h), 0, 0, sw, sh);
    const smallMask = refineSubject(canvasToMask(sc), base, sw, sh, edge, 0);
    const big = new OffscreenCanvas(w, h);
    const bctx = big.getContext('2d', { willReadFrequently: true })!;
    bctx.imageSmoothingQuality = 'high';
    bctx.drawImage(maskToCanvas(smallMask, sw, sh), 0, 0, w, h);
    const m = canvasToMask(big);
    // Scaling up stretched the soft edge over many pixels (a halo on big photos): firm it back to
    // about the width it had, keeping a soft transition.
    const s = Math.min(6, (w * h) / MAX_REFINE_PIXELS);
    for (let i = 0; i < m.length; i++) {
      const v = m[i]!;
      if (v > 0 && v < 255) m[i] = Math.max(0, Math.min(255, (v - 127.5) * Math.sqrt(s) + 127.5));
    }
    return shift ? growMask(m, w, h, shift) : m;
  }
  // The AI's mask is a likelihood: firm it up (unsure parts would show as faint ghosts), then let
  // the edge refinement bring back real soft edges where the picture has them (hair).
  const raw = new Uint8ClampedArray(rawSoft.length);
  for (let i = 0; i < raw.length; i++) {
    const t = Math.max(0, Math.min(1, (rawSoft[i]! / 255 - 0.35) / 0.3));
    raw[i] = t * t * (3 - 2 * t) * 255;
  }
  let m = raw;
  if (edge > 0) {
    const c = new OffscreenCanvas(w, h);
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(base, 0, 0, w, h);
    const rgba = ctx.getImageData(0, 0, w, h).data;
    const radius = Math.max(2, Math.round((Math.min(w, h) / 400) * (1 + edge / 25)));
    const fitted = refineToEdges(raw, rgba, w, h, radius, 0.0002 + (1 - edge / 100) * 0.004);
    // Mix: at full strength the edge follows the picture completely.
    const k = edge / 100;
    m = new Uint8ClampedArray(raw.length);
    for (let i = 0; i < m.length; i++) m[i] = raw[i]! * (1 - k) + fitted[i]! * k;
  }
  return shift ? growMask(m, w, h, shift) : m;
}

function cover(ctx: OffscreenCanvasRenderingContext2D, img: CanvasImageSource & { width: number; height: number }, w: number, h: number) {
  const s = Math.max(w / img.width, h / img.height);
  ctx.drawImage(img, (w - img.width * s) / 2, (h - img.height * s) / 2, img.width * s, img.height * s);
}

/** Light grey checks (shows what is see-through in the preview). */
export function drawChecks(ctx: OffscreenCanvasRenderingContext2D, w: number, h: number): void {
  const s = Math.max(8, Math.round(Math.min(w, h) / 60));
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#e3e5ea';
  for (let y = 0; y < h; y += s) for (let x = (y / s) % 2 ? s : 0; x < w; x += s * 2) ctx.fillRect(x, y, s, s);
}

/**
 * The picture with its background replaced: the subject (where `subject` is set) over the chosen
 * background. `checks`: show see-through parts as checks (preview only).
 */
export function composeBackground(
  base: CanvasImageSource, w: number, h: number, subject: OffscreenCanvas, opts: BackgroundOptions, image: ImageBitmap | null, checks = false,
  /** Where the subject's pixels come from (graphics: the picture with the old background colour taken out of its edges). */
  fgSource: CanvasImageSource | null = null,
): OffscreenCanvas {
  const out = new OffscreenCanvas(w, h);
  const ctx = out.getContext('2d')!;
  if (checks && opts.fill === 'transparent') drawChecks(ctx, w, h);
  if (opts.fill === 'white') { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, h); }
  else if (opts.fill === 'color') { ctx.fillStyle = opts.color; ctx.fillRect(0, 0, w, h); }
  else if (opts.fill === 'image' && image) cover(ctx, image, w, h);
  else if (opts.fill === 'image' && checks) drawChecks(ctx, w, h);
  else if (opts.fill === 'blur') {
    const r = Math.max(1, (opts.blur / 100) * Math.max(4, Math.min(w, h) * 0.03));
    const pad = Math.ceil(r * 2);
    ctx.filter = `blur(${r}px)`;
    ctx.drawImage(base, -pad, -pad, w + pad * 2, h + pad * 2);
    ctx.filter = 'none';
  }
  const fg = new OffscreenCanvas(w, h);
  const f = fg.getContext('2d')!;
  if (opts.feather > 0) f.filter = `blur(${opts.feather / 2}px)`;
  f.drawImage(subject, 0, 0);
  f.filter = 'none';
  f.globalCompositeOperation = 'source-in';
  f.drawImage(fgSource ?? base, 0, 0, w, h);
  ctx.drawImage(fg, 0, 0);
  return out;
}
