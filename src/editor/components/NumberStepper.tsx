import { useEffect, useRef } from 'react';
import { Minus, Plus } from 'lucide-react';
import styles from './editor.module.css';

/**
 * A number field with − and + buttons on its sides (the browser's tiny spin arrows are hidden).
 * Click steps by one, Shift+click by ten, and holding a button keeps counting. Arrow keys work
 * in the field too (the buttons are mouse helpers, so screen readers see one spin button).
 */
export function NumberStepper({
  value, onChange, min = -Infinity, max = Infinity, step = 1, ariaLabel,
}: {
  value: number;
  onChange: (n: number) => void;
  min?: number;
  max?: number;
  step?: number;
  ariaLabel: string;
}) {
  const latest = useRef({ value, onChange });
  latest.current = { value, onChange };
  const timer = useRef<{ wait?: number; repeat?: number }>({});
  const stop = () => {
    window.clearTimeout(timer.current.wait);
    window.clearInterval(timer.current.repeat);
    timer.current = {};
  };
  useEffect(() => stop, []);

  const bump = (dir: 1 | -1, big: boolean) => {
    const { value: v, onChange: set } = latest.current;
    const next = Math.min(max, Math.max(min, Math.round(v) + dir * step * (big ? 10 : 1)));
    if (next !== v) set(next);
  };
  const press = (dir: 1 | -1) => (e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const big = e.shiftKey;
    bump(dir, big);
    stop();
    // Let go anywhere (or at a limit, where the button turns disabled) ends the repeat.
    window.addEventListener('pointerup', stop, { once: true });
    timer.current.wait = window.setTimeout(() => {
      timer.current.repeat = window.setInterval(() => bump(dir, big), 60);
    }, 400);
  };

  return (
    <div className={styles.stepper}>
      <button
        type="button" className={styles.stepBtn} tabIndex={-1} aria-hidden title="Decrease (Shift+click: by 10)"
        disabled={value <= min} onPointerDown={press(-1)} onPointerUp={stop} onPointerLeave={stop} onPointerCancel={stop}
      >
        <Minus size={14} />
      </button>
      <input
        className={styles.stepInput} type="number" inputMode="numeric" min={Number.isFinite(min) ? min : undefined}
        max={Number.isFinite(max) ? max : undefined} step={step} value={value} aria-label={ariaLabel}
        onChange={(e) => onChange(Math.round(Number(e.target.value)))}
        onFocus={(e) => e.currentTarget.select()}
      />
      <button
        type="button" className={styles.stepBtn} tabIndex={-1} aria-hidden title="Increase (Shift+click: by 10)"
        disabled={value >= max} onPointerDown={press(1)} onPointerUp={stop} onPointerLeave={stop} onPointerCancel={stop}
      >
        <Plus size={14} />
      </button>
    </div>
  );
}
