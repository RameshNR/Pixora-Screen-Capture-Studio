import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ArrowLeft, ArrowRight, Check, ClipboardPaste, Download, Share2, FolderOpen, History, ImagePlus, LayoutGrid, Maximize, Minus, Plus, Redo2, RefreshCcw, Replace,
  Trash2, Undo2, X, Image as ImageIcon, SeparatorVertical, Maximize2, Move, Palette,
} from 'lucide-react';
import editorStyles from '@/editor/components/editor.module.css';
import { Button, IconButton } from '@/shared/components/Button';
import { ColorSwatches, RadioGroup, Slider, ToggleSwitch } from '@/shared/components/FormControls';
import { Select, type MenuItem } from '@/shared/components/Dropdown';
import { usePageContextMenu } from '@/shared/components/PageContextMenu';
import { Modal } from '@/shared/components/Modal';
import { Spinner } from '@/shared/components/Progress';
import { useToast } from '@/shared/components/Toast';
import { useSettings } from '@/shared/hooks/useSettings';
import { errorInfoOf } from '@/shared/messaging/client';
import { getCaptureBlob, listCaptures } from '@/history/history-service';
import { downloadBlob } from '@/shared/utils/download';
import { buildFilename } from '@/shared/utils/filename';
import { alphaOf, cssPaint, withAlpha } from '@/shared/utils/color';
import type { CaptureRecord } from '@/shared/types';
import { aspectOf, autoSize, buildTemplate, computeRects, dividers, resizeAt, TEMPLATES, type Box, type CellFit, type CollageNode, type Divider, type TemplateId } from './layout';
import { contentBox, exportCollage, exportScale, formatBytes, LAYOUT_WIDTH, OUTPUT_SIZES, renderCollage, type CollageFormat, type CollageImage, type CollageModel, type CollageStyle, type OutputSize } from './render';
import styles from './collage.module.css';
import { IMAGE_ACCEPT, isSupportedImage, UNSUPPORTED_IMAGE_MESSAGE } from '@/shared/utils/image-types';
import { AddImageMenu } from '@/shared/components/AddImageMenu';
import { formatKeys } from '@/shared/utils/keys';

export const MAX_IMAGES = 30;
const LINE_COLORS = ['#FFFFFF', '#202938', '#000000', '#E05252', '#F59E0B', '#24A36A', '#4F8DF7', '#7C5CF6'];
type AspectChoice = 'auto' | '16:9' | '4:3' | '1:1' | '3:4' | '9:16';
const BACKGROUNDS = ['#FFFFFF', '#F6F7F9', '#202938', '#000000', 'linear:#6aa1fa:#7c5cf6', 'linear:#f6d365:#fda085', 'linear:#84fab0:#8fd3f4', 'transparent'];

let keySeq = 0;
async function toImage(blob: Blob, name: string): Promise<CollageImage> {
  const bitmap = await createImageBitmap(blob);
  return { key: `img${++keySeq}`, bitmap, name, view: { zoom: 1, ox: 0, oy: 0, fit: 'cover' } };
}

function TemplateIcon({ id, n }: { id: TemplateId; n: number }) {
  const rects = computeRects(buildTemplate(id, n), { x: 1, y: 1, w: 46, h: 30 }, 2);
  return (
    <svg width="48" height="32" viewBox="0 0 48 32" aria-hidden>
      {rects.map((r) => (
        <rect key={r.slot} x={r.box.x} y={r.box.y} width={r.box.w} height={r.box.h} rx="2" fill={r.slot === 0 ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.3" opacity={r.slot === 0 ? 0.55 : 1} />
      ))}
    </svg>
  );
}

interface WorkspaceProps {
  /** Images to start with (e.g. the image open in the editor). */
  seeds: Array<{ blob: Blob; name: string }>;
  onCancel: () => void;
  /** Called with the finished collage (PNG); the editor opens it for annotation. */
  onDone: (blob: Blob) => void;
  /** Label of the finish button (default "Edit collage"). */
  doneLabel?: string;
}

/**
 * Collage workspace, shown inside the editor page. Combine many images side by side, stacked or in
 * grids; resize cells by dragging the gaps; style split lines; then edit the result as an image.
 */
export function CollageWorkspace({ seeds, onCancel, onDone, doneLabel = 'Edit collage' }: WorkspaceProps) {
  const { settings } = useSettings();
  const toast = useToast();
  const [images, setImages] = useState<CollageImage[]>([]);
  const [template, setTemplate] = useState<TemplateId>('row');
  const [tree, setTree] = useState<CollageNode>(() => buildTemplate('row', 1));
  const [style, setStyle] = useState<CollageStyle>({
    gap: 16,
    padding: 32,
    radius: 10,
    background: '#FFFFFF',
    lines: { show: false, color: '#202938', width: 4, dash: 'solid' },
  });
  const [columns, setColumns] = useState<number | null>(null);
  const [outputWidth, setOutputWidth] = useState<OutputSize>('original');
  /** Download format and quality (Edit / Add to flow always keep a lossless PNG for further editing). */
  const [format, setFormat] = useState<CollageFormat>('png');
  const [quality, setQuality] = useState(0.9);
  const [estimate, setEstimate] = useState<{ bytes: number; busy: boolean } | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [aspect, setAspect] = useState<AspectChoice>('auto');
  const [selected, setSelected] = useState<number | null>(null);
  /** Pixora's own right-click menu (the collage covers the page, so it handles its own clicks). */
  const collageMenu = usePageContextMenu(noMenu, { global: false });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  /** Which action is running: its button shows the spinner (not every button). */
  const [busyKind, setBusyKind] = useState<'download' | 'finish' | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const replaceInput = useRef<HTMLInputElement>(null);
  const [zoom, setZoom] = useState<number | 'fit'>('fit');
  const [fitScale, setFitScale] = useState(1);
  const [panelTab, setPanelTab] = useState<'props' | 'images' | 'history'>('props');
  const [propTab, setPropTab] = useState<'layout' | 'canvas' | 'image'>('layout');
  // Selecting an image opens its settings.
  useEffect(() => {
    if (selected !== null) setPropTab('image');
  }, [selected]);

  /* ------------------------------ undo / redo ------------------------------ */
  interface Snapshot {
    images: CollageImage[];
    template: TemplateId;
    tree: CollageNode;
    style: CollageStyle;
    columns: number | null;
    outputWidth: OutputSize;
    aspect: AspectChoice;
  }
  const snapshot: Snapshot = { images, template, tree, style, columns, outputWidth, aspect };
  const [hist, setHist] = useState<{ past: Array<{ snap: Snapshot; label: string }>; present: { snap: Snapshot; label: string } | null; future: Array<{ snap: Snapshot; label: string }> }>({ past: [], present: null, future: [] });
  const restoring = useRef(false);
  const original = useRef<Snapshot | null>(null);

  const describe = (prev: Snapshot, next: Snapshot): string => {
    if (next.images.length > prev.images.length) return `Add ${next.images.length - prev.images.length} image${next.images.length - prev.images.length > 1 ? 's' : ''}`;
    if (next.images.length < prev.images.length) return 'Remove image';
    if (next.images.some((im, i) => im.key !== prev.images[i]?.key)) return 'Reorder or replace images';
    if (next.template !== prev.template) return `Layout: ${TEMPLATES.find((t) => t.id === next.template)?.label ?? next.template}`;
    if (next.columns !== prev.columns) return `Columns: ${next.columns}`;
    if (next.style.lines !== prev.style.lines) return 'Split lines';
    if (next.style !== prev.style) return 'Canvas style';
    if (next.outputWidth !== prev.outputWidth || next.aspect !== prev.aspect) return 'Canvas size';
    if (next.tree !== prev.tree) return 'Resize cells';
    return 'Adjust image';
  };

  // Record a history step for every change (quick successive changes, like a slider drag, become one step).
  useEffect(() => {
    if (loading) return;
    if (restoring.current) {
      restoring.current = false;
      return;
    }
    const t = setTimeout(() => {
      setHist((h) => {
        if (!h.present) {
          original.current = snapshot;
          return { past: [], present: { snap: snapshot, label: 'Start' }, future: [] };
        }
        // "Original" is the first collage that has images (an empty start would revert to nothing).
        if (!original.current?.images.length && snapshot.images.length) original.current = snapshot;
        const label = describe(h.present.snap, snapshot);
        return { past: [...h.past, h.present].slice(-100), present: { snap: snapshot, label }, future: [] };
      });
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [images, template, tree, style, columns, outputWidth, aspect, loading]);

  const restore = (snap: Snapshot) => {
    restoring.current = true;
    setImages(snap.images);
    setTemplate(snap.template);
    setTree(snap.tree);
    setStyle(snap.style);
    setColumns(snap.columns);
    setOutputWidth(snap.outputWidth);
    setAspect(snap.aspect);
    setSelected(null);
  };
  const undo = () => {
    const prev = hist.past[hist.past.length - 1];
    if (!prev || !hist.present) return;
    restore(prev.snap);
    setHist({ past: hist.past.slice(0, -1), present: prev, future: [hist.present, ...hist.future] });
  };
  const redo = () => {
    const next = hist.future[0];
    if (!next || !hist.present) return;
    restore(next.snap);
    setHist({ past: [...hist.past, hist.present], present: next, future: hist.future.slice(1) });
  };
  const jump = (index: number) => {
    const all = [...hist.past, ...(hist.present ? [hist.present] : []), ...hist.future];
    const target = all[index];
    if (!target) return;
    restore(target.snap);
    setHist({ past: all.slice(0, index), present: target, future: all.slice(index + 1) });
  };
  const revert = () => {
    if (!original.current || !hist.present) return;
    const snap = original.current;
    restore(snap);
    setHist({ past: [...hist.past, hist.present], present: { snap, label: 'Revert to original' }, future: [] });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, textarea, select')) return;
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (mod && k === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
      else if (mod && (k === 'y' || (k === 'z' && e.shiftKey))) { e.preventDefault(); redo(); }
      else if (mod && (k === '=' || k === '+')) { e.preventDefault(); setZoom((z) => Math.min(4, (z === 'fit' ? fitScale : z) * 1.25)); }
      else if (mod && k === '-') { e.preventDefault(); setZoom((z) => Math.max(0.05, (z === 'fit' ? fitScale : z) / 1.25)); }
      else if (mod && k === '0') { e.preventDefault(); setZoom('fit'); }
      // Delete / Backspace takes the selected image out of the collage (the capture itself is kept).
      else if (!mod && (e.key === 'Delete' || e.key === 'Backspace') && selected !== null && images[selected]) { e.preventDefault(); removeSlot(selected); }
      else if (e.key === 'Escape' && selected !== null) { e.preventDefault(); setSelected(null); }
      else if (!mod && (e.key === 'ArrowLeft' || e.key === 'ArrowRight') && images.length > 1) {
        // Arrow keys move the selection between images.
        e.preventDefault();
        const n = images.length;
        setSelected((cur) => (cur === null ? 0 : (cur + (e.key === 'ArrowRight' ? 1 : n - 1)) % n));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const aspects = useMemo(() => images.map((i) => i.bitmap.width / i.bitmap.height), [images]);

  // Rebuild the layout when the template or number of images changes (sizes fit images uncropped).
  const rebuild = useCallback((t: TemplateId, imgs: CollageImage[], cols: number | null = null) => {
    const a = imgs.map((i) => i.bitmap.width / i.bitmap.height);
    setTree(autoSize(buildTemplate(t, Math.max(1, imgs.length), cols ?? undefined), a));
  }, []);

  const addImages = useCallback(
    async (items: Array<{ blob: Blob; name: string }>) => {
      const supported = items.filter((i) => isSupportedImage({ type: i.blob.type, name: i.name }));
      if (supported.length < items.length) toast.info(`${items.length - supported.length} file${items.length - supported.length > 1 ? 's' : ''} skipped`, UNSUPPORTED_IMAGE_MESSAGE);
      items = supported;
      if (!items.length) return;
      const room = MAX_IMAGES - images.length;
      if (room <= 0) return toast.info(`A collage can hold up to ${MAX_IMAGES} images`);
      try {
        const added = await Promise.all(items.slice(0, room).map((i) => toImage(i.blob, i.name)));
        const next = [...images, ...added];
        // Many images look best in a grid.
        const t = next.length >= 5 && (template === 'row' || template === 'col') ? 'grid' : template;
        setTemplate(t);
        setImages(next);
        rebuild(t, next, columns);
      } catch {
        toast.error('One of the images could not be opened');
      }
    },
    [images, template, rebuild, toast, columns],
  );

  // Initial images (for example the image currently open in the editor).
  useEffect(() => {
    void (async () => {
      if (seeds.length) {
        const imgs = await Promise.all(seeds.map((i) => toImage(i.blob, i.name)));
        setImages(imgs);
        rebuild('row', imgs);
      }
      setLoading(false);
    })();
  }, []);

  // Paste images with Ctrl+V.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const files = Array.from(e.clipboardData?.items ?? []).filter((i) => i.type.startsWith('image/')).map((i) => i.getAsFile()).filter((f): f is File => !!f);
      if (files.length) void addImages(files.map((f) => ({ blob: f, name: f.name || 'Pasted image' })));
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [addImages]);

  const naturalAspect = useMemo(() => {
    if (!images.length) return 16 / 9;
    return aspectOf(autoSize(buildTemplate(template, images.length, columns ?? undefined), aspects), aspects);
  }, [images.length, template, aspects, columns]);

  const width = LAYOUT_WIDTH;
  const height = useMemo(() => {
    const p = style.padding;
    const ratio = aspect === 'auto' ? naturalAspect : (() => { const [a, b] = aspect.split(':').map(Number); return a! / b!; })();
    const contentW = width - p * 2;
    const h = aspect === 'auto' ? contentW / ratio + p * 2 : width / ratio;
    return Math.max(200, Math.min(12000, Math.round(h)));
  }, [aspect, naturalAspect, width, style.padding]);

  const model = useMemo(() => ({ tree, images, style, width, height }), [tree, images, style, width, height]);
  const output = useMemo(() => exportScale(model, outputWidth), [model, outputWidth]);

  // Expected file size: the collage is encoded with the chosen settings shortly after a change
  // (a real encode, so the number is what Download writes).
  useEffect(() => {
    if (!model.images.length) { setEstimate(null); return; }
    let alive = true;
    setEstimate((e) => (e ? { ...e, busy: true } : { bytes: 0, busy: true }));
    const t = setTimeout(() => {
      void exportCollage(model, outputWidth, format, quality)
        .then((b) => alive && setEstimate({ bytes: b.size, busy: false }))
        .catch(() => alive && setEstimate(null));
    }, 450);
    return () => { alive = false; clearTimeout(t); };
  }, [model, outputWidth, format, quality]);

  const updateView = (slot: number, patch: Partial<CollageImage['view']>) =>
    setImages((list) => list.map((img, i) => (i === slot ? { ...img, view: { ...img.view, ...patch } } : img)));

  const removeSlot = (slot: number) => {
    const next = images.filter((_, i) => i !== slot);
    setImages(next);
    rebuild(template, next, columns);
    setSelected(null);
  };

  const swap = (slot: number, dir: -1 | 1) => {
    const j = slot + dir;
    if (j < 0 || j >= images.length) return;
    const next = [...images];
    [next[slot], next[j]] = [next[j]!, next[slot]!];
    setImages(next);
    setSelected(j);
  };

  const exportOptions = (
    <>
            <div>
              <span className={styles.label}>Export size</span>
              <Select label="Export size" value={outputWidth} onChange={setOutputWidth} options={OUTPUT_SIZES} />
            </div>
            <RadioGroup<CollageFormat>
              label="File type"
              tone="dark"
              size="sm"
              value={format}
              onChange={setFormat}
              options={[{ value: 'png', label: 'PNG' }, { value: 'jpeg', label: 'JPEG' }, { value: 'webp', label: 'WebP' }]}
            />
            {format !== 'png' && (
              <Slider tone="dark" label="Quality" min={0.4} max={1} step={0.05} value={quality} format={(q) => `${Math.round(q * 100)}%`} onChange={setQuality} />
            )}
            <div className={styles.estimate} aria-live="polite">
              <span>Expected file size</span>
              <strong>{!estimate ? '—' : estimate.busy && !estimate.bytes ? 'Estimating…' : `${formatBytes(estimate.bytes)}${estimate.busy ? ' …' : ''}`}</strong>
            </div>
            <div className={styles.hint}>
              {format === 'png' ? 'PNG keeps every pixel (largest file).' : format === 'jpeg' ? 'JPEG: smallest for photos; no transparency.' : 'WebP: small files, keeps transparency.'} Download uses these settings; “{doneLabel}” keeps a lossless copy for editing.
            </div>
    </>
  );

  /** Lossless PNG for the editor / flow; Download uses the chosen format and quality. */
  async function exportBlob(forDownload = false): Promise<Blob> {
    return forDownload ? exportCollage(model, outputWidth, format, quality) : exportCollage(model, outputWidth);
  }

  async function finish() {
    setSelected(null);
    setBusy(true);
    setBusyKind('finish');
    try {
      onDone(await exportBlob());
    } catch (err) {
      toast.error(errorInfoOf(err));
      setBusy(false);
      setBusyKind(null);
    }
  }

  /** Downloads the collage; true once the file is saved. */
  async function download(): Promise<boolean> {
    setSelected(null);
    setBusy(true);
    setBusyKind('download');
    try {
      const blob = await exportBlob(true);
      const name = buildFilename('Pixora Collage {date} at {time}', { type: 'Screenshot', extension: format === 'jpeg' ? 'jpg' : format });
      await downloadBlob(blob, name, { saveAs: settings?.storage.askWhereToSave, subfolder: settings?.storage.subfolder });
      toast.success('Downloaded', name);
      return true;
    } catch (err) {
      const info = errorInfoOf(err);
      if (info.code !== 'cancelled') toast.error(info);
      return false;
    } finally {
      setBusy(false);
      setBusyKind(null);
    }
  }

  async function pasteButton() {
    try {
      const items = await navigator.clipboard.read();
      const blobs: Array<{ blob: Blob; name: string }> = [];
      for (const item of items) {
        const type = item.types.find((t) => t.startsWith('image/'));
        if (type) blobs.push({ blob: await item.getType(type), name: 'Pasted image' });
      }
      if (blobs.length) void addImages(blobs);
      else toast.info('No image on the clipboard');
    } catch {
      toast.info('Press Ctrl+V to paste', 'Chrome needs a keyboard paste to read images here.');
    }
  }

  const sel = selected !== null ? images[selected] : undefined;

  /* --------------------------- right-click menus --------------------------- */
  const cellMenu = (slot: number): MenuItem[] => [
    { id: 'replace', label: 'Replace image…', icon: <Replace size={14} />, onSelect: () => { setSelected(slot); replaceInput.current?.click(); } },
    { id: 'left', label: 'Move earlier', icon: <ArrowLeft size={14} />, disabled: slot === 0, onSelect: () => swap(slot, -1) },
    { id: 'right', label: 'Move later', icon: <ArrowRight size={14} />, disabled: slot >= images.length - 1, onSelect: () => swap(slot, 1) },
    { id: 'remove', label: 'Remove from collage', description: 'Del', icon: <Trash2 size={14} />, danger: true, separatorBefore: true, onSelect: () => removeSlot(slot) },
  ];
  const pageMenuItems = (): MenuItem[] => [
    { id: 'add', label: 'Add images…', icon: <ImagePlus size={14} />, disabled: images.length >= MAX_IMAGES, onSelect: () => fileInput.current?.click() },
    { id: 'paste', label: 'Paste image', icon: <ClipboardPaste size={14} />, onSelect: () => void pasteButton() },
    { id: 'undo', label: 'Undo', description: 'Ctrl+Z', icon: <Undo2 size={14} />, separatorBefore: true, disabled: !hist.past.length, onSelect: undo },
    { id: 'redo', label: 'Redo', description: 'Ctrl+Y', icon: <Redo2 size={14} />, disabled: !hist.future.length, onSelect: redo },
    { id: 'download', label: 'Download', icon: <Download size={14} />, separatorBefore: true, disabled: !images.length || busy, onSelect: () => void download() },
  ];

  return (
    <div className={styles.app} onContextMenu={(e) => collageMenu.handle(e, null)}>
      {collageMenu.element}
      <header className={styles.toolbar}>
        <div className={styles.title}>
          <img src="/icons/icon-48.png" alt="" />
          <LayoutGrid size={18} /> Collage
          <span className={styles.sep} />
          <IconButton tone="dark" label="Undo" shortcut="Ctrl+Z" icon={<Undo2 size={17} />} disabled={!hist.past.length} onClick={undo} />
          <IconButton tone="dark" label="Redo" shortcut="Ctrl+Y" icon={<Redo2 size={17} />} disabled={!hist.future.length} onClick={redo} />
          <IconButton tone="dark" label="Revert to original (undoable)" icon={<History size={17} />} disabled={!hist.past.length} onClick={revert} />
        </div>
        <div className={styles.zoomBar} role="group" aria-label="Zoom">
          <IconButton tone="dark" size="sm" label="Zoom out" shortcut="Ctrl+−" icon={<Minus size={15} />} onClick={() => setZoom((z) => Math.max(0.05, (z === 'fit' ? fitScale : z) / 1.25))} />
          <input
            className={styles.zoomInput}
            aria-label="Collage zoom level"
            key={String(zoom) + fitScale}
            defaultValue={`${Math.round((zoom === 'fit' ? fitScale : zoom) * 100)}%`}
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return;
              const n = parseFloat((e.target as HTMLInputElement).value);
              if (Number.isFinite(n) && n > 0) setZoom(Math.max(0.05, Math.min(4, n / 100)));
            }}
          />
          <IconButton tone="dark" size="sm" label="Zoom in" shortcut="Ctrl++" icon={<Plus size={15} />} onClick={() => setZoom((z) => Math.min(4, (z === 'fit' ? fitScale : z) * 1.25))} />
          <IconButton tone="dark" size="sm" label="Fit to screen" shortcut="Ctrl+0" icon={<Maximize size={15} />} active={zoom === 'fit'} onClick={() => setZoom('fit')} />
        </div>
        <div className={styles.actions}>
          <AddImageMenu className={styles.addMenuBtn} label="Add images" onAdd={(imgs) => void addImages(imgs)} />
          <Button size="sm" className={styles.darkBtn} icon={<FolderOpen size={15} />} onClick={() => setPickerOpen(true)}>
            From Recent captures
          </Button>
          <span className={styles.sep} />
          <Button size="sm" className={styles.darkBtn} icon={<Share2 size={15} />} onClick={() => setExportOpen(true)} disabled={!images.length || busy}>
            Export…
          </Button>
          <Button size="sm" className={styles.darkBtn} icon={<X size={15} />} onClick={onCancel}>
            Cancel
          </Button>
          <Button size="sm" variant="primary" icon={<Check size={15} />} onClick={() => void finish()} disabled={!images.length || busy} loading={busyKind === 'finish'}>
            {doneLabel}
          </Button>
        </div>
      </header>

      <div className={styles.body}>
        <main className={styles.stage}>
          {loading ? (
            <Spinner size={24} />
          ) : images.length === 0 ? (
            <div className={styles.empty}>
              <LayoutGrid size={36} />
              <h1>Create a collage</h1>
              <p>Add as many images as you need (up to {MAX_IMAGES}) to compare them side by side, stacked or in a grid. Drag the gaps to resize cells; drag inside a cell to reposition the image.</p>
              <div className={styles.actions}>
                <Button variant="primary" icon={<ImagePlus size={16} />} onClick={() => fileInput.current?.click()}>
                  Add images
                </Button>
                <Button className={styles.darkBtn} icon={<FolderOpen size={16} />} onClick={() => setPickerOpen(true)}>
                  From Recent captures
                </Button>
              </div>
            </div>
          ) : (
            <Preview model={model} selected={busy ? null : selected} plain={busy} onSelect={setSelected}
              onMenu={(e, slot) => collageMenu.handle(e, slot !== null ? cellMenu(slot) : pageMenuItems())} onTree={setTree} onView={updateView} zoom={zoom} onFitScale={setFitScale}
              onZoom={(f) => setZoom((z) => Math.max(0.05, Math.min(4, (z === 'fit' ? fitScale : z) * f)))} />
          )}
        </main>

        <aside className={`${editorStyles.panel} ${styles.panelFix}`} aria-label="Properties">
          <div className={editorStyles.panelTabs} role="tablist" aria-label="Side panel">
            {([['props', 'Properties'], ['images', 'Images'], ['history', 'History']] as const).map(([id, label]) => (
              <button key={id} type="button" role="tab" aria-selected={panelTab === id} className={`${editorStyles.panelTab} ${panelTab === id ? editorStyles.panelTabActive : ''}`} onClick={() => setPanelTab(id)}>
                {label}
                {id === 'images' && images.length > 0 && <span className={editorStyles.count}>{images.length}</span>}
                {id === 'history' && hist.past.length > 0 && <span className={editorStyles.count}>{hist.past.length}</span>}
              </button>
            ))}
          </div>
          <div className={editorStyles.panelScroll}>
          {panelTab === 'images' && (
            <section className={styles.cards}>
              <Card title="Images" icon={<ImageIcon size={15} />}>
              {images.length === 0 ? <div className={styles.hint}>No images yet.</div> : (
                <ul className={styles.imageList}>
                  {images.map((img, i) => (
                    <li key={img.key} className={selected === i ? styles.imageOn : undefined}>
                      <button type="button" className={styles.imageRow} onClick={() => { setSelected(i); setPanelTab('props'); }}>
                        <span className={styles.imageNum}>{i + 1}</span>
                        <span className={styles.imageName}>{img.name}</span>
                        <span className={styles.imageSize}>{img.bitmap.width}×{img.bitmap.height}</span>
                      </button>
                      <IconButton tone="dark" size="sm" label={`Move image ${i + 1} earlier`} icon={<ArrowLeft size={14} />} disabled={i === 0} onClick={() => swap(i, -1)} />
                      <IconButton tone="dark" size="sm" label={`Move image ${i + 1} later`} icon={<ArrowRight size={14} />} disabled={i === images.length - 1} onClick={() => swap(i, 1)} />
                      <IconButton tone="danger" size="sm" label={`Remove image ${i + 1}`} icon={<Trash2 size={14} />} onClick={() => removeSlot(i)} />
                    </li>
                  ))}
                </ul>
              )}
              </Card>
            </section>
          )}
          {panelTab === 'history' && (
            <section className={styles.cards}>
              <Card title="History" icon={<History size={15} />}>
              <ol className={styles.historyList} aria-label="Collage history">
                {[...hist.past, ...(hist.present ? [hist.present] : []), ...hist.future].map((h, i) => {
                  const current = i === hist.past.length;
                  const future = i > hist.past.length;
                  return (
                    <li key={i}>
                      <button type="button" className={`${styles.historyStep} ${current ? styles.historyOn : ''} ${future ? styles.historyFuture : ''}`} aria-current={current ? 'step' : undefined} onClick={() => jump(i)}>
                        {h.label}
                      </button>
                    </li>
                  );
                })}
              </ol>
              <div className={styles.hint}>{formatKeys('Click a step to go back to it. Ctrl+Z / Ctrl+Y undo and redo.')}</div>
              </Card>
            </section>
          )}
          {panelTab === 'props' && <>
          <div className={styles.cards}>
          <div className={styles.outputLine}>
            Output: {output.width} × {output.height} px · {format === 'png' ? 'lossless PNG' : `${format.toUpperCase()} ${Math.round(quality * 100)}%`}
            {estimate && <> · {estimate.busy && !estimate.bytes ? 'estimating…' : `≈ ${formatBytes(estimate.bytes)}`}</>}
            {output.limited && <><br />Reduced to the largest image Chrome can create.</>}
          </div>
          <div className={editorStyles.segTabs} style={{ gridTemplateColumns: 'repeat(3, 1fr)' }} role="tablist" aria-label="Collage settings">
            {([['layout', 'Layout'], ['canvas', 'Canvas'], ['image', 'Image']] as const).map(([id, label]) => (
              <button key={id} type="button" role="tab" aria-selected={propTab === id} className={propTab === id ? editorStyles.segOn : undefined} onClick={() => setPropTab(id)}>{label}</button>
            ))}
          </div>
          {propTab === 'layout' && (
            <>
              <Card title="Layout" icon={<LayoutGrid size={15} />}>
            <div className={styles.templates}>
              {TEMPLATES.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className={`${styles.template} ${template === t.id ? styles.templateActive : ''}`}
                  disabled={images.length > 0 && images.length < t.min}
                  title={t.label}
                  onClick={() => {
                    setTemplate(t.id);
                    rebuild(t.id, images, columns);
                  }}
                >
                  <TemplateIcon id={t.id} n={Math.max(images.length, t.min, 2)} />
                  <span>{t.label}</span>
                </button>
              ))}
            </div>
            {template === 'grid' && images.length > 1 && (
              <Slider
                tone="dark"
                label="Columns"
                min={1}
                max={Math.min(8, images.length)}
                value={columns ?? Math.ceil(Math.sqrt(images.length))}
                onChange={(c) => {
                  setColumns(c);
                  rebuild('grid', images, c);
                }}
              />
            )}
            <Button size="sm" className={styles.darkBtn} icon={<RefreshCcw size={14} />} onClick={() => rebuild(template, images, columns)} disabled={!images.length}>
              Reset cell sizes
            </Button>
              </Card>
              <Card title="Split lines" icon={<SeparatorVertical size={15} />} action={<ToggleSwitch size="sm" label="Split lines" checked={style.lines.show} onChange={(show) => setStyle((s) => ({ ...s, lines: { ...s.lines, show } }))} />}>
            {style.lines.show ? (
              <>
                <ColorSwatches label="Split line colour" colors={LINE_COLORS} value={style.lines.color} onChange={(color) => setStyle((s) => ({ ...s, lines: { ...s.lines, color } }))} />
                <Slider tone="dark" label="Thickness" min={1} max={40} value={style.lines.width} format={(x) => `${x}px`} onChange={(width) => setStyle((s) => ({ ...s, lines: { ...s.lines, width } }))} />
                <RadioGroup
                  label="Split line style"
                  tone="dark"
                  size="sm"
                  value={style.lines.dash}
                  onChange={(dash) => setStyle((s) => ({ ...s, lines: { ...s.lines, dash } }))}
                  options={[
                    { value: 'solid', label: 'Solid' },
                    { value: 'dashed', label: 'Dashed' },
                    { value: 'dotted', label: 'Dotted' },
                  ]}
                />
              </>
            ) : (
              <div className={styles.hint}>Draw lines between the images — choose colour, thickness, style and transparency.</div>
            )}
              </Card>
            </>
          )}
          {propTab === 'canvas' && (
            <>
              <Card title="Shape" icon={<Maximize2 size={15} />}>
            <div>
              <span className={styles.label}>Shape</span>
              <Select<AspectChoice>
                label="Canvas shape"
                variant="dark"
                value={aspect}
                minWidth={200}
                onChange={setAspect}
                options={[
                  { value: 'auto', label: 'Fit images (no cropping)' },
                  { value: '16:9', label: '16:9 Landscape' },
                  { value: '4:3', label: '4:3' },
                  { value: '1:1', label: '1:1 Square' },
                  { value: '3:4', label: '3:4' },
                  { value: '9:16', label: '9:16 Portrait' },
                ]}
              />
            </div>
              </Card>
              <Card title="Export" icon={<Download size={15} />}>
            {exportOptions}
              </Card>
              <Card title="Spacing & corners" icon={<Move size={15} />}>
            <Slider tone="dark" label="Spacing" min={0} max={80} value={style.gap} format={(x) => `${x}px`} onChange={(gap) => setStyle((s) => ({ ...s, gap }))} />
            <Slider tone="dark" label="Outer padding" min={0} max={160} value={style.padding} format={(x) => `${x}px`} onChange={(padding) => setStyle((s) => ({ ...s, padding }))} />
            <Slider tone="dark" label="Corner radius" min={0} max={60} value={style.radius} format={(x) => `${x}px`} onChange={(radius) => setStyle((s) => ({ ...s, radius }))} />
              </Card>
              <Card title="Background" icon={<Palette size={15} />}>
            <div>
              <span className={styles.label}>Background</span>
              <div className={styles.bgGrid}>
                {BACKGROUNDS.map((bg) => (
                  <button
                    key={bg}
                    type="button"
                    aria-label={`Background ${bg}`}
                    className={`${styles.bgSwatch} ${withAlpha(style.background, 1) === bg ? styles.bgActive : ''} ${bg === 'transparent' ? styles.bgNone : ''}`}
                    style={bg === 'transparent' ? undefined : { background: cssPaint(bg) }}
                    onClick={() => setStyle((s) => ({ ...s, background: bg === 'transparent' ? bg : withAlpha(bg, alphaOf(s.background) || 1) }))}
                  />
                ))}
              </div>
            </div>
            {style.background !== 'transparent' && (
              <Slider tone="dark" label="Background opacity" min={0} max={1} step={0.05} value={alphaOf(style.background)} format={(x) => `${Math.round(x * 100)}%`} onChange={(a) => setStyle((st) => ({ ...st, background: withAlpha(st.background, a) }))} />
            )}
              </Card>
            </>
          )}
          {propTab === 'image' && (
            <Card title={sel ? `Image ${selected! + 1}` : 'Image'} icon={<ImageIcon size={15} />}>
            {!sel ? (
              <div className={styles.hint}>Click an image to adjust it. Scroll over an image to zoom, drag to reposition, drag the gaps between images to resize.</div>
            ) : (
              <>
                <RadioGroup<CellFit> label="Fit" tone="dark" size="sm" value={sel.view.fit} onChange={(fit) => updateView(selected!, { fit, ox: 0, oy: 0 })} options={[{ value: 'cover', label: 'Fill cell' }, { value: 'contain', label: 'Show whole image' }]} />
                <Slider tone="dark" label="Zoom" min={1} max={4} step={0.05} value={sel.view.zoom} format={(x) => `${Math.round(x * 100)}%`} onChange={(zoom) => updateView(selected!, { zoom })} />
                <div className={styles.cellActions}>
                  <IconButton tone="dark" label="Move earlier" icon={<ArrowLeft size={16} />} disabled={selected === 0} onClick={() => swap(selected!, -1)} />
                  <IconButton tone="dark" label="Move later" icon={<ArrowRight size={16} />} disabled={selected === images.length - 1} onClick={() => swap(selected!, 1)} />
                  <IconButton tone="dark" label="Reset position" icon={<RefreshCcw size={16} />} onClick={() => updateView(selected!, { zoom: 1, ox: 0, oy: 0 })} />
                  <IconButton tone="dark" label="Replace image" icon={<Replace size={16} />} onClick={() => replaceInput.current?.click()} />
                  <IconButton tone="danger" label="Remove image" icon={<Trash2 size={16} />} onClick={() => removeSlot(selected!)} />
                </div>
              </>
            )}
            </Card>
          )}
          </div>
          </>}
          </div>
        </aside>
      </div>

      <Modal
        open={exportOpen}
        title="Export collage"
        tone="dark"
        width={420}
        onClose={() => busyKind !== 'download' && setExportOpen(false)}
        footer={
          <>
            <Button className={styles.darkBtn} disabled={busyKind === 'download'} onClick={() => setExportOpen(false)}>Cancel</Button>
            {/* Stays open with the spinner on Download while the file is prepared; closes once saved. */}
            <Button variant="primary" icon={<Download size={15} />} loading={busyKind === 'download'} disabled={!images.length || busy} onClick={() => void download().then((ok) => ok && setExportOpen(false))}>
              Download
            </Button>
          </>
        }
      >
        <div className={styles.exportPopup}>
          <div className={styles.outputLine}>Output: {output.width} × {output.height} px</div>
          {exportOptions}
        </div>
      </Modal>
      <input
        ref={fileInput}
        type="file"
        accept={IMAGE_ACCEPT}
        multiple
        hidden
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          void addImages(files.map((f) => ({ blob: f, name: f.name })));
          e.target.value = '';
        }}
      />
      <input
        ref={replaceInput}
        type="file"
        accept={IMAGE_ACCEPT}
        hidden
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (!f || selected === null) return;
          const img = await toImage(f, f.name);
          const next = images.map((x, i) => (i === selected ? img : x));
          setImages(next);
          rebuild(template, next, columns);
        }}
      />
      <RecentPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        max={MAX_IMAGES - images.length}
        onPick={async (ids) => {
          setPickerOpen(false);
          const items: Array<{ blob: Blob; name: string }> = [];
          for (const id of ids) {
            const blob = await getCaptureBlob(id);
            if (blob) items.push({ blob, name: id });
          }
          void addImages(items);
        }}
      />
    </div>
  );
}

/** Interactive preview: select cells, drag to pan, scroll to zoom, drag gaps to resize. */
function Preview({
  model, selected, plain = false, onSelect, onTree, onView, zoom, onFitScale, onMenu, onZoom,
}: {
  /** Ctrl / ⌘ + wheel over the collage: zoom the whole view by this factor (not the browser page). */
  onZoom?: (factor: number) => void;
  /** Right click on the preview: the image under the pointer (selected first), or null. */
  onMenu?: (e: React.MouseEvent, slot: number | null) => void;
  model: CollageModel;
  selected: number | null;
  /** Only the collage itself, without the selection outline and resize handles (while exporting). */
  plain?: boolean;
  onSelect: (slot: number | null) => void;
  onTree: (t: CollageNode) => void;
  onView: (slot: number, patch: Partial<CollageImage['view']>) => void;
  zoom: number | 'fit';
  onFitScale: (s: number) => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [area, setArea] = useState({ w: 800, h: 600 });
  const [hoverDivider, setHoverDivider] = useState<Divider | null>(null);
  const drag = useRef<
    | { kind: 'divider'; d: Divider; startX: number; startY: number; tree: CollageNode }
    | { kind: 'pan'; slot: number; startX: number; startY: number; ox: number; oy: number; cell: Box }
    | null
  >(null);
  const dpr = window.devicePixelRatio || 1;

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setArea({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const fit = Math.min((area.w - 48) / model.width, (area.h - 48) / model.height, 1);
  const scale = zoom === 'fit' ? fit : zoom;
  useEffect(() => onFitScale(fit), [fit, onFitScale]);
  const cssW = Math.max(1, model.width * scale);
  const cssH = Math.max(1, model.height * scale);
  const content = contentBox(model);
  const cells = useMemo(() => computeRects(model.tree, content, model.style.gap), [model.tree, content.x, content.y, content.w, content.h, model.style.gap]);
  const divs = useMemo(() => dividers(model.tree, content, model.style.gap), [model.tree, content.x, content.y, content.w, content.h, model.style.gap]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr * scale, 0, 0, dpr * scale, 0, 0);
    ctx.clearRect(0, 0, model.width, model.height);
    renderCollage(ctx, model);
    const px = 1 / scale;
    if (selected !== null) {
      const c = cells.find((x) => x.slot === selected);
      if (c) {
        ctx.strokeStyle = '#4F8DF7';
        ctx.lineWidth = 3 * px;
        ctx.strokeRect(c.box.x + 1.5 * px, c.box.y + 1.5 * px, c.box.w - 3 * px, c.box.h - 3 * px);
      }
    }
    for (const d of plain ? [] : divs) {
      const hot = hoverDivider && d.path.join() === hoverDivider.path.join() && d.index === hoverDivider.index;
      const cx = d.box.x + d.box.w / 2;
      const cy = d.box.y + d.box.h / 2;
      ctx.fillStyle = hot ? '#4F8DF7' : 'rgba(79,141,247,0.55)';
      ctx.beginPath();
      if (d.dir === 'row') ctx.roundRect(cx - 3 * px, cy - 18 * px, 6 * px, 36 * px, 3 * px);
      else ctx.roundRect(cx - 18 * px, cy - 3 * px, 36 * px, 6 * px, 3 * px);
      ctx.fill();
    }
  }, [model, cssW, cssH, dpr, scale, selected, plain, cells, divs, hoverDivider]);

  const toOut = (e: { clientX: number; clientY: number }) => {
    const r = canvasRef.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left) / scale, y: (e.clientY - r.top) / scale };
  };
  const dividerAt = (p: { x: number; y: number }) => {
    const reach = Math.max(8 / scale, model.style.gap / 2 + 2 / scale);
    return divs.find((d) => (d.dir === 'row' ? Math.abs(p.x - d.box.x) <= reach && p.y >= d.box.y && p.y <= d.box.y + d.box.h : Math.abs(p.y - d.box.y) <= reach && p.x >= d.box.x && p.x <= d.box.x + d.box.w)) ?? null;
  };
  const cellAt = (p: { x: number; y: number }) => cells.find((c) => p.x >= c.box.x && p.x <= c.box.x + c.box.w && p.y >= c.box.y && p.y <= c.box.y + c.box.h) ?? null;

  // Wheel: a native, non-passive listener — React's wheel handler is passive, so it could not stop
  // Chrome from zooming the whole page on Ctrl + wheel (or scrolling while an image zooms).
  const wheel = useRef<(e: WheelEvent) => void>(() => undefined);
  wheel.current = (e: WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      onZoom?.(Math.exp(-e.deltaY * 0.0015));
      return;
    }
    if (!canvasRef.current || !canvasRef.current.contains(e.target as Node)) return;
    const c = cellAt(toOut(e));
    const img = c ? model.images[c.slot] : undefined;
    if (!c || !img) return;
    // Over an image: zoom that image inside its cell (the page doesn't scroll meanwhile).
    e.preventDefault();
    onSelect(c.slot);
    onView(c.slot, { zoom: Math.max(1, Math.min(4, img.view.zoom * Math.exp(-e.deltaY * 0.0015))) });
  };
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const on = (e: WheelEvent) => wheel.current(e);
    el.addEventListener('wheel', on, { passive: false });
    return () => el.removeEventListener('wheel', on);
  }, []);

  return (
    <div ref={wrapRef} className={styles.previewWrap}>
      <canvas
        ref={canvasRef}
        className={styles.preview}
        style={{ width: cssW, height: cssH, cursor: hoverDivider ? (hoverDivider.dir === 'row' ? 'col-resize' : 'row-resize') : 'grab' }}
        aria-label="Collage preview"
        role="img"
        onContextMenu={(e) => {
          const c = cellAt(toOut(e));
          if (c) onSelect(c.slot);
          onMenu?.(e, c ? c.slot : null);
        }}
        onPointerDown={(e) => {
          if (e.button === 2) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          const p = toOut(e);
          const d = dividerAt(p);
          if (d) {
            drag.current = { kind: 'divider', d, startX: p.x, startY: p.y, tree: model.tree };
            return;
          }
          const c = cellAt(p);
          onSelect(c?.slot ?? null);
          const img = c ? model.images[c.slot] : undefined;
          if (c && img) drag.current = { kind: 'pan', slot: c.slot, startX: p.x, startY: p.y, ox: img.view.ox, oy: img.view.oy, cell: c.box };
        }}
        onPointerMove={(e) => {
          const p = toOut(e);
          const g = drag.current;
          if (!g) {
            setHoverDivider(dividerAt(p));
            return;
          }
          if (g.kind === 'divider') {
            const delta = (g.d.dir === 'row' ? p.x - g.startX : p.y - g.startY) / g.d.span;
            onTree(resizeAt(g.tree, g.d.path, g.d.index, delta));
          } else {
            const img = model.images[g.slot];
            if (!img) return;
            const placed = (() => {
              const base = img.view.fit === 'cover' ? Math.max(g.cell.w / img.bitmap.width, g.cell.h / img.bitmap.height) : Math.min(g.cell.w / img.bitmap.width, g.cell.h / img.bitmap.height);
              const s = base * img.view.zoom;
              return { overX: Math.max(1, img.bitmap.width * s - g.cell.w), overY: Math.max(1, img.bitmap.height * s - g.cell.h) };
            })();
            const clamp = (v: number) => Math.max(-1, Math.min(1, v));
            onView(g.slot, { ox: clamp(g.ox + ((p.x - g.startX) * 2) / placed.overX), oy: clamp(g.oy + ((p.y - g.startY) * 2) / placed.overY) });
          }
        }}
        onPointerUp={() => {
          drag.current = null;
        }}
      />
    </div>
  );
}

function RecentPicker({ open, onClose, onPick, max }: { open: boolean; onClose: () => void; onPick: (ids: string[]) => void; max: number }) {
  const [items, setItems] = useState<CaptureRecord[] | null>(null);
  const [chosen, setChosen] = useState<string[]>([]);
  useEffect(() => {
    if (!open) return;
    setChosen([]);
    void listCaptures('screenshot', 'newest').then(setItems);
  }, [open]);
  return (
    <Modal
      open={open}
      title="Add from Recent captures"
      onClose={onClose}
      tone="dark"
      width={720}
      footer={
        <>
          <Button className={styles.darkBtn} onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!chosen.length} onClick={() => onPick(chosen)}>
            Add {chosen.length || ''} image{chosen.length === 1 ? '' : 's'}
          </Button>
        </>
      }
    >
      {!items ? (
        <Spinner size={20} />
      ) : items.length === 0 ? (
        <div className={styles.hint}>No screenshots yet.</div>
      ) : (
        <div className={styles.pickGrid}>
          {items.map((c) => {
            const on = chosen.includes(c.id);
            return (
              <button
                key={c.id}
                type="button"
                aria-pressed={on}
                className={`${styles.pick} ${on ? styles.pickOn : ''}`}
                onClick={() => setChosen((list) => (on ? list.filter((x) => x !== c.id) : list.length < max ? [...list, c.id] : list))}
              >
                {c.thumbnail ? <img src={c.thumbnail} alt="" /> : <span />}
                <span className={styles.pickName}>{c.name}</span>
                {on && <span className={styles.pickBadge}>{chosen.indexOf(c.id) + 1}</span>}
              </button>
            );
          })}
        </div>
      )}
    </Modal>
  );
}

const noMenu = () => null;

/** A titled card with an icon (the panel design used across Pixora's editors). */
function Card({ title, icon, action, children }: { title: string; icon: ReactNode; action?: ReactNode; children: ReactNode }) {
  return (
    <details className={editorStyles.setGroup} open>
      <summary className={editorStyles.setGroupTitle}>
        <span className={editorStyles.setGroupIcon} aria-hidden>{icon}</span>
        <span className={editorStyles.setGroupLabel}>{title}</span>
        {action && <span className={editorStyles.setGroupAction} onClick={(e) => { e.stopPropagation(); e.preventDefault(); }}>{action}</span>}
      </summary>
      <div className={editorStyles.setGroupBody}>{children}</div>
    </details>
  );
}
