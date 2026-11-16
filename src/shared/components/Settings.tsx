import type { ReactNode } from 'react';
import styles from './Settings.module.css';

export function SettingsSection({ title, description, children, id }: { title: string; description?: ReactNode; children: ReactNode; id?: string }) {
  return (
    <section className={styles.section} id={id} aria-labelledby={id ? `${id}-title` : undefined}>
      <header className={styles.head}>
        <h2 className={styles.title} id={id ? `${id}-title` : undefined}>
          {title}
        </h2>
        {description && <p className={styles.description}>{description}</p>}
      </header>
      <div className={styles.rows}>{children}</div>
    </section>
  );
}

export function SettingRow({ label, hint, children, stacked, htmlFor }: { label: ReactNode; hint?: ReactNode; children: ReactNode; stacked?: boolean; htmlFor?: string }) {
  return (
    <div className={`${styles.row} ${stacked ? styles.stacked : ''}`}>
      <div className={styles.labels}>
        <label className={styles.label} htmlFor={htmlFor}>
          {label}
        </label>
        {hint && <div className={styles.hint}>{hint}</div>}
      </div>
      <div className={styles.control}>{children}</div>
    </div>
  );
}

export function InlineNotice({ tone = 'info', children }: { tone?: 'info' | 'warning' | 'error' | 'success'; children: ReactNode }) {
  return <div className={`${styles.notice} ${styles[tone]}`}>{children}</div>;
}
