/**
 * Chrome's "<extension> is sharing your screen · Stop sharing · Hide" bar.
 *
 * Chrome shows it on top of the screen for every screen / window capture, and extensions can't hide it
 * (only Chrome's own component extensions are exempt). It is an ordinary window, so a screen recording
 * captures it like anything else. Pixora finds it in the frames and paints it out before encoding.
 *
 * Found by its look: a plain bar (dark or light theme) holding a blue pill (the "Stop sharing" button),
 * a few times the pill's width, a little taller than the pill, in the lower part of the screen, with
 * its own edges on every side — a blue button on a web page (whose background runs on) doesn't match.
 */

export interface BarRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

type Px = { r: number; g: number; b: number };

const at = (d: Uint8ClampedArray, w: number, x: number, y: number): Px => {
  const i = (y * w + x) * 4;
  return { r: d[i] ?? 0, g: d[i + 1] ?? 0, b: d[i + 2] ?? 0 };
};
const near = (a: Px, b: Px, tol: number) => Math.abs(a.r - b.r) <= tol && Math.abs(a.g - b.g) <= tol && Math.abs(a.b - b.b) <= tol;
const neutral = (p: Px) => Math.max(p.r, p.g, p.b) - Math.min(p.r, p.g, p.b) <= 24;
/** The "Stop sharing" pill: light blue on the dark bar (#A8C7FA), strong blue on the light one (#0B57D0). */
const pillBlue = (p: Px) => p.b >= 150 && p.b - p.r >= 50 && p.b - p.g >= 25;
/** The "Hide" link: thin blue text, which compression mixes with the bar (so a looser blue). */
const linkBlue = (p: Px) => p.b >= 100 && p.b - p.r >= 25 && p.b - p.g >= 10;

/**
 * Looks for the bar in an RGBA image (`w` × `h`): its rectangle in that image's pixels, or null.
 * `fullHeight` is the height of the whole screen in the same pixels (the image may be its lower part).
 */
export function findShareBar(d: Uint8ClampedArray, w: number, h: number, fullHeight = h): BarRect | null {
  const seen = new Uint8Array(w * h);
  const minPillH = Math.max(4, fullHeight * 0.016);
  const maxPillH = fullHeight * 0.075;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const k = y * w + x;
      if (seen[k] || !pillBlue(at(d, w, x, y))) continue;
      // The blue area this pixel belongs to (4-connected).
      let x0 = x, x1 = x, y0 = y, y1 = y, n = 0;
      const stack = [k];
      seen[k] = 1;
      while (stack.length) {
        const q = stack.pop()!;
        const qx = q % w;
        const qy = (q - qx) / w;
        n++;
        if (qx < x0) x0 = qx; if (qx > x1) x1 = qx; if (qy < y0) y0 = qy; if (qy > y1) y1 = qy;
        for (const [nx, ny] of [[qx - 1, qy], [qx + 1, qy], [qx, qy - 1], [qx, qy + 1]] as const) {
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const nk = ny * w + nx;
          if (!seen[nk] && pillBlue(at(d, w, nx, ny))) { seen[nk] = 1; stack.push(nk); }
        }
      }
      const pw = x1 - x0 + 1;
      const ph = y1 - y0 + 1;
      // A pill: a few times wider than tall, mostly blue (its label takes some of it).
      if (ph < minPillH || ph > maxPillH || pw < ph * 1.6 || pw > ph * 7 || n < pw * ph * 0.45) continue;
      const bar = barAround(d, w, h, { x: x0, y: y0, w: pw, h: ph }, fullHeight);
      if (bar) return bar;
    }
  }
  return null;
}

/** The plain bar around a pill, or null when the pill isn't on one. */
function barAround(d: Uint8ClampedArray, w: number, h: number, pill: BarRect, fullHeight: number): BarRect | null {
  // The bar's colour: the median of a strip just left of the pill, level with its top edge (above any
  // text) — one pixel can be off (compression, anti-aliasing).
  const sy = pill.y + 1;
  if (pill.x < 8 || sy >= h) return null;
  const strip: Px[] = [];
  for (let x = Math.max(0, pill.x - Math.round(pill.w * 0.6)); x < pill.x - 1; x++) strip.push(at(d, w, x, sy));
  const mid = (k: 'r' | 'g' | 'b') => strip.map((p) => p[k]).sort((a, b) => a - b)[strip.length >> 1] ?? 0;
  const bg = { r: mid('r'), g: mid('g'), b: mid('b') };
  if (!neutral(bg)) return null;
  const isBg = (x: number, y: number) => near(at(d, w, x, y), bg, 16);
  /** How far the bar colour runs from (x, y) in a direction, allowing small gaps (an icon, a link). */
  const run = (x: number, y: number, dx: number, dy: number, limit: number) => {
    let last = 0, miss = 0;
    for (let i = 1; i <= limit; i++) {
      const px = x + dx * i, py = y + dy * i;
      if (px < 0 || py < 0 || px >= w || py >= h) return { len: last, edge: false };
      if (isBg(px, py)) { last = i; miss = 0; } else if (++miss > 2) return { len: last, edge: true };
    }
    return { len: last, edge: false };
  };
  /** The bar found by where its colour stops on every side (the usual case). */
  const byEdges = (): BarRect | null => {
    const left = run(pill.x, sy, -1, 0, pill.w * 8);
    const right = run(pill.x + pill.w - 1, sy, 1, 0, pill.w * 3);
    if (!left.edge || !right.edge) return null;
    // Top and bottom: the rows where most of the bar left of the pill is bar colour (its text and icon
    // leave plenty of it); the first row where that stops is the edge. Robust to text next to the pill
    // and to dark surroundings that match the bar here and there.
    const x0 = pill.x - left.len;
    const rowShare = (y: number) => {
      let n = 0, t = 0;
      for (let x = x0; x < pill.x - 1; x += 2) { t++; if (isBg(x, y)) n++; }
      return t ? n / t : 0;
    };
    // The text sits level with the pill, so the scan starts at the pill's own top and bottom edges.
    const reach = Math.ceil(pill.h * 0.8);
    let top = pill.y, bottom = pill.y + pill.h - 1;
    while (top - 1 >= 0 && pill.y - (top - 1) <= reach && rowShare(top - 1) >= 0.6) top--;
    while (bottom + 1 < h && bottom + 1 - (pill.y + pill.h - 1) <= reach && rowShare(bottom + 1) >= 0.6) bottom++;
    // Its own edges above and below (a page background runs on).
    if (pill.y - top >= reach || bottom - (pill.y + pill.h - 1) >= reach) return null;
    const bar = { x: x0, y: top, w: left.len + pill.w + right.len, h: bottom - top + 1 };
    if (left.len < pill.w * 1.5 || right.len > pill.w * 1.5) return null;
    if (bar.h < pill.h * 1.05 || bar.h > pill.h * 2.4) return null;
    if (bar.w > w * 0.7) return null;
    // Mostly bar colour or its text (plain greys) outside the pill.
    let plain = 0, total = 0;
    for (let y = bar.y; y < bar.y + bar.h; y += 2) {
      for (let x = bar.x; x < bar.x + bar.w; x += 2) {
        if (x >= pill.x && x < pill.x + pill.w && y >= pill.y && y < pill.y + pill.h) continue;
        const p = at(d, w, x, y);
        total++;
        if (near(p, bg, 16) || neutral(p) || pillBlue(p)) plain++;
      }
    }
    return total && plain / total >= 0.9 ? bar : null;
  };
  return byEdges() ?? (lum(bg) < 70 ? byContent(d, w, h, pill, bg, fullHeight) : null);
}

const lum = (p: Px) => 0.2126 * p.r + 0.7152 * p.g + 0.0722 * p.b;

/**
 * The dark bar on an equally dark page (a dark-theme site, Pixora's own recorder page): its colour
 * doesn't stop at its edges, so it is measured by what it holds — the message and "||" icon to the
 * left of the pill, the blue "Hide" link right after it — and the pill's height. Only where Chrome puts
 * it (centred, low on the screen), so a dark site's own blue buttons are left alone.
 */
function byContent(d: Uint8ClampedArray, w: number, h: number, pill: BarRect, bg: Px, fullHeight: number): BarRect | null {
  const y0 = pill.y + Math.round(pill.h * 0.25);
  const y1 = pill.y + Math.round(pill.h * 0.75);
  const ink = (x: number) => {
    for (let y = y0; y <= y1; y++) if (!near(at(d, w, x, y), bg, 40)) return true;
    return false;
  };
  // "Hide": blue link pixels just right of the pill.
  let linkEnd = -1;
  for (let x = pill.x + pill.w + 2; x < Math.min(w, pill.x + pill.w * 2); x++) {
    for (let y = y0; y <= y1; y++) if (linkBlue(at(d, w, x, y))) { linkEnd = x; break; }
  }
  if (linkEnd < 0 || linkEnd - (pill.x + pill.w) < pill.h * 0.4) return null;
  // The message: ink to the left of the pill, until a long empty stretch.
  let textStart = pill.x;
  let gap = 0;
  for (let x = pill.x - 2; x >= Math.max(0, pill.x - pill.w * 8); x--) {
    if (ink(x)) { textStart = x; gap = 0; } else if (++gap > pill.h * 1.2) break;
  }
  if (pill.x - textStart < pill.w * 1.5) return null;
  const pad = Math.round(pill.h * 0.45);
  const v = Math.round(pill.h * 0.15);
  const bar = { x: Math.max(0, textStart - pad), y: Math.max(0, pill.y - v), w: 0, h: pill.h + v * 2 };
  bar.w = Math.min(w, linkEnd + pad) - bar.x;
  // Where Chrome shows it: centred, in the bottom quarter of the screen; a bar's width.
  const cx = bar.x + bar.w / 2;
  if (cx < w * 0.3 || cx > w * 0.7 || bar.y < h - fullHeight * 0.25) return null;
  if (bar.w < pill.w * 3 || bar.w > Math.min(w * 0.7, pill.w * 10)) return null;
  return bar;
}

/**
 * Fills a rectangle of an RGBA picture from its surroundings, without blurring: each column carries
 * the rows just above it down (blended into the rows just below when they are the same kind of
 * background — not when the taskbar is below), and near its two ends the rows just left and right of
 * it carry on sideways. A plain page background comes out exactly as it was.
 */
export function fillFromEdges(d: Uint8ClampedArray, W: number, H: number, r: BarRect): void {
  const x0 = Math.max(0, Math.floor(r.x));
  const y0 = Math.max(0, Math.floor(r.y));
  const x1 = Math.min(W, Math.ceil(r.x + r.w));
  const y1 = Math.min(H, Math.ceil(r.y + r.h));
  const w = x1 - x0;
  const h = y1 - y0;
  if (w <= 0 || h <= 0) return;
  // Average of up to 3 rows / columns next to the rectangle (evens out compression noise).
  const line = (horizontal: boolean, from: number, step: number): Float32Array | null => {
    const n = horizontal ? w : h;
    const out = new Float32Array(n * 3);
    let used = 0;
    for (let k = 0; k < 3; k++) {
      const p = from + step * k;
      if (p < 0 || p >= (horizontal ? H : W)) break;
      used++;
      for (let i = 0; i < n; i++) {
        const j = horizontal ? (p * W + x0 + i) * 4 : ((y0 + i) * W + p) * 4;
        out[i * 3] = out[i * 3]! + (d[j] ?? 0);
        out[i * 3 + 1] = out[i * 3 + 1]! + (d[j + 1] ?? 0);
        out[i * 3 + 2] = out[i * 3 + 2]! + (d[j + 2] ?? 0);
      }
    }
    if (!used) return null;
    for (let i = 0; i < out.length; i++) out[i] = out[i]! / used;
    return out;
  };
  let top = line(true, y0 - 1, -1);
  let bottom = line(true, y1, 1);
  const left = line(false, x0 - 1, -1);
  const right = line(false, x1, 1);
  if (!top && !bottom) return;
  // The rows below only count when they look like the rows above (a page carrying on, not the taskbar).
  if (top && bottom) {
    let diff = 0;
    for (let i = 0; i < top.length; i++) diff += Math.abs(top[i]! - bottom[i]!);
    if (diff / top.length > 24) bottom = null;
  }
  if (!top) { top = bottom; bottom = null; }
  // Evened out sideways a little, so a photo's detail doesn't run down as stripes (plain stays plain).
  const soften = (row: Float32Array): Float32Array => {
    const rad = Math.max(1, Math.round(h / 6));
    const out = new Float32Array(row.length);
    for (let i = 0; i < w; i++) {
      const a = Math.max(0, i - rad);
      const b = Math.min(w - 1, i + rad);
      for (let c = 0; c < 3; c++) {
        let s = 0;
        for (let k = a; k <= b; k++) s += row[k * 3 + c]!;
        out[i * 3 + c] = s / (b - a + 1);
      }
    }
    return out;
  };
  const T = soften(top!);
  if (bottom) bottom = soften(bottom);
  const reach = Math.max(1, h);
  for (let y = 0; y < h; y++) {
    const v = h > 1 ? y / (h - 1) : 0;
    for (let x = 0; x < w; x++) {
      const u = w > 1 ? x / (w - 1) : 0;
      // Sideways weight: 1 at the ends, none further in than the rectangle's height.
      const side = Math.max(0, 1 - Math.min(x + 1, w - x) / reach);
      const o = ((y0 + y) * W + x0 + x) * 4;
      for (let c = 0; c < 3; c++) {
        const t = T[x * 3 + c]!;
        const vert = bottom ? t + (bottom[x * 3 + c]! - t) * v : t;
        let val = vert;
        if (side > 0 && (left || right)) {
          const a = left ? left[y * 3 + c]! : right![y * 3 + c]!;
          const b = right ? right[y * 3 + c]! : a;
          val = vert + (a + (b - a) * u - vert) * side;
        }
        d[o + c] = val;
      }
      d[o + 3] = 255;
    }
  }
}

/** Where the page picture goes on the frame: page pixel (px, py) lands on (x + px·scale, y + py·scale). */
export interface ShotPlace {
  x: number;
  y: number;
  scale: number;
}

/**
 * How well a page picture fits the frame around the bar: the mean difference (0–255) of the pixels
 * in a band just above and beside the bar. `frame` holds the frame's pixels of `area`; `shot` the
 * page picture drawn at its estimated place over the same area grown by `slack` on every side; the
 * offset (dx, dy) moves the picture from that estimate. Points the picture doesn't cover don't fit.
 */
export function shotMismatch(frame: Uint8ClampedArray, shot: Uint8ClampedArray, area: BarRect, bar: BarRect, slack: number, dx: number, dy: number, step = 2): number {
  const aw = Math.round(area.w);
  const ah = Math.round(area.h);
  const sw = aw + slack * 2;
  const bx0 = Math.round(bar.x - area.x);
  const by0 = Math.round(bar.y - area.y);
  const bx1 = bx0 + Math.round(bar.w);
  const by1 = by0 + Math.round(bar.h);
  let sum = 0;
  let n = 0;
  const shift = ((slack - dy) * sw + (slack - dx)) * 4;
  // One run of pixels on row y: from x0 to x1 (not included).
  const run = (y: number, x0: number, x1: number) => {
    const rowF = y * aw * 4;
    const rowS = rowF + y * slack * 8 + shift;
    for (let x = Math.max(0, x0); x < x1; x += step) {
      const f = rowF + x * 4;
      const s = rowS + x * 4;
      if (shot[s + 3]! < 250) sum += 255;
      else sum += (Math.abs(frame[f]! - shot[s]!) + Math.abs(frame[f + 1]! - shot[s + 1]!) + Math.abs(frame[f + 2]! - shot[s + 2]!)) / 3;
      n++;
    }
  };
  // The band above the bar, and the bands left and right of it (not the bar, not below it).
  for (let y = 0; y < Math.min(ah, by0 - 1); y += step) run(y, 0, aw);
  for (let y = Math.max(0, by0); y < Math.min(ah, by1); y += step) {
    run(y, 0, Math.min(aw, bx0 - 1));
    run(y, bx1 + 1, aw);
  }
  return n ? sum / n : 255;
}

/**
 * The offset (within ±slack) at which the page picture fits the frame best: every offset tried on
 * every sixth pixel (at the right offset everything matches, so few pixels tell), then the best one
 * and its neighbours on all of them. A small preference for the estimate itself
 * settles plain backgrounds, which fit anywhere.
 */
export function alignShot(frame: Uint8ClampedArray, shot: Uint8ClampedArray, area: BarRect, bar: BarRect, slack: number): { dx: number; dy: number; mismatch: number } {
  const score = (dx: number, dy: number, step: number) => shotMismatch(frame, shot, area, bar, slack, dx, dy, step) + 0.02 * (Math.abs(dx) + Math.abs(dy));
  let best = { dx: 0, dy: 0, s: score(0, 0, 6) };
  for (let dy = -slack; dy <= slack; dy++) {
    for (let dx = -slack; dx <= slack; dx++) {
      const s = score(dx, dy, 6);
      if (s < best.s) best = { dx, dy, s };
    }
  }
  const coarse = best;
  best = { ...coarse, s: score(coarse.dx, coarse.dy, 1) };
  for (let dy = coarse.dy - 1; dy <= coarse.dy + 1; dy++) {
    for (let dx = coarse.dx - 1; dx <= coarse.dx + 1; dx++) {
      if (Math.abs(dx) > slack || Math.abs(dy) > slack) continue;
      const s = score(dx, dy, 1);
      if (s < best.s) best = { dx, dy, s };
    }
  }
  return { dx: best.dx, dy: best.dy, mismatch: shotMismatch(frame, shot, area, bar, slack, best.dx, best.dy, 1) };
}

/**
 * Watches a recording's frames for the bar: looks a few times a second (on a small copy of the lower
 * part of the screen) and keeps its place in between; gone (hidden, or the user moved it away) after
 * two looks without it.
 */
export class ShareBarWatcher {
  rect: BarRect | null = null;
  private lastLook = -Infinity;
  private misses = 0;
  private probe: OffscreenCanvas | null = null;

  constructor(private readonly everyMs = 250) {}

  /** Looks again when it is time (always on the first frame); true when it looked. */
  update(frame: CanvasImageSource, fw: number, fh: number, now = performance.now()): boolean {
    if (now - this.lastLook < this.everyMs) return false;
    this.lastLook = now;
    // Lower 55% of the screen, at most 960 px wide.
    const top = Math.floor(fh * 0.45);
    const k = Math.min(1, 960 / fw);
    const pw = Math.max(1, Math.round(fw * k));
    const ph = Math.max(1, Math.round((fh - top) * k));
    if (!this.probe || this.probe.width !== pw || this.probe.height !== ph) this.probe = new OffscreenCanvas(pw, ph);
    const c = this.probe.getContext('2d', { willReadFrequently: true })!;
    c.drawImage(frame, 0, top, fw, fh - top, 0, 0, pw, ph);
    const found = findShareBar(c.getImageData(0, 0, pw, ph).data, pw, ph, Math.round(fh * k));
    if (found) {
      // Back to frame pixels, with a small margin for the bar's rounded edge and shadow.
      const m = 4 / k;
      this.rect = { x: found.x / k - m, y: top + found.y / k - m, w: found.w / k + m * 2, h: found.h / k + m * 2 };
      this.misses = 0;
    } else if (this.rect && ++this.misses >= 2) {
      this.rect = null;
    }
    return true;
  }
}
