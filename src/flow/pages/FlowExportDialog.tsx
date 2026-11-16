import { useState } from 'react';
import type { FlowDoc, FlowItem, ImageFormat, Settings } from '@/shared/types';
import { Modal } from '@/shared/components/Modal';
import { Button } from '@/shared/components/Button';
import { Checkbox, RadioGroup, Slider } from '@/shared/components/FormControls';
import { ProgressIndicator } from '@/shared/components/Progress';
import { downloadBlob } from '@/shared/utils/download';
import { collectImages, exportDocx, exportHtml, exportJson, exportPdf, exportZip, type ExportVersion } from '../flow-export';
import type { PaperSize } from '@/shared/utils/pdf';
import styles from './flow.module.css';

type Scope = 'all' | 'selected' | 'current';
type Target = 'files' | 'zip' | 'pdf' | 'docx' | 'html' | 'json';

interface Props {
  open: boolean;
  onClose: () => void;
  flow: FlowDoc;
  selected: FlowItem[];
  current: FlowItem | null;
  settings: Settings;
  onDone: (message: string) => void;
  onError: (err: unknown) => void;
}

function safe(name: string): string {
  return name.replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'Flow';
}

/** Export all, selected or the current image(s): separate files, ZIP, PDF, Word, HTML or JSON. */
export function FlowExportDialog({ open, onClose, flow, selected, current, settings, onDone, onError }: Props) {
  const [scope, setScope] = useState<Scope>(selected.length ? 'selected' : 'all');
  const [target, setTarget] = useState<Target>('zip');
  const [version, setVersion] = useState<ExportVersion>('edited');
  const [format, setFormat] = useState<ImageFormat>('png');
  const [quality, setQuality] = useState(1);
  const [metadata, setMetadata] = useState(true);
  const [steps, setSteps] = useState(true);
  const [embed, setEmbed] = useState(false);
  const [paper, setPaper] = useState<PaperSize>('a4');
  const [orientation, setOrientation] = useState<'auto' | 'portrait' | 'landscape'>('auto');
  const [margin, setMargin] = useState(36);
  const [fit, setFit] = useState<'contain' | 'actual'>('contain');
  const [busy, setBusy] = useState<string | null>(null);

  const items = scope === 'selected' ? flow.items.filter((i) => selected.some((s) => s.id === i.id)) : scope === 'current' && current ? [current] : flow.items;
  const base = safe(flow.name);
  const save = (blob: Blob, name: string) => downloadBlob(blob, name, { saveAs: settings.storage.askWhereToSave, subfolder: settings.storage.subfolder });

  async function run() {
    const opts = { items, version, format, quality, metadata, steps };
    try {
      if (target === 'files') {
        setBusy('Preparing images…');
        const images = await collectImages(opts, flow.items);
        for (const [i, img] of images.entries()) {
          setBusy(`Saving ${i + 1} of ${images.length}…`);
          await downloadBlob(img.blob, `${base}/${img.name}`, { saveAs: false, subfolder: settings.storage.subfolder });
        }
        onDone(`${images.length} image${images.length === 1 ? '' : 's'} downloaded`);
      } else if (target === 'zip') {
        setBusy('Building the ZIP…');
        await save(await exportZip(flow, opts), `${base}.zip`);
        onDone('ZIP downloaded');
      } else if (target === 'pdf') {
        setBusy('Building the PDF…');
        await save(await exportPdf(flow, opts, { paper, orientation, margin, fit }), `${base}.pdf`);
        onDone('PDF downloaded');
      } else if (target === 'docx') {
        setBusy('Building the Word document…');
        await save(await exportDocx(flow, opts, { paper: paper === 'image' ? 'a4' : paper, orientation, margin }), `${base}.docx`);
        onDone('Word document downloaded');
      } else if (target === 'html') {
        setBusy('Building the HTML page…');
        await save(await exportHtml(flow, opts), `${base}.html`);
        onDone('HTML downloaded');
      } else {
        setBusy('Building the JSON file…');
        await save(await exportJson(flow, { ...opts, embedImages: embed }), `${base}.json`);
        onDone('JSON downloaded');
      }
      onClose();
    } catch (err) {
      onError(err);
    } finally {
      setBusy(null);
    }
  }

  return (
    <Modal
      open={open}
      title="Export flow"
      onClose={onClose}
      tone="dark"
      width={560}
      footer={
        <>
          <Button className={styles.darkBtn} onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!items.length || busy !== null} loading={busy !== null} onClick={() => void run()}>
            Export {items.length} image{items.length === 1 ? '' : 's'}
          </Button>
        </>
      }
    >
      <div className={styles.exportGrid}>
        <div>
          <span className={styles.label}>Images</span>
          <RadioGroup<Scope> label="Images to export" tone="dark" size="sm" value={scope} onChange={setScope} options={[
            { value: 'all', label: `All (${flow.items.length})` },
            { value: 'selected', label: `Selected (${selected.length})`, disabled: !selected.length },
            { value: 'current', label: 'Current', disabled: !current },
          ]} />
        </div>
        <div>
          <span className={styles.label}>Export as</span>
          <RadioGroup<Target> label="Export as" tone="dark" size="sm" value={target} onChange={setTarget} options={[
            { value: 'zip', label: 'ZIP' }, { value: 'files', label: 'Files' }, { value: 'pdf', label: 'PDF' }, { value: 'docx', label: 'Word' }, { value: 'html', label: 'HTML' }, { value: 'json', label: 'JSON' },
          ]} />
        </div>
        <div>
          <span className={styles.label}>Version</span>
          <RadioGroup<ExportVersion> label="Image version" tone="dark" size="sm" value={version} onChange={setVersion} options={[{ value: 'edited', label: 'Edited' }, { value: 'original', label: 'Original' }, { value: 'both', label: 'Both' }]} />
        </div>
        {target !== 'pdf' && target !== 'docx' && (
          <div>
            <span className={styles.label}>Image format</span>
            <RadioGroup<ImageFormat> label="Image format" tone="dark" size="sm" value={format} onChange={setFormat} options={[{ value: 'png', label: 'PNG' }, { value: 'jpeg', label: 'JPEG' }, { value: 'webp', label: 'WebP' }]} />
          </div>
        )}
        {target !== 'pdf' && target !== 'docx' && format !== 'png' && <Slider tone="dark" label="Quality" min={0.4} max={1} step={0.05} value={quality} format={(q) => `${Math.round(q * 100)}%`} onChange={setQuality} />}
        {target === 'docx' && (
          <>
            <div>
              <span className={styles.label}>Page size</span>
              <RadioGroup<PaperSize> label="Page size" tone="dark" size="sm" value={paper === 'image' ? 'a4' : paper} onChange={setPaper} options={[{ value: 'a4', label: 'A4' }, { value: 'letter', label: 'Letter' }, { value: 'legal', label: 'Legal' }]} />
            </div>
            <div>
              <span className={styles.label}>Orientation</span>
              <RadioGroup label="Orientation" tone="dark" size="sm" value={orientation} onChange={setOrientation} options={[{ value: 'auto', label: 'Auto' }, { value: 'portrait', label: 'Portrait' }, { value: 'landscape', label: 'Landscape' }]} />
            </div>
            <Slider tone="dark" label="Margins" min={18} max={72} value={Math.max(18, margin)} format={(v) => `${Math.round((v / 72) * 25.4)} mm`} onChange={setMargin} />
          </>
        )}
        {target === 'pdf' && (
          <>
            <div>
              <span className={styles.label}>Page size</span>
              <RadioGroup<PaperSize> label="Page size" tone="dark" size="sm" value={paper} onChange={setPaper} options={[{ value: 'a4', label: 'A4' }, { value: 'letter', label: 'Letter' }, { value: 'legal', label: 'Legal' }, { value: 'image', label: 'Fit image' }]} />
            </div>
            {paper !== 'image' && (
              <div>
                <span className={styles.label}>Orientation</span>
                <RadioGroup label="Orientation" tone="dark" size="sm" value={orientation} onChange={setOrientation} options={[{ value: 'auto', label: 'Auto' }, { value: 'portrait', label: 'Portrait' }, { value: 'landscape', label: 'Landscape' }]} />
              </div>
            )}
            <div>
              <span className={styles.label}>Image fitting</span>
              <RadioGroup label="Image fitting" tone="dark" size="sm" value={fit} onChange={setFit} options={[{ value: 'contain', label: 'Fit page' }, { value: 'actual', label: 'Actual size' }]} />
            </div>
            <Slider tone="dark" label="Margins" min={0} max={72} value={margin} format={(v) => `${Math.round((v / 72) * 25.4)} mm`} onChange={setMargin} />
          </>
        )}
        <Checkbox checked={metadata} onChange={setMetadata} label="Include details" description="Sequence, capture time, URL and description (ZIP: metadata.json + metadata.csv)." />
        <Checkbox checked={steps} onChange={setSteps} label="Include workflow steps" description="Clicks, form steps and page changes, with form values only as your privacy settings allowed." />
        {target === 'json' && <Checkbox checked={embed} onChange={setEmbed} label="Embed screenshots" description="Images inside the JSON (base64). Larger file." />}
        {busy && <ProgressIndicator value={null} label={busy} />}
        <p className={styles.hint}>Files are numbered in the current image order. Everything is made on this device.</p>
      </div>
    </Modal>
  );
}
