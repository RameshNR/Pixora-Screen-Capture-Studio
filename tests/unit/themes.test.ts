import { describe, expect, it } from 'vitest';
import { contrast, DEFAULT_THEME, resolveThemeId, THEMES, themeSwatches, themeTokens } from '@/shared/theme/themes';
import { normalizeSettings, resolveStoredTheme } from '@/settings/settings-service';
import { DEFAULT_SETTINGS } from '@/shared/constants/defaults';

describe('themes', () => {
  it('has the 7 dark themes and 8 light themes from the palette sheets', () => {
    expect(THEMES.filter((t) => t.mode === 'dark').map((t) => t.name)).toEqual(['Midnight Purple', 'Ocean Blue', 'Graphite Dark', 'Sunset Gradient', 'Emerald Green', 'Royal Indigo', 'Warm Dark']);
    expect(THEMES.filter((t) => t.mode === 'light').map((t) => t.name)).toEqual(['Classic Blue', 'Emerald Fresh', 'Purple Lavender', 'Teal Ocean', 'Sunrise Amber', 'Rose Coral', 'Sky Cyan', 'Slate Minimal']);
    expect(new Set(THEMES.map((t) => t.id)).size).toBe(THEMES.length);
    expect(DEFAULT_THEME).toBe('midnight-purple');
    expect(themeSwatches(THEMES.find((t) => t.id === 'classic-blue')!).map((s) => `${s.label} ${s.color}`)).toEqual(['Primary #2563EB', 'Accent #3B82F6', 'Surface #DBEAFE', 'Canvas #F1F5F9', 'Background #FFFFFF']);
  });

  for (const t of THEMES) {
    it(`${t.name}: every colour is readable`, () => {
      const k = themeTokens(t);
      // Text on panels, page and editor chrome.
      expect(contrast(k['--c-text']!, k['--c-bg']!)).toBeGreaterThanOrEqual(7);
      expect(contrast(k['--c-text']!, k['--c-bg-subtle']!)).toBeGreaterThanOrEqual(7);
      expect(contrast(k['--c-text-secondary']!, k['--c-bg']!)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(k['--c-text-tertiary']!, k['--c-bg']!)).toBeGreaterThanOrEqual(3);
      expect(contrast(k['--c-editor-text']!, k['--c-editor-chrome']!)).toBeGreaterThanOrEqual(7);
      expect(contrast(k['--c-editor-text-dim']!, k['--c-editor-chrome']!)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(k['--c-editor-ink']!, k['--c-editor-tile']!)).toBeGreaterThanOrEqual(4.5);
      // Accent: visible on panels; button labels readable on it.
      expect(contrast(k['--c-primary']!, k['--c-bg']!)).toBeGreaterThanOrEqual(3);
      expect(contrast(k['--c-on-primary']!, k['--c-primary']!)).toBeGreaterThanOrEqual(3);
      // Visible structure: page vs panel, borders, editor canvas vs chrome (the "all the same colour" problem).
      expect(contrast(k['--c-bg-subtle']!, k['--c-bg']!)).toBeGreaterThanOrEqual(1.06);
      expect(contrast(k['--c-border-strong']!, k['--c-bg']!)).toBeGreaterThanOrEqual(1.3);
      expect(contrast(k['--c-editor-canvas']!, k['--c-editor-chrome']!)).toBeGreaterThanOrEqual(1.12);
      expect(k['--c-editor-scheme']).toBe(t.mode);
    });
  }

  it('System follows the computer; old Light / Dark map to Classic Blue / Graphite Dark', () => {
    expect(resolveThemeId('system', true)).toBe('graphite-dark');
    expect(resolveThemeId('system', false)).toBe('classic-blue');
    expect(resolveThemeId('light', true)).toBe('classic-blue');
    expect(resolveThemeId('nonsense', false)).toBe(DEFAULT_THEME);
    expect(resolveStoredTheme('dark')).toBe('graphite-dark');
    expect(normalizeSettings({ version: 8, general: { theme: 'light' } }).general.theme).toBe('classic-blue');
    expect(normalizeSettings({ version: 8, general: { theme: 'system' } }).general.theme).toBe('system');
    expect(normalizeSettings({ version: 9, general: { theme: 'rose-coral' } }).general.theme).toBe('rose-coral');
    expect(normalizeSettings({ version: 9, general: { theme: 'bogus' } }).general.theme).toBe('midnight-purple');
    expect(DEFAULT_SETTINGS.general.theme).toBe('midnight-purple');
  });
});
