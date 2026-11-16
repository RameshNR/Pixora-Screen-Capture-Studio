// Generates the extension icons as PNGs without any image dependencies.
// Design: rounded blue square with a white aperture ring and a recording dot.
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const out = resolve(dirname(fileURLToPath(import.meta.url)), '../public/icons');
mkdirSync(out, { recursive: true });

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};

function render(size) {
  const ss = 4; // supersampling
  const px = Buffer.alloc(size * size * 4);
  const r = size * 0.22;
  const cov = (fx, fy) => {
    // returns [alpha, rgb]
    const x = fx / size, y = fy / size;
    // rounded square
    const dx = Math.max(Math.abs(fx - size / 2) - (size / 2 - r), 0);
    const dy = Math.max(Math.abs(fy - size / 2) - (size / 2 - r), 0);
    if (dx * dx + dy * dy > r * r) return null;
    const t = (x + y) / 2;
    let col = [0x5b + (0x39 - 0x5b) * t, 0x9a + (0x78 - 0x9a) * t, 0xfa + (0xe8 - 0xfa) * t];
    const cx = fx - size * 0.5, cy = fy - size * 0.5;
    const d = Math.hypot(cx, cy) / size;
    if (d > 0.235 && d < 0.33) col = [255, 255, 255];
    const rd = Math.hypot(fx - size * 0.5, fy - size * 0.5) / size;
    if (rd < 0.13) col = [0xef, 0x53, 0x50];
    return col;
  };
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let a = 0, rr = 0, gg = 0, bb = 0;
    for (let sy = 0; sy < ss; sy++) for (let sx = 0; sx < ss; sx++) {
      const c = cov(x + (sx + 0.5) / ss, y + (sy + 0.5) / ss);
      if (c) { a++; rr += c[0]; gg += c[1]; bb += c[2]; }
    }
    const i = (y * size + x) * 4;
    if (a) { px[i] = rr / a; px[i + 1] = gg / a; px[i + 2] = bb / a; px[i + 3] = (a / (ss * ss)) * 255; }
  }
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) { raw[y * (size * 4 + 1)] = 0; px.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4); }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
for (const s of [16, 32, 48, 128]) writeFileSync(resolve(out, `icon-${s}.png`), render(s));
console.log('icons generated');
