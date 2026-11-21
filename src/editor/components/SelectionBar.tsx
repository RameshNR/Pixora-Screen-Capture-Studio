import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  AlignCenterHorizontal, AlignCenterVertical, AlignEndHorizontal, AlignEndVertical, AlignStartHorizontal, AlignStartVertical,
  ArrowDown, ArrowDownToLine, ArrowUp, ArrowUpToLine, Bold, ChevronRight, ClipboardPaste, Copy, CopyPlus, Italic, Layers, Lock, Minus,
  MoreHorizontal, Plus, Trash2,
} from 'lucide-react';
import type { Rect } from '../types';
import type { MenuItem } from '@/shared/components/Dropdown';
import styles from './SelectionBar.module.css';
import { formatKeys } from '@/shared/utils/keys';

export type LayerMove = 'forward' | 'backward' | 'front' | 'back';
export type AlignTo = 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom';

export interface SelectionActions {
  copy: () => void;
  paste: (() => void) | null;
  duplicate: () => void;
  remove: () => void;
  /** Not offered while several objects are selected. */
  layer?: (to: LayerMove) => void;
  align?: (to: AlignTo) => void;
  /** Several objects selected: how many (shown on the bar). */
  count?: number;
  /** Locked ('all') or move only: no deleting; the bar offers Unlock. */
  locked?: 'all' | 'move';
  unlock?: () => void;
  /** The object's menu: the same items as its right-click menu. */
  menu?: () => MenuItem[];
  /** Quick text controls for text and callouts. */
  text?: { size: number; bold: boolean; italic: boolean; setSize: (n: number) => void; toggleBold: () => void; toggleItalic: () => void };
}

interface Props {
  /** Selection box in workspace (screen) coordinates. */
  anchor: Rect;
  /** Visible workspace size, to keep the bar on screen. */
  view: { width: number; height: number };
  actions: SelectionActions;
}

const BAR_H = 40;
const GAP = 14;

/** Floating toolbar above the selected object (quick actions + a "more" menu), like design tools. */
export function SelectionBar({ anchor, view, actions }: Props) {
  const [menu, setMenu] = useState(false);
  const [sub, setSub] = useState<'layer' | 'align' | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const [barW, setBarW] = useState(220);

  useEffect(() => {
    if (barRef.current) setBarW(barRef.current.offsetWidth);
  });

  useEffect(() => {
    if (!menu) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent && e.key !== 'Escape') return;
      if (e instanceof PointerEvent && root.current?.contains(e.target as Node)) return;
      if (e instanceof KeyboardEvent) e.stopPropagation();
      setMenu(false);
      setSub(null);
    };
    window.addEventListener('pointerdown', close, true);
    window.addEventListener('keydown', close, true);
    return () => {
      window.removeEventListener('pointerdown', close, true);
      window.removeEventListener('keydown', close, true);
    };
  }, [menu]);

  // Above the object when there is room, otherwise below it; always inside the workspace.
  const above = anchor.y - BAR_H - GAP >= 8;
  const top = above ? anchor.y - BAR_H - GAP : Math.min(view.height - BAR_H - 8, anchor.y + anchor.h + GAP + 18);
  const left = Math.max(8, Math.min(view.width - barW - 8, anchor.x + anchor.w / 2 - barW / 2));
  const menuBelow = top + BAR_H + 330 < view.height;

  const act = (fn: () => void) => () => {
    fn();
    setMenu(false);
    setSub(null);
  };
  // Keep the canvas from treating clicks on the bar as clicks on the image.
  const stop = { onPointerDown: (e: React.PointerEvent) => e.stopPropagation(), onDoubleClick: (e: React.MouseEvent) => e.stopPropagation() };

  return (
    <div ref={root} className={styles.root} style={{ left, top }} {...stop}>
      <div ref={barRef} className={styles.bar} role="toolbar" aria-label="Selected object">
        {actions.text && (
          <>
            <SizeControl text={actions.text} />
            <Btn label="Bold" pressed={actions.text.bold} onClick={actions.text.toggleBold}><Bold size={15} /></Btn>
            <Btn label="Italic" pressed={actions.text.italic} onClick={actions.text.toggleItalic}><Italic size={15} /></Btn>
            <span className={styles.sep} />
          </>
        )}
        {actions.count !== undefined && <span className={styles.count}>{actions.count} selected</span>}
        {actions.locked && actions.unlock && <Btn label={actions.locked === 'all' ? 'Locked: click to unlock' : 'Move only: click to finish'} onClick={actions.unlock}><Lock size={15} /></Btn>}
        <Btn label="Duplicate (Ctrl+D)" onClick={actions.duplicate}><CopyPlus size={16} /></Btn>
        {!actions.locked && <Btn label="Delete (Del)" onClick={actions.remove}><Trash2 size={16} /></Btn>}
        <Btn label="More options" pressed={menu} onClick={() => { setMenu((m) => !m); setSub(null); }} haspopup><MoreHorizontal size={17} /></Btn>
      </div>
      {menu && actions.menu && (
        <div className={`${styles.menu} ${menuBelow ? '' : styles.menuUp}`} role="menu" aria-label="Object options">
          {actions.menu().map((m) => (
            <div key={m.id} role="none">
              {m.separatorBefore && <div className={styles.divider} role="separator" />}
              <Item icon={m.icon} label={String(m.label)} kbd={typeof m.description === 'string' ? m.description : undefined} disabled={m.disabled} onClick={act(() => m.onSelect?.())} />
            </div>
          ))}
        </div>
      )}
      {menu && !actions.menu && (
        <div className={`${styles.menu} ${menuBelow ? '' : styles.menuUp}`} role="menu" aria-label="Object options">
          <Item icon={<Copy size={16} />} label="Copy" kbd="Ctrl+C" onClick={act(actions.copy)} />
          <Item icon={<ClipboardPaste size={16} />} label="Paste" kbd="Ctrl+V" disabled={!actions.paste} onClick={act(() => actions.paste?.())} />
          <Item icon={<CopyPlus size={16} />} label="Duplicate" kbd="Ctrl+D" onClick={act(actions.duplicate)} />
          <Item icon={<Trash2 size={16} />} label="Delete" kbd="Delete" disabled={Boolean(actions.locked)} onClick={act(actions.remove)} />
          {actions.layer && <div className={styles.divider} role="separator" />}
          {actions.layer && <Item icon={<Layers size={16} />} label="Layer" submenu open={sub === 'layer'} onClick={() => setSub(sub === 'layer' ? null : 'layer')} />}
          {actions.layer && sub === 'layer' && (
            <div className={styles.subList} role="group" aria-label="Layer">
              <Item icon={<ArrowUp size={15} />} label="Bring forward" kbd="Ctrl+]" onClick={act(() => actions.layer?.('forward'))} />
              <Item icon={<ArrowUpToLine size={15} />} label="Bring to front" onClick={act(() => actions.layer?.('front'))} />
              <Item icon={<ArrowDown size={15} />} label="Send backward" kbd="Ctrl+[" onClick={act(() => actions.layer?.('backward'))} />
              <Item icon={<ArrowDownToLine size={15} />} label="Send to back" onClick={act(() => actions.layer?.('back'))} />
            </div>
          )}
          {actions.align && <Item icon={<AlignStartVertical size={16} />} label="Align to image" submenu open={sub === 'align'} onClick={() => setSub(sub === 'align' ? null : 'align')} />}
          {actions.align && sub === 'align' && (
            <div className={styles.subList} role="group" aria-label="Align to image">
              <Item icon={<AlignStartVertical size={15} />} label="Left" onClick={act(() => actions.align?.('left'))} />
              <Item icon={<AlignCenterVertical size={15} />} label="Centre" onClick={act(() => actions.align?.('center'))} />
              <Item icon={<AlignEndVertical size={15} />} label="Right" onClick={act(() => actions.align?.('right'))} />
              <Item icon={<AlignStartHorizontal size={15} />} label="Top" onClick={act(() => actions.align?.('top'))} />
              <Item icon={<AlignCenterHorizontal size={15} />} label="Middle" onClick={act(() => actions.align?.('middle'))} />
              <Item icon={<AlignEndHorizontal size={15} />} label="Bottom" onClick={act(() => actions.align?.('bottom'))} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const MIN_SIZE = 6;
const MAX_SIZE = 600;
const clampSize = (n: number) => Math.max(MIN_SIZE, Math.min(MAX_SIZE, Math.round(n)));

/** − size +: hold a button to keep changing the size, click the number to type one. */
function SizeControl({ text }: { text: NonNullable<SelectionActions['text']> }) {
  const latest = useRef(text);
  latest.current = text;
  const [draft, setDraft] = useState<string | null>(null);
  const step = (by: number) => latest.current.setSize(clampSize(latest.current.size + by));
  const commit = () => {
    const n = Number(draft);
    if (draft && Number.isFinite(n) && n > 0) latest.current.setSize(clampSize(n));
    setDraft(null);
  };
  return (
    <>
      <HoldBtn label="Smaller text" onStep={() => step(-2)}><Minus size={14} /></HoldBtn>
      {draft === null ? (
        <button type="button" className={styles.size} aria-label={`Font size ${Math.round(text.size)}, click to type a size`} title="Click to type a size" onClick={() => setDraft(String(Math.round(text.size)))}>
          {Math.round(text.size)}
        </button>
      ) : (
        <input
          className={styles.sizeInput}
          aria-label="Font size"
          inputMode="numeric"
          autoFocus
          value={draft}
          onFocus={(e) => e.target.select()}
          onChange={(e) => setDraft(e.target.value.replace(/\D/g, '').slice(0, 3))}
          onBlur={commit}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') commit();
            if (e.key === 'Escape') setDraft(null);
          }}
        />
      )}
      <HoldBtn label="Bigger text" onStep={() => step(2)}><Plus size={14} /></HoldBtn>
    </>
  );
}

/** A button that repeats while it is held down, speeding up the longer it is held. */
function HoldBtn({ label, onStep, children }: { label: string; onStep: () => void; children: ReactNode }) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stepRef = useRef(onStep);
  stepRef.current = onStep;
  const stop = () => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(() => stop, []);
  const start = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return;
    // The bar can move as the object grows: keep the press on this button.
    e.currentTarget.setPointerCapture?.(e.pointerId);
    stop();
    stepRef.current();
    let delay = 380;
    const tick = () => {
      stepRef.current();
      delay = Math.max(45, delay * 0.8);
      timer.current = setTimeout(tick, delay);
    };
    timer.current = setTimeout(tick, delay);
  };
  return (
    <button type="button" className={styles.btn} aria-label={label} title={`${label} (hold to repeat)`} onPointerDown={start} onPointerUp={stop} onPointerCancel={stop} onLostPointerCapture={stop} onBlur={stop}
      onClick={(e) => { if (e.detail === 0) stepRef.current(); }}>
      {children}
    </button>
  );
}

function Btn({ label, onClick, children, pressed, haspopup }: { label: string; onClick: () => void; children: ReactNode; pressed?: boolean; haspopup?: boolean }) {
  return (
    <button type="button" className={`${styles.btn} ${pressed ? styles.btnOn : ''}`} aria-label={label} title={formatKeys(label)} aria-pressed={haspopup ? undefined : pressed}
      aria-haspopup={haspopup ? 'menu' : undefined} aria-expanded={haspopup ? !!pressed : undefined} onClick={onClick}>
      {children}
    </button>
  );
}

function Item({ icon, label, kbd, onClick, disabled, submenu, open }: { icon: ReactNode; label: string; kbd?: string; onClick: () => void; disabled?: boolean; submenu?: boolean; open?: boolean }) {
  return (
    <button type="button" role="menuitem" className={styles.item} disabled={disabled} onClick={onClick} aria-haspopup={submenu ? 'menu' : undefined} aria-expanded={submenu ? !!open : undefined}>
      <span className={styles.itemIcon}>{icon}</span>
      <span className={styles.itemLabel}>{label}</span>
      {kbd && <kbd className={styles.kbd}>{formatKeys(kbd)}</kbd>}
      {submenu && <ChevronRight size={15} className={`${styles.chev} ${open ? styles.chevOpen : ''}`} />}
    </button>
  );
}
