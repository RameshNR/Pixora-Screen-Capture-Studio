import type { Annotation, EditorDoc, Rect } from './types';
import { handlesFor, isRoundHandle, renderAnnotation, rotationOf, selectionPolygon } from './tools/annotations';
import type { Ctx2D } from './tools/common';
import { clipImage, drawDeviceOver, drawFrameBackground, drawFrameOver, drawFrameUnder, drawWatermark, ensureFrameAssets, frameLayout } from './tools/decorations';
import { ensureFonts } from './fonts';
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
  /** Annotation currently being edited as text (drawn by the textarea instead). */
  hiddenId: string | null;
  draft: Annotation | null;
  crop: Rect | null;
  /** Cut out & join: the band to remove (image px along the axis). */
  cut?: { axis: 'rows' | 'columns'; from: number; to: number } | null;
  eraserTrail: Array<{ x: number; y: number }> | null;
  /** Eraser outline at the pointer (page coordinates, radius in page px). */
  eraserCursor?: { x: number; y: number; r: number } | null;
}

/**
 * Draws the whole composition in *image* coordinates (image at 0,0; the frame may extend into
 * negative coordinates): frame → image → redactions → annotations → watermark → border.
 * Shared by the on-screen canvas and export.
 */
export function drawComposite(ctx: Ctx2D, doc: EditorDoc, extra: Annotation | null, hiddenIds: ReadonlyArray<string>): void {
  const L = frameLayout(doc);
  drawFrameBackground(ctx, doc, L);
  ctx.save();
  // Mockup perspective: the window / device (not the background) is tilted.
  if (L.tilt) ctx.transform(L.tilt.a, L.tilt.b, L.tilt.c, L.tilt.d, L.tilt.e, L.tilt.f);
  drawFrameUnder(ctx, doc, L);
  ctx.save();
  clipImage(ctx, doc);
  ctx.drawImage(doc.base, 0, 0);
  // A draft that replaces an existing annotation (move / resize) takes that annotation's place.
  const list = doc.annotations
    .filter((a) => !hiddenIds.includes(a.id))
    .map((a) => (extra && a.id === extra.id ? extra : a));
  if (extra && !doc.annotations.some((a) => a.id === extra.id)) list.push(extra);
  for (const a of list) if (a.type === 'blur' || a.type === 'pixelate') renderAnnotation(ctx, doc.base, a);
  for (const a of list) if (a.type !== 'blur' && a.type !== 'pixelate') renderAnnotation(ctx, doc.base, a);
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
  drawComposite(ctx, doc, overlay.draft, overlay.hiddenId ? [overlay.hiddenId] : []);
  ctx.restore();

  // Screen-space decorations (constant size regardless of zoom)
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const toScreen = (x: number, y: number) => {
    const p = L.tilt && !overlay.crop ? L.tilt.transformPoint({ x, y }) : { x, y };
    return { x: originX + p.x * zoom, y: originY + p.y * zoom };
  };

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
    ctx.strokeStyle = SELECT_COLOR;
    ctx.lineWidth = 1.5;
    const hs = handlesFor(selected, zoom);
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
    if ((selected.type === 'line' || selected.type === 'arrow') && selected.bends?.length) {
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
        drawDot(ctx, s.x, s.y, 10, '#fff', 'rgba(15,23,42,0.18)');
        ctx.beginPath();
        ctx.arc(s.x, s.y, 4.4, -Math.PI * 0.85, Math.PI * 0.55);
        ctx.strokeStyle = '#1f2937';
        ctx.lineWidth = 1.6;
        ctx.stroke();
        const ex = s.x + Math.cos(Math.PI * 0.55) * 4.4;
        const ey = s.y + Math.sin(Math.PI * 0.55) * 4.4;
        ctx.beginPath();
        ctx.moveTo(ex - 3, ey - 0.5);
        ctx.lineTo(ex, ey);
        ctx.lineTo(ex + 0.6, ey - 3);
        ctx.stroke();
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
    ctx.strokeStyle = 'rgba(224, 82, 82, 0.5)';
    ctx.lineWidth = Math.max(4, (overlay.eraserCursor?.r ?? 5) * 2 * zoom);
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
