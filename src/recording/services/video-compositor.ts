import type { CameraShape, CameraSize, CornerPosition, RelativeRect } from '@/shared/types';
import { computeCameraRect, cropToPixels, drawCameraOverlay } from './camera-service';
import { cameraRect, type LiveEffects } from './live-effects';
import { logger } from '@/shared/utils/logger';
import { alignShot, fillFromEdges, ShareBarWatcher, shotMismatch, type BarRect } from './share-bar';
import type { PageShot } from './page-under-bar';

/** Mean pixel difference (0–255) around the bar below which a page picture counts as matching the frame. */
const SHOT_FITS = 12;
/** Looks in a row (4 a second) a live page may differ from the frame before it is dropped. */
const LIVE_MISSES = 6;
/** New live pictures in a row that don't line up with the frame before the live page is given up. */
const LIVE_FIT_FAILS = 4;
/** At most this many frames the screen is held back to wait for the live page. */
const MAX_LAG = 4;

/** A copy of a screen frame, held back while the live page catches up. */
interface HeldFrame {
  canvas: OffscreenCanvas;
  timestamp: number;
  duration: number | null;
}

export interface CompositorCamera {
  track: MediaStreamTrack;
  position: CornerPosition;
  size: CameraSize;
  shape: CameraShape;
}

export interface CompositorOptions {
  crop: RelativeRect | null;
  camera: CompositorCamera | null;
  /** Zoom, spotlight, highlight, teleprompter and the webcam bubble's live style. */
  effects?: LiveEffects | null;
  /** Target frame rate: a frame taking longer than 1/fps to process means frames are skipped. */
  fps?: number;
  /** Screen / window recordings: paint Chrome's "… is sharing your screen" bar out of the frames. */
  removeShareBar?: boolean;
}

export function isCompositorSupported(): boolean {
  return typeof MediaStreamTrackProcessor !== 'undefined' && typeof MediaStreamTrackGenerator !== 'undefined' && typeof VideoFrame !== 'undefined';
}

/**
 * Frame-driven video pipeline built on Chrome's MediaStreamTrackProcessor/Generator.
 *
 * Only used when needed (custom-area crop and/or camera overlay). Frames are pulled as they
 * arrive, so it keeps working in hidden documents where requestAnimationFrame is paused.
 * Crop-only recordings use `VideoFrame.visibleRect`, which avoids any pixel copy.
 */
export class VideoCompositor {
  readonly track: MediaStreamTrack;
  private readonly generator: MediaStreamTrackGenerator<VideoFrame>;
  private readonly writer: WritableStreamDefaultWriter<VideoFrame>;
  private sourceReader: ReadableStreamDefaultReader<VideoFrame> | null = null;
  private cameraReader: ReadableStreamDefaultReader<VideoFrame> | null = null;
  private latestCamera: VideoFrame | null = null;
  private canvas: OffscreenCanvas | null = null;
  private ctx: OffscreenCanvasRenderingContext2D | null = null;
  private running = true;
  private cameraVisible: boolean;
  private crop: RelativeRect | null;
  private frameCount = 0;
  private fpsWindowStart = performance.now();
  measuredFps = 0;
  /** Processing load: frames handled, frames over the time budget, total time (ms). */
  private load = { frames: 0, slow: 0, totalMs: 0 };
  outputWidth = 0;
  outputHeight = 0;

  constructor(private readonly source: MediaStreamTrack, private readonly options: CompositorOptions) {
    this.generator = new MediaStreamTrackGenerator({ kind: 'video' });
    this.writer = this.generator.writable.getWriter();
    this.track = this.generator;
    this.cameraVisible = options.camera !== null;
    this.crop = options.crop;
    this.shareBar = options.removeShareBar ? new ShareBarWatcher() : null;
  }

  private readonly shareBar: ShareBarWatcher | null;
  private cleanCanvas: OffscreenCanvas | null = null;
  private cleanCtx: OffscreenCanvasRenderingContext2D | null = null;
  /** Takes a picture of the web page in front (see page-under-bar), when the recorder can. */
  private pageShooter: ((fw: number, fh: number) => Promise<PageShot | null>) | null = null;
  /** The page picture fitted on the frame, and whether it still matches what is around the bar. */
  private shot: PageShot | null = null;
  private shotOk = false;
  /** Looks in a row where the page picture didn't match the frame around the bar. */
  private shotMisses = 0;
  /** New live pictures in a row that didn't line up. */
  private liveFitFails = 0;
  /** Copies of recent screen frames (newest last), and how many of them the output is behind (see inStep). */
  private held: HeldFrame[] = [];
  private spare: HeldFrame[] = [];
  private lag = 0;
  private lagAt = -Infinity;
  private lastOut = -Infinity;
  private shotAt = 0;
  /** A new picture, fitted on the next look. */
  private freshShot: PageShot | null = null;
  private shotPending = false;
  private shotAsked = -Infinity;
  private shotFails = 0;
  /** How far the last page picture was from its estimated place. */
  private lastFit: { dx: number; dy: number } | null = null;
  /** Small canvases read on the CPU (the frame and the page picture around the bar, the fill). */
  private readers: Record<'frame' | 'shot' | 'fill', OffscreenCanvas | null> = { frame: null, shot: null, fill: null };
  private fillAt = -Infinity;
  private fillPlace: BarRect | null = null;

  /** Sets how the recorder takes pictures of the page in front (screen / window recordings). */
  setPageShooter(fn: ((fw: number, fh: number) => Promise<PageShot | null>) | null): void {
    this.pageShooter = fn;
  }

  private reader(key: 'frame' | 'shot' | 'fill', w: number, h: number): OffscreenCanvasRenderingContext2D {
    let c = this.readers[key];
    if (!c || c.width !== w || c.height !== h) c = this.readers[key] = new OffscreenCanvas(w, h);
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, h);
    return ctx;
  }

  /** The page picture drawn over `area` grown by `slack`, read back. */
  private shotPixels(s: PageShot, area: BarRect, slack: number): Uint8ClampedArray {
    const c = this.reader('shot', area.w + slack * 2, area.h + slack * 2);
    c.setTransform(s.scale, 0, 0, s.scale, s.x - (area.x - slack), s.y - (area.y - slack));
    const img = s.picture();
    if (img) c.drawImage(img, 0, 0);
    return c.getImageData(0, 0, area.w + slack * 2, area.h + slack * 2).data;
  }

  /**
   * A few times a second, while the bar shows: fits a new page picture by its pixels (or checks that
   * the one in use still matches the frame around the bar), and asks for a new one when needed.
   */
  private checkShot(frame: VideoFrame, bar: BarRect, fw: number, fh: number, now: number): void {
    const x = Math.max(0, Math.floor(bar.x - 16));
    const y = Math.max(0, Math.floor(bar.y - 16));
    const area = { x, y, w: Math.min(fw, Math.ceil(bar.x + bar.w + 16)) - x, h: Math.min(fh, Math.ceil(bar.y + bar.h + 16)) - y };
    if (area.w > 0 && area.h > 0 && (this.freshShot || this.shot)) {
      const fc = this.reader('frame', area.w, area.h);
      fc.drawImage(frame, area.x, area.y, area.w, area.h, 0, 0, area.w, area.h);
      const fpx = fc.getImageData(0, 0, area.w, area.h).data;
      const fresh = this.freshShot;
      this.freshShot = null;
      if (fresh) {
        const slack = 20;
        const spx = this.shotPixels(fresh, area, slack);
        // The window rarely moves: the last offset first, the full search only when it no longer fits.
        const last = this.lastFit;
        const again = last && Math.abs(last.dx) <= slack && Math.abs(last.dy) <= slack ? shotMismatch(fpx, spx, area, bar, slack, last.dx, last.dy) : Infinity;
        const fit = last && again <= SHOT_FITS ? { ...last, mismatch: again } : alignShot(fpx, spx, area, bar, slack);
        // A live page off by a little scrolling (the two videos a frame or two apart) is still the
        // right page in the right place: kept at the last offset.
        const lagging = fit.mismatch > SHOT_FITS && fresh.live && this.scrolledFit(fresh, fpx, area, bar, last ?? { dx: 0, dy: 0 });
        if (fit.mismatch <= SHOT_FITS || lagging) {
          const off = lagging ? last ?? { dx: 0, dy: 0 } : { dx: fit.dx, dy: fit.dy };
          this.lastFit = off;
          this.shot?.release();
          this.shot = { ...fresh, x: fresh.x + off.dx, y: fresh.y + off.dy, view: { ...fresh.view, x: fresh.view.x + off.dx, y: fresh.view.y + off.dy } };
          this.shotOk = true;
          this.shotMisses = 0;
          this.shotAt = now;
          if (fresh.live) this.liveFitFails = 0;
        } else {
          // A live page that never lines up (Chrome scaled it, another window over it): still pictures instead.
          if (fresh.live && ++this.liveFitFails >= LIVE_FIT_FAILS) {
            logger.info('live page does not line up with the recording; using still pictures');
            fresh.reject?.();
            this.liveFitFails = 0;
            if (this.shot?.live) { this.shot = null; this.shotOk = false; }
          }
          fresh.release();
        }
      }
      if (this.shot && (!fresh || this.shotAt !== now)) {
        const fits = shotMismatch(fpx, this.shotPixels(this.shot, area, 0), area, bar, 0, 0, 0) <= SHOT_FITS || (this.shot.live && this.scrolledFit(this.shot, fpx, area, bar, { dx: 0, dy: 0 }));
        this.shotMisses = fits ? 0 : this.shotMisses + 1;
        // The live page and the recording are a frame or two apart, so while the page scrolls they
        // differ a little; that is no reason to drop it. Only a lasting mismatch (the window moved,
        // another app in front) is.
        this.shotOk = fits || (this.shot.live && this.shotMisses < LIVE_MISSES);
      }
    }
    // A new picture: none yet, the last one no longer matches (scrolled, another page), or it is a
    // second old (what is under the bar may have changed). Chrome allows two still pictures a second;
    // the live page only needs placing again (another tab, the window moved).
    const wait = this.shotFails >= 3 ? 5000 : 600;
    if (this.pageShooter && !this.shotPending && now - this.shotAsked >= wait && (!this.shot || !this.shotOk || now - this.shotAt > 1000)) {
      this.shotPending = true;
      this.shotAsked = now;
      this.pageShooter(fw, fh).then((s) => {
        this.shotFails = s ? 0 : this.shotFails + 1;
        if (!this.running || !s) return s?.release();
        this.freshShot?.release();
        this.freshShot = s;
      }, () => { this.shotFails++; }).finally(() => { this.shotPending = false; });
    }
  }

  /**
   * The live page `s`, at offset `at` from its place, matches the frame once its content is moved up or
   * down a little: the same page, one of the two videos a frame or two behind while it scrolls.
   */
  private scrolledFit(s: PageShot, fpx: Uint8ClampedArray, area: BarRect, bar: BarRect, at: { dx: number; dy: number }): boolean {
    const slack = 48;
    const spx = this.shotPixels({ ...s, x: s.x + at.dx, y: s.y + at.dy }, area, slack);
    for (let dy = -slack; dy <= slack; dy += 2) {
      if (shotMismatch(fpx, spx, area, bar, slack, 0, dy, 4) <= SHOT_FITS) return true;
    }
    return false;
  }

  /** Fills the bar from its surroundings (no page picture for it): worked out at most every 50 ms. */
  private fillBar(frame: VideoFrame, ctx: OffscreenCanvasRenderingContext2D, bar: BarRect, fw: number, fh: number, now: number): void {
    const x = Math.max(0, Math.floor(bar.x - 4));
    const y = Math.max(0, Math.floor(bar.y - 4));
    const w = Math.min(fw, Math.ceil(bar.x + bar.w + 4)) - x;
    const h = Math.min(fh, Math.ceil(bar.y + bar.h + 4)) - y;
    if (w <= 0 || h <= 0) return;
    // Worked out on a half-size copy for big frames (the fill is smooth; that keeps it cheap).
    const q = fw > 1400 ? 0.5 : 1;
    const sw = Math.max(1, Math.round(w * q));
    const sh = Math.max(1, Math.round(h * q));
    const inner = { x: (bar.x - x) * q, y: (bar.y - y) * q, w: bar.w * q, h: bar.h * q };
    const same = this.fillPlace && this.fillPlace.x === x && this.fillPlace.y === y && this.fillPlace.w === w && this.fillPlace.h === h;
    if (!same || now - this.fillAt >= 50) {
      const c = this.reader('fill', sw, sh);
      c.drawImage(frame, x, y, w, h, 0, 0, sw, sh);
      const img = c.getImageData(0, 0, sw, sh);
      fillFromEdges(img.data, sw, sh, inner);
      c.putImageData(img, 0, 0);
      this.fillAt = now;
      this.fillPlace = { x, y, w, h };
    }
    const fill = this.readers.fill;
    if (!fill) return;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(fill, Math.max(0, Math.floor(inner.x)), Math.max(0, Math.floor(inner.y)), Math.max(1, Math.floor(inner.w)), Math.max(1, Math.floor(inner.h)),
      x + Math.floor(inner.x) / q, y + Math.floor(inner.y) / q, Math.floor(inner.w) / q, Math.floor(inner.h) / q);
  }

  /**
   * The frame with Chrome's sharing bar taken out, or null when there is no bar in it: the real page
   * under it where Chrome gives Pixora a picture of that page, otherwise filled from around it.
   */
  private cleaned(frame: VideoFrame): OffscreenCanvas | null {
    if (!this.shareBar) return null;
    const fw = frame.displayWidth;
    const fh = frame.displayHeight;
    const now = performance.now();
    let looked: boolean;
    try {
      looked = this.shareBar.update(frame, fw, fh, now);
    } catch (err) {
      logger.warn('sharing bar check failed', err);
      return null;
    }
    const bar = this.shareBar.rect;
    if (!bar) {
      if (this.shot) { this.shot.release(); this.shot = null; this.shotOk = false; }
      return null;
    }
    if (!this.cleanCanvas || this.cleanCanvas.width !== fw || this.cleanCanvas.height !== fh) {
      this.cleanCanvas = new OffscreenCanvas(fw, fh);
      this.cleanCtx = this.cleanCanvas.getContext('2d', { alpha: false, desynchronized: true });
    }
    const ctx = this.cleanCtx!;
    ctx.drawImage(frame, 0, 0, fw, fh);
    try {
      if (looked) this.checkShot(frame, bar, fw, fh, now);
      const img = this.shotOk ? this.shot?.picture() ?? null : null;
      const s = img ? this.shot : null;
      const v = s?.view;
      const covered = v && v.x <= bar.x && v.y <= bar.y && v.x + v.w >= bar.x + bar.w && v.y + v.h >= bar.y + bar.h;
      if (!covered) this.fillBar(frame, ctx, bar, fw, fh, now);
      if (s && v) {
        // The page's real pixels under the bar (where the page reaches).
        const x0 = Math.max(bar.x, v.x);
        const y0 = Math.max(bar.y, v.y);
        const x1 = Math.min(bar.x + bar.w, v.x + v.w);
        const y1 = Math.min(bar.y + bar.h, v.y + v.h);
        if (img && x1 > x0 && y1 > y0) ctx.drawImage(img,(x0 - s.x) / s.scale, (y0 - s.y) / s.scale, (x1 - x0) / s.scale, (y1 - y0) / s.scale, x0, y0, x1 - x0, y1 - y0);
      }
    } catch (err) {
      logger.warn('sharing bar removal failed', err);
    }
    return this.cleanCanvas;
  }

  start(): void {
    const processor = new MediaStreamTrackProcessor({ track: this.source as MediaStreamVideoTrack, maxBufferSize: 2 });
    this.sourceReader = processor.readable.getReader();
    if (this.options.camera) {
      const camProcessor = new MediaStreamTrackProcessor({ track: this.options.camera.track as MediaStreamVideoTrack, maxBufferSize: 1 });
      this.cameraReader = camProcessor.readable.getReader();
      void this.pumpCamera();
    }
    void this.pumpSource();
  }

  setCameraVisible(visible: boolean): void {
    this.cameraVisible = visible && this.options.camera !== null;
  }

  setCrop(crop: RelativeRect | null): void {
    this.crop = crop;
  }

  /** Waits for the first output frame so the actual output size is known. */
  async waitForFirstFrame(timeoutMs = 4000): Promise<void> {
    const start = performance.now();
    while (this.outputWidth === 0 && performance.now() - start < timeoutMs && this.running) {
      await new Promise((r) => setTimeout(r, 30));
    }
  }

  private async pumpCamera(): Promise<void> {
    const reader = this.cameraReader;
    if (!reader) return;
    try {
      while (this.running) {
        const { value, done } = await reader.read();
        if (done || !value) break;
        this.latestCamera?.close();
        this.latestCamera = value;
      }
    } catch (err) {
      logger.warn('camera pump stopped', err);
    }
  }

  private async pumpSource(): Promise<void> {
    const reader = this.sourceReader;
    if (!reader) return;
    try {
      while (this.running) {
        const { value: frame, done } = await reader.read();
        if (done || !frame) break;
        const t0 = performance.now();
        for (const f of this.inStep(frame)) {
          let out: VideoFrame | null = null;
          try {
            out = this.process(f);
          } catch (err) {
            logger.warn('frame processing failed', err);
          } finally {
            f.close();
          }
          if (out) {
            this.countFrame();
            await this.writer.write(out).catch(() => out?.close());
          }
        }
        this.measure(performance.now() - t0);
      }
    } catch (err) {
      logger.warn('source pump stopped', err);
    }
  }

  /**
   * The screen frames to process now (each to be closed by the caller). While a live page fills in for
   * Chrome's sharing bar, the screen is held back by as many frames as the live page runs behind it
   * (Chrome delivers the tab's video a frame or two later): otherwise, while the page scrolls, what
   * is drawn under the bar is a moment old and visibly off from the page around it.
   */
  private inStep(frame: VideoFrame): VideoFrame[] {
    const keep = this.shot?.live && this.shotOk ? MAX_LAG + 1 : 1;
    if (keep === 1) {
      // Nothing to wait for: straight through, nothing kept open (Chrome's capture has few frames to lend).
      this.lag = 0;
      this.spare.push(...this.held);
      this.held = [];
      this.lastOut = frame.timestamp;
      return [frame];
    }
    // Kept as copies of our own: Chrome's capture lends only a few frames and stalls when they are kept.
    const slot = this.spare.pop() ?? { canvas: new OffscreenCanvas(frame.displayWidth, frame.displayHeight), timestamp: 0, duration: null };
    if (slot.canvas.width !== frame.displayWidth || slot.canvas.height !== frame.displayHeight) {
      slot.canvas.width = frame.displayWidth;
      slot.canvas.height = frame.displayHeight;
    }
    slot.canvas.getContext('2d', { alpha: false })!.drawImage(frame, 0, 0);
    slot.timestamp = frame.timestamp;
    slot.duration = frame.duration;
    frame.close();
    this.held.push(slot);
    const now = performance.now();
    if (now - this.lagAt >= 250) {
      this.lagAt = now;
      try {
        this.measureLag();
      } catch (err) {
        logger.warn('live page delay check failed', err);
      }
    }
    const pick = this.held[Math.max(0, this.held.length - 1 - this.lag)]!;
    const out: VideoFrame[] = [];
    // Never back in time: after the delay grows, frames wait until they are newer than the last one sent
    // (a source whose clock starts over always goes on).
    if (pick.timestamp > this.lastOut || this.lastOut - pick.timestamp > 1_000_000) {
      out.push(new VideoFrame(pick.canvas, { timestamp: pick.timestamp, ...(pick.duration ? { duration: pick.duration } : {}) }));
      this.lastOut = pick.timestamp;
    }
    while (this.held.length > keep) this.spare.push(this.held.shift()!);
    return out;
  }

  /**
   * How many frames the live page runs behind the screen: the held frame whose surroundings of the bar
   * match the newest live picture best. Only while the page moves (a still page matches them all).
   */
  private measureLag(): void {
    const bar = this.shareBar?.rect;
    const s = this.shot;
    const newest = this.held[this.held.length - 1];
    if (!bar || !s || !newest || this.held.length < 2) return;
    const fw = newest.canvas.width;
    const fh = newest.canvas.height;
    const x = Math.max(0, Math.floor(bar.x - 16));
    const y = Math.max(0, Math.floor(bar.y - 16));
    const area = { x, y, w: Math.min(fw, Math.ceil(bar.x + bar.w + 16)) - x, h: Math.min(fh, Math.ceil(bar.y + bar.h + 16)) - y };
    if (area.w <= 0 || area.h <= 0) return;
    const spx = this.shotPixels(s, area, 0);
    const scores: number[] = [];
    for (let i = 0; i < this.held.length; i++) {
      const f = this.held[this.held.length - 1 - i]!;
      if (f.canvas.width !== fw || f.canvas.height !== fh) break;
      const c = this.reader('frame', area.w, area.h);
      c.drawImage(f.canvas, area.x, area.y, area.w, area.h, 0, 0, area.w, area.h);
      scores.push(shotMismatch(c.getImageData(0, 0, area.w, area.h).data, spx, area, bar, 0, 0, 0, 2));
    }
    if (scores.length < 2) return;
    let best = 0;
    for (let i = 1; i < scores.length; i++) if (scores[i]! < scores[best]!) best = i;
    const spread = Math.max(...scores) - scores[best]!;
    if (spread >= 4 && scores[best]! <= SHOT_FITS * 1.5) this.lag = best;
  }

  private measure(ms: number): void {
    const budget = 1000 / Math.max(1, this.options.fps ?? 30);
    this.load.frames++;
    this.load.totalMs += ms;
    if (ms > budget) this.load.slow++;
  }

  /** How hard the computer worked: share of frames that took longer than one frame's time. */
  loadStats(): { frames: number; slowShare: number; avgMs: number; budgetMs: number } {
    const { frames, slow, totalMs } = this.load;
    return { frames, slowShare: frames ? slow / frames : 0, avgMs: frames ? totalMs / frames : 0, budgetMs: 1000 / Math.max(1, this.options.fps ?? 30) };
  }

  private countFrame(): void {
    this.frameCount++;
    const now = performance.now();
    if (now - this.fpsWindowStart >= 1000) {
      this.measuredFps = Math.round((this.frameCount * 1000) / (now - this.fpsWindowStart));
      this.frameCount = 0;
      this.fpsWindowStart = now;
    }
  }

  /**
   * The recording keeps the size of its first frame. A source that changes size while recording (a
   * window or tab going full screen, a resized window) is scaled to fit inside it, centred: the encoder
   * would otherwise cut off what is outside the first size (the bottom of a full-screen window) or
   * stop recording altogether.
   */
  private locked: { w: number; h: number } | null = null;
  private fitCanvas: OffscreenCanvas | null = null;
  private fitCtx: OffscreenCanvasRenderingContext2D | null = null;

  private process(frame: VideoFrame): VideoFrame {
    const out = this.compose(frame);
    const w = this.outputWidth;
    const h = this.outputHeight;
    if (!this.locked) this.locked = { w, h };
    const L = this.locked;
    if (w === L.w && h === L.h) return out;
    // Size changed: fit the frame into the first size (black around it).
    if (!this.fitCanvas || this.fitCanvas.width !== L.w || this.fitCanvas.height !== L.h) {
      this.fitCanvas = new OffscreenCanvas(L.w, L.h);
      this.fitCtx = this.fitCanvas.getContext('2d', { alpha: false, desynchronized: true });
    }
    const ctx = this.fitCtx!;
    const k = Math.min(L.w / w, L.h / h);
    const dw = Math.round(w * k);
    const dh = Math.round(h * k);
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, L.w, L.h);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(out, Math.round((L.w - dw) / 2), Math.round((L.h - dh) / 2), dw, dh);
    const fitted = new VideoFrame(this.fitCanvas, { timestamp: frame.timestamp, ...(frame.duration ? { duration: frame.duration } : {}) });
    if (out !== frame) out.close();
    this.outputWidth = L.w;
    this.outputHeight = L.h;
    return fitted;
  }

  private compose(frame: VideoFrame): VideoFrame {
    const fw = frame.displayWidth;
    const fh = frame.displayHeight;
    const rect = this.crop ? cropToPixels(this.crop, fw, fh) : { x: 0, y: 0, width: fw, height: fh };
    const camera = this.cameraVisible && this.latestCamera ? this.latestCamera : null;
    const effects = this.options.effects ?? null;
    const now = performance.now();
    const fxActive = effects?.active(now) ?? false;
    // Chrome's sharing bar painted out (screen / window recordings), when it is in the frame.
    const clean = this.cleaned(frame);
    const stamp = { timestamp: frame.timestamp, ...(frame.duration ? { duration: frame.duration } : {}) };

    if (!camera && !fxActive && (!clean || !this.crop)) {
      this.outputWidth = rect.width;
      this.outputHeight = rect.height;
      if (clean) return new VideoFrame(clean, stamp);
      if (!this.crop) return frame.clone();
      // Zero-copy crop. visibleRect is expressed in coded pixels; tab frames have coded == display size.
      const sx = frame.codedWidth / fw;
      const sy = frame.codedHeight / fh;
      const even = (n: number) => Math.floor(n / 2) * 2;
      const vw = even(rect.width * sx);
      const vh = even(rect.height * sy);
      // Display size = the cropped pixels exactly (an odd width shown at the old size was stretched by a pixel).
      this.outputWidth = Math.round(vw / sx);
      this.outputHeight = Math.round(vh / sy);
      return new VideoFrame(frame, {
        visibleRect: { x: even(rect.x * sx), y: even(rect.y * sy), width: vw, height: vh },
        displayWidth: this.outputWidth,
        displayHeight: this.outputHeight,
      });
    }

    if (!this.canvas || this.canvas.width !== rect.width || this.canvas.height !== rect.height) {
      this.canvas = new OffscreenCanvas(rect.width, rect.height);
      this.ctx = this.canvas.getContext('2d', { alpha: false, desynchronized: true });
    }
    const ctx = this.ctx!;
    const crop = { x: rect.x, y: rect.y, w: rect.width, h: rect.height };
    const view = effects ? effects.view(crop, fw, fh, now) : crop;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(clean ?? frame, view.x, view.y, view.w, view.h, 0, 0, rect.width, rect.height);
    effects?.drawOverlays(ctx, rect.width, rect.height, view, fw, fh);
    if (camera) {
      const cam = this.options.camera!;
      const style = effects?.camera ?? null;
      const aspect = camera.displayWidth / camera.displayHeight;
      if (style) {
        drawCameraOverlay(ctx, camera, camera.displayWidth, camera.displayHeight, cameraRect(style, rect.width, rect.height, aspect), style.shape, {
          opacity: style.opacity,
          borderWidth: style.borderWidth * (Math.min(rect.width, rect.height) / 1080),
          borderColor: style.borderColor,
          mirror: style.mirror,
        });
      } else {
        drawCameraOverlay(ctx, camera, camera.displayWidth, camera.displayHeight, computeCameraRect(rect.width, rect.height, aspect, cam.position, cam.size, cam.shape), cam.shape);
      }
    }
    this.outputWidth = rect.width;
    this.outputHeight = rect.height;
    return new VideoFrame(this.canvas, { timestamp: frame.timestamp, ...(frame.duration ? { duration: frame.duration } : {}) });
  }

  stop(): void {
    this.running = false;
    void this.sourceReader?.cancel().catch(() => undefined);
    void this.cameraReader?.cancel().catch(() => undefined);
    this.latestCamera?.close();
    this.shot?.release();
    this.freshShot?.release();
    this.shot = this.freshShot = null;
    this.held = [];
    this.spare = [];
    this.latestCamera = null;
    void this.writer.close().catch(() => undefined);
    this.generator.stop();
  }
}
