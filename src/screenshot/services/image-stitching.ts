import { MAX_CANVAS_AREA, MAX_CANVAS_DIMENSION } from '@/shared/constants/media';
import type { PixelRect } from '@/shared/types';

export interface StitchPlan {
  /** Scroll positions (CSS px) to visit, in order. */
  positions: number[];
  /** Height (CSS px) that will be captured (may be truncated to maxHeight). */
  captureHeight: number;
  truncated: boolean;
}

/**
 * Plans the scroll positions for a full-page capture. Each step advances one viewport; the last
 * step is clamped to the bottom so no blank area is captured. Overlap with the previous frame is
 * handled at draw time by placing each frame at its *actual* scroll offset.
 */
export function planFullPageCapture(totalHeight: number, viewportHeight: number, maxHeight: number): StitchPlan {
  const vh = Math.max(1, Math.floor(viewportHeight));
  const captureHeight = Math.max(vh, Math.min(Math.ceil(totalHeight), Math.floor(maxHeight)));
  const truncated = totalHeight > maxHeight;
  const positions: number[] = [];
  for (let y = 0; y < captureHeight; y += vh) {
    positions.push(Math.min(y, Math.max(0, captureHeight - vh)));
  }
  // Deduplicate (clamping can produce the same position twice).
  const unique = positions.filter((p, i) => i === 0 || p !== positions[i - 1]);
  return { positions: unique, captureHeight, truncated };
}

/**
 * A page that scrolls a full-width inner box under a fixed header / above a fixed footer: the CSS
 * heights of the strips above and below the box, which the image takes once (from the first and the
 * last screen). Zero for normal pages and for boxes with side bars next to them.
 */
export function pageBands(m: {
  usesInnerScroller: boolean;
  viewportWidth: number;
  viewportHeight: number;
  clip: { x: number; y: number; width: number; height: number };
}): { top: number; bottom: number } {
  const { clip } = m;
  if (!m.usesInnerScroller) return { top: 0, bottom: 0 };
  const fullWidth = clip.x <= 4 && clip.x + clip.width >= m.viewportWidth - 24;
  if (!fullWidth) return { top: 0, bottom: 0 };
  return {
    top: Math.max(0, Math.round(clip.y)),
    bottom: Math.max(0, Math.round(m.viewportHeight - (clip.y + clip.height))),
  };
}

/**
 * Adds the strip above the scrolled box (from the first screen) and below it (from the last screen)
 * to a stitched image of the box, at the same scale.
 */
export function addBands(
  content: OffscreenCanvas,
  m: { viewportWidth: number; clip: { x: number; y: number; width: number; height: number } },
  topFrame: ImageBitmap | null,
  bottomFrame: ImageBitmap | null,
  top: number,
  bottom: number,
): OffscreenCanvas {
  const px = content.width / m.clip.width;
  const topPx = topFrame ? Math.round(top * px) : 0;
  const bottomPx = bottomFrame ? Math.round(bottom * px) : 0;
  const out = new OffscreenCanvas(content.width, content.height + topPx + bottomPx);
  const ctx = out.getContext('2d');
  if (!ctx) throw new Error('2D context unavailable');
  ctx.imageSmoothingQuality = 'high';
  const strip = (bmp: ImageBitmap, cssY: number, cssH: number, destY: number, destH: number) => {
    const ratio = bmp.width / m.viewportWidth;
    ctx.drawImage(bmp, Math.round(m.clip.x * ratio), Math.round(cssY * ratio), Math.round(m.clip.width * ratio), Math.round(cssH * ratio), 0, destY, out.width, destH);
  };
  if (topFrame && topPx) strip(topFrame, m.clip.y - top, top, 0, topPx);
  ctx.drawImage(content, 0, topPx);
  if (bottomFrame && bottomPx) strip(bottomFrame, m.clip.y + m.clip.height, bottom, topPx + content.height, bottomPx);
  return out;
}

/** Largest part of a split full-page capture, in device pixels (tall images get slow to edit). */
export const PART_MAX_PX = 24_000;

/**
 * How many screens go into one image of a split full-page capture, so each part stays at full
 * resolution within Chrome's canvas limits (height, area) and {@link PART_MAX_PX}.
 */
export function framesPerPart(viewportCss: number, widthCss: number, pxPerCss: number): number {
  const widthPx = Math.max(1, widthCss * pxPerCss);
  const maxPx = Math.min(MAX_CANVAS_DIMENSION, PART_MAX_PX, Math.floor(MAX_CANVAS_AREA / widthPx));
  return Math.max(1, Math.floor(maxPx / Math.max(1, viewportCss * pxPerCss)));
}

/**
 * Output scale so the stitched canvas stays within Chrome's canvas limits. 1 = native device pixels.
 */
export function computeOutputScale(widthPx: number, heightPx: number): number {
  let scale = 1;
  if (heightPx > MAX_CANVAS_DIMENSION) scale = Math.min(scale, MAX_CANVAS_DIMENSION / heightPx);
  if (widthPx > MAX_CANVAS_DIMENSION) scale = Math.min(scale, MAX_CANVAS_DIMENSION / widthPx);
  const area = widthPx * heightPx * scale * scale;
  if (area > MAX_CANVAS_AREA) scale *= Math.sqrt(MAX_CANVAS_AREA / area);
  return scale;
}

export interface CapturedFrame {
  bitmap: ImageBitmap;
  /** Actual scroll position (CSS px) when the frame was taken. */
  scrollTop: number;
}

export interface StitchInput {
  frames: CapturedFrame[];
  /** The scrolling region inside each viewport screenshot, CSS px. */
  clip: PixelRect;
  viewportWidth: number;
  captureHeight: number;
  /** Extra scale requested by the user (1 = device pixels, 1/dpr = CSS pixels). */
  userScale: number;
}

/** Destination rectangles for each frame — pure, so it is unit-testable. */
export function computeFrameDestinations(
  frames: Array<{ scrollTop: number; imageWidth: number }>,
  clip: PixelRect,
  viewportWidth: number,
  captureHeight: number,
): Array<{ src: PixelRect; destY: number; destHeight: number }> {
  const first = frames[0]?.scrollTop ?? 0;
  return frames.map((f) => {
    const ratio = f.imageWidth / viewportWidth; // device pixels per CSS px
    const offset = f.scrollTop - first;
    const visible = Math.max(0, Math.min(clip.height, captureHeight - offset));
    return {
      src: { x: clip.x * ratio, y: clip.y * ratio, width: clip.width * ratio, height: visible * ratio },
      destY: offset,
      destHeight: visible,
    };
  });
}

/** Draws captured frames into one image. Works in the service worker (OffscreenCanvas). */
export async function stitchFrames(input: StitchInput): Promise<{ canvas: OffscreenCanvas; scaled: boolean }> {
  const firstFrame = input.frames[0];
  if (!firstFrame) throw new Error('No frames to stitch');
  const ratio = firstFrame.bitmap.width / input.viewportWidth;
  const nativeW = input.clip.width * ratio * input.userScale;
  const nativeH = input.captureHeight * ratio * input.userScale;
  const limitScale = computeOutputScale(nativeW, nativeH);
  const pxPerCss = ratio * input.userScale * limitScale;
  const canvas = new OffscreenCanvas(Math.max(1, Math.round(input.clip.width * pxPerCss)), Math.max(1, Math.round(input.captureHeight * pxPerCss)));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D context unavailable');
  ctx.imageSmoothingQuality = 'high';
  const dests = computeFrameDestinations(
    input.frames.map((f) => ({ scrollTop: f.scrollTop, imageWidth: f.bitmap.width })),
    input.clip,
    input.viewportWidth,
    input.captureHeight,
  );
  input.frames.forEach((frame, i) => {
    const d = dests[i]!;
    if (d.destHeight <= 0) return;
    // Integer rows on both sides so fractional device-pixel ratios (e.g. 125%) never leave seams.
    const top = Math.round(d.destY * pxPerCss);
    const bottom = Math.min(canvas.height, Math.round((d.destY + d.destHeight) * pxPerCss));
    const sx = Math.round(d.src.x);
    const sy = Math.round(d.src.y);
    const sw = Math.min(frame.bitmap.width - sx, Math.round(d.src.width));
    const sh = Math.min(frame.bitmap.height - sy, Math.round(d.src.height));
    if (bottom <= top || sw <= 0 || sh <= 0) return;
    if (pxPerCss === ratio) {
      // Full resolution: copy the pixels 1:1 (a slot a pixel taller or shorter than the strip,
      // from rounding at fractional display scales, would stretch the whole strip).
      // Copy exactly the rows of this strip's slot (from the frame itself), so no empty row is left
      // between strips (an empty row showed as a dark line).
      const w = Math.min(sw, canvas.width);
      const rows = Math.min(frame.bitmap.height - sy, bottom - top);
      if (rows >= bottom - top - 0) {
        ctx.drawImage(frame.bitmap, sx, sy, w, rows, 0, top, w, rows);
        return;
      }
      // The frame ends a row early (rounding): fill the slot from what it has.
      ctx.drawImage(frame.bitmap, sx, sy, w, rows, 0, top, w, bottom - top);
      return;
    }
    ctx.drawImage(frame.bitmap, sx, sy, sw, sh, 0, top, canvas.width, bottom - top);
  });
  return { canvas, scaled: limitScale < 1 };
}

/** Crops a region (CSS px relative to the viewport) out of a viewport screenshot. */
export async function cropBitmap(bitmap: ImageBitmap, rect: PixelRect, viewportWidth: number, userScale: number): Promise<OffscreenCanvas> {
  const ratio = bitmap.width / viewportWidth;
  const sx = Math.max(0, Math.round(rect.x * ratio));
  const sy = Math.max(0, Math.round(rect.y * ratio));
  const sw = Math.max(1, Math.min(bitmap.width - sx, Math.round(rect.width * ratio)));
  const sh = Math.max(1, Math.min(bitmap.height - sy, Math.round(rect.height * ratio)));
  const canvas = new OffscreenCanvas(Math.max(1, Math.round(sw * userScale)), Math.max(1, Math.round(sh * userScale)));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D context unavailable');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  return canvas;
}

export function scaleBitmap(bitmap: ImageBitmap, userScale: number): OffscreenCanvas {
  const canvas = new OffscreenCanvas(Math.max(1, Math.round(bitmap.width * userScale)), Math.max(1, Math.round(bitmap.height * userScale)));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D context unavailable');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas;
}
