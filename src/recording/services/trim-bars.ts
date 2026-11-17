/**
 * Letterbox bars: a video often has solid black bands around the picture (the recorded tab or
 * window had another shape than the video). Frames taken from the video drop them.
 */

/** Pixel rows/columns to cut from each side: bands that are (almost) pure black all the way across. */
export function findBars(data: Uint8ClampedArray, width: number, height: number, threshold = 18): { top: number; right: number; bottom: number; left: number } {
  const dark = (i: number) => data[i]! <= threshold && data[i + 1]! <= threshold && data[i + 2]! <= threshold;
  const stepX = Math.max(1, Math.floor(width / 200));
  const stepY = Math.max(1, Math.floor(height / 200));
  const rowDark = (y: number) => {
    for (let x = 0; x < width; x += stepX) if (!dark((y * width + x) * 4)) return false;
    return true;
  };
  const colDark = (x: number, y0: number, y1: number) => {
    for (let y = y0; y < y1; y += stepY) if (!dark((y * width + x) * 4)) return false;
    return true;
  };
  let top = 0;
  while (top < height && rowDark(top)) top++;
  if (top >= height) return { top: 0, right: 0, bottom: 0, left: 0 }; // an all-black frame stays as it is
  let bottom = 0;
  while (bottom < height - top && rowDark(height - 1 - bottom)) bottom++;
  let left = 0;
  while (left < width && colDark(left, top, height - bottom)) left++;
  let right = 0;
  while (right < width - left && colDark(width - 1 - right, top, height - bottom)) right++;
  // Only real bands (a dark edge of a few pixels is part of the picture).
  const min = (n: number, size: number) => (n >= Math.max(4, size * 0.01) ? n : 0);
  return { top: min(top, height), bottom: min(bottom, height), left: min(left, width), right: min(right, width) };
}

/**
 * A copy of the canvas without its black bars.
 *
 * The pixels are read from a fresh canvas made for reading (`willReadFrequently`), never from the
 * one passed in: that is the shared drawing canvas of applyRedactions (GPU-backed, also used per
 * frame by exports). Reading it back repeatedly is slow and makes Chrome log "Multiple readback
 * operations using getImageData are faster with the willReadFrequently attribute".
 */
export function trimBars(canvas: OffscreenCanvas): OffscreenCanvas {
  const { width, height } = canvas;
  const copy = new OffscreenCanvas(width, height);
  const ctx = copy.getContext('2d', { willReadFrequently: true });
  if (!ctx) return canvas;
  ctx.drawImage(canvas, 0, 0);
  const b = findBars(ctx.getImageData(0, 0, width, height).data, width, height);
  const w = width - b.left - b.right;
  const h = height - b.top - b.bottom;
  if ((w === width && h === height) || w < 16 || h < 16) return copy;
  const out = new OffscreenCanvas(w, h);
  out.getContext('2d')!.drawImage(copy, b.left, b.top, w, h, 0, 0, w, h);
  return out;
}
