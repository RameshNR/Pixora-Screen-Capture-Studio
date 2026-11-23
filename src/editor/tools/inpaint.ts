/*
 * Fills a hole in a picture with matching surroundings: sand stays sand, a wall's pattern carries
 * on, text on a plain background disappears into that background. The hole is rebuilt from small
 * patches of the picture around it (multi-scale PatchMatch with patch voting, the method behind
 * "content-aware fill"): coarse first so the overall structure fits, then finer and finer so the
 * texture matches. Runs on this computer; nothing is sent anywhere.
 */

export interface InpaintOptions {
  /** Patch radius (patches are 2r+1 wide). */
  radius?: number;
  /** Fixed seed: the same input always gives the same result. */
  seed?: number;
  /** Called with 0–1 as the work goes on. */
  onProgress?: (done: number) => void;
}

interface Level {
  w: number;
  h: number;
  /** RGBA, 0–255. */
  img: Float32Array;
  /** 1 = to be filled. */
  hole: Uint8Array;
}

function rng(seed: number) {
  let s = seed >>> 0 || 0x9e3779b9;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 0x100000000;
  };
}

function downsample(l: Level): Level {
  const w = Math.max(1, Math.ceil(l.w / 2));
  const h = Math.max(1, Math.ceil(l.h / 2));
  const img = new Float32Array(w * h * 4);
  const hole = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let n = 0;
      let any = 0;
      const acc = [0, 0, 0, 0];
      for (let dy = 0; dy < 2; dy++) {
        for (let dx = 0; dx < 2; dx++) {
          const sx = Math.min(l.w - 1, 2 * x + dx);
          const sy = Math.min(l.h - 1, 2 * y + dy);
          const si = sy * l.w + sx;
          if (l.hole[si]) { any = 1; continue; }
          for (let c = 0; c < 4; c++) acc[c]! += l.img[si * 4 + c]!;
          n++;
        }
      }
      const i = y * w + x;
      hole[i] = any;
      if (n) for (let c = 0; c < 4; c++) img[i * 4 + c] = acc[c]! / n;
    }
  }
  return { w, h, img, hole };
}

/** Fills the hole by spreading the colours around it inwards (a smooth first guess). */
function diffuse(l: Level): void {
  const { w, h, img } = l;
  const known = new Uint8Array(w * h);
  let front: number[] = [];
  for (let i = 0; i < w * h; i++) known[i] = l.hole[i] ? 0 : 1;
  for (let i = 0; i < w * h; i++) if (!known[i]) front.push(i);
  let guard = w + h + 4;
  while (front.length && guard-- > 0) {
    const set: Array<[number, number[]]> = [];
    const rest: number[] = [];
    for (const i of front) {
      const x = i % w;
      const y = (i - x) / w;
      const acc = [0, 0, 0, 0];
      let n = 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]] as const) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const j = ny * w + nx;
        if (!known[j]) continue;
        for (let c = 0; c < 4; c++) acc[c]! += img[j * 4 + c]!;
        n++;
      }
      if (n) set.push([i, acc.map((v) => v / n)]);
      else rest.push(i);
    }
    if (!set.length) break;
    for (const [i, v] of set) {
      for (let c = 0; c < 4; c++) img[i * 4 + c] = v[c]!;
      known[i] = 1;
    }
    front = rest;
  }
}

/** Summed-area table of the hole (for "does this patch touch the hole?"). */
function holeSums(l: Level): Int32Array {
  const { w, h, hole } = l;
  const s = new Int32Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      row += hole[y * w + x]!;
      s[(y + 1) * (w + 1) + x + 1] = s[y * (w + 1) + x + 1]! + row;
    }
  }
  return s;
}

function holesIn(s: Int32Array, w: number, x0: number, y0: number, x1: number, y1: number): number {
  const W = w + 1;
  return s[(y1 + 1) * W + x1 + 1]! - s[y0 * W + x1 + 1]! - s[(y1 + 1) * W + x0]! + s[y0 * W + x0]!;
}

/** One level: improve the hole's colours by matching patches and letting them vote. */
class Solver {
  readonly src: Uint8Array;
  readonly sources: Int32Array;
  readonly targets: Int32Array;
  readonly nnf: Int32Array;
  readonly dist: Float32Array;
  readonly isTarget: Uint8Array;

  constructor(readonly l: Level, readonly r: number, readonly rand: () => number) {
    const { w, h } = l;
    const s = holeSums(l);
    this.src = new Uint8Array(w * h);
    this.isTarget = new Uint8Array(w * h);
    const sources: number[] = [];
    const targets: number[] = [];
    for (let y = r; y < h - r; y++) {
      for (let x = r; x < w - r; x++) {
        const n = holesIn(s, w, x - r, y - r, x + r, y + r);
        const i = y * w + x;
        if (n === 0) { this.src[i] = 1; sources.push(i); }
        else { this.isTarget[i] = 1; targets.push(i); }
      }
    }
    this.sources = Int32Array.from(sources);
    this.targets = Int32Array.from(targets);
    this.nnf = new Int32Array(w * h).fill(-1);
    this.dist = new Float32Array(w * h).fill(Infinity);
  }

  get usable() { return this.sources.length > 0 && this.targets.length > 0; }

  randomSource(): number { return this.sources[Math.floor(this.rand() * this.sources.length)]!; }

  distance(p: number, q: number, best: number): number {
    const { w, img } = this.l;
    const r = this.r;
    let d = 0;
    for (let dy = -r; dy <= r; dy++) {
      let pi = (p + dy * w - r) * 4;
      let qi = (q + dy * w - r) * 4;
      for (let dx = -r; dx <= r; dx++, pi += 4, qi += 4) {
        const a = img[pi]! - img[qi]!;
        const b = img[pi + 1]! - img[qi + 1]!;
        const c = img[pi + 2]! - img[qi + 2]!;
        d += a * a + b * b + c * c;
      }
      if (d >= best) return d;
    }
    return d;
  }

  try(p: number, q: number): void {
    if (q < 0 || q >= this.src.length || !this.src[q] || q === this.nnf[p]) return;
    const d = this.distance(p, q, this.dist[p]!);
    if (d < this.dist[p]!) { this.dist[p] = d; this.nnf[p] = q; }
  }

  /** Sets every target's match (from `guess`, or at random) and its distance. */
  init(guess?: (p: number) => number): void {
    for (const p of this.targets) {
      let q = guess ? guess(p) : -1;
      if (q < 0 || !this.src[q]) q = this.randomSource();
      this.nnf[p] = q;
      this.dist[p] = this.distance(p, q, Infinity);
    }
  }

  refreshDistances(): void {
    for (const p of this.targets) this.dist[p] = this.distance(p, this.nnf[p]!, Infinity);
  }

  search(iterations: number): void {
    const { w, h } = this.l;
    const t = this.targets;
    for (let it = 0; it < iterations; it++) {
      const fwd = it % 2 === 0;
      const step = fwd ? -1 : 1;
      for (let k = fwd ? 0 : t.length - 1; fwd ? k < t.length : k >= 0; k += fwd ? 1 : -1) {
        const p = t[k]!;
        const x = p % w;
        // Neighbours' matches, shifted by one.
        const nx = p + step;
        if (x + step >= 0 && x + step < w && this.isTarget[nx]) this.try(p, this.nnf[nx]! - step);
        const ny = p + step * w;
        if (ny >= 0 && ny < w * h && this.isTarget[ny]) this.try(p, this.nnf[ny]! - step * w);
        // Random tries around the current match, closer and closer.
        const q = this.nnf[p]!;
        const qx = q % w;
        const qy = (q - qx) / w;
        for (let R = Math.max(w, h); R >= 1; R >>= 1) {
          const sx = Math.round(qx + (this.rand() * 2 - 1) * R);
          const sy = Math.round(qy + (this.rand() * 2 - 1) * R);
          if (sx < 0 || sy < 0 || sx >= w || sy >= h) continue;
          this.try(p, sy * w + sx);
        }
      }
    }
  }

  /** Each hole pixel becomes the weighted average of what the patches covering it suggest. */
  vote(): void {
    const { w, img, hole } = this.l;
    const r = this.r;
    const n = w * this.l.h;
    const acc = new Float32Array(n * 4);
    const wsum = new Float32Array(n);
    const area = (2 * r + 1) * (2 * r + 1) * 3;
    // Typical patch difference: a match much worse than that counts much less.
    let mean = 0;
    for (const p of this.targets) mean += this.dist[p]! / area;
    mean = Math.max(25, mean / Math.max(1, this.targets.length));
    for (const p of this.targets) {
      const q = this.nnf[p]!;
      const wt = Math.exp(-(this.dist[p]! / area) / (2 * mean)) + 1e-6;
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const xi = p + dy * w + dx;
          if (!hole[xi]) continue;
          const qi = (q + dy * w + dx) * 4;
          acc[xi * 4]! += wt * img[qi]!;
          acc[xi * 4 + 1]! += wt * img[qi + 1]!;
          acc[xi * 4 + 2]! += wt * img[qi + 2]!;
          acc[xi * 4 + 3]! += wt * img[qi + 3]!;
          wsum[xi]! += wt;
        }
      }
    }
    for (let i = 0; i < n; i++) {
      if (!hole[i] || !wsum[i]) continue;
      for (let c = 0; c < 4; c++) img[i * 4 + c] = acc[i * 4 + c]! / wsum[i]!;
    }
  }
}

/**
 * Returns a copy of `rgba` (w × h) with the pixels where `hole` is 1 rebuilt from the rest of the
 * picture. Pixels outside the hole are not changed.
 */
export function inpaint(rgba: Uint8ClampedArray, w: number, h: number, hole: Uint8Array, opts: InpaintOptions = {}): Uint8ClampedArray {
  const r = opts.radius ?? 3;
  const rand = rng(opts.seed ?? 1);
  const out = new Uint8ClampedArray(rgba);
  let any = false;
  for (let i = 0; i < hole.length; i++) if (hole[i]) { any = true; break; }
  if (!any) return out;

  const top: Level = { w, h, img: Float32Array.from(rgba), hole: Uint8Array.from(hole) };
  const levels: Level[] = [top];
  for (;;) {
    const l = levels[levels.length - 1]!;
    if (Math.min(l.w, l.h) / 2 < (2 * r + 1) * 3 || levels.length >= 8) break;
    let minX = l.w, minY = l.h, maxX = -1, maxY = -1;
    for (let y = 0; y < l.h; y++) for (let x = 0; x < l.w; x++) if (l.hole[y * l.w + x]) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
    if (Math.max(maxX - minX, maxY - minY) + 1 <= 2 * r + 1) break;
    levels.push(downsample(l));
  }

  const total = levels.reduce((s, l, i) => s + l.w * l.h * (i === 0 ? 2 : 4), 0);
  let done = 0;
  let prev: Solver | null = null;
  for (let li = levels.length - 1; li >= 0; li--) {
    const l = levels[li]!;
    if (!prev) diffuse(l);
    else {
      // Start from the coarser result: its colours, and its matches scaled up.
      const pl = prev.l;
      for (let y = 0; y < l.h; y++) {
        for (let x = 0; x < l.w; x++) {
          const i = y * l.w + x;
          if (!l.hole[i]) continue;
          const j = Math.min(pl.h - 1, y >> 1) * pl.w + Math.min(pl.w - 1, x >> 1);
          for (let c = 0; c < 4; c++) l.img[i * 4 + c] = pl.img[j * 4 + c]!;
        }
      }
    }
    const s = new Solver(l, r, rand);
    if (!s.usable) {
      if (prev) diffuse(l);
      prev = s;
      continue;
    }
    const before = prev;
    s.init(before ? (p) => {
      const x = p % l.w;
      const y = (p - x) / l.w;
      const pl = before.l;
      const cp = Math.min(pl.h - 1, y >> 1) * pl.w + Math.min(pl.w - 1, x >> 1);
      const cq = before.nnf[cp]!;
      if (cq < 0) return -1;
      const qx = 2 * (cq % pl.w) + (x & 1);
      const qy = 2 * Math.floor(cq / pl.w) + (y & 1);
      return qx < l.w && qy < l.h ? qy * l.w + qx : -1;
    } : undefined);
    const finest = li === 0;
    // Most of the work is at the coarse levels (cheap); the full-size level only sharpens the result.
    const big = s.targets.length > 40_000;
    const coarsest = li === levels.length - 1;
    const em = finest ? (big ? 1 : 2) : coarsest ? 6 : li === 1 && big ? 2 : 3;
    for (let e = 0; e < em; e++) {
      s.search(finest ? (big ? 1 : 2) : coarsest ? 3 : 2);
      s.vote();
      if (e < em - 1) s.refreshDistances();
    }
    done += l.w * l.h * (finest ? 2 : 4);
    opts.onProgress?.(Math.min(1, done / total));
    prev = s;
  }

  for (let i = 0; i < hole.length; i++) {
    if (!hole[i]) continue;
    for (let c = 0; c < 4; c++) out[i * 4 + c] = Math.round(top.img[i * 4 + c]!);
  }
  return out;
}
