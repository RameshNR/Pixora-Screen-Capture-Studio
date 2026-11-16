import { useEffect, useState } from 'react';
import { Copy, Lock, Unlock } from 'lucide-react';
import { Modal } from '@/shared/components/Modal';
import { Button, IconButton } from '@/shared/components/Button';
import { ProgressIndicator } from '@/shared/components/Progress';
import styles from './editor.module.css';

export function ResizeDialog({
  open, width, height, onClose, onApply,
}: { open: boolean; width: number; height: number; onClose: () => void; onApply: (w: number, h: number) => void }) {
  const [w, setW] = useState(width);
  const [h, setH] = useState(height);
  const [lock, setLock] = useState(true);
  useEffect(() => {
    if (open) {
      setW(width);
      setH(height);
    }
  }, [open, width, height]);
  const aspect = width / height;
  const valid = w >= 1 && h >= 1 && w <= 16384 && h <= 16384;
  return (
    <Modal
      open={open}
      title="Resize image"
      onClose={onClose}
      tone="dark"
      width={380}
      footer={
        <>
          <Button className={styles.darkBtn} onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!valid} onClick={() => onApply(w, h)}>
            Resize
          </Button>
        </>
      }
    >
      <div style={{ display: 'grid', gap: 14 }}>
        <div className={styles.row} style={{ alignItems: 'end' }}>
          <div>
            <span className={styles.label}>Width (px)</span>
            <input className={styles.numberField} type="number" min={1} max={16384} value={w} aria-label="Width"
              onChange={(e) => { const n = Math.round(Number(e.target.value)); setW(n); if (lock) setH(Math.max(1, Math.round(n / aspect))); }} />
          </div>
          <IconButton tone="dark" label={lock ? 'Unlock aspect ratio' : 'Lock aspect ratio'} icon={lock ? <Lock size={15} /> : <Unlock size={15} />} active={lock} onClick={() => setLock(!lock)} style={{ flex: 'none' }} />
          <div>
            <span className={styles.label}>Height (px)</span>
            <input className={styles.numberField} type="number" min={1} max={16384} value={h} aria-label="Height"
              onChange={(e) => { const n = Math.round(Number(e.target.value)); setH(n); if (lock) setW(Math.max(1, Math.round(n * aspect))); }} />
          </div>
        </div>
        <div className={styles.row}>
          {[25, 50, 75, 150, 200].map((pct) => (
            <Button key={pct} size="sm" className={styles.darkBtn} onClick={() => { setW(Math.round((width * pct) / 100)); setH(Math.round((height * pct) / 100)); }}>
              {pct}%
            </Button>
          ))}
        </div>
        {!valid && <div className={styles.hint}>Size must be between 1 and 16 384 pixels.</div>}
      </div>
    </Modal>
  );
}

export function OcrDialog({
  open, onClose, text, progress, status, error, onCopy,
}: { open: boolean; onClose: () => void; text: string | null; progress: number; status: string; error: string | null; onCopy: (t: string) => void }) {
  const [value, setValue] = useState(text ?? '');
  useEffect(() => setValue(text ?? ''), [text]);
  return (
    <Modal
      open={open}
      title="Extracted text"
      onClose={onClose}
      tone="dark"
      width={560}
      footer={
        text !== null && (
          <>
            <Button className={styles.darkBtn} onClick={onClose}>
              Close
            </Button>
            <Button variant="primary" icon={<Copy size={15} />} onClick={() => onCopy(value)} disabled={!value}>
              Copy text
            </Button>
          </>
        )
      }
    >
      {error ? (
        <div className={styles.hint}>{error}</div>
      ) : text === null ? (
        <div style={{ display: 'grid', gap: 10 }}>
          <ProgressIndicator value={progress > 0 ? progress : null} label={status || 'Starting text recognition…'} />
          <div className={styles.hint}>Recognition runs entirely on this device. The first run loads the language model (~2 MB).</div>
        </div>
      ) : text ? (
        <textarea className={styles.ocrText} value={value} onChange={(e) => setValue(e.target.value)} aria-label="Extracted text" />
      ) : (
        <div className={styles.hint}>No text was found in this image.</div>
      )}
    </Modal>
  );
}

export const SHORTCUT_GROUPS: Array<{ title: string; items: Array<[string, string]> }> = [
  {
    title: 'Tools',
    items: [
      ['V', 'Select & move'], ['H / Space', 'Pan (hold Space)'], ['P', 'Pen'], ['G', 'Highlighter'], ['R', 'Rectangle'], ['O', 'Ellipse'],
      ['A / L', 'Line & arrow'], ['T', 'Text'], ['K', 'Callout'], ['B', 'Blur'], ['X', 'Pixelate'], ['N', 'Numbered marker'],
      ['S', 'Sticker'], ['U', 'Cursor & click effects'], ['M', 'Solid mask'], ['E', 'Eraser'], ['C', 'Crop'], ['W', 'Watermark'], ['F', 'Border & frame'],
    ],
  },
  {
    title: 'Selected object',
    items: [
      ['Click', 'Select with any tool'], ['Tab / Shift+Tab', 'Select next / previous'], ['Enter', 'Edit text'],
      ['Arrow keys', 'Nudge 1 px (Shift: 10 px)'], ['[ / ]', 'Thinner / thicker, smaller / larger'],
      [', / .', 'Rotate −15° / +15° (Shift: 1°)'], ['Shift + drag rotate handle', 'Snap to 15°'],
      ['Ctrl+D', 'Duplicate'], ['Ctrl+C / Ctrl+X / Ctrl+V', 'Copy / cut / paste object'],
      ['Ctrl+] / Ctrl+[', 'Bring forward / send backward'], ['Delete', 'Remove'], ['Esc', 'Deselect'],
    ],
  },
  {
    title: 'Drawing',
    items: [['Shift + drag', 'Straight lines (45°), squares and circles'], ['Ctrl+Enter', 'Finish typing']],
  },
  {
    title: 'Document',
    items: [
      ['Ctrl+Z / Ctrl+Y', 'Undo / redo'], ['Ctrl+Shift+C', 'Copy image'], ['Ctrl+V', 'Paste an image from the clipboard'],
      ['Ctrl+S / Ctrl+Shift+S', 'Download / save as'], ['Ctrl++ / Ctrl+−', 'Zoom in / out'], ['Ctrl+0 / Ctrl+1', 'Fit / 100 %'],
      ['Ctrl + scroll', 'Zoom at the pointer'], ['?', 'This list'],
    ],
  },
];

export function ShortcutsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} title="Keyboard shortcuts" onClose={onClose} tone="dark" width={720}>
      <div className={styles.shortcutGrid}>
        {SHORTCUT_GROUPS.map((g) => (
          <section key={g.title}>
            <h3 className={styles.shortcutTitle}>{g.title}</h3>
            <dl className={styles.shortcutList}>
              {g.items.map(([k, label]) => (
                <div key={k + label} className={styles.shortcutRow}>
                  <dt>{label}</dt>
                  <dd>
                    <kbd className={styles.kbd}>{k}</kbd>
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </Modal>
  );
}
