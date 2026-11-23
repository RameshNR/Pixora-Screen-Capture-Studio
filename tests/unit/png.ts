import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

/** Minimal PNG reader for tests (8-bit RGB / RGBA, not interlaced). */
export function readPng(path: string): { data: Uint8ClampedArray; width: number; height: number } {
  const b = readFileSync(path);
  let i = 8;
  let width = 0, height = 0, type = 0;
  const idat: Buffer[] = [];
  while (i < b.length) {
    const len = b.readUInt32BE(i);
    const t = b.toString('ascii', i + 4, i + 8);
    const body = b.subarray(i + 8, i + 8 + len);
    if (t === 'IHDR') { width = body.readUInt32BE(0); height = body.readUInt32BE(4); type = body[9]!; }
    if (t === 'IDAT') idat.push(body);
    i += 12 + len;
  }
  const bpp = type === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * bpp;
  const px = new Uint8Array(height * stride);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)]!;
    const src = y * (stride + 1) + 1;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? px[y * stride + x - bpp]! : 0;
      const up = y ? px[(y - 1) * stride + x]! : 0;
      const c = x >= bpp && y ? px[(y - 1) * stride + x - bpp]! : 0;
      let v = raw[src + x]!;
      if (f === 1) v += a;
      else if (f === 2) v += up;
      else if (f === 3) v += (a + up) >> 1;
      else if (f === 4) { const p = a + up - c; const pa = Math.abs(p - a), pb = Math.abs(p - up), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? up : c; }
      px[y * stride + x] = v & 255;
    }
  }
  const data = new Uint8ClampedArray(width * height * 4);
  for (let p = 0; p < width * height; p++) {
    data[p * 4] = px[p * bpp]!; data[p * 4 + 1] = px[p * bpp + 1]!; data[p * 4 + 2] = px[p * bpp + 2]!; data[p * 4 + 3] = bpp === 4 ? px[p * bpp + 3]! : 255;
  }
  return { data, width, height };
}
