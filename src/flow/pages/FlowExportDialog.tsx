import { useState, type ReactNode } from 'react';
import { Archive, FileCode2, FileImage, FileText, FileType2, Files } from 'lucide-react';
import type { FlowDoc, FlowItem, Settings } from '@/shared/types';
import { Modal } from '@/shared/components/Modal';
import { Button } from '@/shared/components/Button';
import { Checkbox, RadioGroup, Slider } from '@/shared/components/FormControls';
import { ProgressIndicator } from '@/shared/components/Progress';
import { downloadBlob } from '@/shared/utils/download';
import { collectImages, exportDocx, exportHtml, exportJson, exportPdf, exportZip, type ExportFormat, type ExportVersion } from '../flow-export';
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
  const [format, setFormat] = useState<ExportFormat>('original');
  const [originalNames, setOriginalNames] = useState(true);
  const [numbered, setNumbered] = useState(true);
  const [quality, setQuality] = useState(1);
  const [metadata, setMetadata] = useState(true);
  const [steps, setSteps] = useState(true);
  const embed = false;
  const [paper, setPaper] = useState<PaperSize>('a4');
  const [orientation, setOrientation] = useState<'auto' | 'portrait' | 'landscape'>('auto');
  const [margin, setMargin] = useState(36);
  const [fit, setFit] = useState<'contain' | 'actual'>('contain');
  const [busy, setBusy] = useState<string | null>(null);

  const items = scope === 'selected' ? flow.items.filter((i) => selected.some((s) => s.id === i.id)) : scope === 'current' && current ? [current] : flow.items;
  const base = safe(flow.name);
  const save = (blob: Blob, name: string) => downloadBlob(blob, name, { saveAs: settings.storage.askWhereToSave, subfolder: settings.storage.subfolder });

  async function run() {
    const opts = { items, version, format, quality, metadata, steps, originalNames, numbered };
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

  const images = target === 'zip' || target === 'files';
  const ext = format === 'original' ? 'their own format' : format === 'jpeg' ? 'JPEG' : format.toUpperCase();
  const summary = images
    ? `${items.length} picture${items.length === 1 ? '' : 's'} in ${ext}${version === 'both' ? ' (original and edited)' : ''}${target === 'zip' ? ', in one ZIP' : ', each its own file'}${metadata && target === 'zip' ? ' + metadata.csv' : ''}`
    : `${items.length} picture${items.length === 1 ? '' : 's'} in one ${target === 'pdf' ? 'PDF' : target === 'docx' ? 'Word document' : 'web page'}`;

  return (
    <Modal
      open={open}
      title="Export flow"
      onClose={onClose}
      tone="dark"
      width={620}
      footer={
        <>
          <span className={styles.xSummary}>{summary}</span>
          <Button className={styles.darkBtn} onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!items.length || busy !== null} loading={busy !== null} onClick={() => void run()}>
            Export {items.length} image{items.length === 1 ? '' : 's'}
          </Button>
        </>
      }
    >
      <div className={styles.xBody}>
        <section className={styles.xSection}>
          <div className={styles.xTitle}><FileImage size={15} aria-hidden /> Images</div>
          <div className={styles.xRow}>
            <RadioGroup<Scope> label="Images to export" tone="dark" size="sm" value={scope} onChange={setScope} options={[
              { value: 'all', label: `All (${flow.items.length})` },
              { value: 'selected', label: `Selected (${selected.length})`, disabled: !selected.length },
              { value: 'current', label: 'Current', disabled: !current },
            ]} />
            <RadioGroup<ExportVersion> label="Image version" tone="dark" size="sm" value={version} onChange={setVersion} options={[{ value: 'edited', label: 'Edited' }, { value: 'original', label: 'Original' }, { value: 'both', label: 'Both' }]} />
          </div>
        </section>

        <section className={styles.xSection}>
          <div className={styles.xTitle}>Export as</div>
          <Cards<Target> label="Export as" value={target} onChange={setTarget} options={TARGETS} />
        </section>

        {images && (
          <section className={styles.xSection}>
            <div className={styles.xTitle}>Picture format</div>
            <Cards<ExportFormat> label="Image format" value={format} onChange={setFormat} options={FORMATS} />
            {format !== 'png' && format !== 'original' && <Slider tone="dark" label="Quality" min={0.4} max={1} step={0.05} value={quality} format={(q) => `${Math.round(q * 100)}%`} onChange={setQuality} />}
            {format === 'original' && <p className={styles.xNote}>No re-encoding: unedited pictures are written exactly as they are (a 6 MB JPEG stays 6 MB).</p>}
          </section>
        )}

        {images && (
          <section className={styles.xSection}>
            <div className={styles.xTitle}>File names</div>
            <Checkbox checked={originalNames} onChange={setOriginalNames} label="Original file names" description="Each picture keeps its own name (otherwise its description or page title)." />
            <Checkbox checked={numbered} onChange={setNumbered} label="Number the files" description='"01 - ", "02 - " … in the current image order.' />
          </section>
        )}

        {target === 'docx' && (
          <section className={styles.xSection}>
            <div className={styles.xTitle}>Page</div>
            <div className={styles.xRow}>
              <RadioGroup<PaperSize> label="Page size" tone="dark" size="sm" value={paper === 'image' ? 'a4' : paper} onChange={setPaper} options={[{ value: 'a4', label: 'A4' }, { value: 'letter', label: 'Letter' }, { value: 'legal', label: 'Legal' }]} />
              <RadioGroup label="Orientation" tone="dark" size="sm" value={orientation} onChange={setOrientation} options={[{ value: 'auto', label: 'Auto' }, { value: 'portrait', label: 'Portrait' }, { value: 'landscape', label: 'Landscape' }]} />
            </div>
            <Slider tone="dark" label="Margins" min={18} max={72} value={Math.max(18, margin)} format={(v) => `${Math.round((v / 72) * 25.4)} mm`} onChange={setMargin} />
          </section>
        )}
        {target === 'pdf' && (
          <section className={styles.xSection}>
            <div className={styles.xTitle}>Page</div>
            <div className={styles.xRow}>
              <RadioGroup<PaperSize> label="Page size" tone="dark" size="sm" value={paper} onChange={setPaper} options={[{ value: 'a4', label: 'A4' }, { value: 'letter', label: 'Letter' }, { value: 'legal', label: 'Legal' }, { value: 'image', label: 'Fit image' }]} />
              {paper !== 'image' && <RadioGroup label="Orientation" tone="dark" size="sm" value={orientation} onChange={setOrientation} options={[{ value: 'auto', label: 'Auto' }, { value: 'portrait', label: 'Portrait' }, { value: 'landscape', label: 'Landscape' }]} />}
              <RadioGroup label="Image fitting" tone="dark" size="sm" value={fit} onChange={setFit} options={[{ value: 'contain', label: 'Fit page' }, { value: 'actual', label: 'Actual size' }]} />
            </div>
            <Slider tone="dark" label="Margins" min={0} max={72} value={margin} format={(v) => `${Math.round((v / 72) * 25.4)} mm`} onChange={setMargin} />
          </section>
        )}

        {target !== 'files' && (
          <section className={styles.xSection}>
            <div className={styles.xTitle}>Include</div>
            <Checkbox checked={metadata} onChange={setMetadata} label="Details" description={target === 'zip' ? 'A metadata.csv spreadsheet: sequence, capture time, address and description.' : 'Capture time, address and description under each picture.'} />
            {target !== 'zip' && <Checkbox checked={steps} onChange={setSteps} label="Workflow steps" description="Clicks, form steps and page changes, with form values only as your privacy settings allowed." />}
          </section>
        )}
        {busy && <ProgressIndicator value={null} label={busy} />}
        <p className={styles.hint}>Everything is made on this device.</p>
      </div>
    </Modal>
  );
}

/** Ways to export (JSON is not offered: Pixora reads no JSON back, so it only made extra files). */
const TARGETS: Array<{ value: Target; label: string; hint: string; icon: ReactNode }> = [
  { value: 'zip', label: 'ZIP', hint: 'All pictures in one file', icon: <Archive size={18} /> },
  { value: 'files', label: 'Files', hint: 'Each picture on its own', icon: <Files size={18} /> },
  { value: 'pdf', label: 'PDF', hint: 'A page per picture', icon: <FileText size={18} /> },
  { value: 'docx', label: 'Word', hint: 'Editable document', icon: <FileType2 size={18} /> },
  { value: 'html', label: 'HTML', hint: 'A web page guide', icon: <FileCode2 size={18} /> },
];

const FORMATS: Array<{ value: ExportFormat; label: string; hint: string }> = [
  { value: 'original', label: 'Original', hint: 'As they came, same size' },
  { value: 'png', label: 'PNG', hint: 'Sharp, lossless' },
  { value: 'jpeg', label: 'JPEG', hint: 'Small, for photos' },
  { value: 'webp', label: 'WebP', hint: 'Smallest files' },
];

/** A choice shown as cards (name, a short hint, an icon). */
function Cards<T extends string>({ label, value, onChange, options }: { label: string; value: T; onChange: (v: T) => void; options: Array<{ value: T; label: string; hint: string; icon?: ReactNode }> }) {
  return (
    <div role="radiogroup" aria-label={label} className={styles.xCards}>
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value} aria-label={o.label}
          className={`${styles.xCard} ${value === o.value ? styles.xCardOn : ''}`} onClick={() => onChange(o.value)}>
          {o.icon && <span className={styles.xCardIcon} aria-hidden>{o.icon}</span>}
          <span className={styles.xCardName}>{o.label}</span>
          <span className={styles.xCardHint}>{o.hint}</span>
        </button>
      ))}
    </div>
  );
}
