/**
 * "Include browser header": the real tabs / address bar / bookmarks bar, cut from a picture of the
 * Chrome window (Chrome's own screenshot API only sees the page). Pure functions, no chrome.* calls.
 */

export interface Pixels {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Where the page (`ref`, a screenshot of what the tab shows) sits inside the window picture
 * (`frame`, same pixel scale). Compares a grid of samples at every candidate position; returns the
 * best one when most samples match, or null.
 */
export function locatePage(frame: Pixels, full: Pixels): { x: number; y: number; match: number } | null {
  // The page picture can be a pixel or two wider than the window picture (rounding at 125% / 150%
  // scaling, a window edge over the page): compare the part that fits.
  const ref = { ...full, width: Math.min(full.width, frame.width) };
  if (full.width - frame.width > 8 || full.height > frame.height || ref.width < 8 || ref.height < 8) return null;
  const unit = Math.max(1, Math.round(ref.width / 1200));
  // Not the page's first rows: Chrome draws the toolbar's shadow over them in the window picture.
  const rows = [8, 12, 20, 34, 60, 120, 240].map((r) => r * unit).filter((r) => r < ref.height);
  const cols: number[] = [];
  for (let i = 0; i < 48; i++) cols.push(Math.floor(((i + 0.5) / 48) * (ref.width - 1)));
  const samples = rows.flatMap((r) => cols.map((c) => [c, r] as const));
  const refPx = samples.map(([c, r]) => (r * full.width + c) * 4);

  // The page is below the header: anywhere in the top part of the window. Sideways only by the
  // window border (or the gap left by docked DevTools on the right, which keeps x small).
  const maxY = Math.min(frame.height - ref.height, Math.floor(frame.height * 0.6));
  const xs = new Set<number>();
  const spare = frame.width - ref.width;
  for (let x = 0; x <= Math.min(spare, 24 * unit); x++) xs.add(x);
  xs.add(Math.round(spare / 2));

  const need = Math.ceil(samples.length * 0.75);
  // Best: most matching samples, then the closest colours, then the highest position — a page
  // whose top is a flat colour also fits a little lower (moving up runs into the header instead).
  let best: { x: number; y: number; match: number; diff: number } | null = null;
  for (let y = 0; y <= maxY; y++) {
    for (const x of xs) {
      let hits = 0;
      let misses = 0;
      let diff = 0;
      const allowedMisses = samples.length - Math.max(need, best ? Math.round(best.match * samples.length) : need);
      for (let s = 0; s < samples.length; s++) {
        const [c, r] = samples[s]!;
        const fi = ((y + r) * frame.width + (x + c)) * 4;
        const ri = refPx[s]!;
        const d =
          Math.abs(frame.data[fi]! - ref.data[ri]!) +
          Math.abs(frame.data[fi + 1]! - ref.data[ri + 1]!) +
          Math.abs(frame.data[fi + 2]! - ref.data[ri + 2]!);
        diff += d;
        if (d <= 48) hits++;
        else if (++misses > allowedMisses) break;
      }
      const match = hits / samples.length;
      if (hits >= need && (!best || match > best.match || (match === best.match && diff < best.diff))) best = { x, y, match, diff };
    }
  }
  return best && { x: best.x, y: best.y, match: best.match };
}

/**
 * The header strip of the window picture: everything above the page, full window width (minus the
 * window border). When the page can't be found, `assumeLayout` (the picture is the size of the
 * browser window) allows the usual layout — border all round, header on top; otherwise null, as
 * for another window or a window without a header (full screen).
 */
export function headerRect(frame: Pixels, ref: Pixels, assumeLayout = false): Rect | null {
  const found = locatePage(frame, ref);
  if (!found && (!assumeLayout || frame.width < ref.width - 8 || frame.height <= ref.height)) return null;
  const border = Math.max(0, Math.round((frame.width - ref.width) / 2));
  const y = found ? found.y : frame.height - ref.height - border;
  // Left border: where the page starts, unless DevTools are docked on the left (then the usual border).
  const x = found && found.x <= Math.max(border, 24) ? found.x : Math.min(border, 24);
  const minHeader = Math.max(12, Math.round(ref.width / 200));
  if (y < minHeader) return null;
  return { x, y: 0, width: Math.max(1, frame.width - 2 * x), height: y };
}

/**
 * Size the header is drawn at above an image `imageWidth` wide: its pixels scaled by `scale`
 * (screenshot scale setting), stretched to the image width when within 6% (scrollbar, borders, a slightly resized window),
 * otherwise kept and the wider of the two sets the result's width.
 */
export function headerLayout(header: { width: number; height: number }, imageWidth: number, scale: number): { width: number; height: number; canvasWidth: number } {
  let width = Math.max(1, Math.round(header.width * scale));
  let height = Math.max(1, Math.round(header.height * scale));
  if (Math.abs(width - imageWidth) <= imageWidth * 0.06) {
    height = Math.max(1, Math.round((height * imageWidth) / width));
    width = imageWidth;
  }
  return { width, height, canvasWidth: Math.max(width, imageWidth) };
}
