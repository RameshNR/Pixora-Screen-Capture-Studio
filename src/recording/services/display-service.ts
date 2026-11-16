import type { RelativeRect } from '@/shared/types';
import type { SurfaceInfo } from './screen-map';

export interface DisplayLike {
  isPrimary: boolean;
  bounds: { left: number; top: number; width: number; height: number };
  workArea: { left: number; top: number; width: number; height: number };
}

/**
 * Finds the display a full-screen capture came from (by aspect ratio — captures may be scaled) and
 * returns its work area (the screen minus the taskbar / dock / menu bar) as a fraction of the screen.
 * Returns null when the capture isn't a whole screen or the work area is the whole screen.
 *
 * `knownScreen`: the capture is known to be a whole monitor (Chrome labels those tracks
 * "screen:…"). Then small aspect differences from scaling / rounding are tolerated and, with a single
 * monitor, that monitor is used even if the sizes don't line up exactly.
 */
export function pickWorkArea(displays: DisplayLike[], captureWidth: number, captureHeight: number, knownScreen = false): RelativeRect | null {
  if (!captureWidth || !captureHeight || displays.length === 0) return null;
  const aspect = captureWidth / captureHeight;
  const tolerance = knownScreen ? 0.05 : 0.01;
  const candidates = displays
    .map((d) => ({ d, diff: Math.abs(d.bounds.width / d.bounds.height - aspect) / aspect }))
    .filter((c) => c.diff < tolerance)
    .sort((a, b) => a.diff - b.diff || Number(b.d.isPrimary) - Number(a.d.isPrimary));
  const d = candidates[0]?.d ?? (knownScreen && displays.length === 1 ? displays[0] : undefined);
  if (!d) return null;
  const b = d.bounds;
  const w = d.workArea;
  if (w.left === b.left && w.top === b.top && w.width === b.width && w.height === b.height) return null;
  const rect = {
    x: (w.left - b.left) / b.width,
    y: (w.top - b.top) / b.height,
    width: w.width / b.width,
    height: w.height / b.height,
  };
  // Guard against odd values reported by some window managers.
  if (rect.width <= 0.3 || rect.height <= 0.3 || rect.x < 0 || rect.y < 0 || rect.x + rect.width > 1.0001 || rect.y + rect.height > 1.0001) return null;
  return rect;
}

/**
 * The real size of the frames a track delivers. `getSettings()` can still report the requested
 * size (e.g. 1920×1080) before the first frame, which on a 16:10 or other non-16:9 screen made the
 * screen look like "not a whole screen" and the taskbar was recorded.
 */
async function frameSize(track: MediaStreamTrack): Promise<{ width: number; height: number } | null> {
  if (typeof MediaStreamTrackProcessor === 'undefined') return null;
  const clone = track.clone();
  try {
    const reader = new MediaStreamTrackProcessor({ track: clone as MediaStreamVideoTrack }).readable.getReader();
    const timeout = new Promise<null>((r) => setTimeout(() => r(null), 2000));
    const res = await Promise.race([reader.read(), timeout]);
    void reader.cancel().catch(() => undefined);
    const frame = res && 'value' in res ? res.value : undefined;
    if (!frame) return null;
    const size = { width: frame.displayWidth, height: frame.displayHeight };
    frame.close();
    return size.width && size.height ? size : null;
  } catch {
    return null;
  } finally {
    clone.stop();
  }
}

/** Work-area crop for a desktop capture track, or null if it isn't a whole screen. */
export async function workAreaCrop(track: MediaStreamTrack | undefined): Promise<RelativeRect | null> {
  if (!track || !chrome.system?.display) return null;
  const s = track.getSettings() as MediaTrackSettings & { displaySurface?: string };
  if (s.displaySurface && s.displaySurface !== 'monitor') return null;
  // Chrome names whole-screen sources "screen:<id>:<n>" and windows "window:<id>:<n>".
  if (/^window:/i.test(track.label)) return null;
  const knownScreen = s.displaySurface === 'monitor' || /^screen:/i.test(track.label);
  const real = await frameSize(track);
  const displays = await chrome.system.display.getInfo();
  return pickWorkArea(displays as unknown as DisplayLike[], real?.width ?? s.width ?? 0, real?.height ?? s.height ?? 0, knownScreen);
}

/**
 * What a desktop recording captures (a whole screen or a window), the shape of its frames and the
 * monitors — used to place areas chosen on a web page, and the mouse, on the recording.
 * Null for anything else (a browser tab picked in Chrome's dialog, camera).
 */
export async function surfaceInfo(track: MediaStreamTrack | undefined): Promise<SurfaceInfo | null> {
  if (!track) return null;
  const s = track.getSettings() as MediaTrackSettings & { displaySurface?: string };
  const kind = s.displaySurface === 'window' || /^window:/i.test(track.label) ? 'window' : s.displaySurface === 'monitor' || /^screen:/i.test(track.label) ? 'screen' : null;
  if (!kind) return null;
  const real = await frameSize(track);
  const displays = chrome.system?.display ? ((await chrome.system.display.getInfo().catch(() => [])) as unknown as DisplayLike[]) : [];
  return { kind, frameWidth: real?.width ?? s.width ?? 0, frameHeight: real?.height ?? s.height ?? 0, displays, hostDpr: window.devicePixelRatio || 1 };
}
