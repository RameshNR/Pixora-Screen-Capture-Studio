import type { RelativeRect } from '@/shared/types';
import type { DisplayLike } from './display-service';

/** Where a web page sits on screen, reported by the page itself (CSS px of the page, screen DIP for the window). */
export interface PageGeometry {
  screenX: number;
  screenY: number;
  outerWidth: number;
  outerHeight: number;
  innerWidth: number;
  innerHeight: number;
  /** The page's devicePixelRatio (screen scale × page zoom). */
  dpr: number;
}

export interface SurfaceInfo {
  /** What the desktop recording captures. */
  kind: 'screen' | 'window';
  /** Size of the captured frames (any unit: only the shape matters). */
  frameWidth: number;
  frameHeight: number;
  displays: DisplayLike[];
  /** devicePixelRatio of an extension page at 100% zoom (the screen scale). */
  hostDpr: number;
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export function isPageGeometry(v: unknown): v is PageGeometry {
  if (!v || typeof v !== 'object') return false;
  const g = v as Record<string, unknown>;
  return ['screenX', 'screenY', 'outerWidth', 'outerHeight', 'innerWidth', 'innerHeight', 'dpr'].every((k) => isNum(g[k]))
    && (g.innerWidth as number) > 0 && (g.innerHeight as number) > 0 && (g.outerWidth as number) > 0 && (g.outerHeight as number) > 0 && (g.dpr as number) > 0;
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/**
 * Builds a function that turns a point of the page (0–1 of its viewport) into a point of the
 * recorded screen / window frame (0–1), or null when the page cannot be placed on the recording
 * (e.g. the recorded window is a different one, or another monitor).
 */
export function pageToSurface(g: PageGeometry, s: SurfaceInfo): ((p: { x: number; y: number }) => { x: number; y: number }) | null {
  if (!s.frameWidth || !s.frameHeight) return null;
  // Page zoom: the page's CSS px are `zoom` screen DIP each.
  const zoom = Math.max(0.25, Math.min(5, g.dpr / Math.max(0.25, s.hostDpr)));
  const vpW = g.innerWidth * zoom;
  const vpH = g.innerHeight * zoom;
  // Viewport position in the window: centred horizontally (side borders), at the bottom (tabs and
  // toolbar above it, the bottom border below).
  const border = Math.max(0, Math.min(16, (g.outerWidth - vpW) / 2));
  const vx = g.screenX + border;
  const vy = Math.max(g.screenY, g.screenY + g.outerHeight - vpH - border);
  const aspect = s.frameWidth / s.frameHeight;

  if (s.kind === 'window') {
    const winAspect = g.outerWidth / g.outerHeight;
    if (Math.abs(winAspect - aspect) / aspect > 0.04) return null;
    return (p) => ({ x: clamp01((vx - g.screenX + p.x * vpW) / g.outerWidth), y: clamp01((vy - g.screenY + p.y * vpH) / g.outerHeight) });
  }

  // Whole screen: the monitor the browser window is on (its centre), if its shape matches the recording.
  const cx = g.screenX + g.outerWidth / 2;
  const cy = g.screenY + g.outerHeight / 2;
  // (Two monitors of the same shape can't be told apart — Chrome doesn't say which one is recorded.)
  const d = s.displays.find((x) => cx >= x.bounds.left && cx < x.bounds.left + x.bounds.width && cy >= x.bounds.top && cy < x.bounds.top + x.bounds.height);
  if (!d) return null;
  const b = d.bounds;
  if (Math.abs(b.width / b.height - aspect) / aspect > 0.05) return null;
  return (p) => ({ x: clamp01((vx + p.x * vpW - b.left) / b.width), y: clamp01((vy + p.y * vpH - b.top) / b.height) });
}

/** A rectangle of the page (0–1 of its viewport) on the recorded frame, or null if it can't be placed. */
export function pageRectToSurface(rect: RelativeRect, g: PageGeometry, s: SurfaceInfo): RelativeRect | null {
  const map = pageToSurface(g, s);
  if (!map) return null;
  const a = map({ x: rect.x, y: rect.y });
  const b = map({ x: rect.x + rect.width, y: rect.y + rect.height });
  const out = { x: a.x, y: a.y, width: b.x - a.x, height: b.y - a.y };
  return out.width > 0.002 && out.height > 0.002 ? out : null;
}
