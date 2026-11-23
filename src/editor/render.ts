import type { Annotation, EditorDoc, Rect } from './types';
import { handlesFor, isRoundHandle, rotationOf, selectionPolygon } from './tools/annotations';
import { drawLayers } from './tools/layers';
import { leaderEndColorOf } from './tools/callouts';
import type { Ctx2D } from './tools/common';
import { clipImage, drawDeviceOver, drawFrameBackground, drawFrameOver, drawFrameUnder, drawWatermark, ensureFrameAssets, frameLayout } from './tools/decorations';
import { ensureFonts } from './fonts';
import { filteredBase } from './tools/filters';
import type { ImageFormat } from '@/shared/types';

export interface ViewTransform {
  zoom: number;
  /** Screen position (CSS px, relative to the canvas) of image point (0, 0). */
  originX: number;
  originY: number;
  dpr: number;
}

export interface SceneOverlay {
  selectedId: string | null;
  /** The selected annotation is in "Move only": no handles. */
  moveOnly?: boolean;
  /** Where the watermark can be dragged (shown while the Watermark tool is open). */
  watermarkBox?: Rect | null;
  /** Several objects selected together: outlined, without handles. */
  multi?: readonly Annotation[];
  /** Annotation currently being edited as text (drawn by the textarea instead). */
  hiddenId: string | null;
  draft: Annotation | null;
  crop: Rect | null;
  /** Cut out & join: the band to remove (image px along the axis). */
  cut?: { axis: 'rows' | 'columns'; from: number; to: number } | null;
  eraserTrail: Array<{ x: number; y: number }> | null;
  /** Eraser outline at the pointer (page coordinates, radius in page px). */
  eraserCursor?: { x: number; y: number; r: number } | null;
  /** Select tool: the marked area of the image. */
  area?: Rect | null;
  /** The eraser trail is the image eraser's stroke: drawn in this colour, full width. */
  eraserPaint?: string | null;
  /** Before / After comparison (see CompareBar), or null. */
  compare?: CompareRender | null;
  /** Magnifying glass at this screen point (CSS px), with or without a comparison. */
  loupe?: { x: number; y: number } | null;
}

/**
 * Draws the whole composition in *image* coordinates (image at 0,0; the frame may extend into
 * negative coordinates): frame → image → redactions → annotations → watermark → border.
 * Shared by the on-screen canvas and export.
 */
export function drawComposite(ctx: Ctx2D, doc: EditorDoc, extra: Annotation | null, hiddenIds: ReadonlyArray<string>, scale = 1): void {
  const L = frameLayout(doc);
  drawFrameBackground(ctx, doc, L);
  ctx.save();
  // Mockup perspective: the window / device (not the background) is tilted.
  if (L.tilt) ctx.transform(L.tilt.a, L.tilt.b, L.tilt.c, L.tilt.d, L.tilt.e, L.tilt.f);
  drawFrameUnder(ctx, doc, L);
  ctx.save();
  clipImage(ctx, doc);
  // The picture with its filters (worked out once per change, then cached).
  // At the size it is shown on screen (`scale`), full size for export.
  const shown = filteredBase(doc, scale) as ImageBitmap;
  ctx.drawImage(shown, 0, 0, doc.width, doc.height);
  // Blur / pixelate regions read the picture at full size.
  const base = shown.width === doc.width ? shown : doc.base;
  // A draft that replaces an existing annotation (move / resize) takes that annotation's place.
  const list = doc.annotations
    .filter((a) => !hiddenIds.includes(a.id))
    .map((a) => (extra && a.id === extra.id ? extra : a));
  if (extra && !doc.annotations.some((a) => a.id === extra.id)) list.push(extra);
  drawLayers(ctx, base, list, doc.width, doc.height);
  drawWatermark(ctx, doc, doc.watermark);
  ctx.restore();
  drawFrameOver(ctx, doc, L);
  drawDeviceOver(ctx, doc, L);
  ctx.restore();
}

/** Font families used by the document (so they can be loaded before drawing). */
export function usedFonts(doc: EditorDoc, extra?: Annotation | null): Set<string> {
  const out = new Set<string>();
  for (const a of extra ? [...doc.annotations, extra] : doc.annotations) {
    if (a.type === 'text' || a.type === 'callout') out.add(a.fontFamily);
    if (a.type === 'text') {
      if (a.header) out.add(a.header.fontFamily);
      if (a.footer) out.add(a.footer.fontFamily);
    }
    if (a.type === 'callout' && a.titleStyle) out.add(a.titleStyle.fontFamily);
  }
  if (doc.watermark) out.add(doc.watermark.fontFamily);
  return out;
}

export function renderScene(ctx: CanvasRenderingContext2D, doc: EditorDoc, view: ViewTransform, overlay: SceneOverlay, size: { width: number; height: number }): void {
  const { zoom, originX, originY, dpr } = view;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, size.width * dpr, size.height * dpr);
  const L = frameLayout(doc);

  ctx.setTransform(dpr * zoom, 0, 0, dpr * zoom, dpr * originX, dpr * originY);
  ctx.imageSmoothingEnabled = zoom < 2;
  ctx.imageSmoothingQuality = 'high';
  // Page shadow under the whole output (theme colours: on a light canvas the shadow is softer but
  // wider, and a thin ring marks the edge so a white page doesn't merge with the background).
  const edge = canvasEdge();
  ctx.save();
  ctx.shadowColor = edge.shadow;
  ctx.shadowBlur = 28 / zoom;
  ctx.shadowOffsetY = 4 / zoom;
  ctx.fillStyle = doc.frame ? '#00000001' : '#fff';
  ctx.fillRect(L.outer.x, L.outer.y, L.outer.w, L.outer.h);
  ctx.restore();
  ctx.save();
  ctx.strokeStyle = edge.ring;
  ctx.lineWidth = 1 / zoom;
  ctx.strokeRect(L.outer.x - 0.5 / zoom, L.outer.y - 0.5 / zoom, L.outer.w + 1 / zoom, L.outer.h + 1 / zoom);
  ctx.restore();
  ctx.save();
  ctx.beginPath();
  ctx.rect(L.outer.x, L.outer.y, L.outer.w, L.outer.h);
  ctx.clip();
  // Filters are worked out at about the size the picture is shown at.
  const shownScale = Math.min(1, zoom * dpr * 1.1);
  drawComposite(ctx, doc, overlay.draft, overlay.hiddenId ? [overlay.hiddenId] : [], shownScale);
  if (overlay.compare) drawCompareImage(ctx, doc, overlay.compare, shownScale, L.outer);
  ctx.restore();

  // Screen-space decorations (constant size regardless of zoom)
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const toScreen = (x: number, y: number) => {
    const p = L.tilt && !overlay.crop ? L.tilt.transformPoint({ x, y }) : { x, y };
    return { x: originX + p.x * zoom, y: originY + p.y * zoom };
  };

  if (overlay.compare) drawCompareDecor(ctx, doc, overlay.compare, { zoom, originX, originY, dpr });
  if (overlay.loupe) drawLoupe(ctx, overlay.loupe, dpr);

  if (overlay.crop) {
    const c = overlay.crop;
    const tl = toScreen(c.x, c.y);
    const w = c.w * zoom;
    const h = c.h * zoom;
    const docTl = toScreen(0, 0);
    ctx.save();
    ctx.fillStyle = 'rgba(10, 12, 16, 0.6)';
    ctx.beginPath();
    ctx.rect(docTl.x, docTl.y, doc.width * zoom, doc.height * zoom);
    ctx.rect(tl.x, tl.y, w, h);
    ctx.fill('evenodd');
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(tl.x, tl.y, w, h);
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 1; i < 3; i++) {
      ctx.moveTo(tl.x + (w * i) / 3, tl.y);
      ctx.lineTo(tl.x + (w * i) / 3, tl.y + h);
      ctx.moveTo(tl.x, tl.y + (h * i) / 3);
      ctx.lineTo(tl.x + w, tl.y + (h * i) / 3);
    }
    ctx.stroke();
    drawHandles(ctx, [
      [tl.x, tl.y], [tl.x + w / 2, tl.y], [tl.x + w, tl.y], [tl.x + w, tl.y + h / 2],
      [tl.x + w, tl.y + h], [tl.x + w / 2, tl.y + h], [tl.x, tl.y + h], [tl.x, tl.y + h / 2],
    ]);
    ctx.restore();
  }

  if (overlay.cut) drawCutOverlay(ctx, overlay.cut, doc, toScreen, zoom);
  if (overlay.area && overlay.area.w > 0 && overlay.area.h > 0) {
    // Marked area: a light tint and a black-and-white dashed edge (visible on any picture).
    const a = overlay.area;
    const tl = { x: originX + a.x * zoom, y: originY + a.y * zoom };
    const w = a.w * zoom;
    const h = a.h * zoom;
    ctx.save();
    ctx.fillStyle = 'rgba(139, 92, 246, 0.10)';
    ctx.fillRect(tl.x, tl.y, w, h);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = '#fff';
    ctx.strokeRect(tl.x + 0.5, tl.y + 0.5, w - 1, h - 1);
    ctx.setLineDash([6, 4]);
    ctx.strokeStyle = '#111827';
    ctx.strokeRect(tl.x + 0.5, tl.y + 0.5, w - 1, h - 1);
    ctx.restore();
  }

  if (overlay.watermarkBox) {
    const b = overlay.watermarkBox;
    const tl = toScreen(b.x, b.y);
    ctx.save();
    ctx.setLineDash([5, 4]);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = SELECT_COLOR;
    ctx.strokeRect(tl.x, tl.y, b.w * zoom, b.h * zoom);
    ctx.restore();
  }

  for (const a of overlay.multi ?? []) {
    if (a.hidden) continue;
    const outline = selectionPolygon(a).map((p) => toScreen(p.x, p.y));
    ctx.save();
    ctx.beginPath();
    outline.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    ctx.closePath();
    ctx.strokeStyle = 'rgba(255,255,255,0.75)';
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.strokeStyle = SELECT_COLOR;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
  }

  const selected = overlay.selectedId
    ? overlay.draft?.id === overlay.selectedId
      ? overlay.draft
      : doc.annotations.find((a) => a.id === overlay.selectedId)
    : null;
  if (selected && selected.id !== overlay.hiddenId && !selected.hidden) {
    const outline = selectionPolygon(selected).map((p) => toScreen(p.x, p.y));
    const isLine = selected.type === 'line' || selected.type === 'arrow';
    ctx.save();
    // A solid accent outline with a faint halo, so it reads on light and dark images.
    if (!isLine) {
      ctx.beginPath();
      outline.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
      ctx.closePath();
      ctx.strokeStyle = 'rgba(255,255,255,0.75)';
      ctx.lineWidth = 4;
      ctx.stroke();
      ctx.strokeStyle = SELECT_COLOR;
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    const shownLock = selected.lock ?? (overlay.moveOnly ? 'move' : undefined);
    if (shownLock) {
      // A padlock (locked) or four arrows (move only) at the top right.
      const xs = outline.map((p) => p.x);
      const ys = outline.map((p) => p.y);
      drawLockBadge(ctx, Math.max(...xs) + 4, Math.min(...ys) - 4, shownLock);
    }
    ctx.strokeStyle = SELECT_COLOR;
    ctx.lineWidth = 1.5;
    const hs = overlay.moveOnly ? [] : handlesFor(selected, zoom);
    // Stem from the top edge to the rotation handle.
    const rot = hs.find((h) => h.handle === 'rot');
    if (rot && outline.length === 4) {
      ctx.strokeStyle = 'rgba(124,58,237,0.55)';
      const top = { x: (outline[0]!.x + outline[1]!.x) / 2, y: (outline[0]!.y + outline[1]!.y) / 2 };
      const r = toScreen(rot.x, rot.y);
      ctx.beginPath();
      ctx.moveTo(top.x, top.y);
      ctx.lineTo(r.x, r.y);
      ctx.stroke();
    }
    // Bend points: dashed guides through the control polygon.
    if ((selected.type === 'line' || selected.type === 'arrow') && selected.bends?.length && selected.route !== 'elbow') {
      const pts = [{ x: selected.x1, y: selected.y1 }, ...selected.bends, { x: selected.x2, y: selected.y2 }].map((p) => toScreen(p.x, p.y));
      ctx.strokeStyle = 'rgba(124,58,237,0.6)';
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
      ctx.stroke();
      ctx.setLineDash([]);
    }
    // Corners: white dots. Sides: white pills along the edge. Line ends: white dots.
    const angle = (rotationOf(selected) * Math.PI) / 180;
    for (const h of hs.filter((x) => !isRoundHandle(x.handle))) {
      const s = toScreen(h.x, h.y);
      if (h.handle === 'n' || h.handle === 's') drawPill(ctx, s.x, s.y, angle);
      else if (h.handle === 'e' || h.handle === 'w') drawPill(ctx, s.x, s.y, angle + Math.PI / 2);
      else drawDot(ctx, s.x, s.y, 6.5, '#fff', SELECT_COLOR);
    }
    // Bend points and the callout tail: accent dots; rotation: a white button with a turn arrow.
    for (const h of hs.filter((x) => isRoundHandle(x.handle))) {
      const s = toScreen(h.x, h.y);
      if (h.handle === 'rot') {
        drawDot(ctx, s.x, s.y, 12, '#fff', 'rgba(15,23,42,0.22)', 1);
        drawRotateIcon(ctx, s.x, s.y);
      } else if (h.handle === 'tt' || h.handle === 'tb') {
        drawTextGrip(ctx, s.x, s.y);
      } else if (h.handle === 't' && selected.type === 'callout' && selected.tail === 'leader') {
        // The leader's end handle shows the end point's real colour.
        drawDot(ctx, s.x, s.y, 6, leaderEndColorOf(selected), '#fff', 2);
      } else drawDot(ctx, s.x, s.y, 6, SELECT_COLOR, '#fff', 2);
    }
    ctx.restore();
  }

  if (overlay.eraserCursor) {
    const c = overlay.eraserCursor;
    const s = toScreen(c.x, c.y);
    ctx.save();
    ctx.beginPath();
    ctx.arc(s.x, s.y, Math.max(3, c.r * zoom), 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(224, 82, 82, 0.12)';
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = 'rgba(255,255,255,0.95)';
    ctx.stroke();
    ctx.setLineDash([3, 3]);
    ctx.strokeStyle = 'rgba(32,41,56,0.9)';
    ctx.stroke();
    ctx.restore();
  }

  if (overlay.eraserTrail && overlay.eraserTrail.length) {
    ctx.save();
    ctx.strokeStyle = overlay.eraserPaint ?? 'rgba(224, 82, 82, 0.5)';
    ctx.lineWidth = Math.max(overlay.eraserPaint ? 1 : 4, (overlay.eraserCursor?.r ?? 5) * 2 * zoom);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    overlay.eraserTrail.forEach((p, i) => {
      const s = toScreen(p.x, p.y);
      if (i === 0) ctx.moveTo(s.x, s.y);
      else ctx.lineTo(s.x, s.y);
    });
    ctx.stroke();
    ctx.restore();
  }
}

/** Accent colour of selections (Pixora violet). */
const SELECT_COLOR = '#7C3AED';

function drawLockBadge(ctx: CanvasRenderingContext2D, x: number, y: number, lock: 'all' | 'move'): void {
  drawDot(ctx, x, y, 11, '#fff', SELECT_COLOR, 1.5);
  if (typeof Path2D === 'undefined') return;
  const size = 13;
  ctx.save();
  ctx.translate(x - size / 2, y - size / 2);
  ctx.scale(size / 24, size / 24);
  ctx.strokeStyle = SELECT_COLOR;
  ctx.lineWidth = 2.6;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.setLineDash([]);
  ctx.stroke(new Path2D(lock === 'all' ? 'M5 11h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2zM7 11V7a5 5 0 0 1 10 0v4' : 'M12 2v20M2 12h20M15 19l-3 3-3-3M19 9l3 3-3 3M5 9l-3 3 3 3M9 5l3-3 3 3'));
  ctx.restore();
}

/** The move handle of a callout's text: a small round button with four arrows. */
function drawTextGrip(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  drawDot(ctx, x, y, 10, SELECT_COLOR, '#fff', 1.5);
  if (typeof Path2D === 'undefined') return;
  const size = 13;
  ctx.save();
  ctx.translate(x - size / 2, y - size / 2);
  ctx.scale(size / 24, size / 24);
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 2.6;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.setLineDash([]);
  ctx.stroke(new Path2D('M12 2v20M2 12h20M15 19l-3 3-3-3M19 9l3 3-3 3M5 9l-3 3 3 3M9 5l3-3 3 3'));
  ctx.restore();
}

/** A clear "rotate" arrow (circular arrow with its head at the top right), 15 px wide. */
function drawRotateIcon(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  if (typeof Path2D === 'undefined') return;
  const size = 15;
  ctx.save();
  ctx.translate(x - size / 2, y - size / 2);
  ctx.scale(size / 24, size / 24);
  ctx.strokeStyle = '#1f2937';
  ctx.lineWidth = 2.5;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.setLineDash([]);
  ctx.stroke(new Path2D('M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8'));
  ctx.stroke(new Path2D('M21 3v5h-5'));
  ctx.restore();
}

function drawDot(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, fill: string, stroke: string, lw = 1.5): void {
  ctx.save();
  ctx.shadowColor = 'rgba(15,23,42,0.28)';
  ctx.shadowBlur = 4;
  ctx.shadowOffsetY = 1;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.lineWidth = lw;
  ctx.strokeStyle = stroke;
  ctx.stroke();
  ctx.restore();
}

/** Side handle: a short white pill lying along the edge. */
function drawPill(ctx: CanvasRenderingContext2D, x: number, y: number, angle: number): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.shadowColor = 'rgba(15,23,42,0.28)';
  ctx.shadowBlur = 4;
  ctx.shadowOffsetY = 1;
  ctx.beginPath();
  ctx.roundRect(-9, -3.5, 18, 7, 3.5);
  ctx.fillStyle = '#fff';
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = SELECT_COLOR;
  ctx.stroke();
  ctx.restore();
}

function drawHandles(ctx: CanvasRenderingContext2D, points: Array<[number, number]>): void {
  for (const [x, y] of points) {
    ctx.beginPath();
    ctx.rect(x - 5, y - 5, 10, 10);
    ctx.fillStyle = '#fff';
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = '#4F8DF7';
    ctx.stroke();
  }
}

export const HANDLE_HIT_RADIUS = 8;

/** Small JPEG preview of the document as it looks now (frame included), for thumbnails. */
export async function renderDocumentThumbnail(doc: EditorDoc, maxWidth = 360): Promise<Blob> {
  await ensureFonts(usedFonts(doc));
  await ensureFrameAssets(doc);
  const L = frameLayout(doc);
  const k = Math.min(1, maxWidth / L.outer.w);
  const canvas = new OffscreenCanvas(Math.max(1, Math.round(L.outer.w * k)), Math.max(1, Math.round(Math.min(L.outer.h * k, maxWidth * 1.5))));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D context unavailable');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingQuality = 'high';
  ctx.scale(k, k);
  ctx.translate(-L.outer.x, -L.outer.y);
  drawComposite(ctx, doc, null, []);
  return canvas.convertToBlob({ type: 'image/jpeg', quality: 0.85 });
}

/** One area of the picture as it looks now (annotations and watermark included, no frame), as a PNG. */
export async function exportArea(doc: EditorDoc, rect: Rect): Promise<Blob> {
  return (await renderArea(doc, rect)).convertToBlob({ type: 'image/png' });
}

/** Draws one part of the picture (annotations included, no frame) onto its own canvas. */
export async function renderArea(doc: EditorDoc, rect: Rect): Promise<OffscreenCanvas> {
  await ensureFonts(usedFonts(doc));
  const w = Math.max(1, Math.round(rect.w));
  const h = Math.max(1, Math.round(rect.h));
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D context unavailable');
  ctx.imageSmoothingQuality = 'high';
  ctx.translate(-Math.round(rect.x), -Math.round(rect.y));
  drawComposite(ctx, { ...doc, frame: null }, null, []);
  return canvas;
}

/** Renders the final image (frame included) at full resolution and encodes it. */
export async function exportDocument(doc: EditorDoc, format: ImageFormat, quality: number): Promise<Blob> {
  await ensureFonts(usedFonts(doc));
  await ensureFrameAssets(doc);
  const L = frameLayout(doc);
  const canvas = new OffscreenCanvas(Math.round(L.outer.w), Math.round(L.outer.h));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D context unavailable');
  if (format === 'jpeg') {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.imageSmoothingQuality = 'high';
  ctx.translate(-L.outer.x, -L.outer.y);
  drawComposite(ctx, doc, null, []);
  return canvas.convertToBlob({ type: `image/${format}`, ...(format === 'png' ? {} : { quality }) });
}

/** Red band over the part Cut out & join removes, with draggable edge handles and its size. */
function drawCutOverlay(
  ctx: CanvasRenderingContext2D,
  cut: { axis: 'rows' | 'columns'; from: number; to: number },
  doc: EditorDoc,
  toScreen: (x: number, y: number) => { x: number; y: number },
  zoom: number,
): void {
  const rows = cut.axis === 'rows';
  const a = Math.min(cut.from, cut.to);
  const b = Math.max(cut.from, cut.to);
  const tl = toScreen(rows ? 0 : a, rows ? a : 0);
  const w = rows ? doc.width * zoom : (b - a) * zoom;
  const h = rows ? (b - a) * zoom : doc.height * zoom;
  ctx.save();
  ctx.beginPath();
  ctx.rect(tl.x, tl.y, w, h);
  ctx.clip();
  ctx.fillStyle = 'rgba(239, 68, 68, 0.28)';
  ctx.fillRect(tl.x, tl.y, w, h);
  // Diagonal hatching: reads as "removed" even over red content.
  ctx.strokeStyle = 'rgba(239, 68, 68, 0.55)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (let d = -h; d < w + h; d += 14) {
    ctx.moveTo(tl.x + d, tl.y);
    ctx.lineTo(tl.x + d + h, tl.y + h);
  }
  ctx.stroke();
  ctx.restore();

  ctx.save();
  ctx.strokeStyle = '#ef4444';
  ctx.lineWidth = 2;
  ctx.setLineDash([8, 5]);
  ctx.beginPath();
  if (rows) {
    ctx.moveTo(tl.x, tl.y); ctx.lineTo(tl.x + w, tl.y);
    ctx.moveTo(tl.x, tl.y + h); ctx.lineTo(tl.x + w, tl.y + h);
  } else {
    ctx.moveTo(tl.x, tl.y); ctx.lineTo(tl.x, tl.y + h);
    ctx.moveTo(tl.x + w, tl.y); ctx.lineTo(tl.x + w, tl.y + h);
  }
  ctx.stroke();
  ctx.setLineDash([]);
  // Edge grips (drag to adjust).
  const grip = (x: number, y: number) => {
    const gw = rows ? 44 : 10;
    const gh = rows ? 10 : 44;
    ctx.beginPath();
    ctx.roundRect(x - gw / 2, y - gh / 2, gw, gh, 5);
    ctx.fillStyle = '#ef4444';
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.stroke();
  };
  if (rows) { grip(tl.x + w / 2, tl.y); grip(tl.x + w / 2, tl.y + h); }
  else { grip(tl.x, tl.y + h / 2); grip(tl.x + w, tl.y + h / 2); }
  // Size label in the band.
  const label = `Remove ${Math.round(b - a)} px`;
  ctx.font = '600 12px Inter, system-ui, sans-serif';
  const tw = ctx.measureText(label).width + 20;
  const cx = tl.x + w / 2;
  const cy = tl.y + h / 2;
  if ((rows ? h : w) > 26) {
    ctx.beginPath();
    ctx.roundRect(cx - tw / 2, cy - 12, tw, 24, 12);
    ctx.fillStyle = 'rgba(17, 20, 26, 0.85)';
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, cx, cy + 0.5);
  }
  ctx.restore();
}

/** Ring and shadow around the image on the editor canvas, from the page's theme. */
function canvasEdge(): { ring: string; shadow: string } {
  if (typeof document === 'undefined') return { ring: 'rgba(255,255,255,0.08)', shadow: 'rgba(0,0,0,0.45)' };
  const css = getComputedStyle(document.documentElement);
  const light = document.documentElement.dataset.theme === 'light';
  return {
    ring: css.getPropertyValue('--c-editor-image-ring').trim() || 'rgba(255,255,255,0.08)',
    shadow: light ? 'rgba(15,23,42,0.28)' : 'rgba(0,0,0,0.5)',
  };
}

/** What the renderer needs to draw a Before / After comparison. */
/** One side-by-side pane: its own zoom (1 = whole picture) and the point shown in its centre (shares of the picture). */
export interface ComparePane { k: number; x: number; y: number }
export const PANE_HOME: ComparePane = { k: 1, x: 0.5, y: 0.5 };

export interface CompareRender {
  /** before / after: only the original / only the edited picture (Show in the view settings). */
  mode: 'side' | 'slider' | 'overlay' | 'diff' | 'before' | 'after';
  /** Slider: where the divider is (share of the picture). Overlay: how much of After shows. */
  split: number;
  /** The divider runs across (Before above, After below). */
  vertical: boolean;
  labels: boolean;
  /** The picture as first opened (null: the picture without its filters). */
  before: EditorDoc | null;
  /** Side by side: what each pane shows (Before, After). */
  panes?: [ComparePane, ComparePane];
  /** Changed pixels tinted red on the edited picture. */
  highlight?: boolean;
}

/** Changed pixels as a translucent red layer (cached per pair and size). */
let changesCache: { a: EditorDoc; b: EditorDoc; scale: number; canvas: OffscreenCanvas } | null = null;
function changesImage(a: EditorDoc, b: EditorDoc, scale: number): OffscreenCanvas {
  if (changesCache && changesCache.a === a && changesCache.b === b && changesCache.scale === scale) return changesCache.canvas;
  const w = Math.max(1, Math.round(b.width * scale));
  const h = Math.max(1, Math.round(b.height * scale));
  const read = (d: EditorDoc) => {
    const c = new OffscreenCanvas(w, h);
    const x = c.getContext('2d', { willReadFrequently: true })!;
    x.scale(w / d.width, h / d.height);
    drawComposite(x, { ...d, frame: null }, null, [], scale);
    return x.getImageData(0, 0, w, h);
  };
  const pa = read(a).data;
  const img = read(b);
  const pb = img.data;
  for (let i = 0; i < pb.length; i += 4) {
    const diff = Math.abs(pa[i]! - pb[i]!) + Math.abs(pa[i + 1]! - pb[i + 1]!) + Math.abs(pa[i + 2]! - pb[i + 2]!);
    pb[i] = 239; pb[i + 1] = 35; pb[i + 2] = 60;
    pb[i + 3] = diff > 36 ? Math.round((Math.min(1, diff / 160) * 0.35 + 0.35) * 255) : 0;
  }
  const out = new OffscreenCanvas(w, h);
  out.getContext('2d')!.putImageData(img, 0, 0);
  changesCache = { a, b, scale, canvas: out };
  return out;
}

const beforeOf = (doc: EditorDoc, c: CompareRender) => c.before ?? { ...doc, filters: null };

/** Differences: changed pixels bright magenta over a dimmed grey picture (cached per pair and size). */
let diffCache: { a: EditorDoc; b: EditorDoc; scale: number; canvas: OffscreenCanvas } | null = null;
function diffImage(a: EditorDoc, b: EditorDoc, scale: number): OffscreenCanvas {
  if (diffCache && diffCache.a === a && diffCache.b === b && diffCache.scale === scale) return diffCache.canvas;
  const w = Math.max(1, Math.round(b.width * scale));
  const h = Math.max(1, Math.round(b.height * scale));
  const read = (d: EditorDoc) => {
    const c = new OffscreenCanvas(w, h);
    const x = c.getContext('2d', { willReadFrequently: true })!;
    x.scale(w / d.width, h / d.height);
    drawComposite(x, { ...d, frame: null }, null, [], scale);
    return x.getImageData(0, 0, w, h);
  };
  const pa = read(a).data;
  const img = read(b);
  const pb = img.data;
  for (let i = 0; i < pb.length; i += 4) {
    const diff = Math.abs(pa[i]! - pb[i]!) + Math.abs(pa[i + 1]! - pb[i + 1]!) + Math.abs(pa[i + 2]! - pb[i + 2]!);
    const l = (0.299 * pb[i]! + 0.587 * pb[i + 1]! + 0.114 * pb[i + 2]!) * 0.55 + 40;
    if (diff > 36) {
      const k = Math.min(1, diff / 160) * 0.8 + 0.2;
      pb[i] = l * (1 - k) + 236 * k;
      pb[i + 1] = l * (1 - k) + 72 * k;
      pb[i + 2] = l * (1 - k) + 153 * k;
    } else {
      pb[i] = l;
      pb[i + 1] = l;
      pb[i + 2] = l;
    }
    pb[i + 3] = 255;
  }
  const out = new OffscreenCanvas(w, h);
  out.getContext('2d')!.putImageData(img, 0, 0);
  diffCache = { a, b, scale, canvas: out };
  return out;
}

/** Before and After drawn into the picture (image coordinates; After is already drawn). */
function drawCompareImage(ctx: CanvasRenderingContext2D, doc: EditorDoc, c: CompareRender, scale: number, outer: Rect): void {
  const before = beforeOf(doc, c);
  const W = doc.width;
  const H = doc.height;
  ctx.save();
  const changes = () => (c.highlight ? changesImage(before, doc, scale) : null);
  if (c.mode === 'before') {
    ctx.beginPath();
    ctx.rect(outer.x, outer.y, outer.w, outer.h);
    ctx.clip();
    drawComposite(ctx, before, null, [], scale);
  } else if (c.mode === 'after') {
    const ch = changes();
    if (ch) ctx.drawImage(ch, 0, 0, W, H);
  } else if (c.mode === 'slider') {
    ctx.beginPath();
    if (c.vertical) ctx.rect(outer.x, outer.y, outer.w, Math.max(0, H * c.split - outer.y));
    else ctx.rect(outer.x, outer.y, Math.max(0, W * c.split - outer.x), outer.h);
    ctx.clip();
    drawComposite(ctx, before, null, [], scale);
  } else if (c.mode === 'overlay') {
    ctx.globalAlpha = 1 - c.split;
    drawComposite(ctx, before, null, [], scale);
  } else if (c.mode === 'diff') {
    ctx.drawImage(diffImage(before, doc, scale), 0, 0, W, H);
  } else {
    // Side by side: each at half size, next to each other (or one above the other).
    ctx.fillStyle = '#e9e7f2';
    ctx.fillRect(outer.x, outer.y, outer.w, outer.h);
    const gap = Math.max(W, H) * 0.01;
    const place = (d: EditorDoc, i: number) => {
      ctx.save();
      if (c.vertical) ctx.translate(W / 4, i ? H / 2 + gap / 2 : -gap / 2);
      else ctx.translate(i ? W / 2 + gap / 2 : -gap / 2, H / 4);
      ctx.scale(0.5, 0.5);
      ctx.beginPath();
      ctx.rect(0, 0, W, H);
      ctx.clip();
      // The pane's own zoom and position (sync zoom / sync scroll link the two).
      const p = c.panes?.[i] ?? PANE_HOME;
      ctx.translate(W / 2, H / 2);
      ctx.scale(p.k, p.k);
      ctx.translate(-p.x * W, -p.y * H);
      drawComposite(ctx, { ...d, frame: null }, null, [], Math.min(1, (scale / 2) * p.k));
      const ch = i === 1 ? changes() : null;
      if (ch) ctx.drawImage(ch, 0, 0, W, H);
      ctx.restore();
    };
    place(before, 0);
    place(doc, 1);
  }
  if (c.mode === 'slider' || c.mode === 'overlay') {
    ctx.restore();
    ctx.save();
    const ch = changes();
    if (ch) ctx.drawImage(ch, 0, 0, W, H);
  }
  ctx.restore();
}

/** Divider, labels and loupe (screen coordinates). */
function drawCompareDecor(ctx: CanvasRenderingContext2D, doc: EditorDoc, c: CompareRender, v: { zoom: number; originX: number; originY: number; dpr: number }): void {
  const left = v.originX;
  const top = v.originY;
  const w = doc.width * v.zoom;
  const h = doc.height * v.zoom;
  ctx.save();
  if (c.mode === 'slider') {
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.shadowColor = 'rgba(0,0,0,0.35)';
    ctx.shadowBlur = 6;
    const pos = c.vertical ? top + h * c.split : left + w * c.split;
    ctx.beginPath();
    if (c.vertical) {
      ctx.moveTo(left, pos);
      ctx.lineTo(left + w, pos);
    } else {
      ctx.moveTo(pos, top);
      ctx.lineTo(pos, top + h);
    }
    ctx.stroke();
    const hx = c.vertical ? left + w / 2 : pos;
    const hy = c.vertical ? pos : top + h / 2;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(hx, hy, 17, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = '#1f2937';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.save();
    ctx.translate(hx, hy);
    if (c.vertical) ctx.rotate(Math.PI / 2);
    ctx.beginPath();
    ctx.moveTo(-4, -5);
    ctx.lineTo(-9, 0);
    ctx.lineTo(-4, 5);
    ctx.moveTo(4, -5);
    ctx.lineTo(9, 0);
    ctx.lineTo(4, 5);
    ctx.stroke();
    ctx.restore();
  }
  if (c.labels && c.mode !== 'after') {
    const label = (text: string, x: number, y: number, right: boolean) => {
      ctx.font = '600 13px Inter Variable, Inter, Segoe UI, sans-serif';
      const lw = ctx.measureText(text).width + 20;
      const bx = right ? x - lw : x;
      ctx.fillStyle = 'rgba(17, 24, 39, 0.8)';
      ctx.beginPath();
      ctx.roundRect(bx, y, lw, 26, 7);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.fillText(text, bx + 10, y + 18);
    };
    if (c.mode === 'before') label('Original', left + 12, top + 12, false);
    else if (c.mode === 'overlay') label('Overlay · After ' + Math.round(c.split * 100) + '%', left + 12, top + 12, false);
    else if (c.mode === 'diff') label('Differences', left + 12, top + 12, false);
    else if (c.vertical) {
      label('Before', left + 12, top + 12, false);
      label('After', left + 12, (c.mode === 'side' ? top + h / 2 : top + h * c.split) + 12, false);
    } else {
      label('Before', left + 12, top + 12, false);
      label('After', left + w - 12, top + 12, true);
    }
  }
  ctx.restore();
}

/**
 * Magnifying glass: the canvas around the pointer at 2.5×, in a circle (screen coordinates). The
 * area is copied first — painting the circle before reading it would magnify the circle itself.
 */
let loupeCopy: OffscreenCanvas | null = null;
function drawLoupe(ctx: CanvasRenderingContext2D, at: { x: number; y: number }, dpr: number): void {
  const r = 90;
  const k = 2.5;
  const sw = ((r * 2) / k) * dpr;
  const size = Math.max(1, Math.round(sw));
  if (!loupeCopy || loupeCopy.width !== size) loupeCopy = new OffscreenCanvas(size, size);
  const lc = loupeCopy.getContext('2d')!;
  lc.clearRect(0, 0, size, size);
  lc.drawImage(ctx.canvas, at.x * dpr - sw / 2, at.y * dpr - sw / 2, sw, sw, 0, 0, size, size);
  ctx.save();
  ctx.beginPath();
  ctx.arc(at.x, at.y, r, 0, Math.PI * 2);
  ctx.clip();
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(at.x - r, at.y - r, r * 2, r * 2);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(loupeCopy, at.x - r, at.y - r, r * 2, r * 2);
  ctx.restore();
  ctx.save();
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 3;
  ctx.shadowColor = 'rgba(0,0,0,0.4)';
  ctx.shadowBlur = 8;
  ctx.beginPath();
  ctx.arc(at.x, at.y, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}
