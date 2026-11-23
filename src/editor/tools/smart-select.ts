/*
 * Selecting things in screenshots and graphics (flat colours, sharp edges), where photo-trained
 * AI models fail: a click on a button, badge, bar or arrow selects exactly that shape (with the
 * text on it); a click on a letter selects the word / line of text it belongs to. Also tells
 * graphics from photos, and finds the background of a graphic (for Remove background).
 */

type RGBA = Uint8ClampedArray;

const diff = (d: RGBA, i: number, j: number) => Math.abs(d[i]! - d[j]!) + Math.abs(d[i + 1]! - d[j + 1]!) + Math.abs(d[i + 2]! - d[j + 2]!);
const diffTo = (d: RGBA, i: number, c: readonly number[]) => Math.abs(d[i]! - c[0]!) + Math.abs(d[i + 1]! - c[1]!) + Math.abs(d[i + 2]! - c[2]!);

/**
 * Share (0–1) of pixels equal to their right-hand neighbour, around (x, y) or over the whole
 * picture: screenshots and graphics are mostly flat (≈0.7+), photos are not. With tolerance 0
 * (exactly equal), smooth photos and renders (JPEG) count as photos too.
 */
export function flatness(d: RGBA, w: number, h: number, around?: { x: number; y: number; r: number }, tolerance = 6): number {
  const x0 = around ? Math.max(0, Math.round(around.x - around.r)) : 0;
  const x1 = around ? Math.min(w - 2, Math.round(around.x + around.r)) : w - 2;
  const y0 = around ? Math.max(0, Math.round(around.y - around.r)) : 0;
  const y1 = around ? Math.min(h - 1, Math.round(around.y + around.r)) : h - 1;
  const step = Math.max(1, Math.floor(Math.sqrt(((x1 - x0 + 1) * (y1 - y0 + 1)) / 60000)));
  let same = 0;
  let n = 0;
  for (let y = y0; y <= y1; y += step) {
    for (let x = x0; x <= x1; x += step) {
      const i = (y * w + x) * 4;
      if (diff(d, i, i + 4) <= tolerance) same++;
      n++;
    }
  }
  return n ? same / n : 0;
}

/** Pixels connected to `seeds` whose colour stays close to their neighbour's and to `ref`. */
function grow(d: RGBA, w: number, h: number, seeds: number[], ref: readonly number[] | null, step: number, far: number, limit?: { x0: number; y0: number; x1: number; y1: number }): Uint8Array {
  const out = new Uint8Array(w * h);
  const stack: number[] = [];
  for (const s of seeds) if (!out[s]) { out[s] = 1; stack.push(s); }
  while (stack.length) {
    const p = stack.pop()!;
    const x = p % w;
    const y = (p - x) / w;
    const nb = [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1];
    for (const q of nb) {
      if (q < 0 || out[q]) continue;
      if (limit) {
        const qx = q % w;
        const qy = (q - qx) / w;
        if (qx < limit.x0 || qx > limit.x1 || qy < limit.y0 || qy > limit.y1) continue;
      }
      if (diff(d, p * 4, q * 4) > step) continue;
      if (ref && diffTo(d, q * 4, ref) > far) continue;
      out[q] = 1;
      stack.push(q);
    }
  }
  return out;
}

function bounds(m: Uint8Array, w: number, h: number) {
  let x0 = w, y0 = h, x1 = -1, y1 = -1, n = 0;
  for (let i = 0; i < m.length; i++) {
    if (!m[i]) continue;
    n++;
    const x = i % w;
    const y = (i - x) / w;
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  return { x0, y0, x1, y1, n };
}

/** Sides of the picture the region runs along (more than a fifth of the side). */
function sides(m: Uint8Array, w: number, h: number): number {
  let s = 0;
  let k = 0;
  for (let x = 0; x < w; x++) k += m[x]!;
  if (k > w / 5) s++;
  k = 0;
  for (let x = 0; x < w; x++) k += m[(h - 1) * w + x]!;
  if (k > w / 5) s++;
  k = 0;
  for (let y = 0; y < h; y++) k += m[y * w]!;
  if (k > h / 5) s++;
  k = 0;
  for (let y = 0; y < h; y++) k += m[y * w + w - 1]!;
  if (k > h / 5) s++;
  return s;
}

const count1 = (m: Uint8Array) => { let n = 0; for (let i = 0; i < m.length; i++) n += m[i]!; return n; };

/** Fills the holes of a region (text on a button, the "1" in a badge) within its box. */
function fillHoles(m: Uint8Array, w: number, h: number): Uint8Array {
  const b = bounds(m, w, h);
  if (b.n === 0) return m;
  const bw = b.x1 - b.x0 + 3;
  const bh = b.y1 - b.y0 + 3;
  // Outside of the region, reachable from around its box.
  const outside = new Uint8Array(bw * bh);
  const at = (x: number, y: number) => {
    const ix = x + b.x0 - 1;
    const iy = y + b.y0 - 1;
    return ix >= 0 && iy >= 0 && ix < w && iy < h ? m[iy * w + ix]! : 0;
  };
  const stack = [0];
  outside[0] = 1;
  while (stack.length) {
    const p = stack.pop()!;
    const x = p % bw;
    const y = (p - x) / bw;
    for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]] as const) {
      if (nx < 0 || ny < 0 || nx >= bw || ny >= bh) continue;
      const q = ny * bw + nx;
      if (outside[q] || at(nx, ny)) continue;
      outside[q] = 1;
      stack.push(q);
    }
  }
  const out = Uint8Array.from(m);
  for (let y = 1; y < bh - 1; y++) {
    for (let x = 1; x < bw - 1; x++) {
      if (!outside[y * bw + x]) out[(y + b.y0 - 1) * w + x + b.x0 - 1] = 1;
    }
  }
  return out;
}

/** Most common colour (quantised) of the pixels in `idx`. */
function dominant(d: RGBA, idx: number[]): number[] {
  const count = new Map<number, number>();
  for (const i of idx) {
    const key = ((d[i]! >> 3) << 10) | ((d[i + 1]! >> 3) << 5) | (d[i + 2]! >> 3);
    count.set(key, (count.get(key) ?? 0) + 1);
  }
  let best = 0;
  let bestN = -1;
  for (const [k, n] of count) if (n > bestN) { best = k; bestN = n; }
  return [((best >> 10) & 31) * 8 + 4, ((best >> 5) & 31) * 8 + 4, (best & 31) * 8 + 4];
}

/** Grows a 0/1 mask by r px (square). */
function dilate(m: Uint8Array, w: number, _h: number, r: number, box: { x0: number; y0: number; x1: number; y1: number }): Uint8Array {
  const tmp = new Uint8Array(m.length);
  const out = new Uint8Array(m.length);
  for (let y = box.y0; y <= box.y1; y++) {
    let last = -1e9;
    for (let x = box.x0; x <= box.x1 + r; x++) {
      if (x <= box.x1 && m[y * w + x]) last = x;
      const t = x - r;
      if (t >= box.x0 && t <= box.x1 && x - last <= 2 * r) tmp[y * w + t] = 1;
    }
  }
  for (let x = box.x0; x <= box.x1; x++) {
    let last = -1e9;
    for (let y = box.y0; y <= box.y1 + r; y++) {
      if (y <= box.y1 && tmp[y * w + x]) last = y;
      const t = y - r;
      if (t >= box.y0 && t <= box.y1 && y - last <= 2 * r) out[t * w + x] = 1;
    }
  }
  return out;
}

/**
 * The thing at (px, py) in a graphic, as a 0/1 mask, or null when the click is on the
 * background (nothing there).
 */
export function selectInGraphic(d: RGBA, w: number, h: number, px: number, py: number): Uint8Array | null {
  const x = Math.max(0, Math.min(w - 1, Math.round(px)));
  const y = Math.max(0, Math.min(h - 1, Math.round(py)));
  const seed = y * w + x;
  const c0 = [d[seed * 4]!, d[seed * 4 + 1]!, d[seed * 4 + 2]!];
  const region = grow(d, w, h, [seed], c0, 24, 90);
  const b = bounds(region, w, h);
  const area = w * h;
  let big = b.n > area * 0.35 || sides(region, w, h) >= 2;
  const small = b.n < 600 || Math.min(b.x1 - b.x0, b.y1 - b.y0) < 14;
  if (!big && !small) {
    const filled = fillHoles(region, w, h);
    // A button or badge has a little text on it; a page or card has lots of other things on it:
    // that is a background, not the thing to select.
    const holes = count1(filled) - b.n;
    // A large surface with other things on it (a page, a card) is a background too.
    const surface = b.n > area * 0.08 && holes > b.n * 0.08;
    if (holes <= b.n * 0.6 && !surface) return filled;
    big = true;
  }

  // A thin thing (a letter, an icon's line) or the background: what stands out from the
  // background colour here, joined into words / lines.
  const ring: number[] = [];
  const pad = big ? 2 : 3;
  const rx0 = Math.max(0, (big ? x : b.x0) - pad), rx1 = Math.min(w - 1, (big ? x : b.x1) + pad);
  const ry0 = Math.max(0, (big ? y : b.y0) - pad), ry1 = Math.min(h - 1, (big ? y : b.y1) + pad);
  for (let xx = rx0; xx <= rx1; xx++) ring.push((ry0 * w + xx) * 4, (ry1 * w + xx) * 4);
  for (let yy = ry0; yy <= ry1; yy++) ring.push((yy * w + rx0) * 4, (yy * w + rx1) * 4);
  const bg = big ? c0 : dominant(d, ring);
  if (!big) {
    // Text or an icon on a button / badge: select the button with it, when it is one.
    const start = ring.find((i) => diffTo(d, i, bg) <= 24);
    if (start !== undefined) {
      const holder = grow(d, w, h, [start / 4], bg, 24, 90);
      const hb = bounds(holder, w, h);
      if (hb.n < area * 0.2 && sides(holder, w, h) === 0 && hb.n > b.n) {
        const filled = fillHoles(holder, w, h);
        if (filled[seed] && count1(filled) - hb.n <= hb.n * 0.6) return filled;
      }
    }
  }
  if (big) {
    // Clicked on the background itself: is there something right here (within a few px)?
    let near = -1;
    for (let r = 1; r <= 10 && near < 0; r++) {
      for (let dy = -r; dy <= r && near < 0; dy++) for (let dx = -r; dx <= r; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        if (diffTo(d, (ny * w + nx) * 4, bg) > 60) { near = ny * w + nx; break; }
      }
    }
    if (near < 0) return null;
  }
  const glyphH = big ? 16 : Math.max(8, b.y1 - b.y0 + 1);
  const gap = Math.max(2, Math.round(glyphH * 0.4));
  const box = {
    x0: Math.max(0, x - glyphH * 30), x1: Math.min(w - 1, x + glyphH * 30),
    y0: Math.max(0, y - glyphH * 2), y1: Math.min(h - 1, y + glyphH * 2),
  };
  const fg = new Uint8Array(w * h);
  for (let yy = box.y0; yy <= box.y1; yy++) for (let xx = box.x0; xx <= box.x1; xx++) {
    const i = yy * w + xx;
    if (diffTo(d, i * 4, bg) > 60) fg[i] = 1;
  }
  const joined = dilate(fg, w, h, gap, box);
  let start = joined[seed] ? seed : -1;
  if (start < 0) {
    for (let r = 1; r <= 8 && start < 0; r++) for (let dy = -r; dy <= r && start < 0; dy++) for (let dx = -r; dx <= r; dx++) {
      const q = (y + dy) * w + x + dx;
      if (y + dy >= 0 && y + dy < h && x + dx >= 0 && x + dx < w && joined[q]) { start = q; break; }
    }
  }
  if (start < 0) return null;
  // The word / line: the joined pixels connected to the click, kept to the text's own pixels
  // plus a small margin.
  const comp = new Uint8Array(w * h);
  const stack = [start];
  comp[start] = 1;
  while (stack.length) {
    const p = stack.pop()!;
    const px2 = p % w;
    const py2 = (p - px2) / w;
    for (const q of [px2 > box.x0 ? p - 1 : -1, px2 < box.x1 ? p + 1 : -1, py2 > box.y0 ? p - w : -1, py2 < box.y1 ? p + w : -1]) {
      if (q < 0 || comp[q] || !joined[q]) continue;
      comp[q] = 1;
      stack.push(q);
    }
  }
  const cb = bounds(comp, w, h);
  // A whole background area joined up is not "a word": give up (the AI or the brush can do it).
  if (cb.n > area * 0.3) return null;
  const out = new Uint8Array(w * h);
  const margin = Math.max(1, Math.round(gap / 2));
  for (let yy = cb.y0; yy <= cb.y1; yy++) for (let xx = cb.x0; xx <= cb.x1; xx++) {
    const i = yy * w + xx;
    if (!comp[i]) continue;
    // Keep the joined shape but trim the dilation back to `margin` beyond the text.
    let close = false;
    for (let dy = -margin; dy <= margin && !close; dy++) for (let dx = -margin; dx <= margin; dx++) {
      const ny = yy + dy, nx = xx + dx;
      if (nx >= 0 && ny >= 0 && nx < w && ny < h && fg[ny * w + nx]) { close = true; break; }
    }
    if (close) out[i] = 1;
  }
  return out;
}

/** Fills the holes of a 0–255 mask (in place, set to 255): parts enclosed by the selection belong to it. */
export function fillMaskHoles(m: Uint8ClampedArray, w: number, h: number): void {
  const bin = new Uint8Array(m.length);
  for (let i = 0; i < m.length; i++) bin[i] = m[i]! > 127 ? 1 : 0;
  const filled = fillHoles(bin, w, h);
  for (let i = 0; i < m.length; i++) if (filled[i] && !bin[i]) m[i] = 255;
}

/**
 * A picture block on a page (a product photo, a banner, an image in a screenshot): everything
 * connected to (x, y) that is not the page's own colour, with the holes inside filled (the white
 * parts of a product, its label). 0/1 mask, or null when (x, y) is on the page itself.
 */
export function blobAt(d: RGBA, w: number, h: number, px: number, py: number): Uint8Array | null {
  // The page colour: the most common colour of the picture.
  const sample: number[] = [];
  const step = Math.max(1, Math.floor(Math.sqrt((w * h) / 40000)));
  for (let y = 0; y < h; y += step) for (let x = 0; x < w; x += step) sample.push((y * w + x) * 4);
  const page = dominant(d, sample);
  const x0 = Math.max(0, Math.min(w - 1, Math.round(px)));
  const y0 = Math.max(0, Math.min(h - 1, Math.round(py)));
  const seed = y0 * w + x0;
  if (diffTo(d, seed * 4, page) <= 24) return null;
  const out = new Uint8Array(w * h);
  const stack = [seed];
  out[seed] = 1;
  let n = 1;
  while (stack.length) {
    const p = stack.pop()!;
    const x = p % w;
    for (const q of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, p - w, p + w]) {
      if (q < 0 || q >= out.length || out[q] || diffTo(d, q * 4, page) <= 24) continue;
      out[q] = 1;
      n++;
      stack.push(q);
    }
  }
  if (n < 64) return null;
  return fillHoles(out, w, h);
}

/**
 * The background of a graphic (a logo or product on a plain colour): the colour along the
 * picture's edges, grown inwards. Returns the subject (everything else) as 0/1, or null.
 */
export function graphicSubject(d: RGBA, w: number, h: number): { mask: Uint8Array; colors: number[][] } | null {
  const edge: number[] = [];
  for (let x = 0; x < w; x++) edge.push(x * 4, ((h - 1) * w + x) * 4);
  for (let y = 0; y < h; y++) edge.push(y * w * 4, (y * w + w - 1) * 4);
  // The background can have several colours (stripes, a two-tone page): every colour that covers
  // a good share of the edges counts. A subject only touching the edge stays.
  const key = (i: number) => ((d[i]! >> 4) << 8) | ((d[i + 1]! >> 4) << 4) | (d[i + 2]! >> 4);
  const share = new Map<number, number[]>();
  for (const i of edge) { const k = key(i); const list = share.get(k); if (list) list.push(i); else share.set(k, [i]); }
  const back = new Uint8Array(w * h);
  let covered = 0;
  const colors: number[][] = [];
  // Which side each edge pixel is on (top, bottom, left, right).
  const sideOf = (i: number) => {
    const p = i / 4;
    const x = p % w;
    const y = (p - x) / w;
    return y === 0 ? 0 : y === h - 1 ? 1 : x === 0 ? 2 : 3;
  };
  for (const list of share.values()) {
    if (list.length < edge.length * 0.08) continue;
    // A background runs along at least two sides (a page, a backdrop); a colour along one side
    // only is part of the picture (a page header, a footer bar) and stays.
    const perSide = [0, 0, 0, 0];
    for (const i of list) perSide[sideOf(i)]!++;
    const sides = [perSide[0]! / w, perSide[1]! / w, perSide[2]! / h, perSide[3]! / h].filter((s) => s >= 0.25).length;
    if (sides < 2) continue;
    covered += list.length;
    const ref = dominant(d, list);
    colors.push(ref);
    const grown = grow(d, w, h, list.map((i) => i / 4), ref, 30, 60);
    for (let i = 0; i < back.length; i++) if (grown[i]) back[i] = 1;
  }
  if (covered < edge.length * 0.3) return null;
  const subject = new Uint8Array(w * h);
  let n = 0;
  for (let i = 0; i < subject.length; i++) if (!back[i]) { subject[i] = 1; n++; }
  if (n < w * h * 0.003 || n > w * h * 0.97) return null;
  return { mask: subject, colors };
}

/**
 * Exact edges for a graphic's subject: along the outline, each pixel is as see-through as it is
 * close to the background colour (anti-aliased edges become soft, nothing else does), and the
 * background colour is taken out of those edge pixels — no leftover tint of the old background.
 * `mask` (0–255) is changed in place; returns the cleaned pixels (RGBA) to draw the subject from.
 */
export function graphicEdges(d: RGBA, w: number, h: number, mask: Uint8ClampedArray, colors: number[][]): Uint8ClampedArray {
  const out = new Uint8ClampedArray(d);
  if (!colors.length) return out;
  const near = (i: number) => {
    let best = Infinity;
    let c = colors[0]!;
    for (const k of colors) { const v = diffTo(d, i, k); if (v < best) { best = v; c = k; } }
    return { dist: best, c };
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      // Only along the outline: a pixel with both subject and background within 2 px (smoothed
      // edges and rounded corners blend over about two pixels).
      const v = mask[p]!;
      let edge = v > 0 && v < 255;
      for (let dy = -2; dy <= 2 && !edge; dy++) for (let dx = -2; dx <= 2; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < w && ny < h && (mask[ny * w + nx]! > 127) !== (v > 127)) { edge = true; break; }
      }
      if (!edge) continue;
      const i = p * 4;
      const { dist, c } = near(i);
      // The subject's own colour here: the solid subject pixel nearby that is most unlike the
      // background. The edge pixel is a blend of the two: its share of the way from the
      // background colour to that colour is how solid it is.
      let full = 0;
      for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h || mask[ny * w + nx]! <= 127) continue;
        const v2 = diffTo(d, (ny * w + nx) * 4, c);
        if (v2 > full) full = v2;
      }
      const a = full > 24 ? Math.max(0, Math.min(1, (dist - 6) / (full - 6))) : Math.max(0, Math.min(1, (dist - 12) / 58));
      mask[p] = Math.round(a * 255);
      if (a > 0 && a < 1) {
        // Un-mix: pixel = a·subject + (1 − a)·background.
        for (let ch = 0; ch < 3; ch++) out[i + ch] = (d[i + ch]! - (1 - a) * c[ch]!) / a;
      }
    }
  }
  return out;
}
