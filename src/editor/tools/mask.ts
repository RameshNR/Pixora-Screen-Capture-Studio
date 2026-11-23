/*
 * Masks (0–255 per pixel, the picture's size) for the retouch tools: growing them, and fitting a
 * rough mask to the picture's own edges (guided filter), so hair and fine edges keep their detail.
 */

/** Box average of `src` (w × h) over a (2r+1)² window, edges clamped. */
export function boxBlur(src: Float32Array, w: number, h: number, r: number): Float32Array {
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let acc = 0;
    for (let x = -r; x <= r; x++) acc += src[row + Math.min(w - 1, Math.max(0, x))]!;
    for (let x = 0; x < w; x++) {
      tmp[row + x] = acc / (2 * r + 1);
      acc += src[row + Math.min(w - 1, x + r + 1)]! - src[row + Math.max(0, x - r)]!;
    }
  }
  for (let x = 0; x < w; x++) {
    let acc = 0;
    for (let y = -r; y <= r; y++) acc += tmp[Math.min(h - 1, Math.max(0, y)) * w + x]!;
    for (let y = 0; y < h; y++) {
      out[y * w + x] = acc / (2 * r + 1);
      acc += tmp[Math.min(h - 1, y + r + 1) * w + x]! - tmp[Math.max(0, y - r) * w + x]!;
    }
  }
  return out;
}

/**
 * Fits `mask` to the edges in `rgba` (guided filter, He et al.): where the picture has an edge
 * the mask follows it, so a soft or blocky mask becomes crisp along a shoulder and fine along hair.
 */
export function refineToEdges(mask: Uint8ClampedArray, rgba: Uint8ClampedArray, w: number, h: number, radius = 8, eps = 0.0008): Uint8ClampedArray {
  const n = w * h;
  const I = new Float32Array(n);
  const p = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    I[i] = (0.299 * rgba[i * 4]! + 0.587 * rgba[i * 4 + 1]! + 0.114 * rgba[i * 4 + 2]!) / 255;
    p[i] = mask[i]! / 255;
  }
  const II = new Float32Array(n);
  const Ip = new Float32Array(n);
  for (let i = 0; i < n; i++) { II[i] = I[i]! * I[i]!; Ip[i] = I[i]! * p[i]!; }
  const mI = boxBlur(I, w, h, radius);
  const mp = boxBlur(p, w, h, radius);
  const mII = boxBlur(II, w, h, radius);
  const mIp = boxBlur(Ip, w, h, radius);
  const a = new Float32Array(n);
  const b = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const v = mII[i]! - mI[i]! * mI[i]!;
    const cov = mIp[i]! - mI[i]! * mp[i]!;
    a[i] = cov / (v + eps);
    b[i] = mp[i]! - a[i]! * mI[i]!;
  }
  const ma = boxBlur(a, w, h, radius);
  const mb = boxBlur(b, w, h, radius);
  const out = new Uint8ClampedArray(n);
  for (let i = 0; i < n; i++) out[i] = Math.round((ma[i]! * I[i]! + mb[i]!) * 255);
  return out;
}

/** Grows (r > 0) or shrinks (r < 0) a mask by about |r| px. */
export function growMask(mask: Uint8ClampedArray, w: number, h: number, r: number): Uint8ClampedArray {
  if (!r) return mask;
  const k = Math.abs(Math.round(r));
  const grow = r > 0;
  // Growing a small selection in a big picture: only its box (plus k) can change — work there.
  if (grow) {
    const b = maskBounds(mask, w, h);
    if (!b) return new Uint8ClampedArray(mask.length);
    const x0 = Math.max(0, b.x - k), y0 = Math.max(0, b.y - k);
    const x1 = Math.min(w, b.x + b.w + k), y1 = Math.min(h, b.y + b.h + k);
    const sw = x1 - x0, sh = y1 - y0;
    if (sw * sh < w * h * 0.6) {
      const part = new Uint8ClampedArray(sw * sh);
      for (let y = 0; y < sh; y++) part.set(mask.subarray((y + y0) * w + x0, (y + y0) * w + x1), y * sw);
      const grown = growMask(part, sw, sh, r);
      const out = new Uint8ClampedArray(mask.length);
      for (let y = 0; y < sh; y++) out.set(grown.subarray(y * sw, y * sw + sw), (y + y0) * w + x0);
      return out;
    }
  }
  const tmp = new Uint8ClampedArray(mask.length);
  const out = new Uint8ClampedArray(mask.length);
  // Max / min over a window of 2k+1, in rows then in columns. The van Herk / Gil–Werman method:
  // a constant number of steps per pixel whatever the window (a 20-megapixel photo stays fast).
  const len = Math.max(w, h) + 2 * k + 2;
  const line = new Uint8ClampedArray(len);
  const pre = new Uint8ClampedArray(len);
  const suf = new Uint8ClampedArray(len);
  const win = 2 * k + 1;
  const pass = (count: number, size: number, at: (line: number, i: number) => number, read: Uint8ClampedArray, write: Uint8ClampedArray) => {
    for (let l = 0; l < count; l++) {
      const n = size + 2 * k;
      for (let i = 0; i < n; i++) {
        const j = i - k;
        // Beyond the edge: the edge pixel itself (as before: edges clamp).
        line[i] = read[at(l, j < 0 ? 0 : j >= size ? size - 1 : j)]!;
      }
      for (let i = 0; i < n; i++) {
        const v = line[i]!;
        pre[i] = i % win === 0 ? v : grow ? Math.max(pre[i - 1]!, v) : Math.min(pre[i - 1]!, v);
      }
      for (let i = n - 1; i >= 0; i--) {
        const v = line[i]!;
        suf[i] = i === n - 1 || (i + 1) % win === 0 ? v : grow ? Math.max(suf[i + 1]!, v) : Math.min(suf[i + 1]!, v);
      }
      // Window [i, i + win − 1] in the padded line is output pixel i.
      for (let i = 0; i < size; i++) {
        const a = suf[i]!;
        const b = pre[i + win - 1]!;
        write[at(l, i)] = grow ? Math.max(a, b) : Math.min(a, b);
      }
    }
  };
  pass(h, w, (y, x) => y * w + x, mask, tmp);
  pass(w, h, (x, y) => y * w + x, tmp, out);
  return out;
}

/** 1 where the mask is set (above `threshold`). */
export function holeOf(mask: Uint8ClampedArray, threshold = 8): Uint8Array {
  const out = new Uint8Array(mask.length);
  for (let i = 0; i < mask.length; i++) out[i] = mask[i]! > threshold ? 1 : 0;
  return out;
}

/** Bounding box of the set pixels, or null. */
export function maskBounds(mask: ArrayLike<number>, w: number, h: number, threshold = 0): { x: number; y: number; w: number; h: number } | null {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      if (mask[row + x]! > threshold) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}
