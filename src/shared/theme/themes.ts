/**
 * Pixora themes (Settings › General › Theme): 7 dark and 8 light.
 *
 * Dark themes are five colours (Primary = base, Accent, Secondary, Surface, Text); light themes are
 * Primary (= accent), Accent (= secondary), Surface (= tint), Canvas (= surface) and Background
 * (= base), plus a text colour — as shown in the picker.
 * `themeTokens` turns them into every CSS colour token the extension pages use (--c-*), including
 * the editor tokens (--c-editor-*), with guaranteed contrast: text on panels, buttons and their
 * labels, borders and the editor canvas against its chrome.
 */

export type ThemeMode = 'light' | 'dark';

export type ThemeId =
  | 'midnight-purple'
  | 'ocean-blue'
  | 'graphite-dark'
  | 'sunset-gradient'
  | 'emerald-green'
  | 'royal-indigo'
  | 'warm-dark'
  | 'classic-blue'
  | 'emerald-fresh'
  | 'purple-lavender'
  | 'teal-ocean'
  | 'sunrise-amber'
  | 'rose-coral'
  | 'sky-cyan'
  | 'slate-minimal';

export interface ThemeSpec {
  id: ThemeId;
  name: string;
  description: string;
  mode: ThemeMode;
  /** Main background (page / window chrome). */
  base: string;
  /** Buttons, selection, links. */
  accent: string;
  /** Second accent (gradients, highlights). */
  secondary: string;
  /** Dark themes: deep panels. Light themes: the canvas (page background). */
  surface: string;
  text: string;
  /** Light themes: the soft tint used for selected items and highlights ("Surface" in the picker). */
  tint?: string;
  /** Badge shown on the card. */
  badge?: 'Default' | 'Recommended';
}

export const DEFAULT_THEME: ThemeId = 'midnight-purple';

export const THEMES: readonly ThemeSpec[] = [
  { id: 'midnight-purple', name: 'Midnight Purple', description: 'Premium, modern and creative', mode: 'dark', base: '#24104F', accent: '#9333EA', secondary: '#06B6D4', surface: '#101B3C', text: '#F8FAFC', badge: 'Default' },
  { id: 'ocean-blue', name: 'Ocean Blue', description: 'Calm, focused and easy on the eyes', mode: 'dark', base: '#0B2545', accent: '#0EA5E9', secondary: '#14B8A6', surface: '#102A43', text: '#E2E8F0' },
  { id: 'graphite-dark', name: 'Graphite Dark', description: 'Modern, high-contrast and distraction-free', mode: 'dark', base: '#0F1115', accent: '#3B82F6', secondary: '#6366F1', surface: '#1F2937', text: '#F9FAFB' },
  { id: 'sunset-gradient', name: 'Sunset Gradient', description: 'Vibrant, creative and energetic', mode: 'dark', base: '#3B0764', accent: '#EC4899', secondary: '#F97316', surface: '#1F1037', text: '#FFF7ED' },
  { id: 'emerald-green', name: 'Emerald Green', description: 'Fresh, modern and productivity-focused', mode: 'dark', base: '#064E3B', accent: '#10B981', secondary: '#34D399', surface: '#0F2F26', text: '#ECFDF5' },
  { id: 'royal-indigo', name: 'Royal Indigo', description: 'Elegant, balanced and professional', mode: 'dark', base: '#312E81', accent: '#6366F1', secondary: '#8B5CF6', surface: '#1E1B4B', text: '#F5F3FF' },
  { id: 'warm-dark', name: 'Warm Dark', description: 'Comfortable and modern, with warm tones', mode: 'dark', base: '#3F1D0C', accent: '#F59E0B', secondary: '#F97316', surface: '#1F1309', text: '#FEF3C7' },
  { id: 'classic-blue', name: 'Classic Blue', description: 'Clean, professional and highly readable', mode: 'light', accent: '#2563EB', secondary: '#3B82F6', tint: '#DBEAFE', surface: '#F1F5F9', base: '#FFFFFF', text: '#0F172A', badge: 'Recommended' },
  { id: 'emerald-fresh', name: 'Emerald Fresh', description: 'Modern, calm and productivity-focused', mode: 'light', accent: '#10B981', secondary: '#34D399', tint: '#D1FAE5', surface: '#ECFDF5', base: '#FFFFFF', text: '#052E22' },
  { id: 'purple-lavender', name: 'Purple Lavender', description: 'Creative, modern and elegant', mode: 'light', accent: '#8B5CF6', secondary: '#A78BFA', tint: '#EDE9FE', surface: '#F5F3FF', base: '#FFFFFF', text: '#1E1538' },
  { id: 'teal-ocean', name: 'Teal Ocean', description: 'Fresh, modern and easy on the eyes', mode: 'light', accent: '#0EA5E9', secondary: '#06B6DA', tint: '#CFFAFE', surface: '#ECFEFF', base: '#FFFFFF', text: '#082F49' },
  { id: 'sunrise-amber', name: 'Sunrise Amber', description: 'Warm, friendly and energizing', mode: 'light', accent: '#F59E0B', secondary: '#FBBF24', tint: '#FEF3C7', surface: '#FFFBEB', base: '#FFFFFF', text: '#2A1A04' },
  { id: 'rose-coral', name: 'Rose Coral', description: 'Soft, modern and visually pleasing', mode: 'light', accent: '#F43F5E', secondary: '#FB7185', tint: '#FEE2E2', surface: '#FFF1F2', base: '#FFFFFF', text: '#2B0A12' },
  { id: 'sky-cyan', name: 'Sky Cyan', description: 'Clean, airy and minimal', mode: 'light', accent: '#0D9488', secondary: '#14B8A6', tint: '#CCFBF1', surface: '#F0FDFA', base: '#FFFFFF', text: '#042F2C' },
  { id: 'slate-minimal', name: 'Slate Minimal', description: 'Neutral, modern and distraction-free', mode: 'light', accent: '#475569', secondary: '#64748B', tint: '#E2E8F0', surface: '#F8FAFC', base: '#FFFFFF', text: '#0F172A' },
];

/** Stored preference: a theme, or "system" (Classic Blue / Graphite Dark following the computer). */
export type ThemePreference = 'system' | ThemeId;

export function isThemeId(v: unknown): v is ThemeId {
  return typeof v === 'string' && THEMES.some((t) => t.id === v);
}

export function themeById(id: ThemeId): ThemeSpec {
  return THEMES.find((t) => t.id === id) ?? THEMES[0]!;
}

/** The theme shown for a preference ("system" follows the computer's light / dark setting). */
export function resolveThemeId(pref: ThemePreference | string | undefined, systemDark: boolean): ThemeId {
  if (pref === 'system') return systemDark ? 'graphite-dark' : 'classic-blue';
  // Settings from before themes: light / dark.
  if (pref === 'light') return 'classic-blue';
  if (pref === 'dark') return 'graphite-dark';
  return isThemeId(pref) ? pref : DEFAULT_THEME;
}

// ---------------------------------------------------------------- colour maths

type RGB = [number, number, number];

export function hexToRgb(hex: string): RGB {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h.slice(0, 6);
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex([r, g, b]: RGB): string {
  return `#${[r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('')}`;
}

/** `a` mixed with `b`: amount 0 = a, 1 = b. */
export function mix(a: string, b: string, amount: number): string {
  const x = hexToRgb(a);
  const y = hexToRgb(b);
  return rgbToHex([0, 1, 2].map((i) => x[i]! + (y[i]! - x[i]!) * amount) as RGB);
}

function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as RGB;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio (1–21). */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((p, q) => q - p) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** Moves `color` towards `towards` in small steps until it reaches `ratio` against `against`. */
function ensureContrast(color: string, against: string, ratio: number, towards: string): string {
  let c = color;
  for (let i = 0; i < 20 && contrast(c, against) < ratio; i++) c = mix(c, towards, 0.1);
  return c;
}

function alpha(hex: string, a: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

// ---------------------------------------------------------------- tokens

const WHITE = '#ffffff';
const BLACK = '#000000';

/** Every CSS colour token for a theme. */
export function themeTokens(t: ThemeSpec): Record<string, string> {
  const dark = t.mode === 'dark';
  const text = t.text;
  // Panels / page / fields.
  const tint = t.tint ?? mix(t.base, t.accent, 0.15);
  // Light: the page is the canvas deepened towards the tint, so white panels stand out on it.
  const page = dark ? t.base : mix(mix(t.surface, tint, 0.55), text, 0.025);
  const panel = dark ? mix(t.base, text, 0.06) : t.base;
  const elevated = dark ? mix(t.base, text, 0.09) : t.base;
  const muted = dark ? mix(t.base, text, 0.12) : mix(page, text, 0.04);
  const border = dark ? mix(t.base, text, 0.17) : mix(page, text, 0.11);
  const borderStrong = dark ? mix(t.base, text, 0.27) : mix(page, text, 0.22);
  const textSecondary = ensureContrast(mix(text, panel, 0.36), panel, 4.6, text);
  const textTertiary = ensureContrast(mix(text, panel, 0.52), panel, 3.1, text);

  // Accent: readable on panels (≥ 3:1), with a label colour readable on it.
  const primary = ensureContrast(t.accent, panel, 3, dark ? WHITE : BLACK);
  // White labels on the accent when readable (≥ 3:1, bold UI text), else a very dark shade of the theme
  // (amber, emerald and other bright accents).
  const darkLabel = mix(dark ? t.base : t.text, BLACK, 0.5);
  const onPrimary = contrast(WHITE, primary) >= 3 || contrast(WHITE, primary) >= contrast(darkLabel, primary) ? WHITE : darkLabel;
  const hover = dark ? mix(primary, WHITE, 0.14) : mix(primary, BLACK, 0.1);
  const active = dark ? mix(primary, BLACK, 0.08) : mix(primary, BLACK, 0.18);
  const soft = dark ? mix(panel, primary, 0.2) : mix(panel, tint, 0.6);
  const softStrong = dark ? mix(panel, primary, 0.32) : mix(tint, primary, 0.12);
  const secondary = ensureContrast(t.secondary, panel, 3, dark ? WHITE : BLACK);

  // Editor chrome and canvas (image editor, video page, Flow Editor, collage).
  const chrome = dark ? mix(t.base, text, 0.07) : t.base;
  const chrome2 = dark ? mix(t.base, text, 0.11) : mix(page, t.base, 0.45);
  const canvas = dark ? mix(t.base, BLACK, 0.38) : mix(page, text, 0.07);
  const editorText = text;
  const editorDim = ensureContrast(mix(text, chrome, 0.36), chrome, 4.6, text);

  const shadow = dark
    ? { xs: '0 1px 2px rgba(0, 0, 0, 0.3)', sm: '0 2px 6px rgba(0, 0, 0, 0.3)', md: '0 8px 24px rgba(0, 0, 0, 0.4)', lg: '0 18px 48px rgba(0, 0, 0, 0.5)' }
    : { xs: '0 1px 2px rgba(15, 23, 42, 0.06)', sm: '0 2px 6px rgba(15, 23, 42, 0.08)', md: '0 1px 2px rgba(15, 23, 42, 0.06), 0 6px 20px rgba(15, 23, 42, 0.09)', lg: '0 18px 48px rgba(15, 23, 42, 0.16)' };

  return {
    '--c-primary': primary,
    '--c-primary-hover': hover,
    '--c-primary-active': active,
    '--c-primary-soft': soft,
    '--c-primary-soft-strong': softStrong,
    '--c-on-primary': onPrimary,
    '--c-secondary': secondary,
    '--c-accent-gradient': `linear-gradient(135deg, ${primary}, ${mix(primary, secondary, 0.55)})`,

    '--c-bg': panel,
    '--c-bg-subtle': page,
    '--c-bg-muted': muted,
    '--c-bg-elevated': elevated,
    '--c-overlay': dark ? 'rgba(0, 0, 0, 0.6)' : alpha(mix(text, BLACK, 0.3), 0.45),

    '--c-text': text,
    '--c-text-secondary': textSecondary,
    '--c-text-tertiary': textTertiary,
    '--c-text-inverse': dark ? t.base : WHITE,

    '--c-border': border,
    '--c-border-strong': borderStrong,

    '--c-success-soft': dark ? mix(panel, '#24a36a', 0.18) : '#e7f6ef',
    '--c-error-soft': dark ? mix(panel, '#e05252', 0.18) : '#fdecec',
    '--c-warning-soft': dark ? mix(panel, '#d98a00', 0.18) : '#fff5e0',

    '--shadow-xs': shadow.xs,
    '--shadow-sm': shadow.sm,
    '--shadow-md': shadow.md,
    '--shadow-lg': shadow.lg,

    '--c-editor-scheme': t.mode,
    '--c-editor-chrome': chrome,
    '--c-editor-chrome-2': chrome2,
    '--c-editor-canvas': canvas,
    '--c-editor-border': dark ? mix(t.base, text, 0.18) : mix(page, text, 0.13),
    '--c-editor-text': editorText,
    '--c-editor-text-dim': editorDim,
    '--c-editor-hover': dark ? mix(t.base, text, 0.15) : mix(tint, panel, 0.35),
    '--c-editor-dot': dark ? alpha(text, 0.06) : alpha(text, 0.14),
    '--c-editor-field': dark ? mix(t.base, BLACK, 0.22) : WHITE,
    '--c-editor-field-border': dark ? mix(t.base, text, 0.22) : mix(page, text, 0.2),
    '--c-editor-thumb': dark ? mix(t.base, BLACK, 0.5) : mix(page, text, 0.05),
    '--c-editor-line': dark ? alpha(text, 0.16) : alpha(text, 0.2),
    /** Thin ring and shadow around the image on the canvas, so a light image stands out on a light canvas. */
    '--c-editor-image-ring': dark ? alpha(WHITE, 0.08) : alpha(text, 0.28),
    '--c-editor-image-shadow': dark ? '0 10px 36px rgba(0, 0, 0, 0.5)' : `0 2px 6px ${alpha(text, 0.12)}, 0 14px 40px ${alpha(text, 0.2)}`,
    /** Card inside a side panel (tool settings), and a tile inside such a card. */
    '--c-editor-card': dark ? mix(chrome, BLACK, 0.18) : mix(page, t.base, 0.35),
    '--c-editor-card-border': dark ? mix(t.base, text, 0.12) : mix(page, text, 0.12),
    '--c-editor-tile': dark ? mix(chrome, BLACK, 0.3) : WHITE,
    /** Preview strokes (arrow and line style buttons). */
    '--c-editor-ink': dark ? mix(text, t.base, 0.1) : mix(text, t.base, 0.15),

    'color-scheme': t.mode,
  };
}

/** The five colours shown for a theme in the picker (as named in the palette sheets). */
export function themeSwatches(t: ThemeSpec): Array<{ label: string; color: string }> {
  if (t.mode === 'light') {
    return [
      { label: 'Primary', color: t.accent },
      { label: 'Accent', color: t.secondary },
      { label: 'Surface', color: t.tint ?? t.surface },
      { label: 'Canvas', color: t.surface },
      { label: 'Background', color: t.base },
    ];
  }
  return [
    { label: 'Primary', color: t.base },
    { label: 'Accent', color: t.accent },
    { label: 'Secondary', color: t.secondary },
    { label: 'Surface', color: t.surface },
    { label: 'Text', color: t.text },
  ];
}
