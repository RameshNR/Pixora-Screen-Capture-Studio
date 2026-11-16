import type { CameraStyle, CursorReport, Easing, LiveEffect, RelativeRect, SpotlightSettings, TeleprompterLive, ZoomSettings } from '@/shared/types';

type Ctx = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;

export interface ViewRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Easing curves for zoom transitions (t in 0–1). */
export function ease(t: number, kind: Easing): number {
  const x = Math.max(0, Math.min(1, t));
  switch (kind) {
    case 'linear':
      return x;
    case 'ease-out':
      return 1 - (1 - x) ** 3;
    case 'spring': {
      // Slight overshoot that settles.
      const c = 1.70158 * 1.2;
      return 1 + (c + 1) * (x - 1) ** 3 + c * (x - 1) ** 2;
    }
    default:
      return x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2;
  }
}

/**
 * The part of the (cropped) source shown for a zoom level and centre, kept inside the crop.
 * `center` is a fraction of the full source frame.
 */
export function zoomView(crop: ViewRect, level: number, center: { x: number; y: number }, frameW: number, frameH: number): ViewRect {
  const z = Math.max(1, level);
  const w = crop.w / z;
  const h = crop.h / z;
  const cx = center.x * frameW;
  const cy = center.y * frameH;
  const x = Math.max(crop.x, Math.min(crop.x + crop.w - w, cx - w / 2));
  const y = Math.max(crop.y, Math.min(crop.y + crop.h - h, cy - h / 2));
  return { x, y, w, h };
}

/** Webcam bubble rectangle in output pixels (centre position, clamped inside the frame). */
export function cameraRect(style: CameraStyle, outW: number, outH: number, cameraAspect: number): { x: number; y: number; width: number; height: number } {
  const shorter = Math.min(outW, outH);
  const height = Math.round((shorter * Math.max(5, Math.min(60, style.sizePct))) / 100);
  const width = style.shape === 'circle' ? height : Math.round(height * Math.max(1, Math.min(cameraAspect, 16 / 9)));
  const margin = Math.round(shorter * 0.02);
  const x = Math.round(Math.max(margin, Math.min(outW - width - margin, style.x * outW - width / 2)));
  const y = Math.round(Math.max(margin, Math.min(outH - height - margin, style.y * outH - height / 2)));
  return { x, y, width, height };
}

/** Teleprompter scroll position (px at the teleprompter's own font size) at a moment in time. */
export function teleprompterOffset(t: TeleprompterLive, now: number): number {
  return t.offset + (t.playing ? (t.speed * Math.max(0, now - t.since)) / 1000 : 0);
}

interface ZoomAnim {
  fromLevel: number;
  toLevel: number;
  fromCenter: { x: number; y: number };
  toCenter: { x: number; y: number } | null;
  start: number;
  duration: number;
}

/**
 * Live visual effects composited into the recording: zoom (manual, region and auto-on-click),
 * cursor spotlight, region highlight with dimmed surroundings, the webcam bubble's style and an
 * optional teleprompter caption. Coordinates arrive as fractions of the full source frame.
 */
export class LiveEffects {
  camera: CameraStyle | null;
  private cursor: { x: number; y: number; at: number } | null = null;
  private followCenter = { x: 0.5, y: 0.5 };
  private zoom: ZoomAnim = { fromLevel: 1, toLevel: 1, fromCenter: { x: 0.5, y: 0.5 }, toCenter: null, start: 0, duration: 1 };
  private manualZoom = 1;
  private autoUntil = 0;
  private spotlight = false;
  private highlight: RelativeRect | null = null;
  teleprompter: TeleprompterLive | null = null;

  constructor(
    camera: CameraStyle | null,
    private readonly zoomSettings: ZoomSettings,
    private readonly spotSettings: SpotlightSettings,
    /** Cursor positions are only meaningful when the recorded frame is the page itself. */
    private readonly cursorTracked: boolean,
  ) {
    this.camera = camera;
  }

  apply(effect: LiveEffect, now = performance.now()): void {
    switch (effect.kind) {
      case 'camera':
        if (this.camera) this.camera = { ...this.camera, ...effect.patch };
        break;
      case 'zoom':
        this.manualZoom = effect.level;
        this.autoUntil = 0;
        this.animateTo(effect.level, effect.center, now);
        break;
      case 'spotlight':
        this.spotlight = effect.on;
        break;
      case 'highlight':
        this.highlight = effect.rect;
        break;
      case 'teleprompter':
        // `since` is wall-clock time (Date.now), shared by the teleprompter window and this host.
        this.teleprompter = effect.state;
        break;
    }
  }

  onCursor(report: CursorReport, now = performance.now()): void {
    if (!this.cursorTracked) return;
    this.cursor = { x: report.x, y: report.y, at: now };
    if (report.click && this.zoomSettings.autoOnClick && this.manualZoom <= 1) {
      this.animateTo(this.zoomSettings.level, { x: report.x, y: report.y }, now);
      this.autoUntil = now + this.zoomSettings.transitionMs + this.zoomSettings.holdMs;
    }
  }

  private animateTo(level: number, center: { x: number; y: number } | null, now: number): void {
    const cur = this.currentZoom(now);
    this.zoom = { fromLevel: cur.level, toLevel: Math.max(1, Math.min(6, level)), fromCenter: cur.center, toCenter: center, start: now, duration: Math.max(1, this.zoomSettings.transitionMs) };
  }

  private currentZoom(now: number): { level: number; center: { x: number; y: number } } {
    if (this.autoUntil && now >= this.autoUntil) {
      this.autoUntil = 0;
      this.animateTo(this.manualZoom, null, now);
    }
    const z = this.zoom;
    const k = ease((now - z.start) / z.duration, this.zoomSettings.easing);
    // No fixed centre: follow the cursor smoothly (or stay centred when the cursor is unknown).
    if (this.cursor) {
      this.followCenter = { x: this.followCenter.x + (this.cursor.x - this.followCenter.x) * 0.12, y: this.followCenter.y + (this.cursor.y - this.followCenter.y) * 0.12 };
    }
    const target = z.toCenter ?? this.followCenter;
    return {
      level: z.fromLevel + (z.toLevel - z.fromLevel) * k,
      center: { x: z.fromCenter.x + (target.x - z.fromCenter.x) * k, y: z.fromCenter.y + (target.y - z.fromCenter.y) * k },
    };
  }

  /** True when frames must be redrawn on a canvas (anything visible besides a plain crop). */
  active(now = performance.now()): boolean {
    const z = this.currentZoom(now);
    return z.level > 1.001 || this.spotlight || this.highlight !== null || (this.teleprompter !== null && this.teleprompter.text.trim() !== '');
  }

  view(crop: ViewRect, frameW: number, frameH: number, now = performance.now()): ViewRect {
    const z = this.currentZoom(now);
    if (z.level <= 1.001) return crop;
    return zoomView(crop, z.level, z.center, frameW, frameH);
  }

  /** Spotlight, highlight dimming and teleprompter, drawn over the frame (output pixels). */
  drawOverlays(ctx: Ctx, outW: number, outH: number, view: ViewRect, frameW: number, frameH: number): void {
    const toOut = (fx: number, fy: number) => ({ x: ((fx * frameW - view.x) / view.w) * outW, y: ((fy * frameH - view.y) / view.h) * outH });
    const dim = `rgba(0,0,0,${Math.max(0, Math.min(0.95, this.spotSettings.dim))})`;
    if (this.highlight) {
      const a = toOut(this.highlight.x, this.highlight.y);
      const b = toOut(this.highlight.x + this.highlight.width, this.highlight.y + this.highlight.height);
      ctx.save();
      ctx.fillStyle = dim;
      ctx.beginPath();
      ctx.rect(0, 0, outW, outH);
      ctx.roundRect(a.x, a.y, b.x - a.x, b.y - a.y, 8);
      ctx.fill('evenodd');
      ctx.strokeStyle = 'rgba(255, 216, 77, 0.95)';
      ctx.lineWidth = Math.max(2, outH / 360);
      ctx.beginPath();
      ctx.roundRect(a.x, a.y, b.x - a.x, b.y - a.y, 8);
      ctx.stroke();
      ctx.restore();
    }
    if (this.spotlight) {
      const c = this.cursor && this.cursorTracked ? toOut(this.cursor.x, this.cursor.y) : { x: outW / 2, y: outH / 2 };
      const r = Math.min(outW, outH) * Math.max(0.03, this.spotSettings.radius);
      ctx.save();
      const g = ctx.createRadialGradient(c.x, c.y, r * 0.85, c.x, c.y, r * 1.15);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, dim);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, outW, outH);
      ctx.restore();
    }
    if (this.teleprompter && this.teleprompter.text.trim()) drawTeleprompter(ctx, this.teleprompter, outW, outH);
  }
}

/** Draws the teleprompter caption box (a few lines, scrolling with the script). */
export function drawTeleprompter(ctx: Ctx, t: TeleprompterLive, outW: number, outH: number, now = Date.now()): void {
  const s = outH / 1080;
  const font = Math.max(10, t.fontSize * s);
  const lineH = font * t.lineHeight;
  const boxW = outW * Math.max(0.2, Math.min(1, t.widthPct));
  const visibleLines = 3;
  const pad = font * 0.6;
  const boxH = lineH * visibleLines + pad * 2;
  const x = (outW - boxW) / 2;
  const y = t.position === 'top' ? outH * 0.04 : outH - boxH - outH * 0.04;
  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, t.backgroundOpacity));
  ctx.fillStyle = t.background;
  ctx.beginPath();
  ctx.roundRect(x, y, boxW, boxH, font * 0.4);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.beginPath();
  ctx.rect(x, y + pad * 0.5, boxW, boxH - pad);
  ctx.clip();
  ctx.font = `600 ${font}px ${t.fontFamily}`;
  ctx.fillStyle = t.color;
  ctx.textBaseline = 'top';
  ctx.textAlign = t.align;
  const lines = wrapLines(ctx, t.text, boxW - pad * 2);
  const offset = teleprompterOffset(t, now) * s;
  const tx = t.align === 'left' ? x + pad : t.align === 'right' ? x + boxW - pad : x + boxW / 2;
  const first = Math.max(0, Math.floor(offset / lineH) - 1);
  for (let i = first; i < Math.min(lines.length, first + visibleLines + 3); i++) {
    ctx.fillText(lines[i]!, tx, y + pad + i * lineH - offset);
  }
  ctx.restore();
}

function wrapLines(ctx: Ctx, text: string, maxWidth: number): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/)) {
      const next = line ? `${line} ${word}` : word;
      if (line && ctx.measureText(next).width > maxWidth) {
        out.push(line);
        line = word;
      } else line = next;
    }
    out.push(line);
  }
  return out;
}
