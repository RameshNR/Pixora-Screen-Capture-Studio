import { cloneElement, isValidElement, useId, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import styles from './Tooltip.module.css';

interface TooltipProps {
  content: ReactNode;
  side?: 'top' | 'bottom' | 'left' | 'right';
  children: ReactElement;
  delay?: number;
}

/** Lightweight tooltip rendered in a portal so it is never clipped by scroll containers. */
export function Tooltip({ content, side = 'bottom', children, delay = 350 }: TooltipProps) {
  const id = useId();
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  if (!isValidElement(children)) return children;

  const show = (target: HTMLElement) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const r = target.getBoundingClientRect();
      const x = side === 'left' ? r.left - 8 : side === 'right' ? r.right + 8 : r.left + r.width / 2;
      const y = side === 'top' ? r.top - 8 : side === 'bottom' ? r.bottom + 8 : r.top + r.height / 2;
      setPos({ x, y });
    }, delay);
  };
  const hide = () => {
    if (timer.current) clearTimeout(timer.current);
    setPos(null);
  };

  const props = children.props as Record<string, unknown>;
  const child = cloneElement(children as ReactElement<Record<string, unknown>>, {
    'aria-describedby': pos ? id : undefined,
    onMouseEnter: (e: React.MouseEvent<HTMLElement>) => {
      (props.onMouseEnter as ((e: React.MouseEvent) => void) | undefined)?.(e);
      show(e.currentTarget);
    },
    onMouseLeave: (e: React.MouseEvent) => {
      (props.onMouseLeave as ((e: React.MouseEvent) => void) | undefined)?.(e);
      hide();
    },
    onFocus: (e: React.FocusEvent<HTMLElement>) => {
      (props.onFocus as ((e: React.FocusEvent) => void) | undefined)?.(e);
      if (e.currentTarget.matches(':focus-visible')) show(e.currentTarget);
    },
    onBlur: (e: React.FocusEvent) => {
      (props.onBlur as ((e: React.FocusEvent) => void) | undefined)?.(e);
      hide();
    },
    onMouseDown: (e: React.MouseEvent) => {
      (props.onMouseDown as ((e: React.MouseEvent) => void) | undefined)?.(e);
      hide();
    },
  });

  return (
    <>
      {child}
      {pos && content
        ? createPortal(
            <div role="tooltip" id={id} className={`${styles.tooltip} ${styles[side]}`} style={{ left: pos.x, top: pos.y }}>
              {content}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
