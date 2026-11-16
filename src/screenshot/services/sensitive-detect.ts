import { AppError } from '@/shared/utils/errors';

export interface OcrWord {
  text: string;
  /** Pixel box in the image. */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export type SensitiveKind = 'email' | 'phone' | 'card' | 'iban' | 'account' | 'id-number' | 'ip' | 'secret' | 'password' | 'personal' | 'url-token';

export interface SensitiveMatch {
  kind: SensitiveKind;
  text: string;
  box: { x: number; y: number; w: number; h: number };
}

export interface PixelRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Share of `box` covered by the union-approximation of `rects` (sum of overlaps, capped at 1). */
function coverage(box: PixelRect, rects: PixelRect[]): number {
  const area = Math.max(1, box.w * box.h);
  let covered = 0;
  for (const r of rects) {
    const w = Math.min(box.x + box.w, r.x + r.w) - Math.max(box.x, r.x);
    const h = Math.min(box.y + box.h, r.y + r.h) - Math.max(box.y, r.y);
    if (w > 0 && h > 0) covered += w * h;
  }
  return Math.min(1, covered / area);
}

/**
 * Splits matches into those still visible and those already hidden by a blur / pixelate / mask
 * region (so checking again after hiding does not list them again).
 */
export function excludeHidden(matches: SensitiveMatch[], hidden: PixelRect[], minCover = 0.75): { visible: SensitiveMatch[]; hidden: number } {
  if (!hidden.length) return { visible: matches, hidden: 0 };
  const visible = matches.filter((m) => coverage(m.box, hidden) < minCover);
  return { visible, hidden: matches.length - visible.length };
}

export const SENSITIVE_LABELS: Record<SensitiveKind, string> = {
  email: 'Email address',
  phone: 'Phone number',
  card: 'Card number',
  iban: 'IBAN / bank account',
  account: 'Account number',
  'id-number': 'ID number',
  ip: 'IP address',
  secret: 'Key / token',
  password: 'Password',
  personal: 'Personal detail',
  'url-token': 'Link with a token',
};

/** Luhn checksum, so random digit runs are not reported as card numbers. */
export function luhn(digits: string): boolean {
  let sum = 0;
  let dbl = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (d < 0 || d > 9) return false;
    if (dbl) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    dbl = !dbl;
  }
  return digits.length >= 12 && sum % 10 === 0;
}

const PATTERNS: Array<{ kind: SensitiveKind; re: RegExp; check?: (m: string) => boolean }> = [
  { kind: 'email', re: /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi },
  { kind: 'url-token', re: /\S*[?&](?:token|key|apikey|api_key|access_token|auth|sig|signature|session|code)=[^\s&]{6,}\S*/gi },
  { kind: 'iban', re: /\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]{4}){2,7}(?:[ ]?[A-Z0-9]{1,4})?\b/g },
  // Long digit runs: card numbers when the checksum passes, otherwise (often an OCR misread) account numbers.
  { kind: 'card', re: /\b(?:\d[ -]?){12,18}\d\b/g },
  { kind: 'id-number', re: /\b\d{3}-\d{2}-\d{4}\b/g },
  { kind: 'ip', re: /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/g },
  { kind: 'phone', re: /(?:\+\d{1,3}[ .-]?)?(?:\(\d{2,4}\)[ .-]?)?\d{3,4}[ .-]\d{3,4}(?:[ .-]\d{2,4})?/g, check: (m) => m.replace(/\D/g, '').length >= 9 },
  { kind: 'account', re: /\b\d{8,18}\b/g },
  { kind: 'secret', re: /\b(?:sk|pk|ghp|gho|xox[abp]|AKIA|AIza)[A-Za-z0-9_-]{12,}\b|\b[A-Fa-f0-9]{32,}\b|\b[A-Za-z0-9+/_-]{32,}={0,2}/g },
];

const PASSWORD_LABEL = /^(?:password|passwd|pwd|passcode|pin|secret|token|otp)[:=]?$/i;

/**
 * Labels whose value (the rest of the line, up to 6 words) is private: "Account: 12-345-678",
 * "Username: jdoe", "SSN 123 45 6789", "Routing number 021000021", "DOB 01/02/1990"…
 */
const VALUE_LABELS: Array<{ re: RegExp; kind: SensitiveKind }> = [
  { re: /^(?:account|acct|a\/c|iban|swift|bic|routing|sort|ifsc|upi)$/i, kind: 'account' },
  { re: /^(?:ssn|sin|nin|aadhaar|aadhar|pan|passport|license|licence|tax|vat|nric|id)$/i, kind: 'id-number' },
  { re: /^(?:username|user|login|userid|user-id|handle)$/i, kind: 'personal' },
  { re: /^(?:dob|birthday|born|address|addr)$/i, kind: 'personal' },
  { re: /^(?:phone|mobile|tel|cell|whatsapp)$/i, kind: 'phone' },
  { re: /^(?:apikey|api-key|api_key|secret)$/i, kind: 'secret' },
];
/** Words that are a key label only together with the next word: "API key", "private key", "client secret". */
const KEY_PREFIX = /^(?:api|private|client|access|secret)$/i;
const KEY_WORD = /^(?:key|secret|token)[:=]?$/i;
/** A value that looks like a key or token (not an ordinary word such as "device."). */
function tokenLike(v: string): boolean {
  const t = v.replace(/[.,;)]+$/, '');
  return t.length >= 12 && /^[A-Za-z0-9_\-+/=.]+$/.test(t) && /\d/.test(t) && /[A-Za-z]/.test(t);
}
/** Strips OCR noise around a label word ("—Password—", "|Email"). */
function labelWord(s: string): string {
  return s.replace(/^[^A-Za-z]+/, '').replace(/[^A-Za-z:=]+$/, '').replace(/[:=]+$/, '');
}
const LABEL_FILLER = /^(?:no\.?|number|num|#|id|key|name|code|of|birth|date)[:=]?$/i;

/**
 * Finds sensitive text in OCR output. Words are grouped by line so patterns spanning several
 * words (card numbers with spaces, IBANs) are found; each match maps back to the boxes of the
 * words it covers.
 */
export function findSensitive(lines: OcrWord[][]): SensitiveMatch[] {
  const out: SensitiveMatch[] = [];
  for (const words of lines) {
    if (!words.length) continue;
    let text = '';
    const spans: Array<{ start: number; end: number; word: OcrWord }> = [];
    for (const w of words) {
      if (text) text += ' ';
      spans.push({ start: text.length, end: text.length + w.text.length, word: w });
      text += w.text;
    }
    const taken: Array<[number, number]> = [];
    const overlaps = (a: number, b: number) => taken.some(([s, e]) => a < e && b > s);
    const add = (kind: SensitiveKind, start: number, end: number) => {
      if (overlaps(start, end)) return;
      const covered = spans.filter((s) => s.start < end && s.end > start).map((s) => s.word);
      if (!covered.length) return;
      taken.push([start, end]);
      const x0 = Math.min(...covered.map((w) => w.x0));
      const y0 = Math.min(...covered.map((w) => w.y0));
      const x1 = Math.max(...covered.map((w) => w.x1));
      const y1 = Math.max(...covered.map((w) => w.y1));
      out.push({ kind, text: text.slice(start, end), box: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } });
    };
    // "Password: hunter2" → the word after the label.
    spans.forEach((s, i) => {
      if (!PASSWORD_LABEL.test(labelWord(s.word.text)) || !spans[i + 1]) return;
      // Not a sentence ("…email and password. Learn more"): a label ends with ":" / "=", stands in
      // a short line, or is followed by something that looks like data.
      const raw = s.word.text;
      if (/[.,;!?)]$/.test(raw)) return;
      if (!/[:=]$/.test(raw) && spans.length > 3 && !/[\d\W_]/.test(spans[i + 1]!.word.text)) return;
      const isSecret = /^(?:token|secret)/i.test(labelWord(s.word.text));
      if (isSecret && !tokenLike(spans[i + 1]!.word.text)) return;
      add(isSecret ? 'secret' : 'password', spans[i + 1]!.start, spans[i + 1]!.end);
    });
    // "API key: sk_live_…", "Private key abc123…" (two-word labels; the value must look like a key).
    spans.forEach((s, i) => {
      if (!KEY_PREFIX.test(labelWord(s.word.text)) || !spans[i + 1] || !KEY_WORD.test(spans[i + 1]!.word.text) || !spans[i + 2]) return;
      if (tokenLike(spans[i + 2]!.word.text)) add('secret', spans[i + 2]!.start, spans[i + 2]!.end);
    });
    // "Account number: 12-345-678" → the value after the label (and any filler words).
    spans.forEach((s, i) => {
      const word = labelWord(s.word.text);
      const label = VALUE_LABELS.find((l) => l.re.test(word));
      if (!label) return;
      // "Sort" is a bank label only as "sort code" ("Sort by: Price" is not).
      if (/^sort$/i.test(word) && !/^code[:=]?$/i.test(spans[i + 1]?.word.text ?? '')) return;
      let j = i + 1;
      while (j < spans.length && LABEL_FILLER.test(spans[j]!.word.text)) j++;
      if (j >= spans.length) return;
      // Numbers (accounts, IDs, phones) must look like data: they start with a number-like word, run
      // only over number-like words ("12-345-678", "1234 5678 9012") and have at least 4 digits.
      // Bank codes (SWIFT / BIC, IFSC) and UPI ids have their own shapes.
      const numeric = label.kind === 'account' || label.kind === 'id-number' || label.kind === 'phone';
      const hasDigit = (t: string) => /\d/.test(t);
      const first = spans[j]!.word.text.replace(/[.,;]+$/, '');
      const code = /^(?:swift|bic|ifsc)$/i.test(word) && /^[A-Z]{4}[A-Z0-9]{4,7}$/.test(first);
      const upi = /^upi$/i.test(word) && /^[\w.-]+@[\w.-]+$/.test(first);
      if (numeric && !code && !upi && !hasDigit(first)) return;
      // The value ends at the next label ("Username: jdoe Mobile 98765…" → "jdoe").
      let last = j;
      const maxWords = label.kind === 'personal' && !/^(?:address|addr)/i.test(word) ? 1 : code || upi ? 1 : 6;
      while (last + 1 < spans.length && last - j + 1 < maxWords) {
        const next = spans[last + 1]!.word.text.replace(/[:=]+$/, '');
        if (VALUE_LABELS.some((l) => l.re.test(next)) || PASSWORD_LABEL.test(next)) break;
        if (numeric && !/^[\d()+\-/.#]*\d[\d()+\-/.#]*$|^[A-Z]{0,3}\d[\dA-Z\-/]*$/.test(next)) break;
        last++;
      }
      const value = text.slice(spans[j]!.start, spans[last]!.end);
      if (numeric && !code && !upi && (value.match(/\d/g) ?? []).length < 4) return;
      if (label.kind === 'secret' && !tokenLike(value)) return;
      // Only values that look like data (digits, @, or a single token), not ordinary sentences.
      if (!/\d|@/.test(value) && last > j && label.kind !== 'personal') return;
      if (label.kind !== 'personal' && !/\d|@/.test(value) && /^[A-Za-z]+[.,]?$/.test(value)) return;
      add(label.kind, spans[j]!.start, spans[last]!.end);
    });
    for (const p of PATTERNS) {
      p.re.lastIndex = 0;
      for (const m of text.matchAll(p.re)) {
        const value = m[0];
        if (p.check && !p.check(value)) continue;
        const kind = p.kind === 'card' && !luhn(value.replace(/\D/g, '')) ? 'account' : p.kind;
        add(kind, m.index ?? 0, (m.index ?? 0) + value.length);
      }
    }
  }
  out.push(...labelsAbove(lines, out));
  return out;
}

const STACKED_LABELS: Array<{ re: RegExp; kind: SensitiveKind }> = [
  { re: /^(?:password|passwd|passcode|pin|otp)$/i, kind: 'password' },
  { re: /^(?:email|e-mail|mail)$/i, kind: 'email' },
  { re: /^(?:username|user|login|userid)$/i, kind: 'personal' },
  { re: /^(?:phone|mobile|tel|cell)$/i, kind: 'phone' },
  { re: /^(?:account|acct|iban|routing|card)$/i, kind: 'account' },
  { re: /^(?:ssn|aadhaar|aadhar|pan|passport)$/i, kind: 'id-number' },
];
const STACKED_FILLER = /^(?:address|name|number|no|id|code|confirm|new|current|your|one-time)$/i;

/**
 * Form fields often show the label above the value ("Password" on one line, the typed value in
 * the box below). A short line made only of a label finds the nearest line just below it that
 * overlaps it horizontally; that line's value is reported (when not already found).
 */
function labelsAbove(lines: OcrWord[][], found: SensitiveMatch[]): SensitiveMatch[] {
  const out: SensitiveMatch[] = [];
  const box = (ws: OcrWord[]) => ({ x0: Math.min(...ws.map((w) => w.x0)), y0: Math.min(...ws.map((w) => w.y0)), x1: Math.max(...ws.map((w) => w.x1)), y1: Math.max(...ws.map((w) => w.y1)) });
  const already = (b: { x0: number; y0: number; x1: number; y1: number }) =>
    [...found, ...out].some((m) => m.box.x < b.x1 && m.box.x + m.box.w > b.x0 && m.box.y < b.y1 && m.box.y + m.box.h > b.y0);
  for (const words of lines) {
    if (!words.length || words.length > 3) continue;
    const parts = words.map((w) => labelWord(w.text)).filter(Boolean);
    const label = parts.map((p) => STACKED_LABELS.find((l) => l.re.test(p))).find(Boolean);
    if (!label || !parts.every((p) => STACKED_LABELS.some((l) => l.re.test(p)) || STACKED_FILLER.test(p))) continue;
    const L = box(words);
    const lh = Math.max(4, L.y1 - L.y0);
    let best: { words: OcrWord[]; gap: number } | null = null;
    for (const line of lines) {
      if (line === words) continue;
      // Field borders are read as "|" / "[" — they are not part of the value.
      const other = line.filter((w) => /[A-Za-z0-9@]/.test(w.text));
      if (!other.length) continue;
      const B = box(other);
      const gap = B.y0 - L.y1;
      if (gap < -lh * 0.3 || gap > lh * 3) continue;
      if (B.x1 < L.x0 - lh * 2 || B.x0 > L.x1 + lh * 30) continue;
      if (!best || gap < best.gap) best = { words: other, gap };
    }
    if (!best) continue;
    // The value is the first word(s) of that line (a typed value has no spaces, except names / numbers).
    const valueWords = label.kind === 'password' || label.kind === 'email' || label.kind === 'personal' ? best.words.slice(0, 1) : best.words.slice(0, 4);
    const value = valueWords.map((w) => w.text).join(' ').replace(/^[|[(]+|[|\])]+$/g, '');
    if (!value || STACKED_LABELS.some((l) => l.re.test(labelWord(value)))) continue;
    if (label.kind === 'phone' || label.kind === 'account' || label.kind === 'id-number') {
      if ((value.match(/\d/g) ?? []).length < 5) continue;
    }
    if (label.kind === 'email' && !value.includes('@')) continue;
    const B = box(valueWords);
    if (already(B)) continue;
    out.push({ kind: label.kind, text: value, box: { x: B.x0, y: B.y0, w: B.x1 - B.x0, h: B.y1 - B.y0 } });
  }
  return out;
}

/** Merges OCR lines from two passes, dropping lines of the second pass that repeat the first. */
export function mergeOcrLines(a: OcrWord[][], b: OcrWord[][]): OcrWord[][] {
  const overlap = (x: OcrWord, y: OcrWord) => {
    const w = Math.min(x.x1, y.x1) - Math.max(x.x0, y.x0);
    const h = Math.min(x.y1, y.y1) - Math.max(x.y0, y.y0);
    return w > 0 && h > 0 && w * h > 0.5 * Math.min((x.x1 - x.x0) * (x.y1 - x.y0), (y.x1 - y.x0) * (y.y1 - y.y0));
  };
  const extra = b.filter((line) => line.length && !line.every((w) => a.some((l) => l.some((v) => overlap(v, w)))));
  return [...a, ...extra];
}

interface TesseractBlock {
  paragraphs?: Array<{ lines?: Array<{ words?: Array<{ text: string; bbox: { x0: number; y0: number; x1: number; y1: number } }> }> }>;
}

/** Runs on-device OCR (bundled Tesseract) and returns sensitive matches. Nothing leaves the device. */
export async function detectSensitive(image: Blob, onProgress?: (p: number, status: string) => void): Promise<SensitiveMatch[]> {
  const { createWorker } = await import('tesseract.js');
  const base = chrome.runtime.getURL('ocr/');
  let worker: Awaited<ReturnType<typeof createWorker>> | null = null;
  try {
    worker = await createWorker('eng', 1, {
      workerPath: `${base}worker.min.js`,
      corePath: base,
      langPath: base,
      workerBlobURL: false,
      gzip: true,
      cacheMethod: 'none',
      logger: (m: { status: string; progress: number }) => onProgress?.(m.progress, m.status),
    });
    const prepared = await prepareForOcr(image);
    const read = async (): Promise<OcrWord[][]> => {
      const { data } = await worker!.recognize(prepared.blob, {}, { blocks: true });
      const blocks = ((data as unknown as { blocks?: TesseractBlock[] | null }).blocks ?? []) as TesseractBlock[];
      const lines: OcrWord[][] = [];
      for (const b of blocks) {
        for (const p of b.paragraphs ?? []) {
          for (const l of p.lines ?? []) {
            lines.push((l.words ?? []).filter((w) => w.text.trim()).map((w) => ({ text: w.text, ...w.bbox })));
          }
        }
      }
      return lines;
    };
    // Pass 1: normal page layout. Pass 2: sparse text, which also reads text inside boxes such as
    // filled-in form fields (the layout pass often skips them as graphics).
    const layout = await read();
    await worker.setParameters({ tessedit_pageseg_mode: '11' as never });
    const lines = mergeOcrLines(layout, await read());
    // Boxes come back in the prepared (scaled) image; map them to the original pixels.
    return findSensitive(lines).map((m) => ({
      ...m,
      box: { x: m.box.x / prepared.scale, y: m.box.y / prepared.scale, w: m.box.w / prepared.scale, h: m.box.h / prepared.scale },
    }));
  } catch (err) {
    throw new AppError('ocr-failed', String(err));
  } finally {
    await worker?.terminate().catch(() => undefined);
  }
}

/**
 * Makes screen text easier to read for OCR: screenshots usually have small, anti-aliased text and
 * often light-on-dark themes. Upscales (2× up to a size limit), converts to grayscale, inverts dark
 * images and stretches the contrast.
 */
export async function prepareForOcr(image: Blob): Promise<{ blob: Blob; scale: number }> {
  const bmp = await createImageBitmap(image);
  const scale = Math.max(1, Math.min(2, 5000 / Math.max(bmp.width, bmp.height)));
  const w = Math.round(bmp.width * scale);
  const h = Math.round(bmp.height * scale);
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close();
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  let sum = 0;
  const hist = new Uint32Array(256);
  for (let i = 0; i < d.length; i += 4) {
    const g = Math.round(0.299 * d[i]! + 0.587 * d[i + 1]! + 0.114 * d[i + 2]!);
    d[i] = g;
    sum += g;
    hist[g]!++;
  }
  const n = d.length / 4;
  const invert = sum / n < 110;
  // 1st / 99th percentile contrast stretch.
  let lo = 0;
  let hi = 255;
  for (let acc = 0, v = 0; v < 256; v++) { acc += hist[v]!; if (acc > n * 0.01) { lo = v; break; } }
  for (let acc = 0, v = 255; v >= 0; v--) { acc += hist[v]!; if (acc > n * 0.01) { hi = v; break; } }
  const range = Math.max(1, hi - lo);
  for (let i = 0; i < d.length; i += 4) {
    let g = Math.max(0, Math.min(255, ((d[i]! - lo) * 255) / range));
    if (invert) g = 255 - g;
    d[i] = d[i + 1] = d[i + 2] = g;
  }
  ctx.putImageData(img, 0, 0);
  return { blob: await canvas.convertToBlob({ type: 'image/png' }), scale };
}
