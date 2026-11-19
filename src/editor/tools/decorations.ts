import type { DeviceFinish, DeviceFrame, EditorDoc, Frame, Rect, Watermark } from '../types';
import { dashPattern, getMeasureContext, makePaint, type Ctx2D } from './common';
import { alpha, shade, shapeGeometry } from './shape-lib';

/**
 * Document decorations: the frame (padding + background, border, rounded corners, shadow and an
 * optional browser window) and the watermark. All geometry is expressed in *image* coordinates:
 * the image occupies (0, 0, width, height) and the frame extends into negative coordinates.
 */
export interface FrameLayout {
  /** Whole output (frame included) in image coordinates. */
  outer: Rect;
  /** Window = image + browser bar. */
  window: Rect;
  /** Browser bar, if any. */
  bar: Rect | null;
  /** Scale factor for browser chrome so it looks right at any resolution. */
  scale: number;
  /** Device mockup geometry (body = whole device, screen = bezel around the window). */
  device?: DeviceLayout | null;
  /** Perspective transform for the window / device (image coordinates), or null. */
  tilt?: DOMMatrix | null;
}

export interface DeviceLayout {
  body: Rect;
  screen: Rect;
  bezel: number;
  /** Laptop base / monitor stand. */
  base: Rect | null;
  neck: Rect | null;
}

/** Bezel, base and stand around the window for each device. */
function deviceLayout(d: DeviceFrame, win: Rect): DeviceLayout {
  const W = win.w;
  const m = Math.min(win.w, win.h);
  switch (d.kind) {
    case 'laptop': {
      const b = Math.max(10, W * 0.028);
      const screen = { x: win.x - b, y: win.y - b * 1.25, w: win.w + b * 2, h: win.h + b * 1.25 + b * 1.35 };
      const baseH = Math.max(10, W * 0.032);
      const over = W * 0.075;
      const base = { x: screen.x - over, y: screen.y + screen.h, w: screen.w + over * 2, h: baseH };
      return { body: { x: base.x, y: screen.y, w: base.w, h: screen.h + baseH }, screen, bezel: b, base, neck: null };
    }
    case 'desktop': {
      const b = Math.max(8, W * 0.018);
      const chin = Math.max(16, W * 0.055);
      const screen = { x: win.x - b, y: win.y - b, w: win.w + b * 2, h: win.h + b + chin };
      const neck = { x: screen.x + screen.w / 2 - W * 0.07, y: screen.y + screen.h, w: W * 0.14, h: W * 0.11 };
      const base = { x: screen.x + screen.w / 2 - W * 0.19, y: neck.y + neck.h, w: W * 0.38, h: Math.max(6, W * 0.022) };
      return { body: { x: screen.x, y: screen.y, w: screen.w, h: base.y + base.h - screen.y }, screen, bezel: b, base, neck };
    }
    case 'tablet': {
      const b = Math.max(14, m * 0.065);
      const screen = { x: win.x - b, y: win.y - b, w: win.w + b * 2, h: win.h + b * 2 };
      return { body: screen, screen, bezel: b, base: null, neck: null };
    }
    case 'phone': {
      const b = Math.max(10, m * 0.045);
      const screen = { x: win.x - b, y: win.y - b * 1.4, w: win.w + b * 2, h: win.h + b * 2.8 };
      return { body: screen, screen, bezel: b, base: null, neck: null };
    }
  }
}

const FINISH: Record<DeviceFinish, { bezel: string; body: string; edge: string }> = {
  space: { bezel: '#0B0B0D', body: '#3A3C41', edge: '#25272B' },
  silver: { bezel: '#0B0B0D', body: '#D5D8DD', edge: '#A9AEB6' },
  black: { bezel: '#050506', body: '#1E1F22', edge: '#101113' },
  white: { bezel: '#F6F6F7', body: '#E9EAEC', edge: '#C9CBD0' },
  gold: { bezel: '#0B0B0D', body: '#E8D5B5', edge: '#C5AE87' },
};

/** Perspective (approximated with skew / scale / rotation) around the centre of `r`. */
function tiltFor(tilt: Frame['tilt'], r: Rect): DOMMatrix | null {
  if (!tilt || tilt === 'none' || typeof DOMMatrix === 'undefined') return null;
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  const m = new DOMMatrix().translate(cx, cy);
  if (tilt === 'left') m.skewYSelf(-7).scaleSelf(0.92, 1);
  else if (tilt === 'right') m.skewYSelf(7).scaleSelf(0.92, 1);
  else if (tilt === 'float') m.rotateSelf(-5);
  else if (tilt === 'back') m.scaleSelf(1, 0.86).skewXSelf(-10);
  return m.translate(-cx, -cy);
}

function boundsAfter(m: DOMMatrix, r: Rect): Rect {
  const pts = [[r.x, r.y], [r.x + r.w, r.y], [r.x + r.w, r.y + r.h], [r.x, r.y + r.h]].map(([x, y]) => m.transformPoint({ x, y }));
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
}

/* ------------------------------ background images ------------------------------ */

const images = new Map<string, ImageBitmap | 'loading' | 'error'>();
const imageListeners = new Set<() => void>();

/** Called when a background image finished decoding (the canvas redraws). */
export function onFrameImageLoaded(fn: () => void): () => void {
  imageListeners.add(fn);
  return () => imageListeners.delete(fn);
}

function loadImage(src: string): Promise<void> {
  const cur = images.get(src);
  if (cur && cur !== 'loading') return Promise.resolve();
  images.set(src, 'loading');
  return fetch(src)
    .then((r) => r.blob())
    .then((b) => createImageBitmap(b))
    .then((bmp) => {
      images.set(src, bmp);
      imageListeners.forEach((f) => f());
    })
    .catch(() => {
      images.set(src, 'error');
    });
}

/** Decodes the frame's background image (call before exporting). */
export async function ensureFrameAssets(doc: Pick<EditorDoc, 'frame'> & { watermark?: Watermark | null }): Promise<void> {
  const bg = doc.frame?.background ?? '';
  if (bg.startsWith('image:')) await loadImage(bg.slice(6));
  const logo = doc.watermark?.logo ?? '';
  if (logo.startsWith('image:')) await loadImage(logo.slice(6));
}

/** Registers an already decoded background image (right after the user picks one). */
export function rememberFrameImage(src: string, bmp: ImageBitmap): void {
  images.set(src, bmp);
}

export function chromeScale(width: number): number {
  return Math.min(4, Math.max(0.6, width / 1280));
}

export const BAR_TAB_HEIGHT = 40;
export const BAR_TOOL_HEIGHT = 46;

export function frameLayout(doc: Pick<EditorDoc, 'width' | 'height' | 'frame'>): FrameLayout {
  const { width: W, height: H, frame } = doc;
  const scale = chromeScale(W);
  if (!frame) return { outer: { x: 0, y: 0, w: W, h: H }, window: { x: 0, y: 0, w: W, h: H }, bar: null, scale };
  const barH = frame.browser ? (frame.browser.style === 'safari' ? BAR_TOOL_HEIGHT * 1.15 : BAR_TAB_HEIGHT + BAR_TOOL_HEIGHT) * scale : 0;
  const top = frame.browser?.position === 'top';
  const bar = frame.browser ? { x: 0, y: top ? -barH : H, w: W, h: barH } : null;
  const window = { x: 0, y: top ? -barH : 0, w: W, h: H + barH };
  const device = frame.device ? deviceLayout(frame.device, window) : null;
  const core = device ? device.body : window;
  const tilt = tiltFor(frame.tilt, core);
  // Room for the tilted shape (plus its shadow) inside the background.
  const shown = tilt ? boundsAfter(tilt, core) : core;
  const p = Math.max(0, frame.padding);
  const ox = Math.max(-1, Math.min(1, frame.offsetX ?? 0));
  const oy = Math.max(-1, Math.min(1, frame.offsetY ?? 0));
  const outer = { x: shown.x - p * (1 + ox), y: shown.y - p * (1 + oy), w: shown.w + p * 2, h: shown.h + p * 2 };
  return { outer, window, bar, scale, device, tilt };
}

function windowPath(ctx: Ctx2D, r: Rect, radius: number): void {
  ctx.beginPath();
  ctx.roundRect(r.x, r.y, r.w, r.h, Math.max(0, Math.min(radius, r.w / 2, r.h / 2)));
}

/** Background behind everything (not tilted). Colours, gradients (`linear:a:b`) or an image (`image:url`). */
export function drawFrameBackground(ctx: Ctx2D, doc: EditorDoc, L: FrameLayout): void {
  const frame = doc.frame;
  if (!frame || frame.padding <= 0 || frame.background === 'transparent') return;
  const o = L.outer;
  if (frame.background.startsWith('image:')) {
    const src = frame.background.slice(6);
    const img = images.get(src);
    if (img && img !== 'loading' && img !== 'error') {
      // Cover the whole background, centred.
      const k = Math.max(o.w / img.width, o.h / img.height);
      const w = img.width * k;
      const h = img.height * k;
      ctx.save();
      ctx.beginPath();
      ctx.rect(o.x, o.y, o.w, o.h);
      ctx.clip();
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, o.x + (o.w - w) / 2, o.y + (o.h - h) / 2, w, h);
      ctx.restore();
    } else {
      if (!img) void loadImage(src);
      ctx.fillStyle = '#E5E7EB';
      ctx.fillRect(o.x, o.y, o.w, o.h);
    }
    return;
  }
  ctx.fillStyle = makePaint(ctx, frame.background, o);
  ctx.fillRect(o.x, o.y, o.w, o.h);
}

/** Device body, shadow and browser chrome (inside the tilt). Call before drawing the image. */
export function drawFrameUnder(ctx: Ctx2D, doc: EditorDoc, L: FrameLayout): void {
  const frame = doc.frame;
  if (!frame) return;
  const k = Math.max(0, frame.shadowSize ?? 1);
  if (L.device && frame.device) {
    drawDeviceBody(ctx, frame.device, L.device, frame.shadow && frame.padding > 0 ? k : 0);
  } else if (frame.shadow && frame.padding > 0 && k > 0) {
    ctx.save();
    ctx.shadowColor = `rgba(15, 23, 42, ${Math.min(0.6, 0.35 * Math.sqrt(k))})`;
    ctx.shadowBlur = Math.max(12, frame.padding * 0.6) * k;
    ctx.shadowOffsetY = Math.max(4, frame.padding * 0.18) * k;
    ctx.fillStyle = '#ffffff';
    windowPath(ctx, L.window, frame.radius);
    ctx.fill();
    ctx.restore();
  }
  if (L.bar && frame.browser) drawBrowserBar(ctx, frame, L.bar, L.scale);
}

function drawDeviceBody(ctx: Ctx2D, d: DeviceFrame, D: DeviceLayout, shadow: number): void {
  const c = FINISH[d.finish] ?? FINISH.space;
  const s = D.screen;
  const b = D.bezel;
  ctx.save();
  if (shadow > 0) {
    ctx.shadowColor = `rgba(15, 23, 42, ${Math.min(0.55, 0.32 * Math.sqrt(shadow))})`;
    ctx.shadowBlur = b * 3 * shadow;
    ctx.shadowOffsetY = b * 0.9 * shadow;
  }
  const radius = d.kind === 'phone' ? b * 3.2 : d.kind === 'tablet' ? b * 1.6 : d.kind === 'laptop' ? b * 0.9 : b * 0.6;
  // Thin metal rim, then the glass bezel inside it.
  ctx.fillStyle = d.kind === 'phone' || d.kind === 'tablet' ? c.body : c.edge;
  ctx.beginPath();
  if (d.kind === 'laptop') ctx.roundRect(s.x, s.y, s.w, s.h, [radius, radius, 0, 0]);
  else ctx.roundRect(s.x, s.y, s.w, s.h, radius);
  ctx.fill();
  ctx.restore();
  const rim = d.kind === 'phone' || d.kind === 'tablet' ? Math.max(2, b * 0.16) : Math.max(1, b * 0.08);
  ctx.save();
  ctx.fillStyle = c.bezel;
  ctx.beginPath();
  if (d.kind === 'laptop') ctx.roundRect(s.x + rim, s.y + rim, s.w - rim * 2, s.h - rim, [radius - rim, radius - rim, 0, 0]);
  else ctx.roundRect(s.x + rim, s.y + rim, s.w - rim * 2, s.h - rim * 2, Math.max(0, radius - rim));
  ctx.fill();
  if (d.kind === 'desktop' && D.base && D.neck) {
    // Chin, neck and foot.
    ctx.fillStyle = c.body;
    ctx.beginPath();
    ctx.roundRect(s.x + rim, s.y + s.h - Math.max(16, (s.w - b * 2) * 0.055) - rim * 0.2, s.w - rim * 2, Math.max(16, (s.w - b * 2) * 0.055) - rim * 0.8, [0, 0, Math.max(0, radius - rim), Math.max(0, radius - rim)]);
    ctx.fill();
    const g = ctx.createLinearGradient(D.neck.x, 0, D.neck.x + D.neck.w, 0);
    g.addColorStop(0, shadeHex(c.body, -0.18));
    g.addColorStop(0.5, c.body);
    g.addColorStop(1, shadeHex(c.body, -0.18));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(D.neck.x + D.neck.w * 0.12, D.neck.y);
    ctx.lineTo(D.neck.x + D.neck.w * 0.88, D.neck.y);
    ctx.lineTo(D.neck.x + D.neck.w, D.neck.y + D.neck.h);
    ctx.lineTo(D.neck.x, D.neck.y + D.neck.h);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = c.body;
    ctx.beginPath();
    ctx.roundRect(D.base.x, D.base.y, D.base.w, D.base.h, D.base.h / 2);
    ctx.fill();
  }
  if (d.kind === 'laptop' && D.base) {
    const B = D.base;
    const g = ctx.createLinearGradient(0, B.y, 0, B.y + B.h);
    g.addColorStop(0, shadeHex(c.body, 0.25));
    g.addColorStop(0.45, c.body);
    g.addColorStop(1, shadeHex(c.body, -0.3));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(B.x + B.h * 0.4, B.y);
    ctx.lineTo(B.x + B.w - B.h * 0.4, B.y);
    ctx.quadraticCurveTo(B.x + B.w, B.y, B.x + B.w, B.y + B.h * 0.55);
    ctx.quadraticCurveTo(B.x + B.w, B.y + B.h, B.x + B.w - B.h * 2, B.y + B.h);
    ctx.lineTo(B.x + B.h * 2, B.y + B.h);
    ctx.quadraticCurveTo(B.x, B.y + B.h, B.x, B.y + B.h * 0.55);
    ctx.quadraticCurveTo(B.x, B.y, B.x + B.h * 0.4, B.y);
    ctx.closePath();
    ctx.fill();
    // Thumb notch.
    ctx.fillStyle = shadeHex(c.body, -0.22);
    ctx.beginPath();
    ctx.roundRect(B.x + B.w / 2 - B.w * 0.07, B.y, B.w * 0.14, B.h * 0.32, [0, 0, B.h * 0.3, B.h * 0.3]);
    ctx.fill();
  }
  ctx.restore();
}

function shadeHex(c: string, amount: number): string {
  const m = /^#([0-9a-f]{6})/i.exec(c);
  if (!m) return c;
  const n = parseInt(m[1]!, 16);
  const t = amount > 0 ? 255 : 0;
  const k = Math.abs(amount);
  const ch = (v: number) => Math.round(v + (t - v) * k).toString(16).padStart(2, '0');
  return `#${ch((n >> 16) & 255)}${ch((n >> 8) & 255)}${ch(n & 255)}`;
}

/** Camera, notch / island and a soft glass reflection over the screen. Call after the image. */
export function drawDeviceOver(ctx: Ctx2D, doc: EditorDoc, L: FrameLayout): void {
  const d = doc.frame?.device;
  const D = L.device;
  if (!d || !D) return;
  const s = D.screen;
  const b = D.bezel;
  ctx.save();
  const cam = (x: number, y: number, r: number) => {
    ctx.fillStyle = '#1C1F26';
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(80,110,160,0.55)';
    ctx.beginPath();
    ctx.arc(x - r * 0.25, y - r * 0.25, r * 0.4, 0, Math.PI * 2);
    ctx.fill();
  };
  if (d.kind === 'laptop' || d.kind === 'desktop') cam(s.x + s.w / 2, s.y + b * 0.62, Math.max(2, b * 0.16));
  if (d.kind === 'tablet') cam(s.x + s.w / 2, s.y + b / 2, Math.max(2, b * 0.13));
  if (d.kind === 'phone') {
    // Dynamic-island style pill over the top of the screen.
    const w = Math.min(s.w * 0.3, b * 7);
    const h = Math.max(6, b * 0.95);
    ctx.fillStyle = '#050506';
    ctx.beginPath();
    ctx.roundRect(s.x + s.w / 2 - w / 2, s.y + b * 1.4 + b * 0.35, w, h, h / 2);
    ctx.fill();
  }
  // Glass reflection.
  const win = L.window;
  ctx.beginPath();
  ctx.rect(win.x, win.y, win.w, win.h);
  ctx.clip();
  const g = ctx.createLinearGradient(win.x, win.y, win.x + win.w * 0.6, win.y + win.h);
  g.addColorStop(0, 'rgba(255,255,255,0.10)');
  g.addColorStop(0.45, 'rgba(255,255,255,0.03)');
  g.addColorStop(0.46, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(win.x, win.y, win.w, win.h);
  ctx.restore();
}

/** Clip the image region to the window's rounded corners (only corners not covered by the bar). */
export function clipImage(ctx: Ctx2D, doc: EditorDoc): void {
  const frame = doc.frame;
  const r = Math.max(0, frame?.radius ?? 0);
  ctx.beginPath();
  if (!frame || r === 0) {
    ctx.rect(0, 0, doc.width, doc.height);
  } else {
    const top = frame.browser?.position === 'top';
    const bottom = frame.browser?.position === 'bottom';
    ctx.roundRect(0, 0, doc.width, doc.height, [top ? 0 : r, top ? 0 : r, bottom ? 0 : r, bottom ? 0 : r]);
  }
  ctx.clip();
}

/** Border around the window. Call after drawing the image. */
export function drawFrameOver(ctx: Ctx2D, doc: EditorDoc, L: FrameLayout): void {
  const frame = doc.frame;
  if (!frame || frame.borderWidth <= 0) return;
  ctx.save();
  ctx.lineWidth = frame.borderWidth;
  ctx.strokeStyle = frame.borderColor;
  ctx.lineCap = frame.borderStyle === 'dotted' ? 'round' : 'butt';
  ctx.setLineDash(dashPattern(frame.borderStyle ?? 'solid', frame.borderWidth));
  const b = frame.borderWidth / 2;
  windowPath(ctx, { x: L.window.x - b, y: L.window.y - b, w: L.window.w + b * 2, h: L.window.h + b * 2 }, frame.radius + b);
  ctx.stroke();
  ctx.restore();
}

function drawBrowserBar(ctx: Ctx2D, frame: Frame, bar: Rect, s: number): void {
  const browser = frame.browser!;
  const dark = browser.theme === 'dark';
  const C = dark
    ? { strip: '#202124', tab: '#35363a', toolbar: '#35363a', url: '#202124', text: '#e8eaed', dim: '#9aa0a6' }
    : { strip: '#dee1e6', tab: '#ffffff', toolbar: '#ffffff', url: '#f1f3f4', text: '#202124', dim: '#5f6368' };
  const top = browser.position === 'top';
  const r = Math.max(0, frame.radius);
  const tabH = BAR_TAB_HEIGHT * s;
  const toolH = BAR_TOOL_HEIGHT * s;
  ctx.save();
  // Bar background with the outer corners rounded.
  ctx.beginPath();
  ctx.roundRect(bar.x, bar.y, bar.w, bar.h, top ? [r, r, 0, 0] : [0, 0, r, r]);
  ctx.clip();
  ctx.fillStyle = C.strip;
  ctx.fillRect(bar.x, bar.y, bar.w, bar.h);

  const stripY = top ? bar.y : bar.y + toolH;
  const toolY = top ? bar.y + tabH : bar.y;

  if (browser.style === 'safari') {
    const host = (() => { try { return new URL(browser.url).host || browser.url; } catch { return browser.url; } })();
    drawSafariBar(ctx, bar, s, C, dark, top, host);
    ctx.restore();
    return;
  }
  const mac = browser.style === 'mac';
  const edge = browser.style === 'edge';
  if (edge && !dark) {
    C.strip = '#E9EEF6';
    C.url = '#F3F6FB';
  }
  // macOS: traffic lights on the left, tabs after them.
  if (mac) {
    const ly = stripY + tabH / 2 + 2 * s;
    [['#ff5f57', 20], ['#febc2e', 40], ['#28c840', 60]].forEach(([color, x]) => {
      ctx.fillStyle = color as string;
      ctx.beginPath();
      ctx.arc(bar.x + (x as number) * s, ly, 6 * s, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.12)';
      ctx.lineWidth = Math.max(0.5, 0.6 * s);
      ctx.stroke();
    });
  }

  // Tab
  const tabW = Math.min(260 * s, bar.w * 0.45);
  const tabX = bar.x + (mac ? 84 : 12) * s;
  ctx.fillStyle = C.tab;
  ctx.beginPath();
  if (edge) ctx.roundRect(tabX, stripY + 6 * s, tabW, tabH - 12 * s, 8 * s);
  else ctx.roundRect(tabX, stripY + 8 * s, tabW, tabH - 8 * s, top ? [9 * s, 9 * s, 0, 0] : [0, 0, 9 * s, 9 * s]);
  ctx.fill();
  ctx.fillStyle = edge ? '#0C7BDC' : '#4F8DF7';
  ctx.beginPath();
  ctx.arc(tabX + 18 * s, stripY + 8 * s + (tabH - 8 * s) / 2, 6 * s, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = C.text;
  ctx.font = `500 ${12.5 * s}px "Segoe UI", system-ui, sans-serif`;
  ctx.textBaseline = 'middle';
  const title = fitText(ctx, browser.title || 'New Tab', tabW - 60 * s);
  ctx.fillText(title, tabX + 32 * s, stripY + 8 * s + (tabH - 8 * s) / 2);
  ctx.fillStyle = C.dim;
  ctx.font = `${13 * s}px "Segoe UI", system-ui, sans-serif`;
  ctx.fillText('✕', tabX + tabW - 20 * s, stripY + 8 * s + (tabH - 8 * s) / 2);
  // New-tab "+"
  ctx.font = `${17 * s}px "Segoe UI", system-ui, sans-serif`;
  ctx.fillText('+', tabX + tabW + 12 * s, stripY + tabH / 2 + 3 * s);

  // Window controls (minimise, maximise, close) — Windows style only.
  const ctrlY = stripY + tabH / 2;
  if (!mac) {
  ctx.strokeStyle = C.text;
  ctx.lineWidth = Math.max(1, 1.2 * s);
  const cw = 46 * s;
  const right = bar.x + bar.w;
  // close
  const cx = right - cw / 2;
  ctx.beginPath();
  ctx.moveTo(cx - 5 * s, ctrlY - 5 * s);
  ctx.lineTo(cx + 5 * s, ctrlY + 5 * s);
  ctx.moveTo(cx + 5 * s, ctrlY - 5 * s);
  ctx.lineTo(cx - 5 * s, ctrlY + 5 * s);
  ctx.stroke();
  // maximise
  const mx = right - cw * 1.5;
  ctx.strokeRect(mx - 5 * s, ctrlY - 5 * s, 10 * s, 10 * s);
  // minimise
  const nx = right - cw * 2.5;
  ctx.beginPath();
  ctx.moveTo(nx - 5 * s, ctrlY);
  ctx.lineTo(nx + 5 * s, ctrlY);
  ctx.stroke();
  }

  // Toolbar: back / forward / reload + address bar
  ctx.fillStyle = C.toolbar;
  ctx.fillRect(bar.x, toolY, bar.w, toolH);
  const midY = toolY + toolH / 2;
  ctx.save();
  ctx.strokeStyle = C.dim;
  ctx.fillStyle = C.dim;
  ctx.lineWidth = Math.max(1, 1.7 * s);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  // Back / forward: a shaft with a 45° head, like Chrome's (dir 1 points left).
  const arrow = (x: number, dir: 1 | -1) => {
    const len = 7 * s;
    const head = 5 * s;
    ctx.beginPath();
    ctx.moveTo(x + len * dir, midY);
    ctx.lineTo(x - len * dir, midY);
    ctx.moveTo(x - len * dir + head * dir, midY - head);
    ctx.lineTo(x - len * dir, midY);
    ctx.lineTo(x - len * dir + head * dir, midY + head);
    ctx.stroke();
  };
  arrow(bar.x + 22 * s, 1);
  arrow(bar.x + 52 * s, -1);
  // Reload: an open circle with a filled arrowhead at its end.
  const rx = bar.x + 82 * s;
  const rr = 6.5 * s;
  const a0 = -Math.PI * 0.3;
  const a1 = Math.PI * 1.55;
  ctx.beginPath();
  ctx.arc(rx, midY, rr, a0, a1);
  ctx.stroke();
  const ex = rx + rr * Math.cos(a1);
  const ey = midY + rr * Math.sin(a1);
  ctx.beginPath();
  ctx.moveTo(ex + 4.2 * s, ey - 0.2 * s);
  ctx.lineTo(ex - 0.6 * s, ey - 3.6 * s);
  ctx.lineTo(ex - 0.4 * s, ey + 3.4 * s);
  ctx.closePath();
  ctx.fill();
  // Home (optional): a house outline.
  let after = 104;
  if (browser.home) {
    const hx = bar.x + 112 * s;
    ctx.beginPath();
    ctx.moveTo(hx - 7.5 * s, midY - 0.5 * s);
    ctx.lineTo(hx, midY - 7.5 * s);
    ctx.lineTo(hx + 7.5 * s, midY - 0.5 * s);
    ctx.moveTo(hx - 5.5 * s, midY - 2.2 * s);
    ctx.lineTo(hx - 5.5 * s, midY + 6.5 * s);
    ctx.lineTo(hx + 5.5 * s, midY + 6.5 * s);
    ctx.lineTo(hx + 5.5 * s, midY - 2.2 * s);
    ctx.moveTo(hx - 1.8 * s, midY + 6.5 * s);
    ctx.lineTo(hx - 1.8 * s, midY + 2 * s);
    ctx.lineTo(hx + 1.8 * s, midY + 2 * s);
    ctx.lineTo(hx + 1.8 * s, midY + 6.5 * s);
    ctx.stroke();
    after = 134;
  }
  ctx.restore();

  const urlX = bar.x + after * s;
  const urlW = bar.w - after * s - 16 * s;
  ctx.fillStyle = C.url;
  ctx.beginPath();
  ctx.roundRect(urlX, toolY + 7 * s, urlW, toolH - 14 * s, (toolH - 14 * s) / 2);
  ctx.fill();
  // Padlock
  ctx.strokeStyle = C.dim;
  ctx.lineWidth = Math.max(1, 1.3 * s);
  ctx.strokeRect(urlX + 14 * s, midY - 2 * s, 9 * s, 7 * s);
  ctx.beginPath();
  ctx.arc(urlX + 18.5 * s, midY - 2 * s, 3 * s, Math.PI, 0);
  ctx.stroke();
  ctx.fillStyle = C.text;
  ctx.font = `${13.5 * s}px "Segoe UI", system-ui, sans-serif`;
  ctx.fillText(fitText(ctx, browser.url || 'https://', urlW - 50 * s), urlX + 32 * s, midY + 0.5 * s);

  // Divider between bar and page
  ctx.fillStyle = dark ? '#00000055' : '#00000014';
  ctx.fillRect(bar.x, top ? bar.y + bar.h - Math.max(1, s) : bar.y, bar.w, Math.max(1, s));
  ctx.restore();
}

/** Safari: one compact toolbar with traffic lights, arrows and a centred address field. */
function drawSafariBar(ctx: Ctx2D, bar: Rect, s: number, C: { text: string; dim: string }, dark: boolean, top: boolean, host: string): void {
  ctx.fillStyle = dark ? '#2B2B2E' : '#F6F6F7';
  ctx.fillRect(bar.x, bar.y, bar.w, bar.h);
  const midY = bar.y + bar.h / 2;
  [['#ff5f57', 20], ['#febc2e', 40], ['#28c840', 60]].forEach(([color, x]) => {
    ctx.fillStyle = color as string;
    ctx.beginPath();
    ctx.arc(bar.x + (x as number) * s, midY, 6 * s, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.strokeStyle = C.dim;
  ctx.lineWidth = Math.max(1, 1.8 * s);
  ctx.lineCap = 'round';
  for (const [x, dir] of [[96, 1], [122, -1]] as const) {
    ctx.beginPath();
    ctx.moveTo(bar.x + (x + 4 * dir) * s, midY - 6 * s);
    ctx.lineTo(bar.x + (x - 2 * dir) * s, midY);
    ctx.lineTo(bar.x + (x + 4 * dir) * s, midY + 6 * s);
    ctx.stroke();
  }
  const urlW = Math.min(bar.w * 0.5, 520 * s);
  const urlX = bar.x + (bar.w - urlW) / 2;
  const urlH = bar.h * 0.6;
  ctx.fillStyle = dark ? '#3A3A3E' : '#E8E8EB';
  ctx.beginPath();
  ctx.roundRect(urlX, midY - urlH / 2, urlW, urlH, 8 * s);
  ctx.fill();
  ctx.fillStyle = C.text;
  ctx.font = `${13 * s}px -apple-system, "Segoe UI", system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(fitText(ctx, host, urlW - 30 * s), urlX + urlW / 2, midY + 0.5 * s);
  ctx.textAlign = 'left';
  ctx.fillStyle = dark ? '#00000055' : '#00000014';
  ctx.fillRect(bar.x, top ? bar.y + bar.h - Math.max(1, s) : bar.y, bar.w, Math.max(1, s));
}

function fitText(ctx: Ctx2D, text: string, max: number): string {
  if (ctx.measureText(text).width <= max) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > max) t = t.slice(0, -1);
  return `${t}…`;
}

/** Logo image of a watermark (decoded once, then cached). */
function watermarkLogo(wm: Watermark): ImageBitmap | null {
  if (!wm.logo?.startsWith('image:')) return null;
  const src = wm.logo.slice(6);
  const img = images.get(src);
  if (!img) void loadImage(src);
  return img && img !== 'loading' && img !== 'error' ? img : null;
}

const SCRIPT_FONT = '"Dancing Script", "Segoe Script", cursive';

/**
 * Watermark over the image (after annotations), in one of many designs: plain text, pill, stamp,
 * signature, round stamp, dashed stamp box, corner ribbon, corner bracket, brush, tape, dashed box,
 * frosted glass, and logo + text. Every design can carry a logo and a second line, and is tiled,
 * centred or placed in a corner, rotated and faded like the plain text.
 */
/** Fonts and measurements of the watermark's mark. */
function markMetrics(ctx: Ctx2D, doc: Pick<EditorDoc, 'width' | 'height'>, wm: Watermark) {
  const W = doc.width;
  const H = doc.height;
  const size = Math.max(8, wm.size * Math.min(W, H));
  const style = wm.style ?? 'plain';
  const accent = wm.accent ?? '#7C3AED';
  const logo = watermarkLogo(wm);
  const text = style === 'stamp' || style === 'stamp-round' ? wm.text.toUpperCase() : wm.text;
  const font = style === 'signature' ? `400 ${size * 1.25}px ${SCRIPT_FONT}` : `${style === 'plain' ? 700 : 800} ${size}px ${wm.fontFamily}`;
  const subFont = `600 ${size * 0.42}px ${wm.fontFamily}`;
  ctx.font = font;
  const textW = text ? ctx.measureText(text).width : 0;
  ctx.font = subFont;
  const subW = wm.subtitle ? ctx.measureText(wm.subtitle).width : 0;
  const logoH = logo ? size * (wm.subtitle ? 1.7 : 1.25) : 0;
  const logoW = logo ? (logo.width / Math.max(1, logo.height)) * logoH : 0;
  const gap = logo && text ? size * 0.35 : 0;
  const blockW = logoW + gap + Math.max(textW, subW);
  const blockH = Math.max(logoH, size * (wm.subtitle ? 1.55 : 1));
  const padX = ['pill', 'glass', 'brush', 'tape', 'dashed', 'stamp', 'stamp-box'].includes(style) ? size * 0.7 : 0;
  const padY = padX ? size * 0.38 : 0;
  const round = style === 'stamp-round';
  const markW = round ? Math.max(blockW, blockH) + size * 1.6 : blockW + padX * 2;
  const markH = round ? markW : blockH + padY * 2;
  return { W, H, size, style, accent, logo, text, font, subFont, textW, subW, logoH, logoW, gap, blockW, blockH, padX, padY, round, markW, markH };
}

/** Centre of the mark at its chosen position, before it was dragged. */
function markHome(wm: Watermark, W: number, H: number, size: number, markW: number, markH: number): { x: number; y: number } {
  const m = size * 0.9;
  return {
    x: wm.position === 'center' ? W / 2 : wm.position.endsWith('left') ? m + markW / 2 : W - m - markW / 2,
    y: wm.position === 'center' ? H / 2 : wm.position.startsWith('top') ? m + markH / 2 : H - m - markH / 2,
  };
}

/** A tiled pattern covers the image and a ribbon belongs to its corner: the others can be dragged. */
export const watermarkMovable = (wm: Watermark): boolean => wm.position !== 'tile' && wm.style !== 'ribbon';

/** The area of the image the watermark covers (where it can be picked up). */
export function watermarkBox(doc: Pick<EditorDoc, 'width' | 'height'>, wm: Watermark | null | undefined): Rect | null {
  if (!wm || (!wm.text.trim() && !wm.logo) || !watermarkMovable(wm)) return null;
  const ctx = getMeasureContext();
  if (!ctx) return null;
  const { W, H, size, markW, markH } = markMetrics(ctx, doc, wm);
  const home = markHome(wm, W, H, size, markW, markH);
  const angle = (wm.rotation * Math.PI) / 180;
  const w = Math.abs(markW * Math.cos(angle)) + Math.abs(markH * Math.sin(angle));
  const h = Math.abs(markW * Math.sin(angle)) + Math.abs(markH * Math.cos(angle));
  return { x: home.x + (wm.offset?.x ?? 0) * W - w / 2, y: home.y + (wm.offset?.y ?? 0) * H - h / 2, w, h };
}

/** The watermark dragged by (dx, dy) image pixels; its centre stays on the image. */
export function moveWatermark(doc: Pick<EditorDoc, 'width' | 'height'>, wm: Watermark, dx: number, dy: number): Watermark {
  const ctx = getMeasureContext();
  if (!ctx) return wm;
  const { W, H, size, markW, markH } = markMetrics(ctx, doc, wm);
  const home = markHome(wm, W, H, size, markW, markH);
  const x = Math.max(0, Math.min(W, home.x + (wm.offset?.x ?? 0) * W + dx));
  const y = Math.max(0, Math.min(H, home.y + (wm.offset?.y ?? 0) * H + dy));
  return { ...wm, offset: { x: (x - home.x) / W, y: (y - home.y) / H } };
}

export function drawWatermark(ctx: Ctx2D, doc: EditorDoc, wm: Watermark | null): void {
  if (!wm || (!wm.text.trim() && !wm.logo)) return;
  ctx.save();
  const { W, H, size, style, accent, logo, text, font, subFont, textW, logoH, logoW, gap, blockW, blockH, markW, markH } = markMetrics(ctx, doc, wm);

  /** Draws the whole mark centred on (0, 0). */
  const drawMark = () => {
    ctx.save();
    const bx = -markW / 2;
    const by = -markH / 2;
    switch (style) {
      case 'pill':
      case 'glass':
        ctx.shadowColor = 'rgba(0,0,0,0.18)';
        ctx.shadowBlur = size * 0.3;
        ctx.shadowOffsetY = size * 0.08;
        ctx.fillStyle = style === 'glass' ? 'rgba(255,255,255,0.38)' : wm.accent ?? '#FFFFFF';
        ctx.beginPath();
        ctx.roundRect(bx, by, markW, markH, markH / 2);
        ctx.fill();
        ctx.shadowColor = 'transparent';
        if (style === 'glass') {
          ctx.strokeStyle = 'rgba(255,255,255,0.8)';
          ctx.lineWidth = Math.max(1, size * 0.05);
          ctx.stroke();
        }
        break;
      case 'stamp':
      case 'stamp-box':
      case 'dashed':
        ctx.strokeStyle = style === 'stamp' ? wm.color : accent;
        ctx.lineWidth = Math.max(1.5, size * (style === 'stamp' ? 0.09 : 0.07));
        if (style !== 'stamp') ctx.setLineDash([size * 0.25, size * 0.16]);
        ctx.beginPath();
        ctx.roundRect(bx, by, markW, markH, size * 0.22);
        ctx.stroke();
        if (style === 'stamp') {
          ctx.lineWidth = Math.max(1, size * 0.035);
          ctx.beginPath();
          ctx.roundRect(bx + size * 0.16, by + size * 0.16, markW - size * 0.32, markH - size * 0.32, size * 0.14);
          ctx.stroke();
        }
        ctx.setLineDash([]);
        break;
      case 'stamp-round': {
        const R = markW / 2;
        ctx.strokeStyle = wm.color;
        ctx.lineWidth = Math.max(1.5, size * 0.1);
        ctx.beginPath();
        ctx.arc(0, 0, R, 0, Math.PI * 2);
        ctx.stroke();
        ctx.lineWidth = Math.max(1, size * 0.04);
        ctx.beginPath();
        ctx.arc(0, 0, R - size * 0.28, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = wm.color;
        ctx.font = `${size * 0.4}px ${wm.fontFamily}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('★ ★ ★', 0, -blockH / 2 - size * 0.45);
        ctx.fillText('★ ★ ★', 0, blockH / 2 + size * 0.45);
        break;
      }
      case 'brush':
        ctx.fillStyle = accent;
        ctx.fill(shapeGeometry('brush', { x: bx, y: by, w: markW, h: markH }).outline);
        break;
      case 'tape': {
        ctx.fillStyle = alpha(accent, 0.85);
        const t = size * 0.18;
        ctx.beginPath();
        ctx.moveTo(bx, by);
        ctx.lineTo(bx + markW, by);
        for (let i = 1; i <= 4; i++) ctx.lineTo(bx + markW + (i % 2 ? -t : 0), by + (markH / 4) * i);
        ctx.lineTo(bx, by + markH);
        for (let i = 3; i >= 0; i--) ctx.lineTo(bx + (i % 2 ? t : 0), by + (markH / 4) * i);
        ctx.closePath();
        ctx.fill();
        break;
      }
      default:
        break;
    }
    ctx.restore();
    // Logo, then the text block.
    let x = -blockW / 2;
    if (logo) {
      ctx.drawImage(logo, x, -logoH / 2, logoW, logoH);
      x += logoW + gap;
    }
    if (text) {
      const plainShadow = style === 'plain' || style === 'signature' || style === 'corner';
      ctx.save();
      if (plainShadow) {
        ctx.shadowColor = 'rgba(0,0,0,0.25)';
        ctx.shadowBlur = size * 0.08;
      }
      ctx.fillStyle = style === 'brush' ? '#FFFFFF' : wm.color;
      ctx.font = font;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      const ty = wm.subtitle ? -size * 0.28 : 0;
      ctx.fillText(text, x, ty);
      ctx.restore();
      if (wm.subtitle) {
        ctx.fillStyle = style === 'brush' ? '#FFFFFF' : style === 'logo-text' ? accent : wm.color;
        ctx.font = subFont;
        ctx.textBaseline = 'middle';
        ctx.fillText(wm.subtitle, x, size * 0.5);
      }
      if (style === 'signature') {
        ctx.strokeStyle = wm.color;
        ctx.lineWidth = Math.max(1, size * 0.05);
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(x - size * 0.2, size * 0.75);
        ctx.quadraticCurveTo(x + textW * 0.5, size * 0.45, x + textW + size * 0.3, size * 0.55);
        ctx.stroke();
      }
    }
  };

  ctx.globalAlpha = wm.opacity;
  const angle = (wm.rotation * Math.PI) / 180;
  const drawAt = (x: number, y: number, rot = angle) => {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    drawMark();
    ctx.restore();
  };

  if (style === 'ribbon') {
    // Diagonal ribbon across a corner.
    const corner = wm.position === 'top-left' || wm.position === 'bottom-left' || wm.position === 'bottom-right' ? wm.position : 'top-right';
    const band = size * 1.6;
    const len = Math.max(textW + size * 3, band * 4);
    const off = len * 0.28;
    const cx = corner.endsWith('right') ? W - off : off;
    const cy = corner.startsWith('top') ? off : H - off;
    const rot = corner === 'top-right' || corner === 'bottom-left' ? Math.PI / 4 : -Math.PI / 4;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, W, H);
    ctx.clip();
    ctx.translate(cx, cy);
    ctx.rotate(rot);
    ctx.shadowColor = 'rgba(0,0,0,0.25)';
    ctx.shadowBlur = size * 0.3;
    const g = ctx.createLinearGradient(0, -band / 2, 0, band / 2);
    g.addColorStop(0, shade(accent, 0.15));
    g.addColorStop(1, shade(accent, -0.15));
    ctx.fillStyle = g;
    ctx.fillRect(-len, -band / 2, len * 2, band);
    ctx.shadowColor = 'transparent';
    ctx.fillStyle = wm.color;
    ctx.font = font;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 0, 0);
    ctx.restore();
  } else if (wm.position === 'tile') {
    const stepX = markW + size * 3;
    const stepY = markH + size * 3;
    let row = 0;
    for (let y = -H; y < H * 2; y += stepY, row++) {
      for (let x = -W + (row % 2) * (stepX / 2); x < W * 2; x += stepX) drawAt(x, y);
    }
  } else {
    const m = size * 0.9;
    const home = markHome(wm, W, H, size, markW, markH);
    const movedX = (wm.offset?.x ?? 0) * W;
    const movedY = (wm.offset?.y ?? 0) * H;
    const x = home.x + movedX;
    const y = home.y + movedY;
    if (style === 'corner') {
      // L-shaped bracket in the corner, the mark beside it.
      const L = size * 1.4;
      const left = wm.position.endsWith('left') || wm.position === 'center';
      const top = wm.position.startsWith('top');
      const bx = (left ? m * 0.6 : W - m * 0.6) + movedX;
      const by = (top ? m * 0.6 : H - m * 0.6) + movedY;
      ctx.save();
      ctx.strokeStyle = accent;
      ctx.lineWidth = Math.max(2, size * 0.14);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(bx, by + (top ? L : -L));
      ctx.lineTo(bx, by);
      ctx.lineTo(bx + (left ? L : -L), by);
      ctx.stroke();
      ctx.restore();
    }
    drawAt(x, y);
  }
  ctx.restore();
}

/** Watermark design presets (style + colours + position + rotation + opacity). */
export const WATERMARK_PRESETS: Array<{ id: string; group: string; label: string; patch: Partial<Watermark> }> = [
  { id: 'w-text', group: 'Text', label: 'Text', patch: { style: 'pill', accent: '#FFFFFF', color: '#111827', position: 'bottom-right', rotation: 0, opacity: 0.9 } },
  { id: 'w-conf', group: 'Text', label: 'Confidential stamp', patch: { style: 'stamp', color: '#DC2626', position: 'center', rotation: -14, opacity: 0.8, text: 'Confidential' } },
  { id: 'w-sign', group: 'Text', label: 'Signature', patch: { style: 'signature', color: '#1F2937', position: 'bottom-right', rotation: -6, opacity: 0.85, text: 'Draft' } },
  { id: 'w-logo', group: 'Logo', label: 'Logo + name', patch: { style: 'logo-text', color: '#1F1B4B', accent: '#7C3AED', position: 'bottom-right', rotation: 0, opacity: 0.9 } },
  { id: 'w-logo-glass', group: 'Logo', label: 'Logo on glass', patch: { style: 'glass', color: '#FFFFFF', position: 'bottom-right', rotation: 0, opacity: 0.9 } },
  { id: 'w-logo-pill', group: 'Logo', label: 'Logo pill', patch: { style: 'pill', accent: '#FFFFFF', color: '#1F1B4B', position: 'bottom-right', rotation: 0, opacity: 0.95 } },
  { id: 'w-diag', group: 'Diagonal', label: 'Diagonal', patch: { style: 'plain', color: '#9CA3AF', position: 'center', rotation: -30, opacity: 0.45 } },
  { id: 'w-diag-red', group: 'Diagonal', label: 'Confidential (diagonal)', patch: { style: 'plain', color: '#DC2626', position: 'center', rotation: -30, opacity: 0.55, text: 'CONFIDENTIAL' } },
  { id: 'w-diag-int', group: 'Diagonal', label: 'Internal use only', patch: { style: 'plain', color: '#7C3AED', position: 'center', rotation: -30, opacity: 0.5, text: 'Internal Use Only' } },
  { id: 'w-tile', group: 'Pattern', label: 'Tiled pattern', patch: { style: 'plain', color: '#6B7280', position: 'tile', rotation: -25, opacity: 0.18 } },
  { id: 'w-high', group: 'Opacity', label: 'High (80%)', patch: { opacity: 0.8 } },
  { id: 'w-med', group: 'Opacity', label: 'Medium (40%)', patch: { opacity: 0.4 } },
  { id: 'w-low', group: 'Opacity', label: 'Low (15%)', patch: { opacity: 0.15 } },
  { id: 'w-bg', group: 'Background', label: 'Large background', patch: { style: 'plain', color: '#A78BFA', position: 'center', rotation: -20, opacity: 0.18, size: 0.18 } },
  { id: 'w-stamp-c', group: 'Stamp', label: 'Round stamp (red)', patch: { style: 'stamp-round', color: '#DC2626', position: 'center', rotation: -12, opacity: 0.8, text: 'Confidential' } },
  { id: 'w-stamp-d', group: 'Stamp', label: 'Round stamp (blue)', patch: { style: 'stamp-round', color: '#1D4ED8', position: 'center', rotation: -12, opacity: 0.8, text: 'Draft' } },
  { id: 'w-stamp-a', group: 'Stamp', label: 'Approved stamp', patch: { style: 'stamp-round', color: '#16A34A', position: 'center', rotation: -12, opacity: 0.8, text: 'Approved' } },
  { id: 'w-stamp-i', group: 'Stamp', label: 'Internal box stamp', patch: { style: 'stamp-box', color: '#7C3AED', accent: '#7C3AED', position: 'center', rotation: -6, opacity: 0.8, text: 'Internal', subtitle: 'Use only' } },
  { id: 'w-rib-r', group: 'Ribbon', label: 'Red ribbon', patch: { style: 'ribbon', color: '#FFFFFF', accent: '#DC2626', position: 'top-right', opacity: 0.95, text: 'Confidential' } },
  { id: 'w-rib-b', group: 'Ribbon', label: 'Blue ribbon', patch: { style: 'ribbon', color: '#FFFFFF', accent: '#2563EB', position: 'top-right', opacity: 0.95, text: 'Draft' } },
  { id: 'w-rib-g', group: 'Ribbon', label: 'Green ribbon', patch: { style: 'ribbon', color: '#FFFFFF', accent: '#16A34A', position: 'top-right', opacity: 0.95, text: 'Approved' } },
  { id: 'w-rib-v', group: 'Ribbon', label: 'Purple ribbon', patch: { style: 'ribbon', color: '#FFFFFF', accent: '#7C3AED', position: 'top-right', opacity: 0.95, text: 'For Review' } },
  { id: 'w-corner-tl', group: 'Corner', label: 'Corner (top left)', patch: { style: 'corner', color: '#1F1B4B', accent: '#7C3AED', position: 'top-left', rotation: 0, opacity: 0.9 } },
  { id: 'w-corner-bl', group: 'Corner', label: 'Corner (bottom left)', patch: { style: 'corner', color: '#DC2626', accent: '#DC2626', position: 'bottom-left', rotation: 0, opacity: 0.9, text: 'Confidential' } },
  { id: 'w-corner-br', group: 'Corner', label: 'Corner (bottom right)', patch: { style: 'corner', color: '#1F1B4B', accent: '#4F46E5', position: 'bottom-right', rotation: 0, opacity: 0.9, text: 'Draft' } },
  { id: 'w-brush', group: 'Custom', label: 'Brush', patch: { style: 'brush', color: '#FFFFFF', accent: '#7C3AED', position: 'bottom-right', rotation: -8, opacity: 0.95 } },
  { id: 'w-tape', group: 'Custom', label: 'Tape', patch: { style: 'tape', color: '#3F2D00', accent: '#F5D78E', position: 'bottom-right', rotation: -8, opacity: 0.95, text: 'Confidential' } },
  { id: 'w-dash', group: 'Custom', label: 'Dashed box', patch: { style: 'dashed', color: '#1F1B4B', accent: '#7C3AED', position: 'bottom-right', rotation: -4, opacity: 0.9, text: 'Internal Use Only' } },
];
