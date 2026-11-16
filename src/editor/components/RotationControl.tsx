import { useRef, useState } from 'react';
import { RotateCcw, RotateCw, Undo2 } from 'lucide-react';
import styles from './RotationControl.module.css';

interface Props {
  /** Current angle in degrees (-180…180). */
  value: number;
  onChange: (deg: number) => void;
}

/** Wraps any angle into -180…180. */
export function normalizeAngle(deg: number): number {
  const a = ((((deg + 180) % 360) + 360) % 360) - 180;
  return Object.is(a, -0) ? 0 : a;
}

/**
 * Rotation of the selected object: a dial to drag (Shift snaps to 15°), an exact angle field,
 * quick turns and a reset.
 */
export function RotationControl({ value, onChange }: Props) {
  const dial = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const angle = Math.round(value);

  const fromPointer = (e: React.PointerEvent) => {
    const r = dial.current!.getBoundingClientRect();
    // 0° points up, clockwise positive (like the canvas rotation handle).
    let deg = (Math.atan2(e.clientX - (r.left + r.width / 2), -(e.clientY - (r.top + r.height / 2))) * 180) / Math.PI;
    if (e.shiftKey) deg = Math.round(deg / 15) * 15;
    onChange(normalizeAngle(Math.round(deg)));
  };

  const commitDraft = () => {
    if (draft === null) return;
    const n = parseFloat(draft);
    if (Number.isFinite(n)) onChange(normalizeAngle(Math.round(n)));
    setDraft(null);
  };

  return (
    <div className={styles.wrap} role="group" aria-label="Rotation">
      <div className={styles.head}>
        <span>Rotation</span>
        <button type="button" className={styles.reset} disabled={angle === 0} onClick={() => onChange(0)} title="Reset rotation" aria-label="Reset rotation">
          <Undo2 size={13} /> Reset
        </button>
      </div>
      <div className={styles.body}>
        <div
          ref={dial}
          className={styles.dial}
          role="slider"
          tabIndex={0}
          aria-label="Rotation dial"
          aria-valuemin={-180}
          aria-valuemax={180}
          aria-valuenow={angle}
          aria-valuetext={`${angle} degrees`}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            fromPointer(e);
          }}
          onPointerMove={(e) => {
            if (e.currentTarget.hasPointerCapture(e.pointerId)) fromPointer(e);
          }}
          onKeyDown={(e) => {
            const step = e.shiftKey ? 15 : 1;
            if (e.key === 'ArrowRight' || e.key === 'ArrowUp') onChange(normalizeAngle(angle + step));
            else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') onChange(normalizeAngle(angle - step));
            else return;
            e.preventDefault();
          }}
        >
          {[0, 90, 180, 270].map((t) => (
            <span key={t} className={styles.tick} style={{ transform: `rotate(${t}deg)` }} />
          ))}
          <span className={styles.needle} style={{ transform: `rotate(${angle}deg)` }}>
            <span className={styles.knob} />
          </span>
          <span className={styles.hub} />
        </div>
        <div className={styles.side}>
          <label className={styles.field}>
            <input
              aria-label="Rotation angle"
              inputMode="numeric"
              value={draft ?? String(angle)}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commitDraft}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitDraft();
                if (e.key === 'Escape') setDraft(null);
              }}
            />
            <span>°</span>
          </label>
          <div className={styles.quick}>
            <button type="button" onClick={() => onChange(normalizeAngle(angle - 90))} title="Turn left 90°" aria-label="Turn left 90°">
              <RotateCcw size={13} /> 90°
            </button>
            <button type="button" onClick={() => onChange(normalizeAngle(angle + 90))} title="Turn right 90°" aria-label="Turn right 90°">
              <RotateCw size={13} /> 90°
            </button>
            <button type="button" onClick={() => onChange(normalizeAngle(angle - 15))} title="Turn left 15°" aria-label="Turn left 15°">−15°</button>
            <button type="button" onClick={() => onChange(normalizeAngle(angle + 15))} title="Turn right 15°" aria-label="Turn right 15°">+15°</button>
          </div>
        </div>
      </div>
    </div>
  );
}
