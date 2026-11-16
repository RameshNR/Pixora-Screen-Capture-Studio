import { StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { ToastProvider } from './components/Toast';
import { applyTheme } from './hooks/useTheme';
import '@/styles/global.css';

/** Mounts an extension page with shared providers. */
export function mountPage(node: ReactNode, opts: { toastPosition?: 'top' | 'bottom' } = {}): void {
  // Apply a provisional theme immediately to avoid a light flash before settings load.
  applyTheme('system');
  const container = document.getElementById('root');
  if (!container) throw new Error('#root missing');
  createRoot(container).render(
    <StrictMode>
      <ToastProvider position={opts.toastPosition}>{node}</ToastProvider>
    </StrictMode>,
  );
}
