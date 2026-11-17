import type { ReactNode } from 'react';
import styles from './Settings.module.css';

/** A settings page: icon, title and actions, then its groups side by side (one column on narrow windows). */
export function SettingsPage({ title, description, icon, actions, children }: { title: string; description?: ReactNode; icon?: ReactNode; actions?: ReactNode; children: ReactNode }) {
  return (
    <div className={styles.page}>
      <header className={styles.pageHead}>
        {icon && <span className={styles.pageIcon} aria-hidden="true">{icon}</span>}
        <div className={styles.pageText}>
          <h1 className={styles.pageTitle}>{title}</h1>
          {description && <p className={styles.pageDescription}>{description}</p>}
        </div>
        {actions && <div className={styles.pageActions}>{actions}</div>}
      </header>
      <div className={styles.groups}>{children}</div>
    </div>
  );
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** One group of settings with a heading (e.g. Screenshot › Full page). */
export function SettingsSection({ title, description, icon, children, id }: { title: string; description?: ReactNode; icon?: ReactNode; children: ReactNode; id?: string }) {
  const key = id ?? `set-${slug(title)}`;
  return (
    <section className={styles.section} id={key} aria-labelledby={`${key}-title`}>
      <header className={styles.head}>
        {icon && <span className={styles.groupIcon} aria-hidden="true">{icon}</span>}
        <div>
          <h2 className={styles.title} id={`${key}-title`}>
            {title}
          </h2>
          {description && <p className={styles.description}>{description}</p>}
        </div>
      </header>
      <div className={styles.rows}>{children}</div>
    </section>
  );
}

export function SettingRow({ label, hint, icon, children, stacked, htmlFor }: { label: ReactNode; hint?: ReactNode; icon?: ReactNode; children: ReactNode; stacked?: boolean; htmlFor?: string }) {
  return (
    <div className={`${styles.row} ${stacked ? styles.stacked : ''} ${icon ? styles.withIcon : ''}`}>
      {icon && <span className={styles.rowIcon} aria-hidden="true">{icon}</span>}
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
