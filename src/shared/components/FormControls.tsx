import { useEffect, useId, useRef, useState, type InputHTMLAttributes, type ReactNode } from 'react';
import { Check } from 'lucide-react';
import { formatColor, parseColor, sameHue } from '../utils/color';
import styles from './FormControls.module.css';

/* --------------------------------- Toggle -------------------------------- */
interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  disabled?: boolean;
  size?: 'sm' | 'md';
  id?: string;
}

export function ToggleSwitch({ checked, onChange, label, disabled, size = 'md', id }: ToggleProps) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className={`${styles.toggle} ${styles[`toggle-${size}`]} ${checked ? styles.on : ''}`}
      onClick={() => onChange(!checked)}
    >
      <span className={styles.knob} />
    </button>
  );
}

/* -------------------------------- Checkbox ------------------------------- */
interface CheckboxProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
}

export function Checkbox({ checked, onChange, label, description, disabled }: CheckboxProps) {
  const id = useId();
  return (
    <label className={`${styles.checkRow} ${disabled ? styles.disabled : ''}`} htmlFor={id}>
      <span className={`${styles.checkbox} ${checked ? styles.checked : ''}`}>
        <input id={id} type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
        {checked && <Check size={12} strokeWidth={3} />}
      </span>
      <span>
        <span className={styles.checkLabel}>{label}</span>
        {description && <span className={styles.checkDesc}>{description}</span>}
      </span>
    </label>
  );
}

/* --------------------------------- Slider -------------------------------- */
interface SliderProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value'> {
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step?: number;
  format?: (v: number) => string;
  label?: string;
  tone?: 'light' | 'dark';
  /** The label is shown next to the control already (settings rows): only the value is shown here. */
  hideLabel?: boolean;
}

export function Slider({ value: stored, onChange, min, max, step = 1, format, label, tone = 'light', hideLabel = false, ...rest }: SliderProps) {
  // While dragging, the thumb follows the pointer and never jumps back to an older saved value
  // (settings are saved asynchronously, one after another): the dragged value is shown for the
  // whole drag, saves go out at most once per frame, and the last value is always saved.
  const [draft, setDraft] = useState<number | null>(null);
  const settle = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dragging = useRef(false);
  const pending = useRef<number | null>(null);
  const frame = useRef<number | null>(null);
  const latest = useRef(onChange);
  latest.current = onChange;
  const flush = () => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    if (pending.current === null) return;
    const v = pending.current;
    pending.current = null;
    latest.current(v);
  };
  const release = () => {
    if (!dragging.current) return;
    dragging.current = false;
    flush();
    if (settle.current) clearTimeout(settle.current);
    // The saved value takes over once it has caught up (or a moment after the drag ends).
    settle.current = setTimeout(() => setDraft(null), 800);
  };
  useEffect(() => {
    if (draft !== null && !dragging.current && pending.current === null && stored === draft) setDraft(null);
  }, [stored, draft]);
  useEffect(() => () => {
    if (settle.current) clearTimeout(settle.current);
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    // A value still waiting when the slider goes away is saved.
    if (pending.current !== null) latest.current(pending.current);
  }, []);
  const value = draft ?? stored;
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div className={`${styles.sliderWrap} ${tone === 'dark' ? styles.sliderDark : ''}`}>
      {label && (
        <div className={`${styles.sliderHead} ${hideLabel ? styles.sliderHeadValue : ''}`}>
          {!hideLabel && <span>{label}</span>}
          <span className={styles.sliderValue}>{format ? format(value) : value}</span>
        </div>
      )}
      <input
        type="range"
        className={styles.slider}
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={label}
        style={{ '--pct': `${pct}%` } as React.CSSProperties}
        {...rest}
        onPointerDown={(e) => {
          dragging.current = true;
          if (settle.current) clearTimeout(settle.current);
          window.addEventListener('pointerup', release, { once: true });
          window.addEventListener('pointercancel', release, { once: true });
          (rest.onPointerDown as ((ev: React.PointerEvent<HTMLInputElement>) => void) | undefined)?.(e);
        }}
        onChange={(e) => {
          const v = Number(e.target.value);
          setDraft(v);
          pending.current = v;
          if (dragging.current) {
            // One save per frame while dragging.
            if (frame.current === null) frame.current = requestAnimationFrame(() => { frame.current = null; flush(); });
          } else {
            // Keyboard / click: saved at once.
            flush();
            if (settle.current) clearTimeout(settle.current);
            settle.current = setTimeout(() => setDraft(null), 1500);
          }
        }}
      />
    </div>
  );
}

/* ------------------------------- RadioGroup ------------------------------ */
export interface RadioOption<T extends string | number> {
  value: T;
  label: ReactNode;
  disabled?: boolean;
  title?: string;
}

interface RadioGroupProps<T extends string | number> {
  value: T;
  options: RadioOption<T>[];
  onChange: (value: T) => void;
  label: string;
  tone?: 'light' | 'dark';
  size?: 'sm' | 'md';
}

/** Segmented control (radio group semantics). */
export function RadioGroup<T extends string | number>({ value, options, onChange, label, tone = 'light', size = 'md' }: RadioGroupProps<T>) {
  return (
    <div role="radiogroup" aria-label={label} className={`${styles.segmented} ${tone === 'dark' ? styles.segDark : ''} ${size === 'sm' ? styles.segSm : ''}`}>
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          disabled={o.disabled}
          title={o.title}
          className={`${styles.segment} ${o.value === value ? styles.segActive : ''}`}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* ------------------------------- Text input ------------------------------ */
interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  tone?: 'light' | 'dark';
  suffix?: ReactNode;
}

export function TextField({ tone = 'light', suffix, className, ...rest }: TextFieldProps) {
  return (
    <span className={`${styles.field} ${tone === 'dark' ? styles.fieldDark : ''} ${className ?? ''}`}>
      <input className={styles.input} {...rest} />
      {suffix && <span className={styles.suffix}>{suffix}</span>}
    </span>
  );
}

interface ColorSwatchesProps {
  value: string;
  onChange: (c: string) => void;
  colors: string[];
  label: string;
  /** Show an opacity slider (stored as #rrggbbaa). Default true. */
  alpha?: boolean;
}

/** Palette + custom colour + optional transparency. Picking a swatch keeps the current opacity. */
export function ColorSwatches({ value, onChange, colors, label, alpha = true }: ColorSwatchesProps) {
  const current = parseColor(value);
  const isTransparent = value === 'transparent';
  const opacity = isTransparent ? 1 : current.alpha;
  const pick = (c: string) => onChange(c === 'transparent' ? c : formatColor(c, opacity || 1));
  return (
    <div className={styles.colorField}>
      <div className={styles.swatches} role="radiogroup" aria-label={label}>
        {colors.map((c) => (
          <button
            key={c}
            type="button"
            role="radio"
            aria-checked={sameHue(c, value)}
            aria-label={c === 'transparent' ? 'None' : c}
            title={c === 'transparent' ? 'None' : c}
            className={`${styles.swatch} ${sameHue(c, value) ? styles.swatchActive : ''} ${c === 'transparent' ? styles.swatchNone : ''}`}
            style={{ background: c === 'transparent' ? undefined : c }}
            onClick={() => pick(c)}
          />
        ))}
        <label className={styles.swatchCustom} title="Custom colour">
          <input type="color" value={isTransparent ? '#000000' : current.hex} onChange={(e) => onChange(formatColor(e.target.value, opacity || 1))} aria-label={`${label}: custom colour`} />
        </label>
      </div>
      {alpha && !isTransparent && (
        <div className={styles.alphaRow}>
          <span className={styles.alphaLabel}>Opacity</span>
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(opacity * 100)}
            aria-label={`${label} opacity`}
            className={styles.alphaSlider}
            style={{ '--c': current.hex } as React.CSSProperties}
            onChange={(e) => onChange(formatColor(current.hex, Number(e.target.value) / 100))}
          />
          <span className={styles.alphaValue}>{Math.round(opacity * 100)}%</span>
        </div>
      )}
    </div>
  );
}
