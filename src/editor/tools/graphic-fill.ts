/*
 * Filling holes in screenshots and graphics. Rebuilding from patches (inpaint.ts) suits photos but
 * copies text and buttons on a page ("Follow" repeated into the hole). Here every hole pixel takes
 * the colour of the picture straight beside it: when the nearest pixels to the left and right
 * agree (a card, a bar, the page) that colour, otherwise the ones above and below, otherwise the
 * nearest one. Flat areas stay flat and edges (a card's border, a header's bottom line) carry
 * straight on through the hole; nothing is copied from elsewhere.
 */

const close = (d: Uint8ClampedArray, i: number, j: number) =>
  Math.abs(d[i]! - d[j]!) + Math.abs(d[i + 1]! - d[j + 1]!) + Math.abs(d[i + 2]! - d[j + 2]!) <= 36;

/** Share of known pixels exactly equal to their right-hand neighbour (screenshots ≈ 0.7+, photos low). */
export function knownFlatness(d: Uint8ClampedArray, hole: Uint8Array, w: number, h: number): number {
  let same = 0;
  let n = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w - 1; x++) {
      const p = y * w + x;
      if (hole[p] || hole[p + 1]) continue;
      const i = p * 4;
      if (d[i] === d[i + 4] && d[i + 1] === d[i + 5] && d[i + 2] === d[i + 6]) same++;
      n++;
    }
  }
  return n ? same / n : 0;
}

/** Returns a copy of `d` (RGBA, w × h) with the hole pixels filled from straight beside them. */
export function graphicFill(d: Uint8ClampedArray, hole: Uint8Array, w: number, h: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(d);
  const n = w * h;
  // Nearest known pixel in each direction (index, or -1).
  const left = new Int32Array(n).fill(-1);
  const right = new Int32Array(n).fill(-1);
  const up = new Int32Array(n).fill(-1);
  const down = new Int32Array(n).fill(-1);
  for (let y = 0; y < h; y++) {
    let last = -1;
    for (let x = 0; x < w; x++) { const p = y * w + x; if (!hole[p]) last = p; else left[p] = last; }
    last = -1;
    for (let x = w - 1; x >= 0; x--) { const p = y * w + x; if (!hole[p]) last = p; else right[p] = last; }
  }
  for (let x = 0; x < w; x++) {
    let last = -1;
    for (let y = 0; y < h; y++) { const p = y * w + x; if (!hole[p]) last = p; else up[p] = last; }
    last = -1;
    for (let y = h - 1; y >= 0; y--) { const p = y * w + x; if (!hole[p]) last = p; else down[p] = last; }
  }
  const put = (p: number, a: number, b: number, t: number) => {
    for (let c = 0; c < 4; c++) out[p * 4 + c] = d[a * 4 + c]! * (1 - t) + d[b * 4 + c]! * t;
  };
  for (let p = 0; p < n; p++) {
    if (!hole[p]) continue;
    const x = p % w;
    const y = (p - x) / w;
    const L = left[p]!, R = right[p]!, U = up[p]!, D = down[p]!;
    const dl = L >= 0 ? x - (L % w) : Infinity;
    const dr = R >= 0 ? (R % w) - x : Infinity;
    const du = U >= 0 ? y - Math.floor(U / w) : Infinity;
    const dd = D >= 0 ? Math.floor(D / w) - y : Infinity;
    const rowAgrees = L >= 0 && R >= 0 && close(d, L * 4, R * 4);
    const colAgrees = U >= 0 && D >= 0 && close(d, U * 4, D * 4);
    if (rowAgrees && (!colAgrees || dl + dr <= du + dd)) put(p, L, R, dl / (dl + dr));
    else if (colAgrees) put(p, U, D, du / (du + dd));
    else {
      // Neither direction agrees (a corner, an edge passing through): the nearest side wins.
      const best = Math.min(dl, dr, du, dd);
      const q = best === dl ? L : best === dr ? R : best === du ? U : D;
      if (q >= 0) put(p, q, q, 0);
    }
  }
  return out;
}
