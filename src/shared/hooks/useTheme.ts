import { useEffect, useState } from 'react';
import { resolveThemeId, themeById, themeTokens, type ThemeId, type ThemeMode, type ThemePreference } from '../theme/themes';

/** Last applied theme, read synchronously when a page opens (no flash of the wrong theme). */
const CACHE_KEY = 'pixora.theme';

const systemDark = () => Boolean(window.matchMedia?.('(prefers-color-scheme: dark)').matches);

/** Light or dark, for a preference. */
export function resolveTheme(pref: ThemePreference | string): ThemeMode {
  return themeById(resolveThemeId(pref, systemDark())).mode;
}

/**
 * Applies a theme to this page: <html data-theme="light|dark" data-palette="<id>"> and every colour
 * token as an inline custom property (so it wins over the light / dark defaults in the stylesheets).
 */
export function applyTheme(pref: ThemePreference | string): ThemeId {
  const id = resolveThemeId(pref, systemDark());
  const spec = themeById(id);
  const root = document.documentElement;
  root.dataset.theme = spec.mode;
  root.dataset.palette = id;
  for (const [k, v] of Object.entries(themeTokens(spec))) root.style.setProperty(k, v);
  try {
    localStorage.setItem(CACHE_KEY, String(pref));
  } catch {
    /* storage blocked: the theme still applies once settings load */
  }
  return id;
}

/** The preference last applied on any Pixora page ("system" before the first one). */
export function cachedThemePreference(): string {
  try {
    return localStorage.getItem(CACHE_KEY) ?? 'system';
  } catch {
    return 'system';
  }
}

/** Keeps the page's theme in sync with Settings › General › Theme and the computer's setting. */
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

/** A colour token's current value on this page (e.g. for canvas drawing). */
export function themeColor(token: string, fallback: string): string {
  if (typeof document === 'undefined') return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(token).trim();
  return v || fallback;
}

/** Re-renders when the page's theme changes; returns the current theme id. */
export function useThemeVersion(): string {
  const [palette, setPalette] = useState(() => document.documentElement.dataset.palette ?? '');
  useEffect(() => {
    const root = document.documentElement;
    const obs = new MutationObserver(() => setPalette(root.dataset.palette ?? ''));
    obs.observe(root, { attributes: true, attributeFilter: ['data-palette', 'style'] });
    return () => obs.disconnect();
  }, []);
  return palette;
}

/** Ink for drawn previews (line and arrow styles): dark on light themes, light on dark ones. */
export function useThemeInk(): string {
  useThemeVersion();
  return themeColor('--c-editor-ink', '#E6E9EF');
}
