import type { Annotation, Rect, RedactAnnotation } from '../types';
import { getBounds, renderAnnotation } from './annotations';
import { rectsIntersect, type Ctx2D } from './common';

/**
 * Annotations are drawn in layer order, and a blur or pixelate region works on everything beneath
 * it: the image and the annotations on lower layers.
 */
export const isRedaction = (a: Annotation): a is RedactAnnotation => a.type === 'blur' || a.type === 'pixelate';

/** What the region reads, including the margin its filter looks at. */
function reachOf(a: RedactAnnotation, width: number, height: number): Rect {
  if (a.invert) return { x: 0, y: 0, w: width, h: height };
  const m = Math.ceil(Math.max(1, a.intensity) * 3);
  return { x: a.x - m, y: a.y - m, w: a.w + m * 2, h: a.h + m * 2 };
}

interface Source { base: CanvasImageSource; below: readonly Annotation[]; canvas: OffscreenCanvas }
const sources = new Map<string, Source>();
const SOURCE_LIMIT = 8;

/** The picture under the region at `index`: the image alone when nothing below overlaps it. */
export function redactSource(base: ImageBitmap, width: number, height: number, list: readonly Annotation[], index: number): ImageBitmap | OffscreenCanvas {
  const a = list[index];
  if (!a || !isRedaction(a) || typeof OffscreenCanvas === 'undefined') return base;
  const reach = reachOf(a, width, height);
  const below = list.slice(0, index).filter((x) => !x.hidden && rectsIntersect(getBounds(x), reach));
  if (!below.length) return base;
  const known = sources.get(a.id);
  // The same picture again: the region's blurred result stays cached.
  if (known && known.base === base && known.below.length === below.length && known.below.every((x, i) => x === below[i])) return known.canvas;
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d');
  if (!ctx) return base;
  ctx.drawImage(base, 0, 0);
  drawLayers(ctx, base, below, width, height);
  sources.delete(a.id);
  sources.set(a.id, { base, below, canvas });
  if (sources.size > SOURCE_LIMIT) sources.delete(sources.keys().next().value!);
  return canvas;
}

/** Draws the annotations from the lowest layer to the highest. */
export function drawLayers(ctx: Ctx2D, base: ImageBitmap, list: readonly Annotation[], width: number, height: number): void {
  list.forEach((a, i) => renderAnnotation(ctx, (isRedaction(a) ? redactSource(base, width, height, list, i) : base) as ImageBitmap, a));
}
