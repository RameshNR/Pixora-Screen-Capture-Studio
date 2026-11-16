import styles from './Progress.module.css';

export function Spinner({ size = 16, label }: { size?: number; label?: string }) {
  return (
    <span className={styles.spinner} style={{ width: size, height: size }} role="status" aria-label={label ?? 'Loading'} />
  );
}

/** Determinate when `value` is 0–1, indeterminate when null. */
export function ProgressIndicator({ value, label, tone = 'primary' }: { value: number | null; label?: string; tone?: 'primary' | 'recording' }) {
  return (
    <div className={styles.wrap}>
      {label && (
        <div className={styles.labelRow}>
          <span>{label}</span>
          {value !== null && <span className={styles.pct}>{Math.round(value * 100)}%</span>}
        </div>
      )}
      <div
        className={styles.track}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={value === null ? undefined : Math.round(value * 100)}
        aria-label={label}
      >
        <div
          className={`${styles.bar} ${value === null ? styles.indeterminate : ''} ${tone === 'recording' ? styles.rec : ''}`}
          style={value === null ? undefined : { width: `${Math.max(0, Math.min(1, value)) * 100}%` }}
        />
      </div>
    </div>
  );
}
