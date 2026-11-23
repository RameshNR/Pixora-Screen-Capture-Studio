import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowLeftRight, ArrowUpDown, ChevronUp, Columns2, Copy, Maximize, Maximize2, Minimize2, Minus, Move, PanelBottom, Plus, Search, Settings, Sparkles, SquareSplitHorizontal, Eye, Info, PanelRight, Tag, ZoomIn } from 'lucide-react';
import { PANE_HOME, type ComparePane } from '../render';
import { ToggleSwitch } from '@/shared/components/FormControls';
import { Tooltip } from '@/shared/components/Tooltip';
import styles from './editor.module.css';

/** How Before and After are shown. */
export type CompareMode = 'side' | 'slider' | 'overlay';

export interface CompareState {
  /** Before / After on. */
  on: boolean;
  mode: CompareMode;
  /** Slider: where the divider is (share of the picture). Overlay: how much of After shows (0–1). */
  split: number;
  /** The divider runs across (Before above, After below) instead of up and down. */
  vertical: boolean;
  /** A magnifying glass follows the pointer. */
  loupe: boolean;
  /** The "Before" / "After" labels on the picture. */
  labels: boolean;
  /** Before / After off: show the original picture instead of the edited one. */
  original: boolean;
  /** Side by side: zooming one pane zooms the other. */
  syncZoom: boolean;
  /** Side by side: moving one pane moves the other. */
  syncScroll: boolean;
  /** Changed pixels tinted red. */
  highlight: boolean;
  /** Side by side: what each pane shows. */
  panes: [ComparePane, ComparePane];
}

export const COMPARE_DEFAULT: CompareState = {
  on: false, mode: 'slider', split: 0.5, vertical: false, loupe: false, labels: true,
  original: false, syncZoom: true, syncScroll: true, highlight: false, panes: [PANE_HOME, PANE_HOME],
};

/** Show: only the original, only the edited picture, or both (Before / After). */
export type CompareShow = 'original' | 'edited' | 'both';
export const showOf = (c: CompareState): CompareShow => (c.on ? 'both' : c.original ? 'original' : 'edited');
const SHOW: Record<CompareShow, Partial<CompareState>> = {
  original: { on: false, original: true },
  edited: { on: false, original: false },
  both: { on: true, original: false },
};

const MODES: Array<{ id: CompareMode; label: string; icon: ReactNode }> = [
  { id: 'side', label: 'Side by side', icon: <Columns2 size={18} /> },
  { id: 'slider', label: 'Slider', icon: <ArrowLeftRight size={18} /> },
  { id: 'overlay', label: 'Overlay (fade between them)', icon: <Copy size={18} /> },
];

/** Zoom sizes offered in the list (and Fit). */
const ZOOMS = [0.1, 0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4];

function Btn({ label, active, onClick, children, disabled }: { label: string; active?: boolean; onClick: () => void; children: ReactNode; disabled?: boolean }) {
  return (
    <Tooltip content={label}>
      <button type="button" aria-label={label} aria-pressed={active} disabled={disabled} className={`${styles.cbBtn} ${active ? styles.cbBtnOn : ''}`} onClick={onClick}>{children}</button>
    </Tooltip>
  );
}

/** Closes a popup on a press outside it. */
function useOutside(open: boolean, ref: React.RefObject<HTMLElement>, close: () => void) {
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) close(); };
    window.addEventListener('pointerdown', onDown, true);
    return () => window.removeEventListener('pointerdown', onDown, true);
  }, [open, ref, close]);
}

/**
 * The bar under the picture. Left: settings and Before / After. Centre: how to compare (side by
 * side, slider, overlay, differences). Right: zoom (with a list of sizes), fit, full screen.
 * Turned off in its settings, a compact card in the corner takes its place.
 */
/** Room the bar had last time (it is rebuilt with every image: starting from it avoids a jump). */
let lastRoom = 2000;

export function CompareBar({ state, onState, canCompare, showBar, onShowBar, zoom, onZoomStep, onZoomTo, onFit, fullScreen, onFullScreen, detailsPopup = true, onDetailsPopup, infoOpen = false, onInfo }: {
  state: CompareState;
  onState: (patch: Partial<CompareState>) => void;
  /** Something changed since the picture was opened: there is something to compare. */
  canCompare: boolean;
  showBar: boolean;
  onShowBar: (show: boolean) => void;
  zoom: number;
  onZoomStep: (dir: 1 | -1) => void;
  onZoomTo: (zoom: number) => void;
  onFit: () => void;
  fullScreen: boolean;
  onFullScreen: () => void;
  /** Full screen: image details float over the picture (or sit in a panel beside it). */
  detailsPopup?: boolean;
  onDetailsPopup?: (v: boolean) => void;
  /** Image details shown, and the button that shows / hides them. */
  infoOpen?: boolean;
  onInfo?: () => void;
}) {
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useOutside(menu, menuRef, () => setMenu(false));
  const [zoomMenu, setZoomMenu] = useState(false);
  const zoomRef = useRef<HTMLDivElement>(null);
  useOutside(zoomMenu, zoomRef, () => setZoomMenu(false));
  const on = state.on && canCompare;
  // Narrow window: the compare views (then the zoom) move into the settings popup.
  const root = useRef<HTMLDivElement>(null);
  const [room, setRoom] = useState(lastRoom);
  // Measured before the first paint (switching images rebuilt the bar wide, then narrowed it: flicker).
  useLayoutEffect(() => {
    const parent = root.current?.parentElement;
    if (!parent) return;
    const measure = () => {
      // Not laid out (being removed while switching images): a width of 0 would make the next bar
      // start in its smallest form and then grow back — the flicker when switching.
      if (!parent.isConnected || parent.clientWidth === 0) return;
      // Room for the bar: the row minus a small image strip (when there is one).
      const strip = [...parent.children].some((c) => c !== root.current && c.getAttribute('aria-label') === 'Open images');
      lastRoom = parent.clientWidth - (strip ? 272 : 0);
      setRoom(lastRoom);
    };
    // No measuring here: right after an image switch the picture area is still at its starting size
    // (it measures the window a moment later), so the bar read a narrow row and folded up. The resize
    // watcher reports the real size before anything is painted; until then the last size is used.
    const ro = new ResizeObserver(measure);
    ro.observe(parent);
    return () => ro.disconnect();
  }, []);
  const modesIn = room < 760;
  const zoomIn = room < 580;
  const toggle = (
    <Tooltip content={canCompare ? (on ? 'Hide Before / After' : 'Show Before / After') : 'Make a change first: then compare it with the original'}>
      <button type="button" role="switch" aria-checked={on} aria-label="Before / After" disabled={!canCompare}
        className={`${styles.cbToggle} ${on ? styles.cbToggleOn : ''}`} onClick={() => onState(on ? SHOW.edited : SHOW.both)}>
        <SquareSplitHorizontal size={17} aria-hidden />{zoomIn ? null : ' Before / After'}
      </button>
    </Tooltip>
  );
  const rows: Array<{ label: string; hint?: string; icon: ReactNode; value: boolean; set: (v: boolean) => void; compare?: boolean }> = [
    // Switching the bar on / off changes the layout: the popup closes with it.
    { label: 'Show control bar', icon: <PanelBottom size={16} />, value: showBar, set: (v) => { onShowBar(v); setMenu(false); } },
    { label: 'Before / After labels', icon: <Tag size={16} />, value: state.labels, set: (v) => onState({ labels: v }), compare: true },
    { label: 'Vertical split', icon: <ArrowUpDown size={16} />, value: state.vertical, set: (v) => onState({ vertical: v }), compare: true },
    { label: 'Sync zoom', hint: 'Side by side: zooming one picture zooms the other', icon: <ZoomIn size={16} />, value: state.syncZoom, set: (v) => onState({ syncZoom: v }), compare: true },
    { label: 'Sync scroll', hint: 'Side by side: moving one picture moves the other', icon: <Move size={16} />, value: state.syncScroll, set: (v) => onState({ syncScroll: v }), compare: true },
    { label: 'Highlight changes', hint: 'Changed pixels tinted red', icon: <Sparkles size={16} />, value: state.highlight, set: (v) => onState({ highlight: v }), compare: true },
    { label: 'Loupe (magnifier)', icon: <Search size={16} />, value: state.loupe, set: (v) => onState({ loupe: v }) },
    ...(onDetailsPopup ? [{ label: 'Details as a popup', hint: 'Full screen: image details float over the picture (off: a panel beside it)', icon: <PanelRight size={16} />, value: detailsPopup, set: onDetailsPopup }] : []),
  ];
  const settings = (
    <div className={styles.cbMenuWrap} ref={menuRef}>
      <Btn label="View settings" active={menu} onClick={() => setMenu((m) => !m)}><Settings size={18} /></Btn>
      {menu && (
        <div className={styles.cbMenu} role="dialog" aria-label="View settings">
          <div className={styles.cbMenuTitle}>View settings</div>
          {showBar && modesIn && (
            <div className={`${styles.cbShow} ${canCompare ? '' : styles.cbOff}`} role="radiogroup" aria-label="Compare view">
              {MODES.map((m) => (
                <button key={m.id} type="button" role="radio" aria-checked={on && state.mode === m.id} aria-label={m.label} title={m.label} disabled={!canCompare}
                  className={on && state.mode === m.id ? styles.cbShowOn : ''} onClick={() => onState({ mode: m.id, on: true, original: false, ...(m.id === 'overlay' && state.mode !== 'overlay' ? { split: 0.5 } : {}) })}>
                  {m.icon}
                </button>
              ))}
            </div>
          )}
          {showBar && zoomIn && (
            <div className={styles.cbMenuZoom} role="group" aria-label="Zoom">
              <button type="button" aria-label="Zoom out" onClick={() => onZoomStep(-1)}><Minus size={16} /></button>
              <ZoomBox zoom={zoom} onZoomTo={onZoomTo} />
              <button type="button" aria-label="Zoom in" onClick={() => onZoomStep(1)}><Plus size={16} /></button>
            </div>
          )}
          <div className={`${styles.cbShow} ${canCompare ? '' : styles.cbOff}`} role="radiogroup" aria-label="Show">
            {(['original', 'edited', 'both'] as const).map((v) => (
              <button key={v} type="button" role="radio" aria-checked={canCompare ? showOf(state) === v : v === 'edited'} disabled={!canCompare}
                className={(canCompare ? showOf(state) === v : v === 'edited') ? styles.cbShowOn : ''} onClick={() => onState(SHOW[v])}>
                {v === 'original' ? 'Original' : v === 'edited' ? 'Edited' : 'Both'}
              </button>
            ))}
          </div>
          {rows.map((r) => {
            const off = r.compare && !canCompare;
            return (
              <label key={r.label} className={`${styles.cbMenuRow} ${off ? styles.cbOff : ''}`} title={off ? 'Make a change first' : r.hint}>
                <span className={styles.cbMenuIcon} aria-hidden>{r.icon}</span>
                <span className={styles.cbMenuLabel}>{r.label}</span>
                <ToggleSwitch size="sm" label={r.label} checked={r.value} disabled={off} onChange={r.set} />
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
  const showingOriginal = canCompare && !state.on && state.original;
  const original = (
    <Btn label={showingOriginal ? 'Show the edited picture' : canCompare ? 'Show the original picture' : 'Original — make a change first'} active={showingOriginal} disabled={!canCompare}
      onClick={() => onState(showingOriginal ? SHOW.edited : SHOW.original)}><Eye size={18} /></Btn>
  );
  const info = onInfo ? <Btn label="Image details: file, size, colours" active={infoOpen} onClick={onInfo}><Info size={18} /></Btn> : null;
  const fit = <Btn label="Fit to screen" onClick={onFit}><Maximize size={18} /></Btn>;
  const full = <Btn label={fullScreen ? 'Exit full screen' : 'Full screen'} active={fullScreen} onClick={onFullScreen}>{fullScreen ? <Minimize2 size={18} /> : <Maximize2 size={18} />}</Btn>;

  if (!showBar) {
    return (
      <div className={styles.cbMini} role="group" aria-label="View" ref={root}>
        {settings}
        {toggle}
        {original}
        {info}
        {fit}
        {full}
      </div>
    );
  }
  return (
    <div className={styles.cbBar} role="group" aria-label="View" ref={root}>
      <div className={styles.cbGroup}>
        {settings}
        <span className={styles.cbSep} />
        {toggle}
        {original}
        {info}
      </div>
      {!modesIn && <span className={styles.cbSep} />}
      {!modesIn && <div className={styles.cbGroup} role="radiogroup" aria-label="Compare view">
        {MODES.map((m) => (
          <Tooltip key={m.id} content={canCompare ? m.label : `${m.label} — make a change first`}>
            <button type="button" role="radio" aria-checked={on && state.mode === m.id} aria-label={m.label} disabled={!canCompare}
              className={`${styles.cbBtn} ${on && state.mode === m.id ? styles.cbBtnOn : ''}`}
              onClick={() => onState({ mode: m.id, on: true, ...(m.id === 'overlay' && state.mode !== 'overlay' ? { split: 0.5 } : {}) })}>
              {m.icon}
            </button>
          </Tooltip>
        ))}
        {on && state.mode === 'overlay' && (
          <input type="range" className={styles.cbMix} aria-label="Overlay mix" min={0} max={100} value={Math.round(state.split * 100)}
            onChange={(e) => onState({ split: Number(e.target.value) / 100 })} />
        )}
      </div>}
      {modesIn && on && state.mode === 'overlay' && (
        <input type="range" className={styles.cbMix} aria-label="Overlay mix" min={0} max={100} value={Math.round(state.split * 100)}
          onChange={(e) => onState({ split: Number(e.target.value) / 100 })} />
      )}
      {!zoomIn && <span className={styles.cbSep} />}
      {!zoomIn && <div className={styles.cbZoom} role="group" aria-label="Zoom" ref={zoomRef}>
        <button type="button" aria-label="Zoom out" onClick={() => onZoomStep(-1)}><Minus size={16} /></button>
        <ZoomBox zoom={zoom} onZoomTo={onZoomTo} />
        <button type="button" className={styles.cbZoomMore} aria-label="Zoom sizes" aria-haspopup="listbox" aria-expanded={zoomMenu} onClick={() => setZoomMenu((v) => !v)}>
          <ChevronUp size={13} aria-hidden />
        </button>
        <button type="button" aria-label="Zoom in" onClick={() => onZoomStep(1)}><Plus size={16} /></button>
        {zoomMenu && (
          <div className={styles.cbZoomMenu} role="listbox" aria-label="Zoom">
            <button type="button" role="option" aria-selected={false} onClick={() => { onFit(); setZoomMenu(false); }}>Fit to screen</button>
            {ZOOMS.map((z) => (
              <button key={z} type="button" role="option" aria-selected={Math.abs(zoom - z) < 0.005} onClick={() => { onZoomTo(z); setZoomMenu(false); }}>{Math.round(z * 100)}%</button>
            ))}
          </div>
        )}
      </div>}
      <div className={styles.cbGroup}>
        {fit}
        {full}
      </div>
    </div>
  );
}

/** The zoom percentage: type a size (e.g. 150) and press Enter. */
function ZoomBox({ zoom, onZoomTo }: { zoom: number; onZoomTo: (z: number) => void }) {
  const shown = `${Math.round(zoom * 100)}%`;
  const [text, setText] = useState<string | null>(null);
  const apply = () => {
    const n = text === null ? NaN : parseFloat(text.replace('%', ''));
    if (Number.isFinite(n) && n > 0) onZoomTo(Math.min(8, Math.max(0.02, n / 100)));
    setText(null);
  };
  return (
    <input className={styles.cbZoomInput} aria-label="Zoom level" title="Type a zoom level (e.g. 150) and press Enter" inputMode="decimal"
      value={text ?? shown}
      onFocus={(e) => e.target.select()}
      onChange={(e) => setText(e.target.value)}
      onBlur={apply}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') { setText(null); (e.target as HTMLInputElement).blur(); }
      }} />
  );
}
