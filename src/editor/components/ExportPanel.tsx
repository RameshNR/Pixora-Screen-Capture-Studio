import { Spinner } from '@/shared/components/Progress';
import { Copy, Download, FileText, QrCode, Save, FileType, Image as ImageIcon } from 'lucide-react';
import type { ImageFormat } from '@/shared/types';
import { Button } from '@/shared/components/Button';
import { Slider, TextField } from '@/shared/components/FormControls';
import styles from './editor.module.css';

interface Props {
  filename: string;
  onFilename: (name: string) => void;
  format: ImageFormat | 'original';
  onFormat: (f: ImageFormat | 'original') => void;
  /** What Original means for this picture ("JPEG"). */
  originalType?: string;
  quality: number;
  onQuality: (q: number) => void;
  onCopy: () => void;
  onDownload: () => void;
  onSaveAs: () => void;
  onPdf: () => void;
  onWord: () => void;
  onQr: () => void;
  busy: boolean;
  /** The running export: its button shows the spinner (the others are only disabled). */
  action?: 'download' | 'saveas' | 'copy' | 'word' | 'pdf' | null;
  /** Image size, shown so the user knows what they export. */
  width?: number;
  height?: number;
}

const FORMATS: Array<{ value: ImageFormat | 'original'; label: string; hint: string }> = [
  { value: 'original', label: 'Original', hint: 'As it came, same size' },
  { value: 'png', label: 'PNG', hint: 'Sharp, lossless' },
  { value: 'jpeg', label: 'JPEG', hint: 'Small, for photos' },
  { value: 'webp', label: 'WebP', hint: 'Smallest file' },
];

/** Body of the editor's Export popup (opened from the toolbar's Export… button). */
export function ExportPanel({ filename, onFilename, format, onFormat, originalType = 'png', quality, onQuality, onCopy, onDownload, onSaveAs, onPdf, onWord, onQr, busy, action = null, width, height }: Props) {
  const real = format === 'original' ? originalType : format;
  const ext = real === 'jpeg' ? 'jpg' : real;
  return (
    <div className={styles.exportBody} aria-label="Export">
      <div className={styles.exportSection}>
        <div className={styles.exportLabel}>File name</div>
        <TextField tone="dark" value={filename} onChange={(e) => onFilename(e.target.value)} suffix={`.${ext}`} aria-label="File name" />
        {width && height ? (
          <div className={styles.exportMeta}>
            <ImageIcon size={13} /> {width} × {height} px
          </div>
        ) : null}
      </div>

      <div className={styles.exportSection}>
        <div className={styles.exportLabel}>Image format</div>
        <div role="radiogroup" aria-label="Image format" className={styles.formatCards}>
          {FORMATS.map((f) => (
            <button
              key={f.value}
              type="button"
              role="radio"
              aria-checked={format === f.value}
              aria-label={f.label}
              className={`${styles.formatCard} ${format === f.value ? styles.formatCardOn : ''}`}
              onClick={() => onFormat(f.value)}
            >
              <span className={styles.formatName}>{f.label}</span>
              <span className={styles.formatHint}>{f.hint}</span>
            </button>
          ))}
        </div>
        {format !== 'png' && format !== 'original' && <Slider tone="dark" label="Quality" min={0.1} max={1} step={0.01} value={quality} format={(q) => `${Math.round(q * 100)}%`} onChange={onQuality} />}
      </div>

      <div className={styles.exportSection}>
        <div className={styles.exportLabel}>Other ways to share</div>
        <div className={styles.shareCards}>
          <button type="button" className={styles.shareCard} onClick={onPdf} disabled={busy} aria-label="PDF…">
            <FileText size={18} /> <span>PDF</span>
          </button>
          <button type="button" className={styles.shareCard} onClick={onWord} disabled={busy} aria-label="Word">
            {action === 'word' ? <Spinner size={18} /> : <FileType size={18} />} <span>Word</span>
          </button>
          <button type="button" className={styles.shareCard} onClick={onQr} disabled={busy} aria-label="QR code…">
            <QrCode size={18} /> <span>QR code</span>
          </button>
        </div>
      </div>

      <div className={styles.exportFooter}>
        <Button size="sm" className={styles.darkBtn} icon={<Copy size={14} />} onClick={onCopy} disabled={busy} loading={action === 'copy'}>
          Copy
        </Button>
        <Button size="sm" className={styles.darkBtn} icon={<Save size={14} />} onClick={onSaveAs} disabled={busy} loading={action === 'saveas'}>
          Save as…
        </Button>
        <Button variant="primary" icon={<Download size={15} />} onClick={onDownload} disabled={busy} loading={action === 'download'} className={styles.exportMain}>
          Download
        </Button>
      </div>
    </div>
  );
}
