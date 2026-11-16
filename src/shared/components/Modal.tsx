import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { Button } from './Button';
import styles from './Modal.module.css';

interface ModalProps {
  open: boolean;
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: number | string;
  tone?: 'light' | 'dark';
  /** The dialog can be moved by dragging its title bar (the page behind stays visible). */
  draggable?: boolean;
}

/** Accessible modal dialog: focus moves inside, Escape closes, focus is restored on close. */
export function Modal({ open, title, onClose, children, footer, width = 440, tone = 'light', draggable = false }: ModalProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  useEffect(() => {
    if (open) setOffset({ x: 0, y: 0 });
  }, [open]);
  const startDrag = (e: ReactPointerEvent<HTMLElement>) => {
    if (!draggable || e.button !== 0 || (e.target as HTMLElement).closest('button')) return;
    e.preventDefault();
    const start = { x: e.clientX - offset.x, y: e.clientY - offset.y };
    const rect = ref.current?.getBoundingClientRect();
    const move = (ev: PointerEvent) => {
      let x = ev.clientX - start.x;
      let y = ev.clientY - start.y;
      if (rect) {
        // Keep the title bar on screen.
        const left0 = rect.left - offset.x;
        const top0 = rect.top - offset.y;
        x = Math.max(-left0 - rect.width + 80, Math.min(window.innerWidth - left0 - 80, x));
        y = Math.max(-top0, Math.min(window.innerHeight - top0 - 48, y));
      }
      setOffset({ x, y });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const focusable = ref.current?.querySelector<HTMLElement>('input, textarea, select, button:not([data-close])');
    (focusable ?? ref.current)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      previous?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;
  return createPortal(
    <div className={`${styles.backdrop} ${draggable ? styles.backdropLight : ''}`} onMouseDown={(e) => !draggable && e.target === e.currentTarget && onClose()}>
      <div ref={ref} role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : undefined} tabIndex={-1} className={`${styles.dialog} ${tone === 'dark' ? styles.dark : ''}`}
        style={{ width, ...(draggable ? { transform: `translate(${offset.x}px, ${offset.y}px)` } : {}) }}>
        <header className={`${styles.header} ${draggable ? styles.dragHandle : ''}`} onPointerDown={startDrag} title={draggable ? 'Drag to move' : undefined}>
          <h2 className={styles.title}>{title}</h2>
          <button type="button" data-close className={styles.close} aria-label="Close" onClick={onClose}>
            <X size={16} />
          </button>
        </header>
        <div className={styles.body}>{children}</div>
        {footer && <footer className={styles.footer}>{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}

interface ConfirmProps {
  open: boolean;
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  tone?: 'light' | 'dark';
  /** Extra content under the message (for example a "Don't ask me again" checkbox). */
  extra?: ReactNode;
}

export function ConfirmationDialog({ open, title, message, confirmLabel = 'Confirm', cancelLabel = 'Cancel', danger, onConfirm, onCancel, tone, extra }: ConfirmProps) {
  return (
    <Modal
      open={open}
      title={title}
      onClose={onCancel}
      width={400}
      tone={tone}
      footer={
        <>
          <Button variant="ghost" onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className={styles.message}>{message}</div>
      {extra && <div style={{ marginTop: 14 }}>{extra}</div>}
    </Modal>
  );
}
