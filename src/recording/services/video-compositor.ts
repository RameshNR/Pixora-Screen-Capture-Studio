import type { CameraShape, CameraSize, CornerPosition, RelativeRect } from '@/shared/types';
import { computeCameraRect, cropToPixels, drawCameraOverlay } from './camera-service';
import { cameraRect, type LiveEffects } from './live-effects';
import { logger } from '@/shared/utils/logger';

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
        let out: VideoFrame | null = null;
        const t0 = performance.now();
        try {
          out = this.process(frame);
        } catch (err) {
          logger.warn('frame processing failed', err);
        } finally {
          frame.close();
        }
        if (out) {
          this.countFrame();
          await this.writer.write(out).catch(() => out?.close());
        }
        this.measure(performance.now() - t0);
      }
    } catch (err) {
      logger.warn('source pump stopped', err);
    }
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

  private process(frame: VideoFrame): VideoFrame {
    const fw = frame.displayWidth;
    const fh = frame.displayHeight;
    const rect = this.crop ? cropToPixels(this.crop, fw, fh) : { x: 0, y: 0, width: fw, height: fh };
    const camera = this.cameraVisible && this.latestCamera ? this.latestCamera : null;
    const effects = this.options.effects ?? null;
    const now = performance.now();
    const fxActive = effects?.active(now) ?? false;

    if (!camera && !fxActive) {
      this.outputWidth = rect.width;
      this.outputHeight = rect.height;
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
    ctx.drawImage(frame, view.x, view.y, view.w, view.h, 0, 0, rect.width, rect.height);
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
    this.latestCamera = null;
    void this.writer.close().catch(() => undefined);
    this.generator.stop();
  }
}
