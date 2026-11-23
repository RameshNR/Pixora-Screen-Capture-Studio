import type { ReactNode } from 'react';
import styles from './ChoiceCards.module.css';

export interface ChoiceCard<T extends string | number> {
  value: T;
  label: string;
  hint?: string;
  icon?: ReactNode;
  disabled?: boolean;
}

/** A choice shown as cards (name, a short hint, an icon) — export windows. Works light and dark. */
export function ChoiceCards<T extends string | number>({ label, value, onChange, options, min = 104 }: { label: string; value: T; onChange: (v: T) => void; options: Array<ChoiceCard<T>>; min?: number }) {
  return (
    <div role="radiogroup" aria-label={label} className={styles.cards} style={{ gridTemplateColumns: `repeat(auto-fit, minmax(${min}px, 1fr))` }}>
      {options.map((o) => (
        <button key={String(o.value)} type="button" role="radio" aria-checked={value === o.value} aria-label={o.label} disabled={o.disabled}
          className={`${styles.card} ${value === o.value ? styles.on : ''}`} onClick={() => onChange(o.value)}>
          {o.icon && <span className={styles.icon} aria-hidden>{o.icon}</span>}
          <span className={styles.name}>{o.label}</span>
          {o.hint && <span className={styles.hint}>{o.hint}</span>}
        </button>
      ))}
    </div>
  );
}

/** A titled block of an export window. */
export function ChoiceSection({ title, icon, children }: { title: string; icon?: ReactNode; children: ReactNode }) {
  return (
    <section className={styles.section} aria-label={title}>
      <div className={styles.title}>{icon}{title}</div>
      {children}
    </section>
  );
}
