import { useEffect } from 'react';
import type { ThemePreference } from '../types';

export function resolveTheme(pref: ThemePreference): 'light' | 'dark' {
  if (pref === 'system') return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  return pref;
}

export function applyTheme(pref: ThemePreference): void {
  document.documentElement.dataset.theme = resolveTheme(pref);
}

/** Keeps <html data-theme> in sync with the preference and the OS setting. */
export function useTheme(pref: ThemePreference | undefined): void {
  useEffect(() => {
    if (!pref) return;
    applyTheme(pref);
    if (pref !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => applyTheme('system');
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [pref]);
}
