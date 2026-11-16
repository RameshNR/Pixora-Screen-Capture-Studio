import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import styles from '../styles/popup.module.css';

interface Props {
  anchor: DOMRect;
  onClose: () => void;
  children: ReactNode;
  label: string;
}

/** Small floating panel anchored to a trigger (device settings in the popup). */
export function AnchoredPopover({ anchor, onClose, children, label }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: anchor.left, top: anchor.bottom + 6 });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    let left = Math.min(anchor.left, window.innerWidth - r.width - 8);
    left = Math.max(8, left);
    let top = anchor.bottom + 6;
    if (top + r.height > window.innerHeight - 8) top = Math.max(8, anchor.top - r.height - 6);
    setPos({ left, top });
  }, [anchor]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      // Menus opened from inside the popover are portalled to body; don't treat them as outside.
      if (ref.current?.contains(target) || (target instanceof Element && target.closest('[role="menu"]'))) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('mousedown', onDown, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  return createPortal(
    <div ref={ref} role="dialog" aria-label={label} className={styles.popover} style={pos}>
      {children}
    </div>,
    document.body,
  );
}
