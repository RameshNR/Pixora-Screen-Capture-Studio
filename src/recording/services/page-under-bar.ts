import type { BarRect, ShotPlace } from './share-bar';
import type { SurfaceInfo } from './screen-map';
import type { LivePage } from './live-page';

/**
 * The web page in front, placed on the screen / window recording. Chrome draws its "… is sharing your
 * screen" bar on top of the screen, not into the page, so the page's own pixels hold what the bar
 * hides there. They come from a live video of the tab (see live-page) where Chrome allows it, which
 * keeps up with scrolling, else from a still picture (`captureVisibleTab`, two a second).
 */
export interface PageShot extends ShotPlace {
  /** The page's pixels now: the still picture, or the newest frame of the live stream (null while it has none). */
  picture(): CanvasImageSource | null;
  /** A live stream: a short mismatch with the frame (the two videos a frame apart while scrolling) doesn't drop it. */
  live: boolean;
  /** Frees the still picture (the live stream belongs to its LivePage). */
  release(): void;
  /** The live stream never lines up with the recording: stop it, still pictures from now on. */
  reject?(): void;
  /** The page's area on the frame (frame pixels). */
  view: BarRect;
}

type Win = chrome.windows.Window;

/**
 * Where a page of `vpW` × `vpH` (screen DIP) in window `win` lands on the frame (`fw` × `fh`), with the
 * page `srcW` pixels wide in its picture. Null when the window isn't on the recorded screen / isn't the recorded window.
 */
function place(surface: SurfaceInfo, fw: number, fh: number, win: Win, vpW: number, vpH: number, srcW: number): (ShotPlace & { view: BarRect }) | null {
  if (win.left === undefined || win.top === undefined || !win.width || !win.height) return null;
  // The page is centred in the window with its side borders, at the bottom.
  const border = Math.max(0, Math.min(16, (win.width - vpW) / 2));
  const vx = win.left + border;
  const vy = Math.max(win.top, win.top + win.height - vpH - border);
  let ox: number;
  let oy: number;
  let k: number;
  if (surface.kind === 'window') {
    k = fw / win.width;
    if (Math.abs(fh / k - win.height) > 24) return null;
    ox = win.left;
    oy = win.top;
  } else {
    const cx = win.left + win.width / 2;
    const cy = win.top + win.height / 2;
    const d = surface.displays.find((s) => cx >= s.bounds.left && cx < s.bounds.left + s.bounds.width && cy >= s.bounds.top && cy < s.bounds.top + s.bounds.height);
    if (!d) return null;
    k = fw / d.bounds.width;
    if (Math.abs(fh / k - d.bounds.height) > 24) return null;
    ox = d.bounds.left;
    oy = d.bounds.top;
  }
  const x = (vx - ox) * k;
  const y = (vy - oy) * k;
  return { x, y, scale: (vpW * k) / srcW, view: { x, y, w: vpW * k, h: vpH * k } };
}

async function windowInFront(populate: boolean): Promise<Win | null> {
  const win = await chrome.windows.getLastFocused({ windowTypes: ['normal'], populate });
  return win.id === undefined || win.state === 'minimized' ? null : win;
}

/**
 * The live video of the focused browser window's page, placed on the frame; the recorder then fits it
 * exactly by its pixels. Null when Chrome won't stream that tab (the still picture is used instead).
 */
export async function livePageInFront(surface: SurfaceInfo, fw: number, fh: number, live: LivePage): Promise<PageShot | null> {
  const win = await windowInFront(true);
  const tab = win?.tabs?.find((t) => t.active);
  if (!win || tab?.id === undefined || !tab.width || !tab.height) return null;
  // Pixora's own pages aren't worth streaming (and the recorder page would show itself).
  if (tab.url?.startsWith(`chrome-extension://${chrome.runtime.id}/`)) return null;
  const tabId = tab.id;
  // The tab's size is its page's size on screen (DIP); captured at that size in physical pixels.
  const dpr = Math.max(0.25, surface.hostDpr);
  if (!(await live.follow(tabId, { width: Math.round(tab.width * dpr), height: Math.round(tab.height * dpr) }))) return null;
  const first = live.frame(tabId);
  if (!first) return null;
  // Should Chrome still fit the page into a frame of another shape, it sits centred in it (letterboxed).
  const srcW = first.displayWidth;
  const srcH = first.displayHeight;
  const cs = Math.min(srcW / tab.width, srcH / tab.height);
  const at = place(surface, fw, fh, win, tab.width, tab.height, tab.width * cs);
  if (!at) return null;
  const lx = (srcW - tab.width * cs) / 2;
  const ly = (srcH - tab.height * cs) / 2;
  return {
    ...at,
    x: at.x - lx * at.scale,
    y: at.y - ly * at.scale,
    live: true,
    picture: () => live.frame(tabId),
    release: () => undefined,
    reject: () => live.giveUp(tabId),
  };
}

/**
 * Takes a still picture of the focused browser window's page and estimates where it sits on the frame
 * (`fw` × `fh`), from the window's place on screen; the recorder then fits it exactly by its pixels.
 * Null when there is no such page or no access to it (all-sites access, or the page Pixora was opened on).
 */
export async function shootPageInFront(surface: SurfaceInfo, fw: number, fh: number): Promise<PageShot | null> {
  const win = await windowInFront(false);
  if (!win || win.id === undefined || !win.width || !win.height) return null;
  const url = await chrome.tabs.captureVisibleTab(win.id, { format: 'jpeg', quality: 92 });
  const image = await createImageBitmap(await (await fetch(url)).blob());
  // The page's size on screen (DIP).
  const dpr = Math.max(0.25, surface.hostDpr);
  const at = place(surface, fw, fh, win, image.width / dpr, image.height / dpr, image.width);
  if (!at) {
    image.close();
    return null;
  }
  return { ...at, live: false, picture: () => image, release: () => image.close() };
}
