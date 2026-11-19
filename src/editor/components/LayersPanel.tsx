import { ArrowDown, ArrowUp, Eye, EyeOff, Frame as FrameIcon, Lock, LockOpen, Move, Stamp, Trash2 } from 'lucide-react';
import type { Annotation, EditorDoc } from '../types';
import { IconButton } from '@/shared/components/Button';
import { describeAnnotation } from '../tools/annotations';
import { timeline, type HistoryState } from '../history/history';
import styles from './editor.module.css';

interface LayersProps {
  doc: EditorDoc;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onToggleHidden: (a: Annotation) => void;
  /** Locks an unlocked annotation, unlocks a locked (or move only) one. */
  onToggleLock: (a: Annotation) => void;
  onMove: (a: Annotation, dir: 1 | -1) => void;
  onDelete: (a: Annotation) => void;
  onOpenWatermark: () => void;
  onRemoveWatermark: () => void;
  onOpenFrame: () => void;
  onRemoveFrame: () => void;
}

/**
 * Every change that is still part of the image, newest on top. Any of them can be selected to
 * re-edit, hidden, re-ordered or removed — without undoing the changes made after it.
 */
export function LayersPanel(p: LayersProps) {
  const items = [...p.doc.annotations].reverse();
  const empty = items.length === 0 && !p.doc.watermark && !p.doc.frame;
  return (
    <div className={styles.listPanel}>
      <div className={styles.hint}>Select any earlier change to edit it, hide it, change its order or remove it — later changes stay.</div>
      {empty && <div className={styles.empty}>No annotations yet.</div>}
      <ul className={styles.list}>
        {p.doc.watermark && (
          <li className={styles.listItem}>
            <button type="button" className={styles.listMain} onClick={p.onOpenWatermark}>
              <Stamp size={15} /> Watermark “{p.doc.watermark.text.slice(0, 18)}”
            </button>
            <IconButton tone="dark" size="sm" label="Remove watermark" icon={<Trash2 size={14} />} onClick={p.onRemoveWatermark} tooltipSide="left" />
          </li>
        )}
        {items.map((a, i) => {
          const index = p.doc.annotations.length - 1 - i;
          return (
            <li key={a.id} className={`${styles.listItem} ${a.id === p.selectedId ? styles.listActive : ''} ${a.hidden ? styles.listHidden : ''}`}>
              <button type="button" className={styles.listMain} onClick={() => p.onSelect(a.id)} title="Select to edit">
                <span className={styles.layerSwatch} style={{ background: swatchColor(a) }} />
                {describeAnnotation(a)}
              </button>
              <IconButton tone="dark" size="sm" label={a.lock === 'all' ? 'Unlock' : a.lock === 'move' ? 'Unlock (move only now)' : 'Lock'} active={Boolean(a.lock)}
                icon={a.lock === 'all' ? <Lock size={14} /> : a.lock === 'move' ? <Move size={14} /> : <LockOpen size={14} />} onClick={() => p.onToggleLock(a)} tooltipSide="left" />
              <IconButton tone="dark" size="sm" label={a.hidden ? 'Show' : 'Hide'} icon={a.hidden ? <EyeOff size={14} /> : <Eye size={14} />} onClick={() => p.onToggleHidden(a)} tooltipSide="left" />
              <IconButton tone="dark" size="sm" label="Bring forward" icon={<ArrowUp size={14} />} disabled={index === p.doc.annotations.length - 1} onClick={() => p.onMove(a, 1)} tooltipSide="left" />
              <IconButton tone="dark" size="sm" label="Send backward" icon={<ArrowDown size={14} />} disabled={index === 0} onClick={() => p.onMove(a, -1)} tooltipSide="left" />
              <IconButton tone="dark" size="sm" label="Remove" icon={<Trash2 size={14} />} disabled={Boolean(a.lock)} onClick={() => p.onDelete(a)} tooltipSide="left" />
            </li>
          );
        })}
        {p.doc.frame && (
          <li className={styles.listItem}>
            <button type="button" className={styles.listMain} onClick={p.onOpenFrame}>
              <FrameIcon size={15} /> {p.doc.frame.browser ? 'Browser frame' : 'Border & frame'}
            </button>
            <IconButton tone="dark" size="sm" label="Remove frame" icon={<Trash2 size={14} />} onClick={p.onRemoveFrame} tooltipSide="left" />
          </li>
        )}
      </ul>
    </div>
  );
}

function swatchColor(a: Annotation): string {
  switch (a.type) {
    case 'rect':
    case 'ellipse':
      return a.stroke;
    case 'callout':
      return a.stroke;
    case 'blur':
    case 'pixelate':
      return '#9aa3b2';
    case 'mask':
      return a.color ?? '#000000';
    case 'image':
      return '#4F8DF7';
    case 'sticker':
      return a.variant === 'badge' ? a.color : '#FFD84D';
    default:
      return a.color;
  }
}

/** Every step, oldest first. Click any step to return to it (and forward again with Redo). */
export function HistoryPanel({ history, onJump }: { history: HistoryState; onJump: (index: number) => void }) {
  const steps = timeline(history);
  const current = history.past.length;
  return (
    <div className={styles.listPanel}>
      <div className={styles.hint}>Click a step to go back to it. You can move forward again until you make a new change.</div>
      <ol className={styles.list}>
        {steps.map((s, i) => (
          <li key={`${i}-${s.at}`} className={`${styles.listItem} ${i === current ? styles.listActive : ''} ${i > current ? styles.listHidden : ''}`}>
            <button type="button" className={styles.listMain} onClick={() => onJump(i)} aria-current={i === current ? 'step' : undefined}>
              <span className={styles.stepNo}>{i}</span>
              {s.label}
              <span className={styles.stepTime}>{new Date(s.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}
