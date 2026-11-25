import { Component, type ErrorInfo, type ReactNode } from 'react';

interface State {
  error: Error | null;
}

/** Where the last crash of a Pixora page is kept (for bug reports). */
export const LAST_CRASH_KEY = 'pixora.lastCrash';

/**
 * Catches an error while a page is drawn. Without it React removes the whole page and leaves an
 * empty white window; this shows what went wrong and a Reload button instead (the editor keeps its
 * drawings, so reloading loses nothing).
 */
export class CrashScreen extends Component<{ children: ReactNode }, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: unknown): State {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    const e = error instanceof Error ? error : new Error(String(error));
    console.error('[Pixora] page crashed', e, info.componentStack);
    try {
      void chrome.storage?.local
        .set({ [LAST_CRASH_KEY]: { at: Date.now(), page: location.pathname, message: e.message, stack: e.stack ?? '', component: info.componentStack ?? '' } })
        .catch(() => undefined);
    } catch {
      /* not in the extension */
    }
  }

  override render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    // A page loaded before the extension was updated can't load its newer parts.
    const stale = /Failed to fetch dynamically imported module|Importing a module script failed|Extension context invalidated/i.test(error.message);
    return (
      <div role="alert" style={{ position: 'fixed', inset: 0, display: 'grid', placeItems: 'center', padding: 16, background: 'var(--bg, #f6f5fb)', color: 'var(--text, #1d1b26)', font: '14px/1.5 system-ui, sans-serif' }}>
        <div style={{ maxWidth: 460, display: 'grid', gap: 12, textAlign: 'center' }}>
          <strong style={{ fontSize: 17 }}>{stale ? 'Pixora was updated' : 'Something went wrong on this page'}</strong>
          <span style={{ opacity: 0.75 }}>
            {stale ? 'Reload the page to use the new version.' : 'Reload the page to carry on. Your drawings are kept.'}
          </span>
          {!stale && (
            <code style={{ fontSize: 12, opacity: 0.6, wordBreak: 'break-word' }}>{error.message}</code>
          )}
          <div>
            <button
              type="button"
              onClick={() => location.reload()}
              style={{ padding: '8px 18px', borderRadius: 8, border: 0, background: '#7c4dff', color: '#fff', font: 'inherit', fontWeight: 600, cursor: 'pointer' }}
            >
              Reload page
            </button>
          </div>
        </div>
      </div>
    );
  }
}
