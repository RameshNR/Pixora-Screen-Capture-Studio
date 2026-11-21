import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, Info, Loader2, X, XCircle } from 'lucide-react';
import type { AppErrorInfo } from '../types';
import styles from './Toast.module.css';
import { formatKeys } from '@/shared/utils/keys';

type ToastKind = 'success' | 'error' | 'info' | 'warning' | 'progress';

interface ToastItem {
  id: number;
  kind: ToastKind;
  title: string;
  message?: string;
  action?: { label: string; onClick: () => void };
}

interface ToastApi {
  show: (t: Omit<ToastItem, 'id'>, durationMs?: number) => number;
  success: (title: string, message?: string) => void;
  info: (title: string, message?: string) => void;
  error: (err: AppErrorInfo | string, message?: string) => void;
  /**
   * A "working…" toast with a spinner for something that may take a few seconds (exporting a big
   * image). It appears only if the work is still running after a moment (no flash for quick work)
   * and stays until the returned function is called.
   */
  progress: (title: string, message?: string) => () => void;
}

const ToastContext = createContext<ToastApi | null>(null);

const ICONS = {
  success: <CheckCircle2 size={18} />,
  error: <XCircle size={18} />,
  info: <Info size={18} />,
  warning: <AlertTriangle size={18} />,
  progress: <Loader2 size={18} className={styles.spin} />,
};

export function ToastProvider({ children, position = 'bottom' }: { children: ReactNode; position?: 'bottom' | 'top' }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);
  const dismiss = useCallback((id: number) => setItems((list) => list.filter((t) => t.id !== id)), []);

  const show = useCallback(
    (t: Omit<ToastItem, 'id'>, durationMs = 4200) => {
      const id = nextId.current++;
      setItems((list) => [...list.slice(-3), { ...t, id }]);
      if (durationMs > 0) setTimeout(() => dismiss(id), durationMs);
      return id;
    },
    [dismiss],
  );

  const api = useMemo<ToastApi>(
    () => ({
      show,
      success: (title, message) => show({ kind: 'success', title, message }),
      info: (title, message) => show({ kind: 'info', title, message }),
      error: (err, message) =>
        typeof err === 'string'
          ? show({ kind: 'error', title: err, message }, 7000)
          : show({ kind: 'error', title: err.title, message: [err.message, err.recovery].filter(Boolean).join(' ') }, 8000),
      progress: (title, message) => {
        let id: number | null = null;
        const timer = setTimeout(() => { id = show({ kind: 'progress', title, message }, 0); }, 250);
        return () => {
          clearTimeout(timer);
          if (id !== null) dismiss(id);
        };
      },
    }),
    [show],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className={`${styles.region} ${styles[position]}`} role="region" aria-live="polite" aria-label="Notifications">
        {items.map((t) => (
          <div key={t.id} className={`${styles.toast} ${styles[t.kind]}`} role={t.kind === 'error' ? 'alert' : 'status'}>
            <span className={styles.icon}>{ICONS[t.kind]}</span>
            <div className={styles.content}>
              <div className={styles.title}>{typeof t.title === 'string' ? formatKeys(t.title) : t.title}</div>
              {t.message && <div className={styles.message}>{typeof t.message === 'string' ? formatKeys(t.message) : t.message}</div>}
              {t.action && (
                <button type="button" className={styles.action} onClick={() => { t.action?.onClick(); dismiss(t.id); }}>
                  {t.action.label}
                </button>
              )}
            </div>
            {t.kind !== 'progress' && (
              <button type="button" className={styles.close} aria-label="Dismiss" onClick={() => dismiss(t.id)}>
                <X size={14} />
              </button>
            )}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
}
