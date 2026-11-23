import { useEffect, useState } from 'react';
import { Spinner } from './Progress';
import styles from './BusyPill.module.css';

/**
 * "Opening the image…": a small pill at the top of the page while something takes a moment. It
 * appears only after a short wait (quick actions don't flash it) and has a thin moving bar.
 */
export function BusyPill({ label, delay = 220 }: { label: string | null; delay?: number }) {
  const [shown, setShown] = useState<string | null>(null);
  useEffect(() => {
    if (!label) { setShown(null); return; }
    const t = setTimeout(() => setShown(label), delay);
    return () => clearTimeout(t);
  }, [label, delay]);
  if (!shown) return null;
  return (
    <div className={styles.pill} role="status" aria-live="polite" aria-label={shown}>
      <Spinner size={15} />
      <span>{shown}</span>
      <span className={styles.bar} aria-hidden />
    </div>
  );
}
