import type { ReactNode } from 'react';
import styles from './pages.module.css';

export function TopBar({ children, subtitle }: { children?: ReactNode; subtitle?: string }) {
  return (
    <header className={styles.topbar}>
      <div className={styles.brand}>
        <img src="/icons/icon-48.png" alt="" />
        {subtitle ? (
          <span className={styles.brandText}>
            Pixora
            <small>{subtitle}</small>
          </span>
        ) : (
          'Pixora'
        )}
      </div>
      {children}
    </header>
  );
}
