import { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Copy, Eye, GripVertical, Images, LayoutGrid, PanelLeftClose, PanelLeftOpen, RotateCcw, X } from 'lucide-react';
import type { CaptureRecord } from '@/shared/types';
import { AddImageMenu, type AddedImage } from '@/shared/components/AddImageMenu';
import { IconButton } from '@/shared/components/Button';
import styles from './ImageRail.module.css';

interface Props {
  items: CaptureRecord[];
  currentId: string;
  /** Live thumbnails of images edited in this session (data URLs). */
  liveThumbs: Record<string, string>;
  checked: Set<string>;
  hidden: boolean;
  onHidden: (hidden: boolean) => void;
  onCheck: (id: string, on: boolean) => void;
  onCheckAll: (on: boolean) => void;
  onOpen: (id: string) => void;
  onCompare: (id: string) => void;
  onRestore: (id: string) => void;
  onRemove: (id: string) => void;
  onAdd: (images: AddedImage[]) => void;
  onCollage: () => void;
  /** Moves an image to a new position in the list. */
  onMove: (id: string, to: number) => void;
  onDuplicate: (id: string) => void;
  /** Renames the capture (the name shown in Recent captures and used for downloads). */
  onRename: (id: string, name: string) => void;
  isEdited: (id: string) => boolean;
}

const host = (url?: string) => {
  try {
    return url ? new URL(url).hostname.replace(/^www\./, '') : '';
  } catch {
    return '';
  }
};

/** The images of this editing session (the screenshot plus any added ones), with the Flow Editor's options. */
export function ImageRail(p: Props) {
  const dragId = useRef<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [dropAt, setDropAt] = useState<{ id: string; after: boolean } | null>(null);

  if (p.hidden) {
    const i = p.items.findIndex((x) => x.id === p.currentId);
    return (
      <aside className={styles.mini} aria-label="Images (hidden)">
        <IconButton tone="dark" size="sm" label="Show image panel" icon={<PanelLeftOpen size={16} />} onClick={() => p.onHidden(false)} />
        <span className={styles.miniCount}>{i + 1}/{p.items.length}</span>
      </aside>
    );
  }
  const all = p.items.length > 0 && p.checked.size === p.items.length;
  return (
    <aside className={styles.rail} aria-label="Images">
      <div className={styles.head}>
        <span className={styles.title}><Images size={15} /> Images ({p.items.length})</span>
        <AddImageMenu className={styles.addBtn} onAdd={p.onAdd} />
        <button type="button" className={styles.hide} aria-label="Hide image panel" title="Hide image panel" onClick={() => p.onHidden(true)}>
          <PanelLeftClose size={15} />
        </button>
      </div>
      <div className={styles.tools}>
        <label className={styles.all}>
          <input type="checkbox" checked={all} onChange={(e) => p.onCheckAll(e.target.checked)} /> Select all
        </label>
        <button type="button" className={styles.toolBtn} onClick={p.onCollage} disabled={p.items.length === 0}
          title={p.checked.size ? `Collage of the ${p.checked.size} selected images` : 'Collage of all images (tick images to choose)'}>
          <LayoutGrid size={14} /> Collage{p.checked.size ? ` (${p.checked.size})` : ''}
        </button>
      </div>
      <ol className={styles.list}>
        {p.items.map((rec, i) => {
          const on = rec.id === p.currentId;
          const edited = p.isEdited(rec.id);
          const thumb = p.liveThumbs[rec.id] ?? rec.thumbnail;
          const site = host(rec.sourceUrl);
          return (
            <li
              key={rec.id}
              className={[
                styles.card,
                on ? styles.cardOn : '',
                dragging === rec.id ? styles.cardDragging : '',
                dropAt?.id === rec.id && dragging !== rec.id ? (dropAt.after ? styles.dropAfter : styles.dropBefore) : '',
              ].join(' ')}
              draggable
              onDragStart={(e) => {
                if ((e.target as HTMLElement).closest('input')) { e.preventDefault(); return; }
                dragId.current = rec.id;
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', rec.id);
                requestAnimationFrame(() => setDragging(rec.id));
              }}
              onDragOver={(e) => {
                if (!dragId.current) return;
                e.preventDefault();
                const r = e.currentTarget.getBoundingClientRect();
                const after = e.clientY > r.top + r.height / 2;
                if (dropAt?.id !== rec.id || dropAt.after !== after) setDropAt({ id: rec.id, after });
              }}
              onDrop={(e) => {
                e.preventDefault();
                const from = dragId.current;
                if (from && dropAt) {
                  const fromIndex = p.items.findIndex((x) => x.id === from);
                  let to = i + (dropAt.after ? 1 : 0);
                  if (fromIndex < to) to -= 1;
                  if (to !== fromIndex) p.onMove(from, to);
                }
                dragId.current = null;
                setDragging(null);
                setDropAt(null);
              }}
              onDragEnd={() => { dragId.current = null; setDragging(null); setDropAt(null); }}
            >
              <div className={styles.top}>
                <input type="checkbox" aria-label={`Select image ${i + 1}`} checked={p.checked.has(rec.id)} onChange={(e) => p.onCheck(rec.id, e.target.checked)} />
                <span className={styles.seq}>{i + 1}</span>
                {edited && <span className={styles.edited}>edited</span>}
                {on && <span className={styles.open}>open</span>}
                <GripVertical size={14} className={styles.grip} aria-hidden />
              </div>
              <button type="button" className={styles.thumb} onClick={() => p.onOpen(rec.id)} aria-label={`Open image ${i + 1}`} aria-current={on ? 'true' : undefined}>
                {thumb ? <img src={thumb} alt="" /> : <span />}
              </button>
              <NameField value={rec.name} label={`Name of image ${i + 1}`} onCommit={(name) => p.onRename(rec.id, name)} />
              <div className={styles.metaDim} title={rec.sourceUrl ?? ''}>
                {new Date(rec.createdAt).toLocaleTimeString()} · {rec.width}×{rec.height}{site ? ` · ${site}` : ''}
              </div>
              <div className={styles.actions}>
                <IconButton tone="dark" size="sm" label="Move up" icon={<ArrowUp size={13} />} disabled={i === 0} onClick={() => p.onMove(rec.id, i - 1)} />
                <IconButton tone="dark" size="sm" label="Move down" icon={<ArrowDown size={13} />} disabled={i === p.items.length - 1} onClick={() => p.onMove(rec.id, i + 1)} />
                <IconButton tone="dark" size="sm" label="Duplicate" icon={<Copy size={13} />} onClick={() => p.onDuplicate(rec.id)} />
                <IconButton tone="dark" size="sm" label={edited ? 'Compare with original' : 'View original'} icon={<Eye size={13} />} onClick={() => p.onCompare(rec.id)} />
                <IconButton tone="dark" size="sm" label="Restore original" icon={<RotateCcw size={13} />} disabled={!edited} onClick={() => p.onRestore(rec.id)} />
                <IconButton tone="dark" size="sm" label="Remove from list" title="Remove from this list (it stays in Recent captures)" icon={<X size={13} />} disabled={p.items.length < 2} onClick={() => p.onRemove(rec.id)} />
              </div>
            </li>
          );
        })}
      </ol>
    </aside>
  );
}

/** Name box: saved when you leave it or press Enter (Esc puts the old name back). */
function NameField({ value, label, onCommit }: { value: string; label: string; onCommit: (v: string) => void }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const commit = () => {
    const v = text.trim();
    if (v && v !== value) onCommit(v);
    else setText(value);
  };
  return (
    <input
      className={styles.name}
      value={text}
      aria-label={label}
      placeholder="Name this image"
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { e.preventDefault(); (e.target as HTMLInputElement).blur(); }
        else if (e.key === 'Escape') { e.stopPropagation(); setText(value); }
      }}
    />
  );
}
