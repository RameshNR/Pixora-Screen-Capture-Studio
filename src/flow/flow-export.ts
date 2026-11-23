import { buildDocx, DOCX_MIME, type DocxBlock } from '@/shared/utils/docx';
import type { FlowDoc, FlowItem, FlowStep, ImageFormat } from '@/shared/types';
import { getCapture, getCaptureBlob } from '@/history/history-service';
import { buildZip, type ZipEntry } from '@/shared/utils/zip';
import { buildMultiPagePdf, jpegFor, type MultiPdfOptions, type PdfPage } from '@/shared/utils/pdf';
import { getOriginalImage } from './flow-store';

export type ExportVersion = 'edited' | 'original' | 'both';

/** 'original': each picture in the format it came in (unedited pictures are written untouched). */
export type ExportFormat = ImageFormat | 'original';

export interface FlowExportOptions {
  items: FlowItem[];
  version: ExportVersion;
  format: ExportFormat;
  /** File names: the picture's own name (default) or its description / page title. */
  originalNames?: boolean;
  /** "03 - " in front of each file name (default on). */
  numbered?: boolean;
  quality: number;
  /** Sequence, time, URL and description (ZIP metadata files, PDF captions, HTML / JSON). */
  metadata: boolean;
  /** Interaction steps (with permitted form values) in PDF / HTML / JSON. */
  steps: boolean;
}

/** A picture file ending (removed from names so "photo.jpeg" does not become "photo.jpeg.png"). */
const IMAGE_EXT = /\.(png|jpe?g|webp|gif|bmp|avif|tiff?|ico|heic|heif)$/i;

/**
 * "03 - Sign in page.png": sequence number (unless turned off), then the picture's own name or its
 * description / page title.
 */
export function exportName(seq: number, item: FlowItem, ext: string, suffix = '', opts: { name?: string; numbered?: boolean } = {}): string {
  const raw = (opts.name || item.description || item.pageTitle || 'image').replace(IMAGE_EXT, '');
  const base = raw.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120) || 'image';
  return `${opts.numbered === false ? '' : `${String(seq).padStart(2, '0')} - `}${base}${suffix}.${ext}`;
}

/** File ending for a picture type ("image/jpeg" → "jpg"). */
export function extFor(type: string): string {
  const t = type.split('/')[1]?.split(/[;+]/)[0] ?? 'png';
  return t === 'jpeg' ? 'jpg' : t === 'svg' ? 'svg' : t || 'png';
}

export async function convertImage(blob: Blob, format: ImageFormat, quality: number): Promise<Blob> {
  // Already in that format: kept as it is (re-encoding a JPEG at 100 % made it three times larger).
  if (blob.type === `image/${format}` && (format === 'png' || quality >= 0.95)) return blob;
  const bmp = await createImageBitmap(blob);
  const canvas = new OffscreenCanvas(bmp.width, bmp.height);
  const ctx = canvas.getContext('2d')!;
  if (format === 'jpeg') {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, bmp.width, bmp.height);
  }
  ctx.drawImage(bmp, 0, 0);
  bmp.close();
  return canvas.convertToBlob({ type: `image/${format}`, ...(format === 'png' ? {} : { quality }) });
}

export interface ExportImage {
  item: FlowItem;
  seq: number;
  version: 'edited' | 'original';
  blob: Blob;
  name: string;
}

/** Images to export, in flow order, in the chosen version(s) and format. */
export async function collectImages(opts: FlowExportOptions, allItems: FlowItem[]): Promise<ExportImage[]> {
  const out: ExportImage[] = [];
  for (const item of opts.items) {
    const seq = allItems.findIndex((i) => i.id === item.id) + 1;
    const versions: Array<'edited' | 'original'> = opts.version === 'both' ? ['original', 'edited'] : [opts.version];
    const rec = opts.originalNames === false ? undefined : await getCapture(item.id);
    // The format the picture came in (an edited picture is stored as PNG; its original keeps the format).
    const first = await getOriginalImage(item.id);
    for (const v of versions) {
      const raw = v === 'original' ? first : await getCaptureBlob(item.id);
      if (!raw) continue;
      let blob: Blob;
      if (opts.format === 'original') {
        const want = (first ?? raw).type;
        blob = raw.type === want || !/^image\/(png|jpeg|webp)$/.test(want) ? raw : await convertImage(raw, want.slice(6) as ImageFormat, 0.95);
      } else blob = await convertImage(raw, opts.format, opts.quality);
      const name = rec?.name && !/^Flow step \d+\.png$/.test(rec.name) ? rec.name : undefined;
      out.push({ item, seq, version: v, blob, name: exportName(seq, item, extFor(blob.type), opts.version === 'both' ? ` (${v})` : '', { name, numbered: opts.numbered }) });
    }
  }
  return out;
}

function stepsFor(doc: FlowDoc, itemId: string): FlowStep[] {
  return doc.steps.filter((s) => s.itemId === itemId);
}

function stepLine(s: FlowStep): string {
  return `${s.title}${s.value && !s.masked && !s.title.includes(s.value) ? ` — ${s.value}` : ''}`;
}

export function metadataRows(doc: FlowDoc, images: ExportImage[]): Array<Record<string, string | number>> {
  return images.map((img) => ({
    sequence: img.seq,
    file: img.name,
    version: img.version,
    description: img.item.description,
    captured: new Date(img.item.at).toISOString(),
    url: img.item.url,
    pageTitle: img.item.pageTitle,
    width: img.item.width,
    height: img.item.height,
    mode: img.item.mode,
    automatic: img.item.auto ? 'yes' : 'no',
    steps: stepsFor(doc, img.item.id).map(stepLine).join(' | '),
  }));
}

function csv(rows: Array<Record<string, string | number>>): string {
  if (!rows.length) return '';
  const keys = Object.keys(rows[0]!);
  const esc = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
  return [keys.join(','), ...rows.map((r) => keys.map((k) => esc(r[k] ?? '')).join(','))].join('\r\n');
}

export async function exportZip(doc: FlowDoc, opts: FlowExportOptions): Promise<Blob> {
  const images = await collectImages(opts, doc.items);
  const entries: ZipEntry[] = [];
  for (const img of images) entries.push({ name: img.name, data: new Uint8Array(await img.blob.arrayBuffer()), date: new Date(img.item.at) });
  if (opts.metadata) {
    const rows = metadataRows(doc, images);
    entries.push({ name: 'metadata.csv', data: csv(rows) });
  }
  return new Blob([buildZip(entries)], { type: 'application/zip' });
}

export async function exportPdf(doc: FlowDoc, opts: FlowExportOptions, pdf: Omit<MultiPdfOptions, 'title'>): Promise<Blob> {
  const images = await collectImages({ ...opts, format: 'png' }, doc.items);
  const pages: PdfPage[] = [];
  for (const img of images) {
    const lines: PdfPage['lines'] = [];
    if (opts.metadata) {
      lines.push({ text: `Step ${img.seq}${img.item.description ? ` — ${img.item.description}` : ''}${opts.version === 'both' ? ` (${img.version})` : ''}`, size: 14, bold: true });
      lines.push({ text: `${new Date(img.item.at).toLocaleString()}${img.item.url ? `  ·  ${img.item.url}` : ''}`, size: 9, color: [0.4, 0.43, 0.5] });
    }
    if (opts.steps) for (const s of stepsFor(doc, img.item.id)) lines.push({ text: `• ${stepLine(s)}`, size: 10 });
    pages.push({ image: await jpegFor(img.blob), lines });
  }
  return new Blob([buildMultiPagePdf(pages, { ...pdf, title: doc.name })], { type: 'application/pdf' });
}

/** A Word document: title, then each image with its heading, details and steps. */
export async function exportDocx(doc: FlowDoc, opts: FlowExportOptions, page: { paper: 'a4' | 'letter' | 'legal'; orientation: 'auto' | 'portrait' | 'landscape'; margin: number }): Promise<Blob> {
  const images = await collectImages({ ...opts, format: 'png' }, doc.items);
  const wide = images.filter((i) => i.item.width > i.item.height).length;
  const orientation = page.orientation === 'auto' ? (wide > images.length / 2 ? 'landscape' : 'portrait') : page.orientation;
  const blocks: DocxBlock[] = [
    { kind: 'title', text: doc.name },
    { kind: 'text', text: `${images.length} image${images.length === 1 ? '' : 's'} · ${new Date(doc.startedAt).toLocaleString()}`, small: true, muted: true },
  ];
  for (const [n, img] of images.entries()) {
    if (n > 0) blocks.push({ kind: 'pageBreak' });
    const caption = img.item.description || img.item.pageTitle || `Image ${img.seq}`;
    blocks.push({ kind: 'heading', text: `Step ${img.seq} — ${caption}${opts.version === 'both' ? ` (${img.version})` : ''}` });
    if (opts.metadata) blocks.push({ kind: 'text', text: `${new Date(img.item.at).toLocaleString()}${img.item.url ? `  ·  ${img.item.url}` : ''}`, small: true, muted: true });
    const bmp = await createImageBitmap(img.blob);
    blocks.push({ kind: 'image', data: new Uint8Array(await img.blob.arrayBuffer()), type: 'png', width: bmp.width, height: bmp.height, alt: caption });
    bmp.close();
    if (opts.steps) for (const s of stepsFor(doc, img.item.id)) blocks.push({ kind: 'bullet', text: stepLine(s) });
  }
  const bytes = buildDocx(blocks, { paper: page.paper, orientation, margin: page.margin, title: doc.name });
  return new Blob([bytes as Uint8Array<ArrayBuffer>], { type: DOCX_MIME });
}

async function dataUrl(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${blob.type || 'image/png'};base64,${btoa(bin)}`;
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

/** A single self-contained HTML file (images embedded). */
export async function exportHtml(doc: FlowDoc, opts: FlowExportOptions): Promise<Blob> {
  const images = await collectImages(opts, doc.items);
  const cards: string[] = [];
  for (const img of images) {
    const steps = opts.steps ? stepsFor(doc, img.item.id) : [];
    cards.push(`<section class="step">
  <h2><span>${img.seq}</span>${esc(img.item.description || img.item.pageTitle || `Image ${img.seq}`)}${opts.version === 'both' ? ` <small>(${img.version})</small>` : ''}</h2>
  ${opts.metadata ? `<p class="meta">${esc(new Date(img.item.at).toLocaleString())}${img.item.url ? ` · <a href="${esc(img.item.url)}">${esc(img.item.url)}</a>` : ''}</p>` : ''}
  ${steps.length ? `<ol class="actions">${steps.map((s) => `<li>${esc(stepLine(s))}</li>`).join('')}</ol>` : ''}
  <img src="${await dataUrl(img.blob)}" alt="${esc(img.item.description || `Step ${img.seq}`)}" width="${img.item.width}" height="${img.item.height}">
</section>`);
  }
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(doc.name)}</title>
<style>
body{margin:0;background:#f4f6fa;color:#1d2433;font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:1100px;margin:0 auto;padding:32px 20px}
h1{margin:0 0 4px;font-size:26px}.sub{color:#5b6372;margin:0 0 28px}
.step{background:#fff;border:1px solid #e4e7ec;border-radius:14px;padding:20px;margin:0 0 22px;box-shadow:0 6px 18px rgba(15,23,42,.06)}
.step h2{display:flex;gap:10px;align-items:center;margin:0 0 4px;font-size:18px}
.step h2 span{display:inline-grid;place-items:center;min-width:28px;height:28px;border-radius:14px;background:#4f6bed;color:#fff;font-size:13px}
.meta{margin:0 0 10px;color:#667085;font-size:13px;word-break:break-all}.actions{margin:0 0 12px;color:#344054}
img{display:block;max-width:100%;height:auto;border-radius:8px;border:1px solid #e4e7ec}
</style></head><body><main>
<h1>${esc(doc.name)}</h1><p class="sub">${images.length} image${images.length === 1 ? '' : 's'} · captured ${esc(new Date(doc.startedAt).toLocaleString())} with Pixora</p>
${cards.join('\n')}
</main></body></html>`;
  return new Blob([html], { type: 'text/html' });
}

export async function exportJson(doc: FlowDoc, opts: FlowExportOptions & { embedImages: boolean }): Promise<Blob> {
  const images = opts.embedImages ? await collectImages(opts, doc.items) : [];
  const body = {
    name: doc.name,
    startedAt: new Date(doc.startedAt).toISOString(),
    endedAt: doc.endedAt ? new Date(doc.endedAt).toISOString() : null,
    images: await Promise.all(
      opts.items.map(async (item) => ({
        sequence: doc.items.findIndex((i) => i.id === item.id) + 1,
        id: item.id,
        description: item.description,
        ...(opts.metadata ? { capturedAt: new Date(item.at).toISOString(), url: item.url, pageTitle: item.pageTitle, width: item.width, height: item.height, mode: item.mode, automatic: item.auto } : {}),
        ...(opts.embedImages ? { files: await Promise.all(images.filter((i) => i.item.id === item.id).map(async (i) => ({ version: i.version, name: i.name, dataUrl: await dataUrl(i.blob) }))) } : {}),
      })),
    ),
    ...(opts.steps
      ? {
          steps: doc.steps.map((s, i) => ({
            number: i + 1, action: s.action, description: s.title, ...(s.note ? { note: s.note } : {}), element: s.element ? { tag: s.element.tag, label: s.element.label, text: s.element.text, selector: s.element.selector } : undefined,
            ...(s.value !== undefined ? { value: s.value, masked: Boolean(s.masked) } : {}), url: s.url, time: new Date(s.at).toISOString(), ...(s.videoMs !== undefined ? { videoMs: s.videoMs } : {}),
            image: s.itemId ? doc.items.findIndex((it) => it.id === s.itemId) + 1 || null : null,
          })),
        }
      : {}),
  };
  return new Blob([JSON.stringify(body, null, 2)], { type: 'application/json' });
}
