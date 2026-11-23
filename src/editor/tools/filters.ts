import type { EditorDoc } from '../types';

/*
 * Filters: a look (preset) at some strength, plus adjustments and effects. They are settings on the
 * document, never baked into the picture: the original pixels stay as they were, every slider can be
 * changed or reset later, and undo / redo / Reset treat them like any other edit. The filtered
 * picture is worked out when it is drawn (and cached until the picture or the settings change).
 */

export const ADJUSTMENTS = ['brightness', 'contrast', 'saturation', 'exposure', 'temperature', 'tint', 'highlights', 'shadows', 'sharpness', 'noise'] as const;
export const EFFECTS = ['blur', 'vignette', 'grain', 'glow', 'sharpen', 'fade'] as const;
export type Adjustment = (typeof ADJUSTMENTS)[number];
export type Effect = (typeof EFFECTS)[number];

export const PRESETS = ['original', 'vivid', 'warm', 'cool', 'cinematic', 'vintage', 'bw', 'noir', 'bright', 'soft', 'dramatic', 'retro', 'portrait', 'matte', 'golden', 'fresh'] as const;
export type FilterPreset = (typeof PRESETS)[number];

export interface ImageFilters {
  preset: FilterPreset;
  /** Strength of the preset, 0–100 %. */
  intensity: number;
  /** −100…100 (sharpness 0…100). Added on top of the preset. */
  adjust: Partial<Record<Adjustment, number>>;
  /** 0…100. Added on top of the preset. */
  effects: Partial<Record<Effect, number>>;
}

export const NO_FILTERS: ImageFilters = { preset: 'original', intensity: 100, adjust: {}, effects: {} };

export const LABELS: Record<Adjustment | Effect | FilterPreset, string> = {
  brightness: 'Brightness', contrast: 'Contrast', saturation: 'Saturation', exposure: 'Exposure', temperature: 'Temperature', tint: 'Tint',
  highlights: 'Highlights', shadows: 'Shadows', sharpness: 'Sharpness', noise: 'Noise', blur: 'Blur', vignette: 'Vignette', grain: 'Grain', glow: 'Glow', fade: 'Fade', sharpen: 'Sharpen',
  original: 'Original', vintage: 'Vintage', cinematic: 'Cinematic', warm: 'Warm', cool: 'Cool', dramatic: 'Dramatic', portrait: 'Portrait', vivid: 'Vivid', noir: 'Noir', retro: 'Retro', bw: 'B&W', bright: 'Bright', soft: 'Soft', matte: 'Matte', golden: 'Golden', fresh: 'Fresh',
};

/** Lowest value of each adjustment (the rest go from −100). */
export const ADJUST_MIN: Record<Adjustment, number> = {
  brightness: -100, contrast: -100, saturation: -100, exposure: -100, temperature: -100, tint: -100, highlights: -100, shadows: -100, sharpness: 0, noise: 0,
};

/** Everything a look can set: the adjustments, the effects and a split tone (teal shadows, orange highlights). */
type Params = Record<Adjustment | Effect | 'split', number>;

const ZERO: Params = {
  brightness: 0, contrast: 0, saturation: 0, exposure: 0, temperature: 0, tint: 0, highlights: 0, shadows: 0, sharpness: 0, noise: 0,
  blur: 0, vignette: 0, grain: 0, glow: 0, fade: 0, sharpen: 0, split: 0,
};

/** Each look at 100 %. */
const LOOKS: Record<FilterPreset, Partial<Params>> = {
  original: {},
  vintage: { temperature: 22, saturation: -32, fade: 42, contrast: -12, vignette: 32, grain: 16, tint: 6 },
  cinematic: { contrast: 22, saturation: -12, split: 75, highlights: -18, shadows: 12, vignette: 22 },
  warm: { temperature: 38, saturation: 10, tint: 4, brightness: 3 },
  cool: { temperature: -38, tint: -6, saturation: -4 },
  dramatic: { contrast: 48, shadows: -22, highlights: -28, saturation: -18, vignette: 42, sharpen: 22 },
  portrait: { brightness: 6, contrast: -6, temperature: 10, saturation: -6, shadows: 16, highlights: -12, blur: 0, fade: 6 },
  vivid: { saturation: 48, contrast: 16, sharpness: 16, exposure: 4 },
  noir: { saturation: -100, contrast: 42, vignette: 36, grain: 14, shadows: -8 },
  retro: { temperature: 26, tint: 12, fade: 36, saturation: -22, grain: 22, contrast: -10, vignette: 18 },
  bw: { saturation: -100, contrast: 12 },
  bright: { exposure: 18, brightness: 8, shadows: 14, saturation: 8 },
  soft: { contrast: -18, highlights: -10, glow: 30, fade: 10 },
  matte: { fade: 40, contrast: -14, saturation: -8 },
  golden: { temperature: 45, tint: 8, saturation: 14, glow: 18, highlights: -8 },
  fresh: { temperature: -12, saturation: 22, exposure: 8, contrast: 8 },
};

export function isActive(f: ImageFilters | null | undefined): f is ImageFilters {
  if (!f) return false;
  const p = resolve(f);
  return (Object.keys(p) as Array<keyof Params>).some((k) => p[k] !== 0);
}

/** The values in use: the preset at its strength plus the user's own changes. */
export function resolve(f: ImageFilters): Params {
  const out: Params = { ...ZERO };
  const look = LOOKS[f.preset] ?? {};
  const k = Math.max(0, Math.min(100, f.intensity)) / 100;
  for (const key of Object.keys(out) as Array<keyof Params>) {
    const v = (look[key] ?? 0) * k + ((f.adjust as Record<string, number>)[key] ?? 0) + ((f.effects as Record<string, number>)[key] ?? 0);
    const min = key in ADJUST_MIN ? ADJUST_MIN[key as Adjustment] : 0;
    out[key] = Math.max(min, Math.min(100, Math.round(v * 10) / 10));
  }
  return out;
}

/** The blur radius (px) a Blur value means for a picture of this size. */
export function blurRadius(value: number, w: number, h: number): number {
  return (value / 100) * Math.max(3, Math.min(w, h) * 0.025);
}

/** Small, fixed pseudo-random numbers (the grain looks the same on screen and in the download). */
function noise(i: number): number {
  let x = (i * 2654435761) >>> 0;
  x ^= x >>> 15;
  x = Math.imul(x, 2246822519) >>> 0;
  x ^= x >>> 13;
  return (x & 0xffff) / 0xffff - 0.5;
}

/**
 * Colour work on RGBA pixels, in place. `soft` is the same picture slightly blurred (needed for
 * Sharpness / Sharpen; omitted, no sharpening).
 */
export function applyPixels(data: Uint8ClampedArray, w: number, h: number, p: Params, soft?: Uint8ClampedArray | null): void {
  const exposure = Math.pow(2, (p.exposure / 100) * 1.5);
  const bright = (p.brightness / 100) * 0.3;
  const contrast = p.contrast >= 0 ? 1 + (p.contrast / 100) * 1.2 : 1 + p.contrast / 100 * 0.85;
  // Per channel (0–255 in, 0–1 out): exposure, brightness, contrast.
  const lut = new Float32Array(256);
  for (let i = 0; i < 256; i++) lut[i] = ((i / 255) * exposure + bright - 0.5) * contrast + 0.5;
  const sat = 1 + p.saturation / 100;
  const temp = (p.temperature / 100) * 0.14;
  const tint = (p.tint / 100) * 0.1;
  const hi = (p.highlights / 100) * 0.4;
  const sh = (p.shadows / 100) * 0.4;
  const split = p.split / 100;
  const fade = p.fade / 100;
  const sharp = ((p.sharpness + p.sharpen) / 100) * 1.6;
  const grain = (p.grain / 100) * 0.22;
  const fine = (p.noise / 100) * 0.16;
  const vig = (p.vignette / 100) * 0.8;
  const cx = w / 2;
  const cy = h / 2;
  const sharpen = sharp > 0 && soft;
  for (let y = 0, i = 0; y < h; y++) {
    const dy = (y - cy) / cy;
    for (let x = 0; x < w; x++, i += 4) {
      let r0 = data[i]!;
      let g0 = data[i + 1]!;
      let b0 = data[i + 2]!;
      if (sharpen) {
        r0 = Math.max(0, Math.min(255, r0 + sharp * (r0 - soft[i]!)));
        g0 = Math.max(0, Math.min(255, g0 + sharp * (g0 - soft[i + 1]!)));
        b0 = Math.max(0, Math.min(255, b0 + sharp * (b0 - soft[i + 2]!)));
      }
      let r = lut[r0 | 0]!;
      let g = lut[g0 | 0]!;
      let b = lut[b0 | 0]!;
      let l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      if (hi || sh || split) {
        const lc = l < 0 ? 0 : l > 1 ? 1 : l;
        const ws = (1 - lc) * (1 - lc);
        const wh = lc * lc;
        const d = sh * ws + hi * wh;
        r += d; g += d; b += d;
        if (split) {
          r += (-0.05 * ws + 0.07 * wh) * split;
          g += (0.02 * ws + 0.025 * wh) * split;
          b += (0.07 * ws - 0.06 * wh) * split;
        }
      }
      if (temp || tint) {
        r += temp + tint * 0.5;
        g -= tint;
        b += -temp + tint * 0.5;
      }
      if (sat !== 1) {
        l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        r = l + (r - l) * sat;
        g = l + (g - l) * sat;
        b = l + (b - l) * sat;
      }
      if (fade) {
        r = r * (1 - 0.3 * fade) + 0.2 * fade;
        g = g * (1 - 0.3 * fade) + 0.2 * fade;
        b = b * (1 - 0.3 * fade) + 0.2 * fade;
      }
      if (vig) {
        const dx = (x - cx) / cx;
        const dist = Math.sqrt(dx * dx + dy * dy) / Math.SQRT2;
        const t = dist <= 0.35 ? 0 : dist >= 1 ? 1 : ((dist - 0.35) / 0.65) ** 2 * (3 - 2 * ((dist - 0.35) / 0.65));
        const m = 1 - vig * t;
        r *= m; g *= m; b *= m;
      }
      if (fine) {
        // Noise: fine and coloured (each channel its own), unlike Grain.
        r += noise(i * 3 + 7) * fine; g += noise(i * 3 + 11) * fine; b += noise(i * 3 + 13) * fine;
      }
      if (grain) {
        const n = noise(i) * grain;
        r += n; g += n; b += n;
      }
      data[i] = r * 255;
      data[i + 1] = g * 255;
      data[i + 2] = b * 255;
    }
  }
}

/** Filtered pictures per base bitmap: one per size used (the screen's and, for export, full size). */
const cache = new WeakMap<ImageBitmap, Map<number, { key: string; canvas: OffscreenCanvas }>>();

/** Draws `src` (w × h) through a CSS blur onto a new canvas. */
function blurred(src: CanvasImageSource, w: number, h: number, radius: number, read = false): OffscreenCanvas {
  const c = new OffscreenCanvas(w, h);
  const ctx = c.getContext('2d', read ? { willReadFrequently: true } : undefined)!;
  // Edges stay solid: the picture is drawn a little bigger underneath, then the blurred copy on top.
  ctx.filter = `blur(${radius}px)`;
  const pad = Math.ceil(radius * 2);
  ctx.drawImage(src, -pad, -pad, w + pad * 2, h + pad * 2);
  ctx.drawImage(src, 0, 0, w, h);
  ctx.filter = 'none';
  return c;
}

/** The picture with these filters (drawn at `w` × `h`), on a new canvas. */
export function renderFiltered(src: CanvasImageSource, w: number, h: number, f: ImageFilters): OffscreenCanvas {
  const p = resolve(f);
  const canvas = new OffscreenCanvas(Math.max(1, w), Math.max(1, h));
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(src, 0, 0, w, h);
  if (p.blur > 0) {
    const b = blurred(canvas, w, h, blurRadius(p.blur, w, h));
    ctx.clearRect(0, 0, w, h);
    // Keep see-through parts see-through.
    ctx.drawImage(src, 0, 0, w, h);
    ctx.globalCompositeOperation = 'source-atop';
    ctx.drawImage(b, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
  }
  const img = ctx.getImageData(0, 0, w, h);
  let soft: Uint8ClampedArray | null = null;
  if (p.sharpness + p.sharpen > 0) {
    const s = blurred(canvas, w, h, Math.max(1, Math.min(w, h) / 900), true);
    soft = s.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, w, h).data;
  }
  applyPixels(img.data, w, h, p, soft);
  ctx.putImageData(img, 0, 0);
  if (p.glow > 0) {
    // Glow: a soft, blurred copy lightens on top (bright parts bloom).
    const halo = blurred(canvas, w, h, Math.max(2, Math.min(w, h) * 0.012));
    ctx.globalAlpha = Math.min(1, p.glow / 100) * 0.65;
    ctx.globalCompositeOperation = 'screen';
    ctx.drawImage(halo, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  }
  return canvas;
}

/** The picture as drawn: the base with the document's filters (cached), or the base itself. */
/**
 * `scale`: the size it is shown at (1 = full size, for export). On screen a big photo is filtered at
 * about the size it is shown (a 20-megapixel photo at 25 % needs a sixteenth of the work), so
 * sliders follow the pointer smoothly; draw the result stretched to the picture's size.
 */
export function filteredBase(doc: Pick<EditorDoc, 'base' | 'width' | 'height' | 'filters'>, scale = 1): CanvasImageSource & { width: number; height: number } {
  const f = doc.filters;
  if (!isActive(f)) return doc.base;
  // Fixed steps (1, ½, ¼, ⅛ — the smallest that is still sharp enough), so zooming a little does not refilter.
  const step = [0.125, 0.25, 0.5, 1].find((s) => s >= scale) ?? 1;
  const key = JSON.stringify(resolve(f));
  let sizes = cache.get(doc.base);
  if (!sizes) { sizes = new Map(); cache.set(doc.base, sizes); }
  const hit = sizes.get(step);
  if (hit && hit.key === key) return hit.canvas;
  const w = Math.max(1, Math.round(doc.width * step));
  const h = Math.max(1, Math.round(doc.height * step));
  const canvas = renderFiltered(doc.base, w, h, f);
  sizes.set(step, { key, canvas });
  return canvas;
}
