import { useEffect, useState, type ReactNode } from 'react';
import {
  ArrowUpRight, ChevronDown, Share2, Columns2, Copy, Crop, Download, Droplet, Eraser, FlipHorizontal2, FlipVertical2, Frame, Grid3x3, Hand, Highlighter,
  EyeOff, Keyboard, LayoutGrid, ScanSearch, MessageSquareText, Minus, MousePointer2, MousePointerClick, Pen, Plus, Redo2, RefreshCcwDot, RotateCcw, RotateCw, ScanText, Scaling, Scissors,
  Shapes, Stamp, Sticker, Type, Undo2,
} from 'lucide-react';
import type { Tool } from '../types';
import { IconButton, Button } from '@/shared/components/Button';
import { Dropdown } from '@/shared/components/Dropdown';
import { Tooltip } from '@/shared/components/Tooltip';
import { AddImageMenu, type AddedImage } from '@/shared/components/AddImageMenu';
import { Spinner } from '@/shared/components/Progress';
import styles from './editor.module.css';
import { formatKeys } from '@/shared/utils/keys';

interface Props {
  /** Inside the Flow Editor: its header shows the logo and the Copy / Download buttons. */
  hideBrand?: boolean;
  tool: Tool;
  onTool: (tool: Tool) => void;
  canUndo: boolean;
  canRedo: boolean;
  canReset: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onReset: () => void;
  onRotate: (dir: 'cw' | 'ccw') => void;
  onFlip: (axis: 'horizontal' | 'vertical') => void;
  onResize: () => void;
  /** Opens Cut out & join (remove a middle band, keep the rest). */
  onCutOut?: () => void;
  /** Original vs edited (screenshot editor). */
  onCompare?: () => void;
  /** Pictures to place on the image (from the computer, the clipboard or a web address). */
  onInsertImages: (images: AddedImage[]) => void;
  /** Omitted where collages are not available (e.g. inside the Flow Editor). */
  onCollage?: () => void;
  zoom: number;
  onZoom: (zoom: number | 'fit') => void;
  onOcr: () => void;
  ocrBusy: boolean;
  onCopy: () => void;
  onDownload: () => void;
  /** Opens the export settings (format, quality, Save as, PDF, Word, QR). */
  onExport?: () => void;
  onShortcuts: () => void;
  onFindSensitive: () => void;
  busy: boolean;
  /** A download is running: the Download button shows the spinner. */
  downloading?: boolean;
  /** Drawing on a video frame: no tools that change the picture's size (crop, resize, rotate, cut, frame). */
  videoMode?: boolean;
}

const ZOOM_STEPS = [0.1, 0.25, 0.33, 0.5, 0.67, 0.75, 1, 1.25, 1.5, 2, 3, 4, 6, 8];

export const MIN_ZOOM = 0.02;
export const MAX_ZOOM = 8;

/** Parses typed zoom ("150", "150%", "1.5x") into a factor, or null when invalid. */
export function parseZoom(text: string): number | null {
  const t = text.trim().toLowerCase().replace(',', '.');
  const m = /^(\d+(?:\.\d+)?)\s*(%|x|×)?$/.exec(t);
  if (!m) return null;
  const n = Number(m[1]);
  const z = m[2] === 'x' || m[2] === '×' ? n : n / 100;
  if (!Number.isFinite(z) || z <= 0) return null;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
}

/** Zoom percentage you can type into, plus a menu of presets. */
function ZoomField({ zoom, onZoom }: { zoom: number; onZoom: (z: number | 'fit') => void }) {
  const shown = `${Math.round(zoom * 100)}%`;
  const [text, setText] = useState(shown);
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    if (!editing) setText(shown);
  }, [shown, editing]);
  const apply = () => {
    const z = parseZoom(text);
    if (z !== null) onZoom(z);
    else setText(shown);
    setEditing(false);
  };
  return (
    <div className={styles.zoomField}>
      <input
        className={styles.zoomInput}
        value={editing ? text : shown}
        aria-label="Zoom level"
        title="Type a zoom level (e.g. 150) and press Enter"
        inputMode="decimal"
        onFocus={(e) => { setEditing(true); setText(shown.replace('%', '')); requestAnimationFrame(() => e.target.select()); }}
        onChange={(e) => setText(e.target.value)}
        onBlur={apply}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') { setText(shown); setEditing(false); (e.target as HTMLInputElement).blur(); }
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            const next = nextZoom(zoom, e.key === 'ArrowUp' ? 1 : -1);
            onZoom(next);
            setText(String(Math.round(next * 100)));
          }
        }}
      />
      <Dropdown
        minWidth={170}
        ariaLabel="Zoom presets"
        items={[
          { id: 'fit', label: 'Fit to screen', onSelect: () => onZoom('fit') },
          { id: '100', label: '100% (actual size)', onSelect: () => onZoom(1) },
          ...[0.25, 0.5, 0.75, 1.5, 2, 4].map((z) => ({ id: String(z), label: `${z * 100}%`, onSelect: () => onZoom(z) })),
        ]}
        trigger={({ toggle, open }) => (
          <button type="button" className={styles.zoomMenu} aria-label="Zoom presets" aria-haspopup="menu" aria-expanded={open} onClick={toggle}>
            <ChevronDown size={13} />
          </button>
        )}
      />
    </div>
  );
}

export function nextZoom(zoom: number, dir: 1 | -1): number {
  if (dir > 0) return ZOOM_STEPS.find((z) => z > zoom + 0.001) ?? MAX_ZOOM;
  return [...ZOOM_STEPS].reverse().find((z) => z < zoom - 0.001) ?? Math.max(MIN_ZOOM, zoom / 1.25);
}

export function EditorToolbar(p: Props) {
  const T = (tool: Tool, label: string, icon: ReactNode, shortcut?: string) => (
    <IconButton tone="dark" key={tool} label={label} shortcut={shortcut} icon={icon} active={p.tool === tool} onClick={() => p.onTool(tool)} />
  );
  return (
    <header className={styles.toolbar} role="toolbar" aria-label="Editor tools">
      <div className={`${styles.group} ${styles.left}`}>
        {!p.hideBrand && <img className={styles.brand} src="/icons/icon-48.png" alt="Pixora" />}
        <IconButton tone="dark" label="Undo" shortcut="Ctrl+Z" icon={<Undo2 size={18} />} disabled={!p.canUndo} onClick={p.onUndo} />
        <IconButton tone="dark" label="Redo" shortcut="Ctrl+Y" icon={<Redo2 size={18} />} disabled={!p.canRedo} onClick={p.onRedo} />
        <IconButton tone="dark" label="Reset to original (undoable)" icon={<RefreshCcwDot size={18} />} disabled={!p.canReset} onClick={p.onReset} />
      </div>

      <div className={`${styles.group} ${styles.center}`}>
        {T('select', 'Select & move', <MousePointer2 size={18} />, 'V')}
        {T('hand', 'Move & pan (drag an object to move it, the image to pan)', <Hand size={18} />, 'H')}
        {!p.videoMode && <>
        <span className={styles.sep} />
        {T('crop', 'Crop', <Crop size={18} />, 'C')}
        <IconButton tone="dark" label="Resize image" icon={<Scaling size={18} />} onClick={p.onResize} />
        {p.onCompare && <IconButton tone="dark" label="Compare with original" title="Compare with original: side by side, slider, highlight changes" icon={<Columns2 size={18} />} onClick={p.onCompare} />}
        {p.onCutOut && <IconButton tone="dark" label="Cut out & join" title="Cut out & join: mark a part in the middle of the image to remove; the rest is joined" icon={<Scissors size={18} />} active={p.tool === 'cut'} onClick={p.onCutOut} />}
        <Dropdown
          minWidth={190}
          ariaLabel="Rotate and flip"
          items={[
            { id: 'ccw', label: 'Rotate left', icon: <RotateCcw size={15} />, onSelect: () => p.onRotate('ccw') },
            { id: 'cw', label: 'Rotate right', icon: <RotateCw size={15} />, onSelect: () => p.onRotate('cw') },
            { id: 'fh', label: 'Flip horizontal', icon: <FlipHorizontal2 size={15} />, onSelect: () => p.onFlip('horizontal'), separatorBefore: true },
            { id: 'fv', label: 'Flip vertical', icon: <FlipVertical2 size={15} />, onSelect: () => p.onFlip('vertical') },
          ]}
          trigger={({ toggle, open }) => (
            <Tooltip content="Rotate & flip">
              <button type="button" aria-label="Rotate & flip" aria-haspopup="menu" aria-expanded={open} className={styles.menuTool} onClick={toggle}>
                <RotateCw size={18} />
                <ChevronDown size={11} />
              </button>
            </Tooltip>
          )}
        />
        </>}
        <span className={styles.sep} />
        {T('pen', 'Pen', <Pen size={18} />, 'P')}
        {T('highlighter', 'Highlighter', <Highlighter size={18} />, 'G')}
        {/* One tool for every shape: rectangle, circle, triangle, badges… (pick the shape in the panel). */}
        <IconButton tone="dark" key="shapes" label="Shapes" shortcut="R / O" icon={<Shapes size={18} />} active={p.tool === 'rect' || p.tool === 'ellipse'} onClick={() => p.onTool('rect')} />
        {T('arrow', 'Line & arrow (heads, curves, dashes)', <ArrowUpRight size={18} />, 'A / L')}
        {T('text', 'Text', <Type size={18} />, 'T')}
        {T('callout', 'Callout', <MessageSquareText size={18} />, 'K')}
        {T('blur', 'Blur', <Droplet size={18} />, 'B')}
        {T('pixelate', 'Pixelate', <Grid3x3 size={18} />, 'X')}
        {T('mask', 'Solid mask (hide with a colour)', <EyeOff size={18} />, 'M')}
        <IconButton tone="dark" label="Find sensitive info (emails, numbers, keys)" icon={<ScanSearch size={18} />} onClick={p.onFindSensitive} />
        {T('marker', 'Numbered marker', <span className={styles.markerGlyph}>1</span>, 'N')}
        {T('sticker', 'Sticker', <Sticker size={18} />, 'S')}
        {T('cursor', 'Cursor & click effects', <MousePointerClick size={18} />, 'U')}
        <AddImageMenu variant="icon" label="Insert image" onAdd={p.onInsertImages} />
        {T('eraser', 'Eraser (removes annotations)', <Eraser size={18} />, 'E')}
        <span className={styles.sep} />
        {T('watermark', 'Watermark', <Stamp size={18} />, 'W')}
        {!p.videoMode && T('frame', 'Border & browser frame', <Frame size={18} />, 'F')}
        {p.onCollage && !p.videoMode && <IconButton tone="dark" label="Collage — combine images" icon={<LayoutGrid size={18} />} onClick={p.onCollage} />}
      </div>

      <div className={`${styles.group} ${styles.right}`}>
        <div className={styles.zoom}>
          <IconButton tone="dark" size="sm" label="Zoom out" shortcut="Ctrl+−" icon={<Minus size={15} />} onClick={() => p.onZoom(nextZoom(p.zoom, -1))} />
          <ZoomField zoom={p.zoom} onZoom={p.onZoom} />
          <IconButton tone="dark" size="sm" label="Zoom in" shortcut="Ctrl++" icon={<Plus size={15} />} onClick={() => p.onZoom(nextZoom(p.zoom, 1))} />
        </div>
        <IconButton tone="dark" size="sm" label="Keyboard shortcuts" shortcut="?" icon={<Keyboard size={16} />} onClick={p.onShortcuts} />
        <button type="button" className={styles.ocrBtn} onClick={p.onOcr} disabled={p.ocrBusy} aria-label="Extract text (OCR)">
          {p.ocrBusy ? <Spinner size={13} /> : <ScanText size={15} />} AI OCR
        </button>
        {!p.hideBrand && (
          <>
            <Button size="sm" className={styles.darkBtn} icon={<Copy size={15} />} onClick={p.onCopy} disabled={p.busy} title={formatKeys('Copy image (Ctrl+C)')}>
              Copy
            </Button>
            <Button size="sm" variant="primary" className={styles.primaryBtn} icon={<Download size={15} />} onClick={p.onDownload} loading={p.downloading} disabled={p.busy} title={formatKeys('Download (Ctrl+S)')}>
              Download
            </Button>
            {p.onExport && (
              <Button size="sm" className={styles.darkBtn} icon={<Share2 size={15} />} onClick={p.onExport} disabled={p.busy} title="Export settings: file name, format, quality, Save as, PDF, Word, QR code">
                Export…
              </Button>
            )}
          </>
        )}
      </div>
    </header>
  );
}
