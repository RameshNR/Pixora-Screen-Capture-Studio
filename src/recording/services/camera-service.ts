import type { CameraShape, CameraSize, CornerPosition, PixelRect, RelativeRect } from '@/shared/types';
import { CAMERA_OVERLAY_SCALE } from '@/shared/constants/media';

/** Where the picture-in-picture camera bubble goes inside an output frame. */
export function computeCameraRect(
  frameWidth: number,
  frameHeight: number,
  cameraAspect: number,
  position: CornerPosition,
  size: CameraSize,
  shape: CameraShape,
): PixelRect {
  const shorter = Math.min(frameWidth, frameHeight);
  const base = Math.round(shorter * CAMERA_OVERLAY_SCALE[size]);
  const width = shape === 'circle' ? base : Math.round(base * Math.max(1, Math.min(cameraAspect, 16 / 9)));
  const height = base;
  const margin = Math.round(shorter * 0.03);
  const x = position.endsWith('left') ? margin : frameWidth - width - margin;
  const y = position.startsWith('top') ? margin : frameHeight - height - margin;
  return { x, y, width, height };
}

/** Converts a relative crop rectangle to even-aligned pixels inside a frame (I420 requires even offsets). */
export function cropToPixels(rect: RelativeRect, frameWidth: number, frameHeight: number): PixelRect {
  const even = (n: number) => Math.max(0, Math.floor(n / 2) * 2);
  const x = even(rect.x * frameWidth);
  const y = even(rect.y * frameHeight);
  const width = Math.max(2, Math.min(even(rect.width * frameWidth), even(frameWidth - x)));
  const height = Math.max(2, Math.min(even(rect.height * frameHeight), even(frameHeight - y)));
  return { x, y, width, height };
}

export interface CameraDrawOptions {
  opacity?: number;
  borderWidth?: number;
  borderColor?: string;
  /** Mirror horizontally (what people expect from a selfie view). */
  mirror?: boolean;
}

function shapePath(ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D, rect: PixelRect, shape: CameraShape): void {
  const { x, y, width, height } = rect;
  ctx.beginPath();
  if (shape === 'circle') ctx.arc(x + width / 2, y + height / 2, Math.min(width, height) / 2, 0, Math.PI * 2);
  else if (shape === 'rounded') ctx.roundRect(x, y, width, height, Math.min(width, height) * 0.14);
  else ctx.rect(x, y, width, height);
  ctx.closePath();
}

/** Draws a camera frame into `ctx` with the configured shape, cropping the camera to cover the rect. */
export function drawCameraOverlay(
  ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D,
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  rect: PixelRect,
  shape: CameraShape,
  options: CameraDrawOptions = {},
): void {
  const { x, y, width, height } = rect;
  // "cover" crop of the camera image.
  const targetAspect = width / height;
  const srcAspect = sourceWidth / sourceHeight;
  let sw = sourceWidth;
  let sh = sourceHeight;
  if (srcAspect > targetAspect) sw = sourceHeight * targetAspect;
  else sh = sourceWidth / targetAspect;
  const sx = (sourceWidth - sw) / 2;
  const sy = (sourceHeight - sh) / 2;
  const opacity = Math.max(0, Math.min(1, options.opacity ?? 1));

  ctx.save();
  ctx.globalAlpha = opacity;
  shapePath(ctx, rect, shape);
  ctx.shadowColor = 'rgba(0,0,0,0.35)';
  ctx.shadowBlur = Math.max(4, width * 0.04);
  ctx.fillStyle = '#000';
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.clip();
  if (options.mirror) {
    ctx.translate(x * 2 + width, 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(source, sx, sy, sw, sh, x, y, width, height);
  ctx.restore();

  const border = options.borderWidth ?? Math.max(2, width * 0.015);
  if (border > 0) {
    ctx.save();
    ctx.globalAlpha = opacity;
    shapePath(ctx, rect, shape);
    ctx.lineWidth = border;
    ctx.strokeStyle = options.borderColor ?? 'rgba(255,255,255,0.9)';
    ctx.stroke();
    ctx.restore();
  }
}
