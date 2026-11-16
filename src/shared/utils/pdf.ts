/**
 * Minimal single-page PDF writer for screenshots: one JPEG image (DCTDecode, embedded as-is) on a
 * page that is either the image's own size or A4 / Letter with margins. No fonts, no scripts,
 * no network; the bytes are built in memory.
 */
export type PdfPageSize = 'image' | 'a4' | 'letter';

export interface PdfOptions {
  page: PdfPageSize;
  /** Margin in points for paper sizes (1 pt = 1/72 inch). */
  margin?: number;
  title?: string;
}

const PAPER: Record<Exclude<PdfPageSize, 'image'>, [number, number]> = {
  a4: [595.28, 841.89],
  letter: [612, 792],
};

/** Page size and image placement (points). Landscape paper is used for wide images. */
export function pdfLayout(imgW: number, imgH: number, opts: PdfOptions): { pageW: number; pageH: number; x: number; y: number; w: number; h: number } {
  if (opts.page === 'image') {
    // 96 dpi screen pixels → points.
    const w = (imgW * 72) / 96;
    const h = (imgH * 72) / 96;
    return { pageW: w, pageH: h, x: 0, y: 0, w, h };
  }
  let [pw, ph] = PAPER[opts.page];
  if (imgW > imgH) [pw, ph] = [ph, pw];
  const m = opts.margin ?? 36;
  const k = Math.min((pw - m * 2) / imgW, (ph - m * 2) / imgH);
  const w = imgW * k;
  const h = imgH * k;
  return { pageW: pw, pageH: ph, x: (pw - w) / 2, y: (ph - h) / 2, w, h };
}

function pdfString(s: string): string {
  return `(${s.replace(/[\\()]/g, (c) => `\\${c}`).replace(/[^\x20-\x7e]/g, '?')})`;
}

export function buildPdf(jpeg: Uint8Array, imgW: number, imgH: number, opts: PdfOptions): Uint8Array<ArrayBuffer> {
  const L = pdfLayout(imgW, imgH, opts);
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const offsets: number[] = [];
  let size = 0;
  const push = (data: Uint8Array | string) => {
    const bytes = typeof data === 'string' ? enc.encode(data) : data;
    chunks.push(bytes);
    size += bytes.length;
  };
  const obj = (n: number, body: string | Array<Uint8Array | string>) => {
    offsets[n] = size;
    push(`${n} 0 obj\n`);
    for (const part of Array.isArray(body) ? body : [body]) push(part);
    push('\nendobj\n');
  };
  const f = (v: number) => (Math.round(v * 100) / 100).toString();
  const content = `q\n${f(L.w)} 0 0 ${f(L.h)} ${f(L.x)} ${f(L.y)} cm\n/Im0 Do\nQ\n`;

  push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  obj(3, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${f(L.pageW)} ${f(L.pageH)}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`);
  obj(4, [
    `<< /Type /XObject /Subtype /Image /Width ${imgW} /Height ${imgH} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`,
    jpeg,
    '\nendstream',
  ]);
  obj(5, [`<< /Length ${enc.encode(content).length} >>\nstream\n`, content, 'endstream']);
  obj(6, `<< /Title ${pdfString(opts.title ?? 'Screenshot')} /Producer (Pixora) /CreationDate (D:${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)}Z) >>`);
  const xref = size;
  push(`xref\n0 7\n0000000000 65535 f \n${offsets.slice(1).map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`);
  push(`trailer\n<< /Size 7 /Root 1 0 R /Info 6 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  const out = new Uint8Array(new ArrayBuffer(size));
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

/** Renders an image blob into a PDF blob (JPEG at the given quality, white background). */
export async function imageToPdf(image: Blob, opts: PdfOptions & { quality?: number }): Promise<Blob> {
  const bmp = await createImageBitmap(image);
  const canvas = new OffscreenCanvas(bmp.width, bmp.height);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, bmp.width, bmp.height);
  ctx.drawImage(bmp, 0, 0);
  const jpeg = new Uint8Array(await (await canvas.convertToBlob({ type: 'image/jpeg', quality: opts.quality ?? 1 })).arrayBuffer());
  const pdf = buildPdf(jpeg, bmp.width, bmp.height, opts);
  bmp.close();
  return new Blob([pdf], { type: 'application/pdf' });
}

/* ------------------------------ multi-page PDF ------------------------------ */

export type PaperSize = 'a4' | 'letter' | 'legal' | 'image';

export interface PdfPage {
  /** JPEG bytes and pixel size. */
  image?: { jpeg: Uint8Array; width: number; height: number };
  /** Caption lines drawn above the image (Helvetica; non-Latin characters become "?"). */
  lines?: Array<{ text: string; size?: number; bold?: boolean; color?: [number, number, number] }>;
}

export interface MultiPdfOptions {
  paper: PaperSize;
  orientation: 'auto' | 'portrait' | 'landscape';
  /** Points. */
  margin: number;
  /** 'contain': scale to fit the page; 'actual': screen size (96 dpi), shrunk only when needed. */
  fit: 'contain' | 'actual';
  title?: string;
}

const PAPERS: Record<Exclude<PaperSize, 'image'>, [number, number]> = { a4: [595.28, 841.89], letter: [612, 792], legal: [612, 1008] };

function winAnsi(s: string): string {
  return s
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/…/g, '...')
    .replace(/•/g, '*')
    .replace(/[^\x20-\x7e\xa0-\xff]/g, '?')
    .replace(/[\\()]/g, (c) => `\\${c}`);
}

/** Wraps text to a width (Helvetica ≈ 0.5 em per character on average). */
function wrap(text: string, size: number, width: number): string[] {
  const max = Math.max(8, Math.floor(width / (size * 0.5)));
  const out: string[] = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/)) {
      if ((line + ' ' + word).trim().length > max && line) {
        out.push(line);
        line = word;
      } else line = (line + ' ' + word).trim();
    }
    out.push(line);
  }
  return out;
}

/** One page per entry: optional caption lines, then the screenshot fitted below. */
export function buildMultiPagePdf(pages: PdfPage[], opts: MultiPdfOptions): Uint8Array<ArrayBuffer> {
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const offsets: number[] = [];
  let size = 0;
  const push = (d: Uint8Array | string) => {
    const b = typeof d === 'string' ? enc.encode(d) : d;
    chunks.push(b);
    size += b.length;
  };
  const f = (v: number) => (Math.round(v * 100) / 100).toString();
  // Objects: 1 catalog, 2 pages, 3 font, 4 bold font, 5 info, then 3 per page (page, content, image).
  const firstPageObj = 6;
  const pageObj = (i: number) => firstPageObj + i * 3;
  const objCount = firstPageObj + pages.length * 3;
  const obj = (n: number, body: Array<Uint8Array | string>) => {
    offsets[n] = size;
    push(`${n} 0 obj\n`);
    body.forEach(push);
    push('\nendobj\n');
  };
  push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
  obj(1, ['<< /Type /Catalog /Pages 2 0 R >>']);
  obj(2, [`<< /Type /Pages /Kids [${pages.map((_, i) => `${pageObj(i)} 0 R`).join(' ')}] /Count ${pages.length} >>`]);
  obj(3, ['<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>']);
  obj(4, ['<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>']);
  obj(5, [`<< /Title (${winAnsi(opts.title ?? 'Flow')}) /Producer (Pixora) >>`]);

  pages.forEach((p, i) => {
    const img = p.image;
    const lines = p.lines ?? [];
    let pw: number;
    let ph: number;
    if (opts.paper === 'image' && img) {
      const capH = lines.reduce((h, l) => h + (l.size ?? 11) * 1.4, 0);
      pw = (img.width * 72) / 96 + opts.margin * 2;
      ph = (img.height * 72) / 96 + opts.margin * 2 + (capH ? capH + 10 : 0);
    } else {
      [pw, ph] = PAPERS[opts.paper === 'image' ? 'a4' : opts.paper];
      const landscape = opts.orientation === 'landscape' || (opts.orientation === 'auto' && !!img && img.width > img.height);
      if (landscape) [pw, ph] = [ph, pw];
    }
    const m = opts.margin;
    let content = '';
    let y = ph - m;
    for (const l of lines) {
      const sz = l.size ?? 11;
      for (const text of wrap(l.text, sz, pw - m * 2)) {
        y -= sz * 1.35;
        const [r, g, b] = l.color ?? [0.12, 0.14, 0.18];
        content += `BT /${l.bold ? 'F2' : 'F1'} ${f(sz)} Tf ${f(r)} ${f(g)} ${f(b)} rg ${f(m)} ${f(y)} Td (${winAnsi(text)}) Tj ET\n`;
      }
    }
    if (img) {
      const top = lines.length ? y - 10 : ph - m;
      const availW = pw - m * 2;
      const availH = Math.max(10, top - m);
      const fitK = Math.min(availW / img.width, availH / img.height);
      // 'actual': screen size (96 dpi), shrunk only when it does not fit.
      const k = opts.fit === 'actual' ? Math.min(72 / 96, fitK) : fitK;
      const w = img.width * k;
      const h = img.height * k;
      const x = (pw - w) / 2;
      const iy = top - h;
      content += `q\n${f(w)} 0 0 ${f(h)} ${f(x)} ${f(iy)} cm\n/Im${i} Do\nQ\n`;
    }
    const n = pageObj(i);
    obj(n, [`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${f(pw)} ${f(ph)}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >>${img ? ` /XObject << /Im${i} ${n + 2} 0 R >>` : ''} >> /Contents ${n + 1} 0 R >>`]);
    obj(n + 1, [`<< /Length ${enc.encode(content).length} >>\nstream\n`, content, 'endstream']);
    if (img) {
      obj(n + 2, [`<< /Type /XObject /Subtype /Image /Width ${img.width} /Height ${img.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${img.jpeg.length} >>\nstream\n`, img.jpeg, '\nendstream']);
    } else {
      obj(n + 2, ['<< >>']);
    }
  });
  const xref = size;
  let table = `xref\n0 ${objCount}\n0000000000 65535 f \n`;
  for (let n = 1; n < objCount; n++) table += `${String(offsets[n] ?? 0).padStart(10, '0')} 00000 n \n`;
  push(table);
  push(`trailer\n<< /Size ${objCount} /Root 1 0 R /Info 5 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  const out = new Uint8Array(new ArrayBuffer(size));
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

/** JPEG bytes of an image blob (white background) for PDF pages. */
export async function jpegFor(image: Blob, quality = 1): Promise<{ jpeg: Uint8Array; width: number; height: number }> {
  const bmp = await createImageBitmap(image);
  const canvas = new OffscreenCanvas(bmp.width, bmp.height);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, bmp.width, bmp.height);
  ctx.drawImage(bmp, 0, 0);
  const jpeg = new Uint8Array(await (await canvas.convertToBlob({ type: 'image/jpeg', quality })).arrayBuffer());
  const out = { jpeg, width: bmp.width, height: bmp.height };
  bmp.close();
  return out;
}
