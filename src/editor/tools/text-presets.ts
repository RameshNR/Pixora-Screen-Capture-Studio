import type { TextAnnotation, TextPart } from '../types';
import { DEFAULT_FONT } from '../types';

/**
 * Text design sheet: title styles, banners, badges & labels, outline & stroke, background
 * highlights, shadow & 3D, handwritten, callout text, step text, decorative, gradient & modern,
 * and combinations. A preset replaces the whole look of the text but keeps its words.
 */

export type TextLook = Partial<Omit<TextAnnotation, 'id' | 'type' | 'x' | 'y' | 'text' | 'rotation' | 'hidden'>>;

export interface TextPreset {
  id: string;
  label: string;
  /** Words shown in the preview. */
  sample: string;
  patch: TextLook;
}

const HAND = '"Dancing Script", cursive';
const FUN = 'Chewy, cursive';
const F = DEFAULT_FONT;

/** Every look field back to plain text, so presets never mix. */
export const TEXT_LOOK_RESET: TextLook = {
  fontFamily: F, bold: true, italic: false, underline: false, strike: false, caps: false, letterSpacing: 0,
  outlineWidth: 0, outlineColor: '#FFFFFF', outlineDash: 'solid', shadow: false, shadowBlur: undefined, shadowOpacity: undefined, shadowColor: undefined, shadowX: undefined, shadowY: undefined,
  gradient: null, extrude: 0, extrudeColor: undefined, deco: 'none', decoColor: undefined, decoColor2: undefined,
  background: 'transparent', borderWidth: 0, borderStyle: 'solid', borderRadius: 6, padding: null, header: null, footer: null, dividers: false,
};

const part = (text: string, color: string, fontSize: number, extra: Partial<TextPart> = {}): TextPart => ({
  text, color, fontSize, fontFamily: F, bold: false, italic: false, align: 'left', ...extra,
});

const T = (id: string, label: string, sample: string, patch: TextLook): TextPreset => ({ id, label, sample, patch });
const pad = (v: number, h: number): [number, number, number, number] => [v, h, v, h];

export const TEXT_GROUPS: Array<{ id: string; label: string; items: TextPreset[] }> = [
  {
    id: 'quick', label: 'Quick',
    items: [
      T('q-default', 'Default', 'Aa', { color: '#E05252' }),
      T('q-highlight', 'Highlight', 'Aa', { color: '#5B21B6', background: '#EDE9FE', borderRadius: 10, padding: pad(6, 12) }),
      T('q-success', 'Success', 'Aa', { color: '#166534', background: '#DCFCE7', borderRadius: 10, padding: pad(6, 12) }),
      T('q-warning', 'Warning', 'Aa', { color: '#B91C1C', background: '#FFE4E6', borderRadius: 10, padding: pad(6, 12) }),
    ],
  },
  {
    id: 'title', label: 'Title styles',
    items: [
      T('t-swash', 'Yellow swash', 'Title', { color: '#111827', italic: true, deco: 'brush-under', decoColor: '#FACC15' }),
      T('t-box', 'Outline box', 'Title', { color: '#111827', deco: 'tilted-box', decoColor: '#7C3AED', padding: pad(4, 10) }),
      T('t-brush', 'Purple brush', 'Title', { color: '#FFFFFF', italic: true, deco: 'brush', decoColor: '#8B5CF6', padding: pad(4, 10) }),
      T('t-caps', 'Underlined caps', 'TITLE', { color: '#1D4ED8', italic: true, caps: true, underline: true }),
      T('t-yellow', 'Yellow brush', 'Title', { color: '#111827', deco: 'brush', decoColor: '#FDE047', padding: pad(4, 10) }),
      T('t-ring', 'Red ring', 'Title', { color: '#111827', underline: true, deco: 'ring', decoColor: '#EF4444', padding: pad(2, 6) }),
    ],
  },
  {
    id: 'banner', label: 'Banner',
    items: [
      T('bn-new', 'NEW', 'NEW', { color: '#FFFFFF', caps: true, deco: 'banner', decoColor: '#EC4899', decoColor2: '#F43F5E', padding: pad(4, 10) }),
      T('bn-update', 'UPDATE', 'UPDATE', { color: '#FFFFFF', caps: true, deco: 'banner', decoColor: '#0EA5E9', decoColor2: '#2563EB', padding: pad(4, 10) }),
      T('bn-feature', 'FEATURE', 'FEATURE', { color: '#FFFFFF', caps: true, deco: 'banner', decoColor: '#8B5CF6', decoColor2: '#A78BFA', padding: pad(4, 10) }),
      T('bn-tip', 'TIP', 'TIP', { color: '#111827', caps: true, deco: 'ribbon', decoColor: '#FDE68A', borderWidth: 0, padding: pad(4, 10) }),
      T('bn-important', 'IMPORTANT', 'IMPORTANT', { color: '#FFFFFF', caps: true, deco: 'banner', decoColor: '#EF4444', decoColor2: '#DC2626', padding: pad(4, 10) }),
      T('bn-note', 'NOTE', 'NOTE', { color: '#FFFFFF', caps: true, deco: 'banner', decoColor: '#22C55E', decoColor2: '#15803D', padding: pad(4, 10) }),
    ],
  },
  {
    id: 'badge', label: 'Badge & label',
    items: [
      T('bg-beta', 'Beta', 'Beta', { color: '#7C3AED', background: '#EDE9FE', borderRadius: 999, padding: pad(5, 16) }),
      T('bg-new', 'New', 'New', { color: '#FFFFFF', background: '#EF4444', borderRadius: 999, padding: pad(5, 16) }),
      T('bg-pro', 'Pro', '👑 Pro', { color: '#FFFFFF', background: '#4C1D95', borderRadius: 999, padding: pad(5, 16) }),
      T('bg-free', 'Free', 'Free', { color: '#FFFFFF', background: '#16A34A', borderRadius: 999, padding: pad(5, 16) }),
      T('bg-hot', 'Hot', '🔥 Hot', { color: '#DC2626', background: '#FFE4E6', borderRadius: 999, padding: pad(5, 16) }),
      T('bg-update', 'Update', '🔄 Update', { color: '#0284C7', background: '#E0F2FE', borderRadius: 999, padding: pad(5, 16) }),
      T('bg-ai', 'AI', '✨ AI', { color: '#9333EA', background: '#F3E8FF', borderRadius: 999, padding: pad(5, 16) }),
      T('bg-version', 'Version', 'v2.0', { color: '#7C3AED', background: '#FFFFFF', borderWidth: 2.5, borderColor: '#7C3AED', borderRadius: 999, padding: pad(5, 16) }),
    ],
  },
  {
    id: 'outline', label: 'Outline & stroke',
    items: [
      T('o-white', 'White outline', 'Text', { color: '#FFFFFF', outlineWidth: 4, outlineColor: '#111827', fontFamily: FUN }),
      T('o-magenta', 'Magenta', 'Text', { color: '#D946EF', outlineWidth: 4, outlineColor: '#FFFFFF', shadow: true, shadowColor: '#581C87', shadowOpacity: 0.6, shadowBlur: 0, shadowY: 3, fontFamily: FUN }),
      T('o-blue', 'Blue', 'Text', { color: '#3B82F6', outlineWidth: 4, outlineColor: '#FFFFFF', extrude: 3, extrudeColor: '#1E3A8A', fontFamily: FUN }),
      T('o-yellow', 'Yellow caps', 'TEXT', { color: '#FDE047', caps: true, outlineWidth: 4, outlineColor: '#111827', extrude: 3, extrudeColor: '#111827', fontFamily: FUN }),
      T('o-pink', 'Pink', 'Text', { color: '#F472B6', outlineWidth: 4, outlineColor: '#FFFFFF', shadow: true, shadowOpacity: 0.25, fontFamily: FUN }),
      T('o-cyan', 'Cyan', 'Text', { color: '#22D3EE', outlineWidth: 4, outlineColor: '#FFFFFF', shadow: true, shadowOpacity: 0.25, fontFamily: FUN }),
    ],
  },
  {
    id: 'highlight', label: 'Background highlight',
    items: [
      T('h-yellow', 'Yellow brush', 'Highlighted Text', { color: '#111827', deco: 'brush', decoColor: '#FDE047', padding: pad(4, 10) }),
      T('h-pink', 'Pink brush', 'Highlighted Text', { color: '#111827', deco: 'brush', decoColor: '#F9A8D4', padding: pad(4, 10) }),
      T('h-blue', 'Blue box', 'Highlighted Text', { color: '#111827', background: '#BAE6FD', borderRadius: 12, padding: pad(6, 14) }),
      T('h-green', 'Green box', 'Highlighted Text', { color: '#111827', background: '#D9F99D', borderRadius: 12, padding: pad(6, 14) }),
    ],
  },
  {
    id: '3d', label: 'Shadow & 3D',
    items: [
      T('s-dark', 'Soft shadow', 'Text', { color: '#1F2937', shadow: true, shadowBlur: 6, shadowY: 4, shadowOpacity: 0.35, fontFamily: FUN }),
      T('s-purple', 'Purple 3D', 'Text', { color: '#C084FC', outlineWidth: 2, outlineColor: '#FFFFFF', extrude: 4, extrudeColor: '#6B21A8', fontFamily: FUN }),
      T('s-blue', 'Blue 3D', 'Text', { color: '#60A5FA', outlineWidth: 2, outlineColor: '#FFFFFF', extrude: 4, extrudeColor: '#1E40AF', fontFamily: FUN }),
      T('s-orange', 'Orange 3D', 'Text', { color: '#FDBA74', gradient: ['#FDE047', '#F97316'], outlineWidth: 2, outlineColor: '#FFFFFF', extrude: 4, extrudeColor: '#C2410C', fontFamily: FUN }),
      T('s-pink', 'Pink 3D', 'Text', { color: '#F472B6', outlineWidth: 2, outlineColor: '#FFFFFF', extrude: 4, extrudeColor: '#9D174D', fontFamily: FUN }),
      T('s-cyan', 'Cyan 3D', 'Text', { color: '#22D3EE', gradient: ['#67E8F9', '#2563EB'], outlineWidth: 2, outlineColor: '#FFFFFF', extrude: 4, extrudeColor: '#1E3A8A', fontFamily: FUN }),
    ],
  },
  {
    id: 'hand', label: 'Handwritten',
    items: [
      T('w-note', 'Note', 'Note', { color: '#111827', fontFamily: HAND, deco: 'swash', decoColor: '#FACC15' }),
      T('w-important', 'Important!', 'Important!', { color: '#DC2626', fontFamily: HAND, deco: 'swash', decoColor: '#EF4444' }),
      T('w-check', 'Check ✓', 'Check ✓', { color: '#1E3A8A', fontFamily: HAND, deco: 'swash', decoColor: '#1E3A8A' }),
      T('w-idea', 'Idea', 'Idea', { color: '#7C3AED', fontFamily: HAND, deco: 'ring', decoColor: '#7C3AED', padding: pad(2, 6) }),
      T('w-todo', 'To Do', 'To Do', { color: '#111827', fontFamily: HAND, deco: 'tilted-box', decoColor: '#16A34A', padding: pad(4, 10) }),
      T('w-remember', 'Remember', 'Remember', { color: '#111827', fontFamily: HAND, deco: 'swash', decoColor: '#EC4899' }),
    ],
  },
  {
    id: 'callout', label: 'Callout text',
    items: [
      T('c-step1', 'Step 1', 'Step 1', { color: '#111827', deco: 'speech', decoColor: '#3B82F6', decoColor2: '#EFF6FF', padding: pad(6, 14) }),
      T('c-step2', 'Step 2', 'Step 2', { color: '#111827', deco: 'speech', decoColor: '#EAB308', decoColor2: '#FEF9C3', padding: pad(6, 14) }),
      T('c-step3', 'Step 3', 'Step 3', { color: '#111827', deco: 'cloud', decoColor: '#EC4899', decoColor2: '#FCE7F3', padding: pad(6, 14) }),
      T('c-tip', 'Tip', 'Tip', { color: '#111827', deco: 'cloud', decoColor: '#8B5CF6', decoColor2: '#EDE9FE', padding: pad(6, 14) }),
      T('c-note', 'Note', 'Note', { color: '#111827', deco: 'speech', decoColor: '#06B6D4', decoColor2: '#CFFAFE', padding: pad(6, 14) }),
      T('c-important', 'Important', 'Important', { color: '#111827', deco: 'speech', decoColor: '#EF4444', decoColor2: '#FFF7ED', padding: pad(6, 14) }),
    ],
  },
  {
    id: 'step', label: 'Numbered & step',
    items: [
      T('n-1', 'Step purple', 'Step 1', { color: '#FFFFFF', deco: 'chevron', decoColor: '#7C3AED', decoColor2: '#A855F7', padding: pad(6, 14) }),
      T('n-2', 'Step blue', 'Step 2', { color: '#FFFFFF', deco: 'chevron', decoColor: '#0EA5E9', decoColor2: '#2563EB', padding: pad(6, 14) }),
      T('n-3', 'Step pink', 'Step 3', { color: '#FFFFFF', deco: 'chevron', decoColor: '#EC4899', decoColor2: '#F43F5E', padding: pad(6, 14) }),
    ],
  },
  {
    id: 'decor', label: 'Decorative',
    items: [
      T('d-wow', 'WOW!', 'WOW!', { color: '#111827', caps: true, fontFamily: FUN, deco: 'burst', decoColor: '#FDE047', decoColor2: '#111827', padding: pad(2, 6) }),
      T('d-sale', 'SALE', 'SALE', { color: '#FFFFFF', caps: true, deco: 'banner', decoColor: '#EF4444', decoColor2: '#DC2626', padding: pad(4, 10) }),
      T('d-new', 'NEW!', 'NEW!', { color: '#FFFFFF', italic: true, caps: true, deco: 'brush', decoColor: '#3B82F6', padding: pad(4, 12) }),
      T('d-soon', 'Coming soon', 'COMING SOON', { color: '#7C3AED', caps: true, deco: 'megaphone', decoColor: '#7C3AED', padding: pad(6, 12) }),
      T('d-go', "Let's Go!", "Let's Go!", { color: '#111827', fontFamily: HAND, deco: 'swash', decoColor: '#FACC15' }),
      T('d-congrats', 'Congrats!', 'Congrats!', { color: '#111827', fontFamily: HAND, deco: 'swash', decoColor: '#EC4899' }),
    ],
  },
  {
    id: 'gradient', label: 'Gradient & modern',
    items: [
      T('g-purple', 'Purple gradient', 'Text', { color: '#A855F7', gradient: ['#7C3AED', '#EC4899'] }),
      T('g-blue', 'Blue gradient', 'Text', { color: '#06B6D4', gradient: ['#22D3EE', '#2563EB'] }),
      T('g-sunset', 'Sunset gradient', 'Text', { color: '#F97316', gradient: ['#FACC15', '#EF4444'] }),
      T('g-pill', 'Gradient pill', 'Text', { color: '#FFFFFF', deco: 'pill-gradient', decoColor: '#8B5CF6', decoColor2: '#3B82F6', padding: pad(6, 18) }),
      T('g-dark', 'Dark pill', 'Text', { color: '#FFFFFF', deco: 'pill-dark', decoColor: '#1E1B4B', padding: pad(6, 18) }),
      T('g-outline', 'Outline pill', 'Text', { color: '#7C3AED', gradient: ['#7C3AED', '#EC4899'], deco: 'pill-outline', decoColor: '#7C3AED', decoColor2: '#EC4899', padding: pad(6, 18) }),
    ],
  },
  {
    id: 'combo', label: 'Combinations',
    items: [
      T('x-title', 'Title + subtitle', 'Title Here', { color: '#111827', deco: 'bar', decoColor: '#7C3AED', footer: part('Subtitle goes here', '#6B7280', 15) }),
      T('x-key', 'Key point', 'Key Point', { color: '#7C3AED', italic: true, deco: 'swash', decoColor: '#EC4899' }),
      T('x-tip', 'Pro tip', '💡 Pro Tip', { color: '#111827', deco: 'dashed-box', decoColor: '#111827', padding: pad(10, 14), footer: part('Add a short note here', '#374151', 14) }),
    ],
  },
];

export const ALL_TEXT_PRESETS = TEXT_GROUPS.flatMap((g) => g.items);

/** Background designs offered in Design → Background → Design. */
export const TEXT_DECOS: Array<{ value: NonNullable<TextAnnotation['deco']>; label: string }> = [
  { value: 'brush', label: 'Brush' }, { value: 'brush-under', label: 'Swash under' }, { value: 'banner', label: 'Banner' }, { value: 'ribbon', label: 'Ribbon' },
  { value: 'burst', label: 'Burst' }, { value: 'swash', label: 'Underline swash' }, { value: 'ring', label: 'Hand ring' }, { value: 'tape', label: 'Tape' },
  { value: 'tilted-box', label: 'Outline box' }, { value: 'bar', label: 'Side bar' }, { value: 'pill-gradient', label: 'Gradient pill' }, { value: 'pill-dark', label: 'Dark pill' },
  { value: 'pill-outline', label: 'Outline pill' }, { value: 'speech', label: 'Speech' }, { value: 'cloud', label: 'Cloud' }, { value: 'chevron', label: 'Chevron' },
  { value: 'dashed-box', label: 'Dashed box' }, { value: 'megaphone', label: 'Megaphone' },
];

export const GRADIENT_PAIRS: Array<[string, string]> = [
  ['#7C3AED', '#EC4899'], ['#22D3EE', '#2563EB'], ['#FACC15', '#EF4444'], ['#8B5CF6', '#3B82F6'], ['#34D399', '#0EA5E9'], ['#F472B6', '#FB923C'],
];
