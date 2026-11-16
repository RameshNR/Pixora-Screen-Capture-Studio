import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronsLeftRight, Columns2, Expand, Image as ImageIcon, Maximize, Minimize2, Minus, Plus, RotateCcw, Sparkles, X } from 'lucide-react';
import styles from './CompareDialog.module.css';

interface Props {
  open: boolean;
  /** The untouched capture. */
  original: string;
  /** The current (edited) picture; omit when the image was never edited. */
  edited?: string;
  onClose: () => void;
  /** Brings the original back (shown only when there is an edited version). */
  onRestore?: () => void;
  /** Accessible name prefix of the pictures ("Screenshot: Original"). */
  alt?: string;
}

type View = 'original' | 'edited' | 'both';
type Layout = 'side' | 'slider';
type Zoom = number | 'fit';
interface Size { w: number; h: number }

const MIN = 0.05;
const MAX = 8;

/**
 * Original vs edited screenshot: zoom (buttons, wheel at the pointer, keys), Fit / 100%, Original /
 * Edited / Both, side by side (two panes with their own scrolling; zoom and scroll can be linked)
 * or a slider, and "Highlight changes" (pixels that differ, computed on this device).
 */
export function CompareDialog({ open, original, edited, onClose, onRestore, alt = 'Screenshot' }: Props) {
  const both = Boolean(edited);
  const srcs = useMemo(() => (edited ? [original, edited] : [original]), [original, edited]);
  const labels = ['Original', 'Edited'];
  const [sizes, setSizes] = useState<Array<Size | null>>([null, null]);
  const [view, setView] = useState<View>(both ? 'both' : 'original');
  const [layout, setLayout] = useState<Layout>('side');
  const [zooms, setZooms] = useState<[Zoom, Zoom]>(['fit', 'fit']);
  const [active, setActive] = useState(0);
  const [syncZoom, setSyncZoom] = useState(true);
  const [syncScroll, setSyncScroll] = useState(true);
  const [highlight, setHighlight] = useState(false);
  const [diff, setDiff] = useState<{ url: string; changed: number } | null>(null);
  const [full, setFull] = useState(false);
  const [split, setSplit] = useState(0.5);
  const panes = useRef<Array<HTMLDivElement | null>>([null, null]);
  const [areas, setAreas] = useState<Size[]>([{ w: 0, h: 0 }, { w: 0, h: 0 }]);
  const anchors = useRef<Array<{ fx: number; fy: number; sx: number; sy: number } | null>>([null, null]);
  const syncing = useRef(false);

  useEffect(() => {
    if (!open) return;
    setView(both ? 'both' : 'original');
    setZooms(['fit', 'fit']);
    setHighlight(false);
  }, [open, both]);

  // Image sizes (decoded off screen; nothing is drawn until they are known).
  useEffect(() => {
    if (!open) return;
    let alive = true;
    setSizes([null, null]);
    srcs.forEach((src, i) => {
      const img = new Image();
      img.onload = () => alive && setSizes((s) => s.map((x, j) => (j === i ? { w: img.naturalWidth, h: img.naturalHeight } : x)) as Array<Size | null>);
      img.src = src;
    });
    return () => { alive = false; };
  }, [open, srcs]);

  const sameSize = both && sizes[0] && sizes[1] && sizes[0].w === sizes[1].w && sizes[0].h === sizes[1].h;
  const effLayout: Layout = view === 'both' && layout === 'slider' && sameSize ? 'slider' : 'side';
  // Which pictures each pane shows: side by side → [0] and [1]; one picture or the slider → one pane.
  const paneImages: number[][] = view === 'both' ? (effLayout === 'side' ? [[0], [1]] : [[0, 1]]) : [[view === 'edited' ? 1 : 0]];

  // Pixels that differ between original and edited (same size only), as a red overlay.
  useEffect(() => {
    if (!open || !highlight || !sameSize || !edited) { setDiff(null); return; }
    let alive = true;
    void computeDiff(original, edited).then((d) => alive && setDiff(d)).catch(() => alive && setDiff(null));
    return () => { alive = false; };
  }, [open, highlight, sameSize, original, edited]);
  useEffect(() => () => { if (diff) URL.revokeObjectURL(diff.url); }, [diff]);

  // Pane sizes.
  useLayoutEffect(() => {
    if (!open) return;
    const ro = new ResizeObserver(() => setAreas(panes.current.map((p) => ({ w: Math.floor(p?.clientWidth ?? 0), h: Math.floor(p?.clientHeight ?? 0) }))));
    panes.current.forEach((p) => p && ro.observe(p));
    setAreas(panes.current.map((p) => ({ w: Math.floor(p?.clientWidth ?? 0), h: Math.floor(p?.clientHeight ?? 0) })));
    return () => ro.disconnect();
  }, [open, paneImages.length, full, view, effLayout]);

  const natOf = (pane: number): Size | null => {
    const idx = paneImages[pane];
    if (!idx) return null;
    const s = idx.map((i) => sizes[i]);
    if (!s.every(Boolean)) return null;
    return { w: Math.max(...s.map((x) => x!.w)), h: Math.max(...s.map((x) => x!.h)) };
  };
  const fitOf = (pane: number) => {
    const n = natOf(pane);
    const a = areas[pane];
    if (!n || !a || !a.w) return 1;
    return Math.min(1, (a.w - 24) / n.w, (a.h - 24) / n.h);
  };
  const scaleOf = (pane: number) => {
    const z = zooms[pane] ?? 'fit';
    return z === 'fit' ? fitOf(pane) : z;
  };

  /** Zooms one pane (and the other when zoom is linked), keeping the point under `at` in place. */
  const zoomPane = useCallback((pane: number, next: Zoom, at?: { x: number; y: number }) => {
    const targets = syncZoom && paneImages.length > 1 ? [0, 1] : [pane];
    targets.forEach((p) => {
      const el = panes.current[p];
      const n = natOf(p);
      if (!el || !n) return;
      const s = scaleOf(p);
      const w = n.w * s;
      const h = n.h * s;
      const px = at?.x ?? el.clientWidth / 2;
      const py = at?.y ?? el.clientHeight / 2;
      const padX = Math.max(0, (el.clientWidth - w) / 2);
      const padY = Math.max(0, (el.clientHeight - h) / 2);
      anchors.current[p] = { fx: clamp01((el.scrollLeft + px - padX) / Math.max(1, w)), fy: clamp01((el.scrollTop + py - padY) / Math.max(1, h)), sx: px, sy: py };
    });
    setZooms((z) => {
      const out: [Zoom, Zoom] = [...z] as [Zoom, Zoom];
      targets.forEach((p) => { out[p] = next === 'fit' ? 'fit' : Math.max(MIN, Math.min(MAX, next)); });
      return out;
    });
  }, [syncZoom, paneImages.length, sizes, areas, zooms]); // eslint-disable-line react-hooks/exhaustive-deps

  // After a zoom, put the anchored point back under the pointer / centre.
  useLayoutEffect(() => {
    panes.current.forEach((el, p) => {
      const a = anchors.current[p];
      const n = natOf(p);
      if (!el || !a || !n) return;
      anchors.current[p] = null;
      const s = scaleOf(p);
      const padX = Math.max(0, (el.clientWidth - n.w * s) / 2);
      const padY = Math.max(0, (el.clientHeight - n.h * s) / 2);
      el.scrollLeft = a.fx * n.w * s + padX - a.sx;
      el.scrollTop = a.fy * n.h * s + padY - a.sy;
    });
  });

  // Wheel zoom at the pointer, per pane.
  useEffect(() => {
    if (!open) return;
    const offs = panes.current.map((el, p) => {
      if (!el) return () => undefined;
      const onWheel = (e: WheelEvent) => {
        e.preventDefault();
        const r = el.getBoundingClientRect();
        setActive(p);
        zoomPane(p, scaleOf(p) * Math.exp(-e.deltaY * 0.0022), { x: e.clientX - r.left, y: e.clientY - r.top });
      };
      el.addEventListener('wheel', onWheel, { passive: false });
      return () => el.removeEventListener('wheel', onWheel);
    });
    return () => offs.forEach((f) => f());
  });

  // Scrolling one pane scrolls the other to the same place (when linked).
  const onPaneScroll = (p: number) => {
    if (!syncScroll || paneImages.length < 2 || syncing.current) return;
    const a = panes.current[p];
    const b = panes.current[1 - p];
    if (!a || !b) return;
    const fx = a.scrollWidth > a.clientWidth ? a.scrollLeft / (a.scrollWidth - a.clientWidth) : 0;
    const fy = a.scrollHeight > a.clientHeight ? a.scrollTop / (a.scrollHeight - a.clientHeight) : 0;
    syncing.current = true;
    b.scrollLeft = fx * Math.max(0, b.scrollWidth - b.clientWidth);
    b.scrollTop = fy * Math.max(0, b.scrollHeight - b.clientHeight);
    requestAnimationFrame(() => { syncing.current = false; });
  };

  // Keys: Esc closes (Done), + − 0 1 zoom the active pane.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); return; }
      const t = e.target as HTMLElement | null;
      if (t?.closest('input, textarea')) return;
      if (e.key === '+' || e.key === '=') zoomPane(active, scaleOf(active) * 1.25);
      else if (e.key === '-') zoomPane(active, scaleOf(active) / 1.25);
      else if (e.key === '0') zoomPane(active, 'fit');
      else if (e.key === '1') zoomPane(active, 1);
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  if (!open) return null;
  const scale = scaleOf(Math.min(active, paneImages.length - 1));
  const activeZoom = zooms[Math.min(active, paneImages.length - 1)] ?? 'fit';
  const fmt = (s: Size | null) => (s ? `${s.w.toLocaleString()} × ${s.h.toLocaleString()}` : '…');

  const picture = (i: number, s: number, extra: React.CSSProperties = {}) => (
    <img key={i} src={srcs[i]} alt={`${alt}: ${labels[i]}`} draggable={false} className={styles.img} style={{ width: sizes[i]!.w * s, height: sizes[i]!.h * s, ...extra }} />
  );
  const diffLayer = (s: number, extra: React.CSSProperties = {}) => (highlight && diff && sizes[1] ? (
    <img src={diff.url} alt="" aria-hidden className={styles.diff} style={{ width: sizes[1].w * s, height: sizes[1].h * s, ...extra }} />
  ) : null);

  const renderPane = (p: number) => {
    const idx = paneImages[p]!;
    const n = natOf(p);
    const a = areas[p] ?? { w: 0, h: 0 };
    const s = scaleOf(p);
    // Nothing is drawn until the pictures are decoded and the pane is measured (no jump / flicker).
    const ready = n && idx.every((i) => sizes[i]) && a.w > 0 && a.h > 0;
    const w = n ? n.w * s : 0;
    const h = n ? n.h * s : 0;
    const isSlider = idx.length === 2;
    const label = isSlider ? 'Original | Edited' : labels[idx[0]!]!;
    const showsEdited = idx.includes(1);
    return (
      <section key={`${p}-${idx.join()}`} className={`${styles.pane} ${showsEdited && !isSlider ? styles.paneEdited : ''} ${active === p && paneImages.length > 1 ? styles.paneActive : ''}`} aria-label={`${label} picture`} onPointerDown={() => setActive(p)}>
        <header className={styles.paneHead}>
          <ImageIcon size={15} aria-hidden />
          <span className={styles.paneTitle}>{label}</span>
          <span className={styles.chip}>{fmt(sizes[idx[0]!] ?? null)}</span>
        </header>
        <PanScroller refCb={(el) => { panes.current[p] = el; }} onScroll={() => onPaneScroll(p)} canPan={ready ? w > a.w + 0.5 || h > a.h + 0.5 : false} fits={!ready || (w <= a.w + 0.5 && h <= a.h + 0.5)}
          onDoubleClick={(x, y) => zoomPane(p, zooms[p] === 'fit' || s < 1 ? Math.max(1, fitOf(p) * 2) : 'fit', { x, y })}>
          {ready && (
            <div className={styles.stage} style={{ width: w, height: h }}>
              {!isSlider && (
                <div className={styles.frame} style={{ width: w, height: h }}>
                  {picture(idx[0]!, s)}
                  {idx[0] === 1 && diffLayer(s)}
                </div>
              )}
              {isSlider && (
                <div className={styles.frame} style={{ width: w, height: h }}>
                  {picture(0, s, { position: 'absolute', inset: 0 })}
                  <div className={styles.clip} style={{ clipPath: `inset(0 0 0 ${split * 100}%)` }}>
                    {picture(1, s, { position: 'absolute', inset: 0 })}
                    {diffLayer(s, { position: 'absolute', inset: 0 })}
                  </div>
                  <span className={styles.tag} style={{ left: 8 }}>Original</span>
                  <span className={styles.tag} style={{ right: 8 }}>Edited</span>
                  <SliderHandle split={split} onSplit={setSplit} />
                </div>
              )}
            </div>
          )}
        </PanScroller>
      </section>
    );
  };

  return createPortal(
    <div className={`${styles.backdrop} ${full ? styles.backdropFull : ''}`} onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-label={both ? 'Original vs edited screenshot' : 'Original screenshot'} className={`${styles.dialog} ${full ? styles.full : ''}`}>
        <header className={styles.head}>
          <span className={styles.logo} aria-hidden><ImageIcon size={22} /></span>
          <div className={styles.titles}>
            <h2>{both ? 'Original vs Edited Screenshot' : 'Original Screenshot'}</h2>
            <p>{both ? 'Compare screenshots side by side, zoom, and review changes.' : 'This picture was never edited. Zoom in to look at the details.'}</p>
          </div>
          <button type="button" className={styles.headBtn} aria-label={full ? 'Exit full screen' : 'Full screen'} title={full ? 'Exit full screen' : 'Full screen'} onClick={() => setFull((f) => !f)}>
            {full ? <Minimize2 size={18} /> : <Expand size={18} />}
          </button>
          <button type="button" className={styles.headBtn} aria-label="Close" title="Close (Esc)" onClick={onClose}><X size={20} /></button>
        </header>

        <div className={styles.toolbar}>
          <div className={styles.group} role="toolbar" aria-label="Zoom">
            <button type="button" aria-label="Zoom out" title="Zoom out (−)" onClick={() => zoomPane(active, scale / 1.25)}><Minus size={16} /></button>
            <span className={styles.level} aria-live="polite">{Math.round(scale * 100)}%</span>
            <button type="button" aria-label="Zoom in" title="Zoom in (+)" onClick={() => zoomPane(active, scale * 1.25)}><Plus size={16} /></button>
          </div>
          <div className={styles.group}>
            <button type="button" className={activeZoom === 'fit' ? styles.on : undefined} aria-pressed={activeZoom === 'fit'} title="Fit to the window (0)" onClick={() => zoomPane(active, 'fit')}><Maximize size={15} /> Fit</button>
            <button type="button" className={activeZoom === 1 ? styles.on : undefined} aria-pressed={activeZoom === 1} title="Actual size (1)" onClick={() => zoomPane(active, 1)}>100%</button>
          </div>
          {both && (
            <>
              <span className={styles.sep} />
              <div className={styles.group} role="radiogroup" aria-label="Layout">
                <button type="button" role="radio" aria-checked={view === 'both' && effLayout === 'side'} className={view === 'both' && effLayout === 'side' ? styles.on : undefined}
                  onClick={() => { setView('both'); setLayout('side'); setZooms(['fit', 'fit']); }}>
                  <Columns2 size={15} /> Side by side
                </button>
                <button type="button" role="radio" aria-checked={view === 'both' && effLayout === 'slider'} className={view === 'both' && effLayout === 'slider' ? styles.on : undefined} disabled={!sameSize}
                  title={sameSize ? 'Drag the divider to compare' : 'The pictures have different sizes: use Side by side'} onClick={() => { setView('both'); setLayout('slider'); setZooms(['fit', 'fit']); }}>
                  <ChevronsLeftRight size={15} /> Slider
                </button>
              </div>
              <span className={styles.flex} />
              <div className={styles.group} role="radiogroup" aria-label="Compare">
                {(['original', 'edited', 'both'] as View[]).map((v) => (
                  <button key={v} type="button" role="radio" aria-checked={view === v} className={view === v ? styles.on : undefined} onClick={() => { setView(v); setActive(0); setZooms(['fit', 'fit']); }}>
                    {v === 'both' && <Columns2 size={15} />}
                    {v === 'original' ? 'Original' : v === 'edited' ? 'Edited' : 'Both'}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        <div className={`${styles.panes} ${paneImages.length > 1 ? styles.panesTwo : ''}`}>
          {paneImages.map((_, p) => renderPane(p))}
        </div>

        <footer className={styles.foot}>
          {both ? (
            <div className={styles.options} role="group" aria-label="View options">
              <span className={styles.optionsTitle}>View Options</span>
              <Tick label="Sync Zoom" checked={syncZoom} disabled={paneImages.length < 2} onChange={setSyncZoom} title="Zoom both pictures together" />
              <Tick label="Sync Scroll" checked={syncScroll} disabled={paneImages.length < 2} onChange={setSyncScroll} title="Scrolling one picture scrolls the other" />
              <Tick label="Highlight Changes" icon={<Sparkles size={14} />} checked={highlight} disabled={!sameSize} onChange={setHighlight}
                title={sameSize ? 'Mark the pixels that differ (on the Edited picture)' : 'Only for pictures of the same size'} />
              {highlight && diff && <span className={styles.diffNote} aria-live="polite">{diff.changed ? `${diff.changed.toFixed(diff.changed < 1 ? 2 : 1)}% of the picture changed` : 'No differences'}</span>}
            </div>
          ) : <span className={styles.flex} />}
          <div className={styles.actions}>
            {both && onRestore && (
              <button type="button" className={styles.secondary} onClick={onRestore}><RotateCcw size={16} /> Restore Original</button>
            )}
            <button type="button" className={styles.primary} onClick={onClose}><Check size={16} /> Done</button>
          </div>
        </footer>
      </div>
    </div>,
    document.body,
  );
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

/** Scrolling area that can be dragged to move around once the picture is larger than it. */
function PanScroller({ refCb, onScroll, canPan, fits, onDoubleClick, children }: {
  refCb: (el: HTMLDivElement | null) => void; onScroll: () => void; canPan: boolean; fits: boolean; onDoubleClick: (x: number, y: number) => void; children: React.ReactNode;
}) {
  const drag = useRef<{ x: number; y: number; sl: number; st: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  return (
    <div
      ref={refCb}
      // A picture that fits shows no scrollbars at all (scrollbars coming and going re-fitted the picture: flicker).
      className={`${styles.scroller} ${fits ? styles.fits : ''} ${canPan ? styles.canPan : ''} ${dragging ? styles.dragging : ''}`}
      tabIndex={0}
      aria-label="Zoomable image"
      onScroll={onScroll}
      onPointerDown={(e) => {
        if (!canPan || e.button !== 0 || (e.target as HTMLElement).closest('[role="slider"]')) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = { x: e.clientX, y: e.clientY, sl: e.currentTarget.scrollLeft, st: e.currentTarget.scrollTop };
        setDragging(true);
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        e.currentTarget.scrollLeft = d.sl - (e.clientX - d.x);
        e.currentTarget.scrollTop = d.st - (e.clientY - d.y);
      }}
      onPointerUp={() => { drag.current = null; setDragging(false); }}
      onPointerCancel={() => { drag.current = null; setDragging(false); }}
      onDoubleClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); onDoubleClick(e.clientX - r.left, e.clientY - r.top); }}
    >
      {children}
    </div>
  );
}

function SliderHandle({ split, onSplit }: { split: number; onSplit: (v: number) => void }) {
  const start = (e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    const stage = (e.currentTarget as HTMLElement).parentElement!;
    const move = (ev: PointerEvent) => {
      const r = stage.getBoundingClientRect();
      onSplit(clamp01((ev.clientX - r.left) / r.width));
    };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  return (
    <div className={styles.divider} style={{ left: `${split * 100}%` }} onPointerDown={start} role="slider" aria-label="Compare position" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(split * 100)} tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft') onSplit(clamp01(split - 0.05));
        else if (e.key === 'ArrowRight') onSplit(clamp01(split + 0.05));
        else return;
        e.preventDefault();
        e.stopPropagation();
      }}>
      <span className={styles.knob}><ChevronsLeftRight size={16} /></span>
    </div>
  );
}

function Tick({ label, checked, onChange, disabled, title, icon }: { label: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; title?: string; icon?: React.ReactNode }) {
  return (
    <label className={`${styles.tick} ${disabled ? styles.tickOff : ''}`} title={title}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className={styles.box} aria-hidden>{checked && <Check size={13} strokeWidth={3} />}</span>
      {icon}
      {label}
    </label>
  );
}

/**
 * Marks the pixels that differ between two same-size pictures (red, slightly widened so thin
 * changes stay visible) and reports how much of the picture changed.
 */
export async function computeDiff(a: string, b: string): Promise<{ url: string; changed: number }> {
  const [ia, ib] = await Promise.all([loadBitmap(a), loadBitmap(b)]);
  const k = Math.min(1, 2400 / Math.max(ia.width, ia.height));
  const w = Math.max(1, Math.round(ia.width * k));
  const h = Math.max(1, Math.round(ia.height * k));
  const ca = new OffscreenCanvas(w, h).getContext('2d', { willReadFrequently: true })!;
  const cb = new OffscreenCanvas(w, h).getContext('2d', { willReadFrequently: true })!;
  ca.drawImage(ia, 0, 0, w, h);
  cb.drawImage(ib, 0, 0, w, h);
  ia.close();
  ib.close();
  const da = ca.getImageData(0, 0, w, h).data;
  const db = cb.getImageData(0, 0, w, h).data;
  const mask = new Uint8Array(w * h);
  let changed = 0;
  for (let i = 0, p = 0; p < mask.length; p++, i += 4) {
    const d = Math.abs(da[i]! - db[i]!) + Math.abs(da[i + 1]! - db[i + 1]!) + Math.abs(da[i + 2]! - db[i + 2]!) + Math.abs(da[i + 3]! - db[i + 3]!);
    if (d > 40) { mask[p] = 1; changed++; }
  }
  const out = new OffscreenCanvas(w, h);
  const ctx = out.getContext('2d')!;
  const img = ctx.createImageData(w, h);
  const r = Math.max(1, Math.round(2 * k));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!mask[y * w + x]) continue;
      for (let dy = -r; dy <= r; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -r; dx <= r; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= w) continue;
          const o = (yy * w + xx) * 4;
          img.data[o] = 255; img.data[o + 1] = 45; img.data[o + 2] = 85; img.data[o + 3] = 120;
        }
      }
    }
  }
  ctx.putImageData(img, 0, 0);
  const blob = await out.convertToBlob({ type: 'image/png' });
  return { url: URL.createObjectURL(blob), changed: (changed / mask.length) * 100 };
}

async function loadBitmap(src: string): Promise<ImageBitmap> {
  const blob = await (await fetch(src)).blob();
  return createImageBitmap(blob);
}
