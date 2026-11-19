import type { Annotation, EditorDoc, Watermark } from '@/editor/types';
import { getBounds, renderAnnotation, translate } from '@/editor/tools/annotations';
import { drawWatermark } from '@/editor/tools/decorations';
import { isRedaction, redactSource } from '@/editor/tools/layers';
import { viewScale, type Ctx2D } from '@/editor/tools/common';

/**
 * Advanced Video Editor: the image editor's annotations (pen, shapes, arrows, text, callouts,
 * blur / pixelate / masks, markers, stickers, cursors, images…) shown on the video for a time
 * range, with an entrance / exit animation and an effect while visible. Drawn on the player as a
 * preview and burned into the frames when exporting. Coordinates are video pixels.
 */
export type OverlayAnimIn =
  | 'none' | 'fade' | 'pop' | 'zoom-in' | 'spin-in' | 'blur-in'
  | 'slide-up' | 'slide-left' | 'slide-from-left' | 'slide-from-top' | 'fly-from-left' | 'fly-from-right'
  | 'wipe' | 'wipe-rtl' | 'wipe-down' | 'wipe-up' | 'reveal';
export type OverlayAnimOut =
  | 'none' | 'fade' | 'pop' | 'zoom-out' | 'spin-out' | 'blur-out'
  | 'slide-down' | 'slide-right' | 'slide-to-left' | 'slide-to-top' | 'wipe-out' | 'wipe-out-rtl';
export type OverlayEffect = 'none' | 'pulse' | 'bounce' | 'shake' | 'glow' | 'float' | 'wiggle' | 'heartbeat';

/** Point B of a move: where the drawing is (offset from where it was drawn) at time `t`. */
export interface MotionKey {
  t: number;
  dx: number;
  dy: number;
}

export interface VideoOverlay {
  id: string;
  annotation: Annotation;
  /** Seconds on the original video. */
  start: number;
  end: number;
  /** First animation of each list (kept for older recordings). */
  animIn: OverlayAnimIn;
  animOut: OverlayAnimOut;
  effect: OverlayEffect;
  /** Several animations combined (e.g. Fade in + Slide in from left + Zoom in). */
  ins?: OverlayAnimIn[];
  outs?: OverlayAnimOut[];
  effects?: OverlayEffect[];
  /** Move over time: dragging the drawing at a later moment adds a point it glides to. */
  motion?: boolean;
  moves?: MotionKey[];
}

export const insOf = (o: VideoOverlay): OverlayAnimIn[] => (o.ins ?? [o.animIn]).filter((x) => x !== 'none');
export const outsOf = (o: VideoOverlay): OverlayAnimOut[] => (o.outs ?? [o.animOut]).filter((x) => x !== 'none');
export const effectsOf = (o: VideoOverlay): OverlayEffect[] => (o.effects ?? [o.effect]).filter((x) => x !== 'none');

/** Stored form: image annotations keep their picture as a PNG blob (IndexedDB can't store bitmaps). */
export type StoredOverlay = Omit<VideoOverlay, 'annotation'> & { annotation: Annotation | (Omit<Annotation, 'bitmap'> & { type: 'image'; png: Blob }) };

export const ANIM_SECONDS = 0.45;
export const DEFAULT_OVERLAY_SECONDS = 4;

export const ANIM_IN_LABELS: Record<OverlayAnimIn, string> = {
  none: 'None', fade: 'Fade in', pop: 'Pop in', 'zoom-in': 'Zoom in', 'spin-in': 'Spin in', 'blur-in': 'Blur in',
  'slide-from-left': 'Slide in from left (fade)', 'slide-left': 'Slide in from right (fade)', 'slide-from-top': 'Slide in from top (fade)', 'slide-up': 'Slide in from bottom (fade)',
  'fly-from-left': 'Fly in from left', 'fly-from-right': 'Fly in from right',
  wipe: 'Wipe left → right', 'wipe-rtl': 'Wipe right → left', 'wipe-down': 'Wipe top → bottom', 'wipe-up': 'Wipe bottom → top', reveal: 'Draw / type on',
};
export const ANIM_OUT_LABELS: Record<OverlayAnimOut, string> = {
  none: 'None', fade: 'Fade out', pop: 'Pop out', 'zoom-out': 'Zoom out', 'spin-out': 'Spin out', 'blur-out': 'Blur out',
  'slide-to-left': 'Slide out to left (fade)', 'slide-right': 'Slide out to right (fade)', 'slide-to-top': 'Slide out to top (fade)', 'slide-down': 'Slide out to bottom (fade)',
  'wipe-out': 'Wipe out left → right', 'wipe-out-rtl': 'Wipe out right → left',
};
export const EFFECT_LABELS: Record<OverlayEffect, string> = {
  none: 'None', pulse: 'Pulse', bounce: 'Bounce', shake: 'Shake', glow: 'Glow', float: 'Float', wiggle: 'Wiggle', heartbeat: 'Heartbeat',
};

export function activeOverlays(list: readonly VideoOverlay[], t: number): VideoOverlay[] {
  return list.filter((o) => t >= o.start && t <= o.end);
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const easeOut = (k: number) => 1 - (1 - k) ** 3;
const easeBack = (k: number) => {
  const c = 1.70158;
  return 1 + (c + 1) * (k - 1) ** 3 + c * (k - 1) ** 2;
};

export interface OverlayState {
  alpha: number;
  scale: number;
  dx: number;
  dy: number;
  /** Degrees. */
  rotate: number;
  /** Blur radius as a share of the video's shorter side. */
  blur: number;
  /** Visible part of the drawing's box (0–1 on each side): wipes. */
  clip: { l: number; r: number; t: number; b: number };
  /** Draw / type on: share of the strokes or text shown. */
  reveal: number;
  glow: number;
}

const smooth = (k: number) => k * k * (3 - 2 * k);

/** Where a moving drawing is at time `t` (offset from where it was drawn), gliding between points. */
export function motionOffset(o: VideoOverlay, t: number): { dx: number; dy: number } {
  const keys = [...(o.moves ?? [])].sort((a, b) => a.t - b.t);
  if (!keys.length) return { dx: 0, dy: 0 };
  const all: MotionKey[] = keys[0]!.t > o.start + 1e-3 ? [{ t: o.start, dx: 0, dy: 0 }, ...keys] : keys;
  if (t <= all[0]!.t) return { dx: all[0]!.dx, dy: all[0]!.dy };
  for (let i = 1; i < all.length; i++) {
    const a = all[i - 1]!;
    const b = all[i]!;
    if (t <= b.t) {
      const k = smooth(clamp01((t - a.t) / Math.max(1e-3, b.t - a.t)));
      return { dx: a.dx + (b.dx - a.dx) * k, dy: a.dy + (b.dy - a.dy) * k };
    }
  }
  const last = all[all.length - 1]!;
  return { dx: last.dx, dy: last.dy };
}

/** How an overlay looks at time `t`: every in / out animation and effect combined, plus its motion. */
export function overlayState(o: VideoOverlay, t: number, size: number): OverlayState {
  const s: OverlayState = { alpha: 1, scale: 1, dx: 0, dy: 0, rotate: 0, blur: 0, clip: { l: 0, r: 1, t: 0, b: 1 }, reveal: 1, glow: 0 };
  const len = Math.max(0.05, o.end - o.start);
  const dur = Math.min(ANIM_SECONDS, len / 2.5);
  const kin = clamp01((t - o.start) / dur);
  const kout = clamp01((o.end - t) / dur);
  const ei = easeOut(kin);
  const eo = easeOut(kout);
  const move = size * 0.06;
  const fly = size * 0.6;
  for (const a of insOf(o)) {
    switch (a) {
      case 'fade': s.alpha *= ei; break;
      case 'pop': s.scale *= 0.5 + 0.5 * easeBack(kin); s.alpha *= clamp01(kin * 2); break;
      case 'zoom-in': s.scale *= 0.15 + 0.85 * ei; s.alpha *= clamp01(kin * 1.5); break;
      case 'spin-in': s.rotate += (1 - ei) * -180; s.scale *= 0.4 + 0.6 * ei; s.alpha *= ei; break;
      case 'blur-in': s.blur = Math.max(s.blur, (1 - ei) * 0.03); s.alpha *= clamp01(kin * 1.5); break;
      case 'slide-up': s.dy += (1 - ei) * move; s.alpha *= ei; break;
      case 'slide-from-top': s.dy -= (1 - ei) * move; s.alpha *= ei; break;
      case 'slide-left': s.dx += (1 - ei) * move * 1.5; s.alpha *= ei; break;
      case 'slide-from-left': s.dx -= (1 - ei) * move * 1.5; s.alpha *= ei; break;
      case 'fly-from-left': s.dx -= (1 - ei) * fly; break;
      case 'fly-from-right': s.dx += (1 - ei) * fly; break;
      case 'wipe': s.clip.r = Math.min(s.clip.r, ei); break;
      case 'wipe-rtl': s.clip.l = Math.max(s.clip.l, 1 - ei); break;
      case 'wipe-down': s.clip.b = Math.min(s.clip.b, ei); break;
      case 'wipe-up': s.clip.t = Math.max(s.clip.t, 1 - ei); break;
      case 'reveal': s.reveal = clamp01((t - o.start) / Math.min(len * 0.6, Math.max(dur, 1.2))); break;
      default: break;
    }
  }
  for (const a of outsOf(o)) {
    switch (a) {
      case 'fade': s.alpha *= eo; break;
      case 'pop': s.scale *= 0.5 + 0.5 * eo; s.alpha *= clamp01(kout * 2); break;
      case 'zoom-out': s.scale *= 0.15 + 0.85 * eo; s.alpha *= clamp01(kout * 1.5); break;
      case 'spin-out': s.rotate += (1 - eo) * 180; s.scale *= 0.4 + 0.6 * eo; s.alpha *= eo; break;
      case 'blur-out': s.blur = Math.max(s.blur, (1 - eo) * 0.03); s.alpha *= clamp01(kout * 1.5); break;
      case 'slide-down': s.dy += (1 - eo) * move; s.alpha *= eo; break;
      case 'slide-to-top': s.dy -= (1 - eo) * move; s.alpha *= eo; break;
      case 'slide-right': s.dx += (1 - eo) * move * 1.5; s.alpha *= eo; break;
      case 'slide-to-left': s.dx -= (1 - eo) * move * 1.5; s.alpha *= eo; break;
      case 'wipe-out': s.clip.l = Math.max(s.clip.l, 1 - eo); break;
      case 'wipe-out-rtl': s.clip.r = Math.min(s.clip.r, eo); break;
      default: break;
    }
  }
  const p = t - o.start;
  for (const e of effectsOf(o)) {
    switch (e) {
      case 'pulse': s.scale *= 1 + 0.05 * Math.sin(p * Math.PI * 2 * 1.2); break;
      case 'bounce': s.dy -= Math.abs(Math.sin(p * Math.PI * 1.6)) * size * 0.015; break;
      case 'shake': s.dx += Math.sin(p * 40) * size * 0.004 * (Math.sin(p * 3) > 0.6 ? 1 : 0.15); break;
      case 'glow': s.glow = 0.6 + 0.4 * Math.sin(p * Math.PI * 2); break;
      case 'float': s.dy += Math.sin(p * Math.PI * 0.8) * size * 0.008; break;
      case 'wiggle': s.rotate += Math.sin(p * Math.PI * 4) * 4; break;
      case 'heartbeat': { const b = (p * 1.1) % 1; s.scale *= 1 + (b < 0.15 ? Math.sin((b / 0.15) * Math.PI) * 0.08 : b > 0.25 && b < 0.4 ? Math.sin(((b - 0.25) / 0.15) * Math.PI) * 0.05 : 0); break; }
      default: break;
    }
  }
  const m = motionOffset(o, t);
  s.dx += m.dx;
  s.dy += m.dy;
  return s;
}

/** The part of an annotation shown while it is drawn / typed on. */
function partial(a: Annotation, reveal: number): Annotation {
  if (reveal >= 1) return a;
  if (a.type === 'pen' || a.type === 'highlighter') {
    return { ...a, points: a.points.slice(0, Math.max(1, Math.ceil(a.points.length * reveal))) };
  }
  if (a.type === 'text' || a.type === 'callout') {
    return { ...a, text: a.text.slice(0, Math.ceil(a.text.length * reveal)) };
  }
  return a;
}

/**
 * Draws the overlays visible at time `t` onto a frame already on `ctx` (size w × h video pixels).
 * `base`: the frame itself (blur / pixelate overlays read it); `watermark` covers the whole video.
 */
export function drawOverlays(ctx: Ctx2D, base: ImageBitmap | null, overlays: readonly VideoOverlay[], t: number, w: number, h: number, watermark: Watermark | null = null): void {
  const size = Math.min(w, h);
  // Canvas blur and glow are measured in real pixels, the drawings in video pixels.
  const px = viewScale(ctx);
  const active = activeOverlays(overlays, t);
  const layers = active.map((o) => o.annotation);
  for (const [index, o] of active.entries()) {
    const st = overlayState(o, t, size);
    const { l, r, t: ct, b: cb } = st.clip;
    if (st.alpha <= 0.001 || r - l <= 0.001 || cb - ct <= 0.001) continue;
    const a = partial(o.annotation, st.reveal);
    const bx = getBounds(o.annotation);
    const cx = bx.x + bx.w / 2;
    const cy = bx.y + bx.h / 2;
    ctx.save();
    ctx.globalAlpha *= st.alpha;
    if (l > 0 || r < 1 || ct > 0 || cb < 1) {
      // Wipes: only part of the drawing's box (with a margin for strokes) is shown.
      const m = 6;
      const x0 = bx.x - m + st.dx;
      const y0 = bx.y - m + st.dy;
      const W = bx.w + m * 2;
      const H = bx.h + m * 2;
      ctx.beginPath();
      ctx.rect(x0 + W * l, y0 + H * ct, W * (r - l), H * (cb - ct));
      ctx.clip();
    }
    ctx.translate(cx + st.dx, cy + st.dy);
    if (st.rotate) ctx.rotate((st.rotate * Math.PI) / 180);
    if (st.scale !== 1) ctx.scale(st.scale, st.scale);
    ctx.translate(-cx, -cy);
    if (st.blur > 0) ctx.filter = `blur(${Math.max(0.5, st.blur * size * px).toFixed(1)}px)`;
    if (st.glow > 0) {
      ctx.shadowColor = 'rgba(255, 220, 90, 0.95)';
      ctx.shadowBlur = size * 0.02 * st.glow * px;
    }
    if (base || !isRedaction(a)) renderAnnotation(ctx, (base && isRedaction(a) ? redactSource(base, w, h, layers, index) : base ?? null) as ImageBitmap, a);
    ctx.restore();
  }
  if (watermark) drawWatermark(ctx, { width: w, height: h } as EditorDoc, watermark);
}

/**
 * Burns the overlays into an export frame. Drawings are stored in the source video's pixels, and the
 * frame may already be resized (4K recording exported at 1080p), so they are scaled with the frame.
 */
export async function burnOverlays(canvas: OffscreenCanvas, overlays: readonly VideoOverlay[], t: number, sourceWidth: number, sourceHeight: number, watermark: Watermark | null): Promise<void> {
  const sx = canvas.width / sourceWidth;
  const sy = canvas.height / sourceHeight;
  // Blur and pixelate read the frame at the drawing's own coordinates.
  const base = needsFrame(overlays, t)
    ? await createImageBitmap(canvas, sx === 1 && sy === 1 ? {} : { resizeWidth: sourceWidth, resizeHeight: sourceHeight, resizeQuality: 'high' })
    : null;
  const ctx = canvas.getContext('2d')!;
  ctx.save();
  ctx.setTransform(sx, 0, 0, sy, 0, 0);
  drawOverlays(ctx, base, overlays, t, sourceWidth, sourceHeight, watermark);
  ctx.restore();
  base?.close();
}

/** True when some overlay at time `t` reads the frame (blur / pixelate). */
export function needsFrame(overlays: readonly VideoOverlay[], t: number): boolean {
  return activeOverlays(overlays, t).some((o) => o.annotation.type === 'blur' || o.annotation.type === 'pixelate');
}

/* --------------------------------- storage -------------------------------- */
export async function toStored(list: readonly VideoOverlay[]): Promise<StoredOverlay[]> {
  return Promise.all(list.map(async (o) => {
    if (o.annotation.type !== 'image') return o as StoredOverlay;
    const { bitmap, ...rest } = o.annotation;
    const c = new OffscreenCanvas(bitmap.width, bitmap.height);
    c.getContext('2d')!.drawImage(bitmap, 0, 0);
    return { ...o, annotation: { ...rest, png: await c.convertToBlob({ type: 'image/png' }) } } as StoredOverlay;
  }));
}

export async function fromStored(list: readonly StoredOverlay[] | undefined): Promise<VideoOverlay[]> {
  if (!list?.length) return [];
  const out: VideoOverlay[] = [];
  for (const o of list) {
    const a = o.annotation as Annotation & { png?: Blob };
    if (a.type === 'image' && a.png) {
      const bitmap = await createImageBitmap(a.png).catch(() => null);
      if (!bitmap) continue;
      const { png: _png, ...rest } = a;
      out.push({ ...o, annotation: { ...(rest as Annotation), bitmap } as Annotation });
    } else out.push(o as VideoOverlay);
  }
  return out;
}

/** A short name for the overlay list ("Text: Book now", "Arrow", "Blur"). */
export function overlayName(a: Annotation): string {
  const kind: Record<string, string> = {
    pen: 'Pen', highlighter: 'Highlighter', rect: 'Shape', ellipse: 'Shape', arrow: 'Arrow', line: 'Line', text: 'Text', callout: 'Callout',
    blur: 'Blur', pixelate: 'Pixelate', mask: 'Mask', marker: 'Marker', sticker: 'Sticker', cursor: 'Cursor', image: 'Image',
  };
  const base = kind[a.type] ?? 'Drawing';
  if ((a.type === 'text' || a.type === 'callout') && a.text.trim()) return `${base}: ${a.text.trim().slice(0, 30)}`;
  if (a.type === 'marker') return `Marker ${a.n}`;
  return base;
}

/* ------------------------------ live editing sync ------------------------------ */
export interface OverlayDefaults {
  seconds: number;
  animIn: OverlayAnimIn;
  animOut: OverlayAnimOut;
  effect: OverlayEffect;
  ins?: OverlayAnimIn[];
  outs?: OverlayAnimOut[];
  effects?: OverlayEffect[];
}

export const BUILTIN_OVERLAY_DEFAULTS: OverlayDefaults = { seconds: DEFAULT_OVERLAY_SECONDS, animIn: 'fade', animOut: 'fade', effect: 'none' };

/**
 * Applies the drawings of the frame being edited to the video's overlays: changed drawings update
 * their overlay, new ones become overlays from `time` (for `defaults.seconds`), and drawings this
 * editing session knew (`known`: annotation ids) that are gone are removed. Other overlays stay.
 */
export function syncOverlays(
  overlays: readonly VideoOverlay[],
  annotations: readonly Annotation[],
  known: ReadonlySet<string>,
  time: number,
  duration: number,
  defaults: OverlayDefaults,
  makeId: () => string,
): { overlays: VideoOverlay[]; known: Set<string> } {
  const byAnnotation = new Map(overlays.map((o) => [o.annotation.id, o]));
  const present = new Set(annotations.map((a) => a.id));
  const nextKnown = new Set([...known, ...present]);
  const out: VideoOverlay[] = overlays.filter((o) => !(known.has(o.annotation.id) && !present.has(o.annotation.id)));
  for (const a of annotations) {
    const prev = byAnnotation.get(a.id);
    if (prev) {
      const next = fromShown(prev, a, time);
      if (next !== prev) out[out.findIndex((o) => o.id === prev.id)] = next;
      continue;
    }
    const end = duration > 0 ? Math.min(duration, time + defaults.seconds) : time + defaults.seconds;
    out.push({
      id: makeId(), annotation: a, start: time, end: Math.max(end, time + 0.1), animIn: defaults.animIn, animOut: defaults.animOut, effect: defaults.effect,
      ...(defaults.ins ? { ins: [...defaults.ins] } : {}), ...(defaults.outs ? { outs: [...defaults.outs] } : {}), ...(defaults.effects ? { effects: [...defaults.effects] } : {}),
    });
  }
  // Layer order: the drawings on this frame take the order they have in the editor (bring forward,
  // send back…), staying within the places they already use; drawings not on this frame keep theirs.
  const order = new Map(annotations.map((a, i) => [a.id, i]));
  const slots = out.flatMap((o, i) => (order.has(o.annotation.id) ? [i] : []));
  const layered = slots.map((i) => out[i]!).sort((a, b) => order.get(a.annotation.id)! - order.get(b.annotation.id)!);
  slots.forEach((slot, i) => { out[slot] = layered[i]!; });
  return { overlays: out, known: nextKnown };
}

/** The drawing as shown at `t` (moved along its path), for editing on that frame. */
export function shownAt(o: VideoOverlay, t: number): Annotation {
  const m = motionOffset(o, t);
  return m.dx || m.dy ? translate(o.annotation, m.dx, m.dy) : o.annotation;
}

/**
 * The edited drawing at `t` back to the overlay: style changes go to the drawing itself; with
 * "Move over time" on (after its start), a new position becomes a point it glides to at `t`.
 */
export function fromShown(o: VideoOverlay, shown: Annotation, t: number): VideoOverlay {
  if (shown === o.annotation) return o;
  const was = motionOffset(o, t);
  const b0 = getBounds(o.annotation);
  const b1 = getBounds(shown);
  const off = { dx: b1.x - b0.x, dy: b1.y - b0.y };
  if (o.motion && t > o.start + 0.05 && (Math.abs(off.dx - was.dx) > 0.5 || Math.abs(off.dy - was.dy) > 0.5)) {
    const moves = (o.moves ?? []).filter((k) => Math.abs(k.t - t) > 0.05);
    moves.push({ t, dx: Math.round(off.dx), dy: Math.round(off.dy) });
    moves.sort((x, y) => x.t - y.t);
    return { ...o, annotation: translate(shown, -off.dx, -off.dy), moves };
  }
  const base = was.dx || was.dy ? translate(shown, -was.dx, -was.dy) : shown;
  return { ...o, annotation: base };
}
