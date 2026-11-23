import { useEffect, useState } from 'react';
import { Check, Image as ImageIcon, Info, X } from 'lucide-react';
import type { CaptureRecord } from '@/shared/types';
import { formatBytes, formatDateTime } from '@/shared/utils/format';
import { copyText } from '@/shared/utils/download';
import styles from './editor.module.css';

/** Colour facts of a picture (from a small copy, so it is quick even for 20 MP photos). */
export interface ColourStats {
  /** 64 bins each, 0–1 (scaled to the highest bin over all channels). */
  r: number[];
  g: number[];
  b: number[];
  l: number[];
  /** Mean brightness and its spread (0–100). */
  brightness: number;
  contrast: number;
  /** Mean saturation (0–100). */
  saturation: number;
  /** Main colours, most first: hex and share of the picture (0–1). */
  palette: Array<{ hex: string; share: number }>;
}

const BINS = 64;

export async function colourStats(source: CanvasImageSource & { width: number; height: number }): Promise<ColourStats> {
  const k = Math.min(1, 360 / Math.max(source.width, source.height));
  const w = Math.max(1, Math.round(source.width * k));
  const h = Math.max(1, Math.round(source.height * k));
  const c = new OffscreenCanvas(w, h);
  const x = c.getContext('2d', { willReadFrequently: true })!;
  x.drawImage(source, 0, 0, w, h);
  const d = x.getImageData(0, 0, w, h).data;
  const r = new Array<number>(BINS).fill(0);
  const g = new Array<number>(BINS).fill(0);
  const b = new Array<number>(BINS).fill(0);
  const l = new Array<number>(BINS).fill(0);
  // Colours grouped finely (8 levels a channel → 512 groups), averaged inside each group.
  const groups = new Map<number, { n: number; r: number; g: number; b: number }>();
  let sumL = 0;
  let sumL2 = 0;
  let sumS = 0;
  let n = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3]! < 16) continue;
    const R = d[i]!;
    const G = d[i + 1]!;
    const B = d[i + 2]!;
    const L = 0.2126 * R + 0.7152 * G + 0.0722 * B;
    r[R >> 2]!++;
    g[G >> 2]!++;
    b[B >> 2]!++;
    l[Math.min(BINS - 1, L >> 2)]!++;
    sumL += L;
    sumL2 += L * L;
    const mx = Math.max(R, G, B);
    sumS += mx ? (mx - Math.min(R, G, B)) / mx : 0;
    n++;
    const key = ((R >> 5) << 6) | ((G >> 5) << 3) | (B >> 5);
    const q = groups.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
    q.n++;
    q.r += R;
    q.g += G;
    q.b += B;
    groups.set(key, q);
  }
  // Main colours: the biggest groups, near ones merged, so different colours each get a place.
  const merged: Array<{ n: number; r: number; g: number; b: number }> = [];
  for (const q of [...groups.values()].sort((p, s) => s.n - p.n)) {
    const avg = [q.r / q.n, q.g / q.n, q.b / q.n];
    const near = merged.find((m) => Math.hypot(m.r / m.n - avg[0]!, m.g / m.n - avg[1]!, m.b / m.n - avg[2]!) < 38);
    if (near) { near.n += q.n; near.r += q.r; near.g += q.g; near.b += q.b; } else merged.push({ ...q });
  }
  const top = Math.max(1, ...r, ...g, ...b, ...l);
  const scale = (a: number[]) => a.map((v) => v / top);
  const mean = n ? sumL / n : 0;
  const hex = (v: number) => Math.round(v).toString(16).padStart(2, '0');
  const palette = merged.sort((p, s) => s.n - p.n).filter((q) => q.n / Math.max(1, n) >= 0.005).slice(0, 12)
    .map((q) => ({ hex: `#${hex(q.r / q.n)}${hex(q.g / q.n)}${hex(q.b / q.n)}`, share: q.n / Math.max(1, n) }));
  return {
    r: scale(r), g: scale(g), b: scale(b), l: scale(l),
    brightness: Math.round((mean / 255) * 100),
    contrast: Math.round((Math.sqrt(Math.max(0, (n ? sumL2 / n : 0) - mean * mean)) / 128) * 100),
    saturation: Math.round((n ? sumS / n : 0) * 100),
    palette,
  };
}

/** Histogram: red, green and blue (blended), with brightness as a line. */
export function Histogram({ stats, height = 110 }: { stats: ColourStats; height?: number }) {
  const W = 256;
  const pad = 4;
  const H = height - pad;
  const path = (a: number[]) => `M0 ${height} ${a.map((v, i) => `L${((i + 0.5) / BINS) * W} ${height - v * H}`).join(' ')} L${W} ${height} Z`;
  const line = (a: number[]) => a.map((v, i) => `${i ? 'L' : 'M'}${((i + 0.5) / BINS) * W} ${height - v * H}`).join(' ');
  return (
    <svg className={styles.histogram} viewBox={`0 0 ${W} ${height}`} preserveAspectRatio="none" role="img" aria-label={`Colour histogram: brightness ${stats.brightness}%, contrast ${stats.contrast}%`}>
      <path d={path(stats.r)} fill="rgba(239, 68, 68, 0.42)" />
      <path d={path(stats.g)} fill="rgba(34, 197, 94, 0.42)" />
      <path d={path(stats.b)} fill="rgba(59, 130, 246, 0.42)" />
      <path d={line(stats.l)} fill="none" stroke="currentColor" strokeWidth={1.5} vectorEffect="non-scaling-stroke" opacity={0.85} />
    </svg>
  );
}

function ratio(w: number, h: number): string {
  // The familiar names first (16:10, not 8:5).
  const common = [[16, 9], [16, 10], [4, 3], [3, 2], [1, 1], [21, 9], [5, 4], [9, 16], [10, 16], [3, 4], [2, 3]] as const;
  const near = common.find(([p, q]) => Math.abs(w / h - p / q) < 0.005);
  if (near) return `${Math.abs(w / h - near[0] / near[1]) < 1e-9 ? '' : '≈ '}${near[0]}:${near[1]}`;
  const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
  const g = gcd(w, h);
  return w / g <= 32 && h / g <= 32 ? `${w / g}:${h / g}` : `${(w / h).toFixed(2)}:1`;
}

const typeName = (mime: string) => ({ 'image/jpeg': 'JPEG', 'image/png': 'PNG', 'image/webp': 'WebP', 'image/gif': 'GIF', 'image/bmp': 'BMP', 'image/avif': 'AVIF' } as Record<string, string>)[mime] ?? (mime.split('/')[1]?.toUpperCase() || 'Image');

/** A main colour: click copies its value ("#c08457") to the clipboard. */
function Swatch({ hex, share }: { hex: string; share: number }) {
  const [copied, setCopied] = useState(false);
  const light = (() => { const v = parseInt(hex.slice(1), 16); return (0.299 * (v >> 16) + 0.587 * ((v >> 8) & 255) + 0.114 * (v & 255)) > 150; })();
  return (
    <button type="button" className={styles.swatch} title={`${hex.toUpperCase()} · ${Math.round(share * 100)}% of the picture — click to copy`} aria-label={`Copy colour ${hex.toUpperCase()}`}
      onClick={() => void copyText(hex.toUpperCase()).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1200); }).catch(() => undefined)}>
      <span className={styles.swatchChip} style={{ background: hex, color: light ? '#111827' : '#ffffff' }}>{copied && <Check size={14} strokeWidth={3} />}</span>
      <span className={styles.swatchHex}>{copied ? 'Copied' : hex.toUpperCase()}</span>
      <span className={styles.swatchShare}>{Math.max(1, Math.round(share * 100))}%</span>
    </button>
  );
}

/**
 * Image details: file (name, format, size), size in pixels, megapixels, aspect ratio, when and where
 * it came from, its state, and its colours (histogram, brightness, contrast, saturation, main
 * colours — click one to copy it).
 */
export function ImageInfo({ record, width, height, source, edited, onClose }: { record: CaptureRecord; width: number; height: number; source: ImageBitmap | null; edited: boolean; onClose?: () => void }) {
  const [stats, setStats] = useState<ColourStats | null>(null);
  useEffect(() => {
    if (!source) return;
    let alive = true;
    setStats(null);
    const t = setTimeout(() => void colourStats(source).then((s) => alive && setStats(s)).catch(() => undefined), 60);
    return () => { alive = false; clearTimeout(t); };
  }, [source]);
  const state = edited ? 'Changed · not saved' : record.edited ? 'Edited · original kept' : 'Original';
  const rows: Array<[string, string]> = [
    ['Name', record.name],
    ['Format', `${typeName(record.mimeType)}${record.edited ? ' (edited, stored as PNG)' : ''}`],
    ['File size', formatBytes(record.size)],
    ['Dimensions', `${width} × ${height} px`],
    ['Megapixels', `${((width * height) / 1e6).toFixed(1)} MP`],
    ['Aspect ratio', ratio(width, height)],
    ['Added', formatDateTime(record.createdAt)],
    ...(record.updatedAt && record.updatedAt - record.createdAt > 2000 ? [['Changed', formatDateTime(record.updatedAt)] as [string, string]] : []),
    ...(record.sourceTitle && record.sourceTitle !== record.name ? [['Source', record.sourceTitle] as [string, string]] : []),
    ...(record.sourceUrl ? [['Address', record.sourceUrl] as [string, string]] : []),
  ];
  return (
    <div className={styles.imageInfo}>
      <div className={styles.infoHead}>
        <ImageIcon size={20} aria-hidden />
        <span>Image details</span>
        {onClose ? (
          <button type="button" className={styles.infoClose} aria-label="Close image details" onClick={onClose}><X size={16} /></button>
        ) : (
          <span className={styles.infoMark} title="About this picture: file, size, colours" aria-hidden><Info size={16} /></span>
        )}
      </div>
      <dl className={styles.infoList}>
        {rows.map(([k, v]) => (
          <div key={k}><dt>{k}</dt><dd title={v}>{v}</dd></div>
        ))}
        <div><dt>State</dt><dd><span className={`${styles.statePill} ${edited ? styles.stateChanged : ''}`}>{state}</span></dd></div>
      </dl>
      <div className={styles.infoColours} aria-label="Colours">
        <div className={styles.infoSub}>Colours</div>
        {stats ? (
          <>
            <Histogram stats={stats} />
            <div className={styles.infoMeters}>
              <span>Brightness <b>{stats.brightness}%</b></span>
              <span>Contrast <b>{stats.contrast}%</b></span>
              <span>Saturation <b>{stats.saturation}%</b></span>
            </div>
            <div className={styles.paletteBar} aria-hidden>
              {stats.palette.map((p) => <span key={p.hex} style={{ background: p.hex, flexGrow: p.share }} />)}
            </div>
            <div className={styles.palette} role="group" aria-label="Main colours">
              {stats.palette.map((p) => <Swatch key={p.hex} hex={p.hex} share={p.share} />)}
            </div>
          </>
        ) : (
          <div className={styles.hint}>Reading the colours…</div>
        )}
      </div>
    </div>
  );
}
