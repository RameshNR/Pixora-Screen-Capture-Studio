import { useEffect, useRef, useState } from 'react';
import { History, Redo2, RefreshCcwDot, Undo2, X } from 'lucide-react';
import { IconButton } from '@/shared/components/Button';
import { videoTimeline, type VideoHistory } from '../services/video-history';
import styles from './VideoHistory.module.css';

/** The header's Undo, Redo and History buttons; History opens a window listing every step. */
export function VideoHistoryControls({ history, canUndo, canRedo, canReset, onUndo, onRedo, onReset, onJump }: {
  history: VideoHistory | null;
  canUndo: boolean;
  canRedo: boolean;
  canReset: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onReset: () => void;
  onJump: (index: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const current = useRef<HTMLLIElement>(null);
  const steps = history ? videoTimeline(history) : [];
  const at = history?.past.length ?? 0;

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('pointerdown', onPointer, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onPointer, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  useEffect(() => {
    if (open) current.current?.scrollIntoView({ block: 'nearest' });
  }, [open, at]);

  return (
    <div ref={root} className={styles.root} role="group" aria-label="Undo and history">
      <IconButton label="Undo" shortcut="Ctrl+Z" icon={<Undo2 size={17} />} disabled={!canUndo} onClick={onUndo} />
      <IconButton label="Redo" shortcut="Ctrl+Y" icon={<Redo2 size={17} />} disabled={!canRedo} onClick={onRedo} />
      <IconButton label="Reset to original" icon={<RefreshCcwDot size={17} />} disabled={!canReset} onClick={onReset} />
      <IconButton label="History" icon={<History size={17} />} active={open} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen((v) => !v)} />
      {open && (
        <section className={styles.panel} role="dialog" aria-label="Edit history">
          <header className={styles.head}>
            <h2>History</h2>
            <IconButton size="sm" label="Close history" icon={<X size={15} />} onClick={() => setOpen(false)} />
          </header>
          <p className={styles.hint}>Click a step to go back to it. You can move forward again until you make a new change.</p>
          <ol className={styles.list}>
            {steps.map((s, i) => (
              <li key={`${i}-${s.at}`} ref={i === at ? current : undefined}>
                <button type="button" className={`${styles.step} ${i === at ? styles.stepOn : ''} ${i > at ? styles.stepLater : ''}`} aria-current={i === at ? 'step' : undefined} onClick={() => onJump(i)}>
                  <span className={styles.no}>{i}</span>
                  <span className={styles.label} title={s.label}>{s.label}</span>
                  <time className={styles.time}>{new Date(s.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</time>
                </button>
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}
