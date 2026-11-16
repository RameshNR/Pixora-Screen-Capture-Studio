import { useEffect, useState } from 'react';
import { Modal } from '@/shared/components/Modal';
import { Button } from '@/shared/components/Button';
import { RadioGroup, Slider } from '@/shared/components/FormControls';
import styles from './editor.module.css';

/* ---------------------------------- PDF ---------------------------------- */
export function PdfDialog({ open, onClose, onExport }: { open: boolean; onClose: () => void; onExport: (opts: { page: 'image' | 'a4' | 'letter'; margin: number }) => void }) {
  const [page, setPage] = useState<'image' | 'a4' | 'letter'>('a4');
  const [margin, setMargin] = useState(36);
  return (
    <Modal
      open={open}
      title="Save as PDF"
      onClose={onClose}
      tone="dark"
      width={400}
      footer={
        <>
          <Button className={styles.darkBtn} onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={() => onExport({ page, margin })}>Download PDF</Button>
        </>
      }
    >
      <div style={{ display: 'grid', gap: 14 }}>
        <div>
          <span className={styles.label}>Page size</span>
          <RadioGroup label="PDF page size" tone="dark" size="sm" value={page} onChange={setPage} options={[{ value: 'image', label: 'Fit image' }, { value: 'a4', label: 'A4' }, { value: 'letter', label: 'Letter' }]} />
        </div>
        {page !== 'image' && <Slider tone="dark" label="Margin" min={0} max={72} value={margin} format={(v) => `${Math.round((v / 72) * 25.4)} mm`} onChange={setMargin} />}
        <div className={styles.hint}>The image (with all annotations, frame and watermark) goes on one page, turned to landscape for wide images. The PDF is made on this device.</div>
      </div>
    </Modal>
  );
}

/** QR code for a link, as an SVG string (empty text gives null). */
export async function qrSvg(text: string): Promise<string | null> {
  if (!text) return null;
  const { default: qrcode } = await import('qrcode-generator');
  const qr = qrcode(0, 'M');
  qr.addData(text, 'Byte');
  qr.make();
  return qr.createSvgTag({ cellSize: 6, margin: 4, scalable: true });
}

/* --------------------------------- QR code -------------------------------- */
export function QrDialog({ open, onClose, sourceUrl, fileBase, onDownload }: { open: boolean; onClose: () => void; sourceUrl: string; fileBase: string; onDownload: (blob: Blob, name: string) => void }) {
  const [mode, setMode] = useState<'page' | 'link'>(sourceUrl ? 'page' : 'link');
  const [link, setLink] = useState('');
  const [svg, setSvg] = useState<string | null>(null);
  const text = mode === 'page' ? sourceUrl : link.trim();
  useEffect(() => {
    let alive = true;
    void qrSvg(text).then((s) => alive && setSvg(s));
    return () => {
      alive = false;
    };
  }, [text]);

  async function download() {
    if (!svg) return;
    const img = new Image();
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    await img.decode();
    const canvas = new OffscreenCanvas(720, 720);
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, 720, 720);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, 0, 0, 720, 720);
    onDownload(await canvas.convertToBlob({ type: 'image/png' }), `${fileBase} QR.png`);
  }

  return (
    <Modal
      open={open}
      title="QR code"
      onClose={onClose}
      tone="dark"
      width={440}
      footer={
        <>
          <Button className={styles.darkBtn} onClick={onClose}>Close</Button>
          <Button variant="primary" disabled={!svg} onClick={() => void download()}>Download QR code</Button>
        </>
      }
    >
      <div style={{ display: 'grid', gap: 12 }}>
        <RadioGroup label="QR code content" tone="dark" size="sm" value={mode} onChange={setMode} options={[{ value: 'page', label: 'Captured page link', disabled: !sourceUrl }, { value: 'link', label: 'A link I paste' }]} />
        {mode === 'link' && (
          <input className={styles.numberField} style={{ width: '100%' }} value={link} placeholder="https://… (e.g. where you shared the image)" aria-label="Link for the QR code" onChange={(e) => setLink(e.target.value)} />
        )}
        <div className={styles.qrBox} aria-label="QR code preview">
          {svg ? <div dangerouslySetInnerHTML={{ __html: svg }} /> : <span style={{ color: '#5b6372', fontSize: 13 }}>Enter a link to make a QR code.</span>}
        </div>
        <div className={styles.hint}>
          Scanning opens the link on the other device. Pixora keeps captures on this computer and never uploads them, so a QR code can’t carry the image itself: to open the image on a phone, share it first (Drive, Photos, chat…) and paste that link here.
        </div>
      </div>
    </Modal>
  );
}
