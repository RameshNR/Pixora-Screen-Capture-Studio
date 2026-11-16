import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  AlignCenterHorizontal, AlignCenterVertical, AlignEndHorizontal, AlignEndVertical, AlignStartHorizontal, AlignStartVertical,
  ArrowDown, ArrowDownToLine, ArrowUp, ArrowUpToLine, Bold, ChevronRight, ClipboardPaste, Copy, CopyPlus, Italic, Layers, Minus,
  MoreHorizontal, Plus, Trash2,
} from 'lucide-react';
import type { Rect } from '../types';
import styles from './SelectionBar.module.css';

export type LayerMove = 'forward' | 'backward' | 'front' | 'back';
export type AlignTo = 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom';

export interface SelectionActions {
  copy: () => void;
  paste: (() => void) | null;
  duplicate: () => void;
  remove: () => void;
  layer: (to: LayerMove) => void;
  align: (to: AlignTo) => void;
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
            <Btn label="Smaller text" onClick={() => actions.text!.setSize(Math.max(6, actions.text!.size - 2))}><Minus size={14} /></Btn>
            <span className={styles.size} aria-label="Font size">{Math.round(actions.text.size)}</span>
            <Btn label="Bigger text" onClick={() => actions.text!.setSize(Math.min(400, actions.text!.size + 2))}><Plus size={14} /></Btn>
            <Btn label="Bold" pressed={actions.text.bold} onClick={actions.text.toggleBold}><Bold size={15} /></Btn>
            <Btn label="Italic" pressed={actions.text.italic} onClick={actions.text.toggleItalic}><Italic size={15} /></Btn>
            <span className={styles.sep} />
          </>
        )}
        <Btn label="Duplicate (Ctrl+D)" onClick={actions.duplicate}><CopyPlus size={16} /></Btn>
        <Btn label="Delete (Del)" onClick={actions.remove}><Trash2 size={16} /></Btn>
        <Btn label="More options" pressed={menu} onClick={() => { setMenu((m) => !m); setSub(null); }} haspopup><MoreHorizontal size={17} /></Btn>
      </div>
      {menu && (
        <div className={`${styles.menu} ${menuBelow ? '' : styles.menuUp}`} role="menu" aria-label="Object options">
          <Item icon={<Copy size={16} />} label="Copy" kbd="Ctrl+C" onClick={act(actions.copy)} />
          <Item icon={<ClipboardPaste size={16} />} label="Paste" kbd="Ctrl+V" disabled={!actions.paste} onClick={act(() => actions.paste?.())} />
          <Item icon={<CopyPlus size={16} />} label="Duplicate" kbd="Ctrl+D" onClick={act(actions.duplicate)} />
          <Item icon={<Trash2 size={16} />} label="Delete" kbd="Delete" onClick={act(actions.remove)} />
          <div className={styles.divider} role="separator" />
          <Item icon={<Layers size={16} />} label="Layer" submenu open={sub === 'layer'} onClick={() => setSub(sub === 'layer' ? null : 'layer')} />
          {sub === 'layer' && (
            <div className={styles.subList} role="group" aria-label="Layer">
              <Item icon={<ArrowUp size={15} />} label="Bring forward" kbd="Ctrl+]" onClick={act(() => actions.layer('forward'))} />
              <Item icon={<ArrowUpToLine size={15} />} label="Bring to front" onClick={act(() => actions.layer('front'))} />
              <Item icon={<ArrowDown size={15} />} label="Send backward" kbd="Ctrl+[" onClick={act(() => actions.layer('backward'))} />
              <Item icon={<ArrowDownToLine size={15} />} label="Send to back" onClick={act(() => actions.layer('back'))} />
            </div>
          )}
          <Item icon={<AlignStartVertical size={16} />} label="Align to image" submenu open={sub === 'align'} onClick={() => setSub(sub === 'align' ? null : 'align')} />
          {sub === 'align' && (
            <div className={styles.subList} role="group" aria-label="Align to image">
              <Item icon={<AlignStartVertical size={15} />} label="Left" onClick={act(() => actions.align('left'))} />
              <Item icon={<AlignCenterVertical size={15} />} label="Centre" onClick={act(() => actions.align('center'))} />
              <Item icon={<AlignEndVertical size={15} />} label="Right" onClick={act(() => actions.align('right'))} />
              <Item icon={<AlignStartHorizontal size={15} />} label="Top" onClick={act(() => actions.align('top'))} />
              <Item icon={<AlignCenterHorizontal size={15} />} label="Middle" onClick={act(() => actions.align('middle'))} />
              <Item icon={<AlignEndHorizontal size={15} />} label="Bottom" onClick={act(() => actions.align('bottom'))} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Btn({ label, onClick, children, pressed, haspopup }: { label: string; onClick: () => void; children: ReactNode; pressed?: boolean; haspopup?: boolean }) {
  return (
    <button type="button" className={`${styles.btn} ${pressed ? styles.btnOn : ''}`} aria-label={label} title={label} aria-pressed={haspopup ? undefined : pressed}
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
      {kbd && <kbd className={styles.kbd}>{kbd}</kbd>}
      {submenu && <ChevronRight size={15} className={`${styles.chev} ${open ? styles.chevOpen : ''}`} />}
    </button>
  );
}
