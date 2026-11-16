export interface FilenameContext {
  type: 'Screenshot' | 'Recording' | 'Edited';
  date?: Date;
  title?: string;
  url?: string;
  extension: string;
}

const pad = (n: number, len = 2) => String(n).padStart(len, '0');

/** Characters Windows, macOS and chrome.downloads all reject in a file name. */
const ILLEGAL = /[<>:"/\\|?*\u0000-\u001f]/g;

export function sanitizeFilename(name: string, maxLength = 120): string {
  let clean = name.replace(ILLEGAL, '-').replace(/\s+/g, ' ').trim();
  // Leading dots create hidden files; trailing dots/spaces are invalid on Windows.
  clean = clean.replace(/^\.+/, '').replace(/[. ]+$/, '');
  if (/^(con|prn|aux|nul|com\d|lpt\d)$/i.test(clean)) clean = `_${clean}`;
  if (clean.length > maxLength) clean = clean.slice(0, maxLength).trim();
  return clean || 'capture';
}

export function sanitizeSubfolder(folder: string): string {
  return folder
    .split(/[\\/]+/)
    .map((part) => part.trim())
    .filter((part) => part && part !== '.' && part !== '..')
    .map((part) => sanitizeFilename(part, 60))
    .join('/');
}

function hostOf(url?: string): string {
  if (!url) return '';
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

/**
 * Expands a filename pattern. Supported tokens:
 * {type} {date} {time} {timestamp} {title} {host} {yyyy} {mm} {dd} {hh} {min} {ss}
 */
export function buildFilename(pattern: string, ctx: FilenameContext): string {
  const d = ctx.date ?? new Date();
  const tokens: Record<string, string> = {
    type: ctx.type,
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}.${pad(d.getMinutes())}.${pad(d.getSeconds())}`,
    timestamp: String(d.getTime()),
    title: ctx.title ?? '',
    host: hostOf(ctx.url),
    yyyy: String(d.getFullYear()),
    mm: pad(d.getMonth() + 1),
    dd: pad(d.getDate()),
    hh: pad(d.getHours()),
    min: pad(d.getMinutes()),
    ss: pad(d.getSeconds()),
  };
  const expanded = pattern.replace(/\{(\w+)\}/g, (match, key: string) => tokens[key] ?? match);
  const base = sanitizeFilename(expanded.replace(/\s*-\s*$/, ''));
  const ext = ctx.extension.replace(/^\./, '');
  return `${base}.${ext}`;
}

export function replaceExtension(filename: string, extension: string): string {
  const ext = extension.replace(/^\./, '');
  const dot = filename.lastIndexOf('.');
  const base = dot > 0 ? filename.slice(0, dot) : filename;
  return `${base}.${ext}`;
}

export function stripExtension(filename: string): string {
  const dot = filename.lastIndexOf('.');
  return dot > 0 ? filename.slice(0, dot) : filename;
}

export function extensionForMime(mime: string): string {
  const m = mime.toLowerCase();
  if (m.startsWith('image/png')) return 'png';
  if (m.startsWith('image/jpeg')) return 'jpg';
  if (m.startsWith('image/webp')) return 'webp';
  if (m.startsWith('video/mp4')) return 'mp4';
  if (m.startsWith('video/x-matroska')) return 'mkv';
  if (m.startsWith('video/webm')) return 'webm';
  return 'bin';
}
