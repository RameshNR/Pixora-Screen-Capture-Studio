import { logger } from '@/shared/utils/logger';
import { quietMediapipe } from '@/shared/utils/quiet-mediapipe';
import { blobAt, fillMaskHoles, flatness, graphicEdges, graphicSubject, selectInGraphic } from '../tools/smart-select';
import { growMask } from '../tools/mask';

/*
 * Finding things in the picture, on this computer, with Google's MediaPipe models (Apache-2.0),
 * bundled with the extension (engine in /mediapipe, models in /models): nothing is downloaded and
 * no picture leaves the device.
 *  - "magic touch" (interactive segmenter): the object at a point the user clicks.
 *  - selfie segmenter: people.
 * Both give a mask the size of the picture: 0 = not part of it, 255 = part of it.
 */

/** Pictures are looked at no bigger than this (the mask is scaled up and refined afterwards). */
const MAX_SIDE = 1024;

type Mask = { getAsFloat32Array: () => Float32Array; width: number; height: number; close: () => void };
type Result = { confidenceMasks?: Mask[]; close: () => void };
type Interactive = { segment: (img: OffscreenCanvas, roi: { keypoint?: { x: number; y: number }; scribble?: Array<{ x: number; y: number }> }) => Result };
type Plain = { segment: (img: OffscreenCanvas) => Result };

let interactive: Promise<Interactive | null> | null = null;
let person: Promise<Plain | null> | null = null;

async function files() {
  quietMediapipe();
  const vision = await import('@mediapipe/tasks-vision');
  return { vision, files: await vision.FilesetResolver.forVisionTasks(chrome.runtime.getURL('mediapipe')) };
}

function loadInteractive(): Promise<Interactive | null> {
  interactive ??= files().then(async ({ vision, files: f }) =>
    (await vision.InteractiveSegmenter.createFromOptions(f, {
      baseOptions: { modelAssetPath: chrome.runtime.getURL('models/magic_touch.tflite'), delegate: 'CPU' },
      outputCategoryMask: false,
      outputConfidenceMasks: true,
    })) as unknown as Interactive,
  ).catch((err) => {
    logger.warn('object selection unavailable', err);
    interactive = null;
    return null;
  });
  return interactive;
}

function loadPerson(): Promise<Plain | null> {
  person ??= files().then(async ({ vision, files: f }) =>
    (await vision.ImageSegmenter.createFromOptions(f, {
      baseOptions: { modelAssetPath: chrome.runtime.getURL('models/selfie_segmenter.tflite'), delegate: 'CPU' },
      runningMode: 'IMAGE',
      outputCategoryMask: false,
      outputConfidenceMasks: true,
    })) as unknown as Plain,
  ).catch((err) => {
    logger.warn('person detection unavailable', err);
    person = null;
    return null;
  });
  return person;
}

/** The picture, scaled down to at most MAX_SIDE. */
function small(src: CanvasImageSource, w: number, h: number): OffscreenCanvas {
  const k = Math.min(1, MAX_SIDE / Math.max(w, h));
  const c = new OffscreenCanvas(Math.max(1, Math.round(w * k)), Math.max(1, Math.round(h * k)));
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, c.width, c.height);
  return c;
}

/** The model's mask (0–1, its own size) as a w × h mask (0–255), scaled up smoothly. */
function toMask(m: Mask, w: number, h: number): Uint8ClampedArray {
  const f = m.getAsFloat32Array();
  const c = new OffscreenCanvas(m.width, m.height);
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(m.width, m.height);
  for (let i = 0; i < f.length; i++) {
    img.data[i * 4] = 255;
    img.data[i * 4 + 1] = 255;
    img.data[i * 4 + 2] = 255;
    img.data[i * 4 + 3] = Math.round(Math.max(0, Math.min(1, f[i]!)) * 255);
  }
  ctx.putImageData(img, 0, 0);
  const big = new OffscreenCanvas(w, h);
  const bctx = big.getContext('2d', { willReadFrequently: true })!;
  bctx.imageSmoothingQuality = 'high';
  bctx.drawImage(c, 0, 0, w, h);
  const d = bctx.getImageData(0, 0, w, h).data;
  const out = new Uint8ClampedArray(w * h);
  for (let i = 0; i < out.length; i++) out[i] = d[i * 4 + 3]!;
  return out;
}

function firstMask(r: Result, w: number, h: number, pick: (masks: Mask[]) => Mask | undefined): Uint8ClampedArray | null {
  try {
    const m = r.confidenceMasks ? pick(r.confidenceMasks) : undefined;
    return m ? toMask(m, w, h) : null;
  } finally {
    r.close();
  }
}

/** The picture's pixels (cached per picture). */
const pixelCache = new WeakMap<object, Uint8ClampedArray>();
function pixels(src: CanvasImageSource, w: number, h: number): Uint8ClampedArray {
  const hit = pixelCache.get(src as object);
  if (hit && hit.length === w * h * 4) return hit;
  const c = new OffscreenCanvas(w, h);
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(src, 0, 0, w, h);
  const d = ctx.getImageData(0, 0, w, h).data;
  pixelCache.set(src as object, d);
  return d;
}

const to255 = (m: Uint8Array) => Uint8ClampedArray.from(m, (v) => (v ? 255 : 0));

/** A mask that looks like one thing (not most of the picture, not the backdrop running off its sides). */
function plausible(m: Uint8ClampedArray | null, w: number, h: number): m is Uint8ClampedArray {
  if (!m) return false;
  const c = coverage(m);
  return c > 0.00005 && c < 0.5 && edgesTouched(m, w, h) <= 2;
}

/**
 * The object at `point` (picture px). Screenshots and graphics (flat colours) are handled by
 * shape / text detection, photos by the AI model; each is the other's fallback.
 */
export async function selectObjectAt(src: CanvasImageSource, w: number, h: number, point: { x: number; y: number }): Promise<Uint8ClampedArray | null> {
  // Let the page show "Finding the object…" before the work starts.
  await new Promise((r) => setTimeout(r, 30));
  const d = pixels(src, w, h);
  const graphic = flatness(d, w, h, { x: point.x, y: point.y, r: Math.max(40, Math.min(w, h) / 12) }, 0) > 0.6;
  const shape = () => { const m = selectInGraphic(d, w, h, point.x, point.y); return m ? to255(m) : null; };
  const block = () => {
    if (flatness(d, w, h, undefined, 0) <= 0.5) return null;
    const b = blobAt(d, w, h, point.x, point.y);
    const m = b ? to255(b) : null;
    return plausible(m, w, h) && coverage(m) < 0.35 ? m : null;
  };
  if (graphic) {
    const m = shape();
    if (plausible(m, w, h)) return m;
    // Not a single flat shape (e.g. a product box with a white part inside): the picture block.
    const b = block();
    if (b) return b;
    // Clicked on empty page / background: nothing to select (the photo AI would only guess).
    if (!m) return null;
  }
  // A photo inside a screenshot (a product picture on a page): the whole picture block — the
  // object, its coloured edges and the white parts inside it — is what stands out from the page.
  if (!graphic) {
    const b = block();
    if (b) return b;
  }
  const ai = await selectWithAi(src, w, h, point).catch(() => null);
  if (plausible(ai, w, h)) return ai;
  if (!graphic) {
    const m = shape();
    if (plausible(m, w, h)) return m;
  }
  return null;
}

/**
 * The object at `point`, found by the AI model (photos). On a big picture (e.g. a photo inside a
 * screenshot) the model first looks at the part around the click, in more detail; only when the
 * object fills that part is the whole picture used. Only the piece at the click is kept (the model
 * also marks stray bits elsewhere).
 */
async function selectWithAi(src: CanvasImageSource, w: number, h: number, point: { x: number; y: number }): Promise<Uint8ClampedArray | null> {
  // Very big photos (20 megapixels and more): the model only sees ~1024 px anyway, so the work
  // around it (finding the piece at the click, filling its holes) is done on a copy of at most
  // 3 megapixels and only the result is scaled up — seconds instead of a frozen page.
  const limit = 3_000_000;
  if (w * h > limit * 1.05) {
    const k = Math.sqrt(limit / (w * h));
    const sw = Math.max(1, Math.round(w * k));
    const sh = Math.max(1, Math.round(h * k));
    const m = await selectWithAi(small2(src, w, h, sw, sh), sw, sh, { x: point.x * k, y: point.y * k });
    return m ? scaleMask(m, sw, sh, w, h) : null;
  }
  const seg = await loadInteractive();
  if (!seg) return null;
  const run = (sx: number, sy: number, sw: number, sh: number) => {
    const part = new OffscreenCanvas(sw, sh);
    part.getContext('2d')!.drawImage(src, sx, sy, sw, sh, 0, 0, sw, sh);
    const img = small(part, sw, sh);
    const r = seg.segment(img, { keypoint: { x: Math.max(0, Math.min(1, (point.x - sx) / sw)), y: Math.max(0, Math.min(1, (point.y - sy) / sh)) } });
    // The model gives "background" first, then the object.
    return firstMask(r, sw, sh, (ms) => ms[ms.length - 1]);
  };
  if (Math.max(w, h) > 1400) {
    const side = Math.round(Math.max(700, Math.min(w, h) * 0.6));
    const sw = Math.min(w, side);
    const sh = Math.min(h, side);
    const sx = Math.round(Math.max(0, Math.min(w - sw, point.x - sw / 2)));
    const sy = Math.round(Math.max(0, Math.min(h - sh, point.y - sh / 2)));
    const part = run(sx, sy, sw, sh);
    if (part) {
      const local = keepAt(part, sw, sh, { x: point.x - sx, y: point.y - sy });
      // Not cut off by the part's edges (where they are not the picture's edges): it fits.
      if (local && !cutOff(local, sw, sh, { left: sx > 0, top: sy > 0, right: sx + sw < w, bottom: sy + sh < h })) {
        const full = new Uint8ClampedArray(w * h);
        for (let y = 0; y < sh; y++) full.set(local.subarray(y * sw, y * sw + sw), (y + sy) * w + sx);
        return full;
      }
    }
  }
  const m = run(0, 0, w, h);
  return m ? keepAt(m, w, h, point) : null;
}

/** Does the mask run into the given sides (more than a tenth of the side)? */
function cutOff(m: Uint8ClampedArray, w: number, h: number, sides: { left: boolean; top: boolean; right: boolean; bottom: boolean }): boolean {
  const count = (len: number, at: (i: number) => number) => { let k = 0; for (let i = 0; i < len; i++) if (m[at(i)]! > 127) k++; return k > len / 10; };
  return (sides.top && count(w, (i) => i)) || (sides.bottom && count(w, (i) => (h - 1) * w + i))
    || (sides.left && count(h, (i) => i * w)) || (sides.right && count(h, (i) => i * w + w - 1));
}

/**
 * Only the part of a mask connected to `point` (or the nearest part, within a few px); its soft
 * edge is kept. Null when nothing is near the point.
 */
export function keepAt(m: Uint8ClampedArray, w: number, h: number, point: { x: number; y: number }): Uint8ClampedArray | null {
  const px = Math.max(0, Math.min(w - 1, Math.round(point.x)));
  const py = Math.max(0, Math.min(h - 1, Math.round(point.y)));
  let start = -1;
  for (let r = 0; r <= 12 && start < 0; r++) {
    for (let dy = -r; dy <= r && start < 0; dy++) for (let dx = -r; dx <= r; dx++) {
      const x = px + dx, y = py + dy;
      if (x >= 0 && y >= 0 && x < w && y < h && m[y * w + x]! > 127) { start = y * w + x; break; }
    }
  }
  if (start < 0) return null;
  const comp = new Uint8ClampedArray(w * h);
  const stack = [start];
  comp[start] = 255;
  while (stack.length) {
    const p = stack.pop()!;
    const x = p % w;
    for (const q of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, p - w, p + w]) {
      if (q < 0 || q >= m.length || comp[q] || m[q]! <= 127) continue;
      comp[q] = 255;
      stack.push(q);
    }
  }
  // Parts enclosed by the piece (the white console inside a box, a label) belong to it.
  fillMaskHoles(comp, w, h);
  // The soft rim just outside the piece belongs to it too.
  const rim = growMask(comp, w, h, 2);
  const out = new Uint8ClampedArray(w * h);
  for (let i = 0; i < out.length; i++) out[i] = comp[i] ? 255 : rim[i] ? m[i]! : 0;
  return out;
}

/** People in the picture. */
export async function selectPeople(src: CanvasImageSource, w: number, h: number): Promise<Uint8ClampedArray | null> {
  const seg = await loadPerson();
  if (!seg) return null;
  return firstMask(seg.segment(small(src, w, h)), w, h, (ms) => ms[0]);
}

/** How many sides of the picture a mask runs along (more than a fifth of that side). */
export function edgesTouched(mask: Uint8ClampedArray, w: number, h: number): number {
  let n = 0;
  const side = (len: number, at: (i: number) => number) => {
    let k = 0;
    for (let i = 0; i < len; i++) if (mask[at(i)]! > 127) k++;
    if (k > len / 5) n++;
  };
  side(w, (i) => i);
  side(w, (i) => (h - 1) * w + i);
  side(h, (i) => i * w);
  side(h, (i) => i * w + w - 1);
  return n;
}

function small2(src: CanvasImageSource, w: number, h: number, sw: number, sh: number): OffscreenCanvas {
  const c = new OffscreenCanvas(sw, sh);
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, w, h, 0, 0, sw, sh);
  return c;
}

/** A mask (0–255) scaled smoothly to another size. */
function scaleMask(m: Uint8ClampedArray, w: number, h: number, W: number, H: number): Uint8ClampedArray {
  const c = new OffscreenCanvas(w, h);
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(w, h);
  for (let i = 0; i < m.length; i++) { img.data[i * 4] = 255; img.data[i * 4 + 1] = 255; img.data[i * 4 + 2] = 255; img.data[i * 4 + 3] = m[i]!; }
  ctx.putImageData(img, 0, 0);
  const big = new OffscreenCanvas(W, H);
  const bctx = big.getContext('2d', { willReadFrequently: true })!;
  bctx.imageSmoothingQuality = 'high';
  bctx.drawImage(c, 0, 0, W, H);
  const d = bctx.getImageData(0, 0, W, H).data;
  const out = new Uint8ClampedArray(W * H);
  for (let i = 0; i < out.length; i++) out[i] = d[i * 4 + 3]!;
  return out;
}

/** Middle of a mask (picture px). */
function centroid(m: Uint8ClampedArray, w: number, h: number): { x: number; y: number } {
  let sx = 0, sy = 0, n = 0;
  for (let i = 0; i < m.length; i += 3) if (m[i]! > 127) { const x = i % w; sx += x; sy += (i - x) / w; n++; }
  return n ? { x: sx / n, y: sy / n } : { x: w / 2, y: h / 2 };
}

/** Intersection over union of two masks. */
function overlap(a: Uint8ClampedArray, b: Uint8ClampedArray): number {
  let both = 0, either = 0;
  for (let i = 0; i < a.length; i += 2) {
    const p = a[i]! > 127, q = b[i]! > 127;
    if (p && q) both++;
    if (p || q) either++;
  }
  return either ? both / either : 0;
}

const plausibleSubject = (m: Uint8ClampedArray, w: number, h: number) => { const c = coverage(m); return c > 0.02 && c < 0.95 && edgesTouched(m, w, h) <= 3; };

/** Share of the picture a mask covers (0–1). */
export function coverage(mask: Uint8ClampedArray): number {
  let n = 0;
  for (let i = 0; i < mask.length; i++) if (mask[i]! > 127) n++;
  return n / Math.max(1, mask.length);
}

/**
 * The main subject: the people in the picture when there are any, otherwise the object in the
 * middle (a product, a pet, a car…).
 */
export interface Subject {
  mask: Uint8ClampedArray;
  /** graphic: a screenshot / logo on plain colours — exact edges, no edge refinement or feather. */
  kind: 'person' | 'object' | 'graphic';
  /** Graphics: the picture with the background colour taken out of the edge pixels. */
  clean?: Uint8ClampedArray;
}

export async function detectSubject(src: CanvasImageSource, w: number, h: number): Promise<Subject | null> {
  // Let the page show "Finding the subject…" first.
  await new Promise((r) => setTimeout(r, 30));
  // A graphic (logo, product shot, render) on a plain background: that background. Big pictures
  // are looked at on a smaller copy (the edge refinement brings the detail back).
  const k = Math.min(1, Math.sqrt(1_500_000 / (w * h)));
  const sw = Math.max(1, Math.round(w * k));
  const sh = Math.max(1, Math.round(h * k));
  const d = k < 1 ? pixels(small2(src, w, h, sw, sh), sw, sh) : pixels(src, w, h);
  // Judged on the full-size pixels (a scaled copy is never exactly flat).
  const full = pixels(src, w, h);
  if (flatness(full, w, h, undefined, 0) > 0.75) {
    const g = graphicSubject(d, sw, sh);
    if (g) {
      const mask = k < 1 ? scaleMask(to255(g.mask), sw, sh, w, h) : to255(g.mask);
      if (k < 1) for (let i = 0; i < mask.length; i++) mask[i] = mask[i]! > 127 ? (mask[i]! > 230 ? 255 : 128) : mask[i]! > 25 ? 128 : 0;
      const clean = graphicEdges(full, w, h, mask, g.colors);
      return { mask, kind: 'graphic', clean };
    }
  }
  // A photo: found on a copy of at most 3 megapixels (the models see ~1024 px anyway); the mask is
  // scaled up once (the edge refinement brings the detail back).
  const cap = 3_000_000;
  if (w * h > cap * 1.05) {
    const k2 = Math.sqrt(cap / (w * h));
    const pw = Math.max(1, Math.round(w * k2));
    const ph = Math.max(1, Math.round(h * k2));
    const r = await photoSubject(small2(src, w, h, pw, ph), pw, ph);
    return r ? { ...r, mask: scaleMask(r.mask, pw, ph, w, h) } : null;
  }
  return photoSubject(src, w, h);
}

/** The subject of a photo: people, or the thing near the middle. */
async function photoSubject(src: CanvasImageSource, w: number, h: number): Promise<Subject | null> {
  const people = await selectPeople(src, w, h).catch(() => null);
  if (people) {
    const c = coverage(people);
    if (c > 0.03 && c < 0.97) {
      // The person model's outline is rough (and it also fires on other subjects). The object model,
      // asked at the subject's middle, often gives a much tighter outline: use it when the two agree
      // on what the subject is (never just a shirt for a whole person).
      const tight = await selectWithAi(src, w, h, centroid(people, w, h)).catch(() => null);
      if (tight && plausibleSubject(tight, w, h) && overlap(tight, people) > 0.6) return { mask: tight, kind: 'person' };
      return { mask: people, kind: 'person' };
    }
  }
  // A subject sits inside the picture; the sky, the sea or a wall runs into its edges. Try a few
  // points near the middle and keep the first thing that looks like a subject.
  let fallback: Uint8ClampedArray | null = null;
  for (const [fx, fy] of [[0.5, 0.5], [0.5, 0.62], [0.5, 0.38], [0.38, 0.5], [0.62, 0.5]] as const) {
    const obj = await selectWithAi(src, w, h, { x: w * fx, y: h * fy }).catch(() => null);
    if (!obj) continue;
    const c = coverage(obj);
    if (c < 0.005 || c > 0.9) continue;
    fallback ??= obj;
    if (edgesTouched(obj, w, h) <= 1) return { mask: obj, kind: 'object' };
  }
  return fallback ? { mask: fallback, kind: 'object' } : null;
}
