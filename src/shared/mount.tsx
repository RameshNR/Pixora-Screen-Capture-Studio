import { StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { ToastProvider } from './components/Toast';
import { applyTheme, cachedThemePreference, useTheme } from './hooks/useTheme';
import { useSettings } from './hooks/useSettings';
import '@/styles/global.css';

/** Every Pixora window follows Settings › General › Theme, live (also when changed elsewhere). */
function ThemeSync() {
  const { settings } = useSettings();
  useTheme(settings?.general.theme);
  return null;
}

/** Mounts an extension page with shared providers. */
export function mountPage(node: ReactNode, opts: { toastPosition?: 'top' | 'bottom' } = {}): void {
  // The theme last used on any Pixora page, applied before the first paint (no flash); the
  // current setting follows as soon as it is read.
  applyTheme(cachedThemePreference());
  const container = document.getElementById('root');
  if (!container) throw new Error('#root missing');
  createRoot(container).render(
    <StrictMode>
      <ThemeSync />
      <ToastProvider position={opts.toastPosition}>{node}</ToastProvider>
    </StrictMode>,
  );
}
