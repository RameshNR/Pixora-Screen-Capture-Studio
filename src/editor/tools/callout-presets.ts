import type { CalloutDesign } from '../types';
import { CALLOUT_DESIGNS, type DesignPatch } from './callouts';

/**
 * Callout picker catalogue. Each entry is a design plus the colours it starts with (the same
 * design can appear in several colourways). `sample` is only used for the preview and as the
 * starting text of a new callout.
 */
export interface CalloutPreset {
  key: string;
  id: CalloutDesign;
  label: string;
  patch: DesignPatch;
  sample?: { title?: string; text?: string; badge?: string };
}

const P = (key: string, id: CalloutDesign, label: string, patch: DesignPatch, sample?: CalloutPreset['sample']): CalloutPreset => ({ key, id, label, patch, sample });
const T = (color: string, extra: Partial<NonNullable<DesignPatch['titleStyle']>> = {}) => ({ titleStyle: { color, ...extra } });

const BADGE = (key: string, label: string, icon: NonNullable<DesignPatch['icon']>, fill: string, stroke: string, accent: string, color = '#374151', bold = false): CalloutPreset =>
  P(key, 'badge', label, { fill, stroke, accent, color, icon, strokeWidth: stroke === 'transparent' ? 0 : 1.5, tail: 'none', bold, align: 'left', ...T(color) }, { text: label });

export const CALLOUT_GROUPS: Array<{ id: string; label: string; items: CalloutPreset[] }> = [
  {
    id: 'premium', label: 'Premium',
    items: [
      P('soft', 'soft', 'Rounded rectangle', { fill: '#F1EAFF', stroke: '#C9B3F5', accent: '#7C3AED', color: '#4B4F63', radius: 16, strokeWidth: 1.5, tail: 'none', ...T('#1D1B4B') }, { title: 'Rounded Rectangle', text: 'Clean and versatile.' }),
      P('pill-glow', 'pill-glow', 'Pill label', { fill: '#6D4AFF', stroke: '#6D4AFF', accent: '#8F6BFF', color: '#FFFFFF', strokeWidth: 0, tail: 'none', align: 'center', ...T('#FFFFFF', { align: 'center' }) }, { text: 'Pill Label' }),
      P('speech-soft', 'speech-soft', 'Speech bubble', { fill: '#E3EEFF', stroke: '#3B82F6', accent: '#3B82F6', color: '#475467', radius: 24, strokeWidth: 2, tail: 'speech', ...T('#101828') }, { title: 'Speech Bubble', text: 'Great for explanations.' }),
      P('cloud', 'cloud', 'Cloud bubble', { fill: '#F6EDFF', stroke: '#B57BEE', accent: '#B57BEE', color: '#4B4F63', strokeWidth: 2, tail: 'none', align: 'center', ...T('#1D1B4B', { align: 'center' }) }, { title: 'Cloud Bubble', text: 'Friendly and expressive.' }),
      P('quote-card', 'quote-card', 'Quote callout', { fill: '#FFFFFF', stroke: '#E4E7EC', accent: '#7C3AED', color: '#475467', radius: 14, strokeWidth: 1.5, tail: 'none', ...T('#101828') }, { title: 'Quote Callout', text: 'Highlight key information.' }),
      P('highlight', 'highlight', 'Highlight label', { fill: '#FFE14D', stroke: 'transparent', accent: '#F5C400', color: '#3B3B3B', strokeWidth: 0, tail: 'none', ...T('#1D2433') }, { title: 'Highlight Label', text: 'Emphasize important text.' }),
      P('fold-note', 'fold-note', 'Note (folded corner)', { fill: '#E3F0FF', stroke: '#93C1F5', accent: '#93C1F5', color: '#475467', strokeWidth: 1.5, tail: 'none', ...T('#101828') }, { title: 'Note Callout', text: 'With corner fold style.' }),
      P('sketch', 'sketch', 'Sketch callout', { fill: '#FFFFFF', stroke: '#111827', accent: '#111827', color: '#374151', strokeWidth: 2, tail: 'none', ...T('#111827') }, { title: 'Sketch Callout', text: 'Hand-drawn look.' }),
      P('ribbon-red', 'ribbon-fold', 'Ribbon label', { fill: '#E5484D', stroke: 'transparent', accent: '#B4232A', color: '#FFE4E6', strokeWidth: 0, tail: 'none', ...T('#FFFFFF') }, { title: 'Ribbon Label', text: 'For attention and status.' }),
      P('arrow-soft', 'arrow-soft', 'Arrow label', { fill: '#F1EAFF', stroke: '#9B7BEA', accent: '#7C3AED', color: '#475467', strokeWidth: 1.5, tail: 'none', ...T('#1D1B4B') }, { title: 'Arrow Label', text: 'Directional and clear.' }),
    ],
  },
  {
    id: 'steps', label: 'Steps',
    items: [
      P('seal-purple', 'step-seal', 'Step · purple seal', { fill: '#F3EEFF', stroke: '#D9CCFA', accent: '#7C3AED', color: '#475467', radius: 16, strokeWidth: 1, tail: 'none', badge: '1', ...T('#1D1B4B') }, { title: 'Step 1: Open Settings', text: 'Click the Settings icon in the top-right corner.', badge: '1' }),
      P('seal-blue', 'step-seal', 'Step · blue seal', { fill: '#EEF5FF', stroke: '#C8DBF7', accent: '#1E88E5', color: '#475467', radius: 16, strokeWidth: 1, tail: 'none', badge: '2', ...T('#0F2A4D') }, { title: 'Step 2: Choose Options', text: 'Select the required option from the list.', badge: '2' }),
      P('seal-green', 'step-seal', 'Step · green seal', { fill: '#EEF9F0', stroke: '#C9E8CF', accent: '#2E9E3E', color: '#475467', radius: 16, strokeWidth: 1, tail: 'none', badge: '3', ...T('#123B1A') }, { title: 'Step 3: Apply Changes', text: 'Click Apply to save your changes.', badge: '3' }),
      P('step-circle', 'step-circle', 'Step · circle', { fill: '#FFFFFF', stroke: '#E4E7EC', accent: '#4F46E5', color: '#475467', radius: 14, strokeWidth: 1, tail: 'none', badge: '1', ...T('#101828') }, { title: 'Step 1', text: 'Describe the step here.', badge: '1' }),
      P('banner-orange', 'step-banner', 'Step banner', { fill: '#FF9800', stroke: 'transparent', accent: '#263A4A', color: '#3A2A12', strokeWidth: 0, tail: 'none', badge: '1', ...T('#263A4A') }, { title: 'Step 1: Your text here', text: 'Lorem ipsum dolor sit amet.', badge: '1' }),
      P('box-teal', 'step-box', 'Step box · outline', { fill: '#FFFFFF', stroke: '#2BA3C9', accent: '#2BA3C9', color: '#5B7A86', radius: 14, strokeWidth: 3, tail: 'speech', ...T('#2BA3C9', { align: 'right' }) }, { title: 'Step 01', text: 'Describe this step.' }),
      P('box-teal-fill', 'step-box', 'Step box · filled', { fill: '#2BA3C9', stroke: '#FFFFFF', accent: '#BDEBFA', color: '#E6F7FC', radius: 14, strokeWidth: 3, tail: 'speech', ...T('#FFFFFF', { align: 'right' }) }, { title: 'Step 02', text: 'Describe this step.' }),
      P('box-green', 'step-box', 'Step box · lime', { fill: '#B5D334', stroke: '#FFFFFF', accent: '#FFFFFF', color: '#F4FAE0', radius: 12, strokeWidth: 3, tail: 'speech', ...T('#FFFFFF', { align: 'right' }) }, { title: 'Step 01', text: 'Describe this step.' }),
      P('peel-teal', 'peel-card', 'Peel corner · teal', { fill: '#FFFFFF', stroke: '#E4E0D6', accent: '#19B3B1', color: '#4E8F8E', radius: 24, strokeWidth: 2, tail: 'none', badge: 'Step 01', ...T('#19B3B1', { align: 'right' }) }, { title: '01', text: 'Describe this step.', badge: 'Step 01' }),
      P('peel-olive', 'peel-card', 'Peel corner · olive', { fill: '#FFFFFF', stroke: '#E4E0D6', accent: '#A8A21A', color: '#7A7612', radius: 24, strokeWidth: 2, tail: 'none', badge: 'Step 02', ...T('#A8A21A', { align: 'right' }) }, { title: '02', text: 'Describe this step.', badge: 'Step 02' }),
      P('peel-pink', 'peel-card', 'Peel corner · magenta', { fill: '#FFFFFF', stroke: '#E4E0D6', accent: '#D81B60', color: '#9C1446', radius: 24, strokeWidth: 2, tail: 'none', badge: 'Step 03', ...T('#D81B60', { align: 'right' }) }, { title: '03', text: 'Describe this step.', badge: 'Step 03' }),
      P('band-teal', 'top-band', 'Title band', { fill: '#FFFFFF', stroke: '#E4E0D6', accent: '#1FB5C2', color: '#4B5563', radius: 22, strokeWidth: 2, tail: 'speech', ...T('#FFFFFF', { align: 'center' }) }, { title: 'Step 01', text: 'Lorem ipsum dolor sit amet.' }),
      P('arc-teal', 'circle-arc', 'Circle with arc', { fill: '#FFFFFF', stroke: '#E4E0D6', accent: '#0E9F8E', color: '#4B5563', strokeWidth: 2, tail: 'none', badge: '01', align: 'center', ...T('#0E9F8E', { align: 'right' }) }, { title: 'Title', text: 'Describe this step.', badge: '01' }),
      P('chip-teal', 'corner-chip', 'Number chip · teal', { fill: '#FFFFFF', stroke: '#E4E7EC', accent: '#19B3B1', color: '#374151', radius: 12, strokeWidth: 1.5, tail: 'none', badge: '01', ...T('#101828') }, { text: 'Your text', badge: '01' }),
      P('chip-green', 'corner-chip', 'Number chip · green', { fill: '#FFFFFF', stroke: '#E4E7EC', accent: '#22C55E', color: '#374151', radius: 12, strokeWidth: 1.5, tail: 'none', badge: '02', ...T('#101828') }, { text: 'Your text', badge: '02' }),
      P('chip-pink', 'corner-chip', 'Number chip · pink', { fill: '#FFFFFF', stroke: '#E4E7EC', accent: '#EC4899', color: '#374151', radius: 12, strokeWidth: 1.5, tail: 'none', badge: '03', ...T('#101828') }, { text: 'Your text', badge: '03' }),
      P('chip-purple', 'corner-chip', 'Number chip · purple', { fill: '#FFFFFF', stroke: '#E4E7EC', accent: '#8B5CF6', color: '#374151', radius: 12, strokeWidth: 1.5, tail: 'none', badge: '04', ...T('#101828') }, { text: 'Your text', badge: '04' }),
    ],
  },
  {
    id: 'quotes', label: 'Quotes',
    items: [
      P('q-bubble', 'quote-bubble', 'Quote bubble', { fill: '#FFFFFF', stroke: '#6D3FE0', accent: '#6D3FE0', color: '#1D1B4B', radius: 28, strokeWidth: 2.5, tail: 'speech', align: 'center', ...T('#1D1B4B', { align: 'center' }) }, { text: '“Important note about this feature.”' }),
      P('q-brush', 'quote-brush', 'Highlighter quote', { fill: '#FFE14D', stroke: 'transparent', accent: '#111827', color: '#111827', strokeWidth: 0, tail: 'none', align: 'center', ...T('#111827', { align: 'center' }) }, { title: 'Quick tip:', text: 'You can also use a keyboard shortcut.' }),
      P('q-soft', 'speech-soft', 'Soft quote bubble', { fill: '#E3EEFF', stroke: '#4A90E2', accent: '#4A90E2', color: '#1D2939', radius: 26, strokeWidth: 2.5, tail: 'speech', align: 'center', ...T('#1D2939', { align: 'center' }) }, { text: '“This explains how it works.”' }),
      P('q-frame', 'quote-frame', 'Quote frame', { fill: '#FFFFFF', stroke: '#6D3FE0', accent: '#6D3FE0', color: '#1D1B4B', radius: 18, strokeWidth: 2.5, tail: 'none', ...T('#1D1B4B') }, { title: 'Pro Tip:', text: 'Customize this style for your use case.' }),
      P('q-badge', 'quote-badge', 'Bubble with quote badge', { fill: '#FFFFFF', stroke: '#111827', accent: '#FFD21F', color: '#111827', radius: 40, strokeWidth: 2, tail: 'speech', bold: true, ...T('#111827') }, { text: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit.' }),
      P('q-offset', 'offset-card', 'Offset card', { fill: '#FFFFFF', stroke: '#111827', accent: '#FFD21F', color: '#111827', radius: 18, strokeWidth: 2.5, tail: 'none', ...T('#111827') }, { text: 'Your text here' }),
      P('q-circle', 'circle-quote', 'Circle quote', { fill: '#FFFFFF', stroke: '#111827', accent: '#111827', color: '#111827', strokeWidth: 2.5, tail: 'speech', align: 'center', ...T('#111827', { align: 'center' }) }, { text: 'Your text here' }),
      P('q-circle-orange', 'circle-quote', 'Orange circle quote', { fill: '#F7871F', stroke: '#111827', accent: '#111827', color: '#FFFFFF', strokeWidth: 2, tail: 'speech', align: 'center', ...T('#FFFFFF', { align: 'center' }) }, { text: 'Your text here' }),
      P('q-heart', 'heart', 'Heart quote', { fill: '#F7871F', stroke: '#111827', accent: '#FFFFFF', color: '#FFFFFF', strokeWidth: 2, tail: 'none', align: 'center', ...T('#FFFFFF', { align: 'center' }) }, { text: 'Your text here' }),
      P('q-flower', 'flower-quote', 'Flower quote', { fill: '#3A3A3A', stroke: 'transparent', accent: '#F5C842', color: '#FFFFFF', strokeWidth: 0, tail: 'none', align: 'center', ...T('#FFFFFF', { align: 'center' }) }, { title: 'QUOTE', text: 'Your text here' }),
      P('q-open', 'quote-open', 'Open frame', { fill: 'transparent', stroke: '#333333', accent: '#333333', color: '#333333', strokeWidth: 2.5, tail: 'none', align: 'center', ...T('#333333', { align: 'center' }) }, { title: 'QUOTE', text: 'Your text here' }),
      P('q-open-dash', 'quote-open', 'Dashed open frame', { fill: 'transparent', stroke: '#333333', accent: '#333333', color: '#333333', strokeWidth: 2.5, dash: 'dashed', tail: 'none', align: 'center', ...T('#333333', { align: 'center' }) }, { title: 'QUOTE', text: 'Your text here' }),
      P('q-curve', 'quote-curve', 'Curved open frame', { fill: 'transparent', stroke: '#333333', accent: '#333333', color: '#333333', strokeWidth: 2.5, tail: 'none', align: 'center', ...T('#333333', { align: 'center' }) }, { title: 'QUOTE', text: 'Your text here' }),
      P('q-ring', 'quote-ring', 'Open circle', { fill: 'transparent', stroke: '#111827', accent: '#111827', color: '#111827', strokeWidth: 2.5, tail: 'none', align: 'center', ...T('#111827', { align: 'center' }) }, { text: 'Your text here' }),
      P('q-lines', 'quote-lines', 'Lines quote', { fill: 'transparent', stroke: '#E5484D', accent: '#E5484D', color: '#1D2433', strokeWidth: 2.5, italic: true, tail: 'none', align: 'center', ...T('#1D2433', { align: 'center' }) }, { text: 'Your text here' }),
      P('q-double', 'double-frame', 'Double frame', { fill: 'transparent', stroke: '#F5B400', accent: '#F5B400', color: '#3A2E00', radius: 24, strokeWidth: 3, tail: 'none', align: 'center', ...T('#3A2E00', { align: 'center' }) }, { text: 'Your text here' }),
      P('q-rule', 'rule-box', 'Ruled box', { fill: '#F8D44C', stroke: '#333333', accent: '#333333', color: '#333333', radius: 14, strokeWidth: 2.5, tail: 'none', align: 'center', ...T('#333333', { align: 'center' }) }, { title: 'QUOTE', text: 'Your text here' }),
      P('q-sketch', 'sketch-quote', 'Sketch quote', { fill: 'transparent', stroke: '#111827', accent: '#111827', color: '#111827', strokeWidth: 2, tail: 'none', align: 'center', ...T('#111827', { align: 'center' }) }, { text: 'Your text here' }),
      P('q-sketch-blue', 'sketch-quote', 'Blue sketch quote', { fill: 'transparent', stroke: '#2D9CDB', accent: '#2D9CDB', color: '#1D2433', strokeWidth: 2, tail: 'none', align: 'center', ...T('#1D2433', { align: 'center' }) }, { text: 'Your text here' }),
      P('q-scribble', 'scribble', 'Scribble square', { fill: '#FFFFFF', stroke: '#FFC21F', accent: '#0F3550', color: '#0F3550', strokeWidth: 1.5, tail: 'none', align: 'center', shape: 'rect', ...T('#0F3550', { align: 'center' }) }, { title: 'Quote', text: 'Your text here' }),
      P('q-scribble-c', 'scribble', 'Scribble circle', { fill: '#FFFFFF', stroke: '#FFC21F', accent: '#0F3550', color: '#0F3550', strokeWidth: 1.5, tail: 'none', align: 'center', shape: 'ellipse', ...T('#0F3550', { align: 'center' }) }, { title: 'Quote', text: 'Your text here' }),
      P('q-scribble-h', 'scribble', 'Scribble hexagon', { fill: '#FFFFFF', stroke: '#FFC21F', accent: '#0F3550', color: '#0F3550', strokeWidth: 1.5, tail: 'none', align: 'center', shape: 'hexagon', ...T('#0F3550', { align: 'center' }) }, { title: 'Quote', text: 'Your text here' }),
      P('q-scribble-l', 'scribble', 'Scribble leaf', { fill: '#FFFFFF', stroke: '#FFC21F', accent: '#0F3550', color: '#0F3550', strokeWidth: 1.5, tail: 'none', align: 'center', shape: 'leaf', ...T('#0F3550', { align: 'center' }) }, { title: 'Quote', text: 'Your text here' }),
      P('q-dark', 'offset-frame', 'Dark offset frame', { fill: '#333333', stroke: '#333333', accent: '#F5C842', color: '#FFFFFF', strokeWidth: 2, tail: 'none', align: 'center', ...T('#FFFFFF', { align: 'center' }) }, { title: 'QUOTE', text: 'Your text here' }),
      P('q-hex', 'hex', 'Hexagon quote', { fill: '#FFE14D', stroke: '#E5B800', accent: '#111827', color: '#111827', strokeWidth: 2, tail: 'none', align: 'center', ...T('#111827', { align: 'center' }) }, { text: 'Your text here' }),
      P('q-para', 'parallelogram', 'Slanted quote', { fill: '#FFFFFF', stroke: '#111827', accent: '#111827', color: '#111827', strokeWidth: 2, tail: 'none', align: 'center', ...T('#111827', { align: 'center' }) }, { text: 'Your text here' }),
    ],
  },
  {
    id: 'speech', label: 'Speech & shapes',
    items: [
      P('s-rect', 'speech-soft', 'Box with tail', { fill: '#FFFFFF', stroke: '#6D3FE0', accent: '#6D3FE0', color: '#111827', radius: 10, strokeWidth: 2.5, tail: 'speech', align: 'center', ...T('#111827') }, { text: 'Callout' }),
      P('s-cloud', 'cloud', 'Yellow cloud', { fill: '#FFE14D', stroke: '#E0B400', accent: '#E0B400', color: '#111827', strokeWidth: 2, tail: 'speech', align: 'center', ...T('#111827') }, { text: 'Callout' }),
      P('s-circle', 'cloud', 'Circle with tail', { fill: '#FFFFFF', stroke: '#6D3FE0', accent: '#6D3FE0', color: '#111827', strokeWidth: 2.5, tail: 'speech', align: 'center', shape: 'ellipse', ...T('#111827') }, { text: 'Callout' }),
      P('s-thought', 'cloud', 'Thought bubble', { fill: '#FFFFFF', stroke: '#F472B6', accent: '#F472B6', color: '#111827', strokeWidth: 2, tail: 'none', align: 'center', shape: 'thought', ...T('#111827') }, { text: 'Callout' }),
      P('s-para', 'parallelogram', 'Parallelogram', { fill: '#E9E1FB', stroke: '#D5C6F7', accent: '#7C3AED', color: '#111827', strokeWidth: 1.5, tail: 'none', align: 'center', ...T('#111827') }, { text: 'Callout' }),
      P('s-hex', 'hex', 'Hexagon', { fill: '#FFFFFF', stroke: '#3B82F6', accent: '#3B82F6', color: '#111827', strokeWidth: 2.5, tail: 'none', align: 'center', ...T('#111827') }, { text: 'Callout' }),
      P('s-offset', 'offset-card', 'Layered card', { fill: '#FFFFFF', stroke: '#F59E0B', accent: '#FFD84D', color: '#111827', radius: 12, strokeWidth: 2, tail: 'none', align: 'center', ...T('#111827') }, { text: 'Callout' }),
      P('s-slant', 'slant', 'Slanted bubble', { fill: '#FFFFFF', stroke: '#111827', accent: '#111827', color: '#111827', strokeWidth: 2, tail: 'speech', ...T('#111827') }, { text: 'Your text here' }),
      P('s-heart', 'heart', 'Heart', { fill: '#FFFFFF', stroke: '#EC4899', accent: '#EC4899', color: '#111827', strokeWidth: 2, tail: 'none', align: 'center', ...T('#111827', { align: 'center' }) }, { text: 'Your text here' }),
      P('s-workflow', 'offset-card', 'Workflow card', { fill: '#FFFFFF', stroke: '#111827', accent: '#FFD21F', color: '#111827', radius: 18, strokeWidth: 2, tail: 'leader', leaderEnd: 'ring', align: 'center', ...T('#111827') }, { text: 'Your text here' }),
      P('s-brown', 'speech-soft', 'Warm bubble', { fill: '#A0522D', stroke: '#A0522D', accent: '#7A3E22', color: '#FFFFFF', radius: 22, strokeWidth: 0, tail: 'speech', align: 'center', ...T('#FFFFFF') }, { text: 'Your text here' }),
    ],
  },
  {
    id: 'labels', label: 'Labels & tags',
    items: [
      P('l-new', 'slant', 'Slanted yellow', { fill: '#FFE14D', stroke: '#E5B800', accent: '#E5B800', color: '#111827', strokeWidth: 1.5, bold: true, tail: 'none', align: 'center', ...T('#111827') }, { text: 'New Feature' }),
      P('l-version', 'slant', 'Slanted purple', { fill: '#7C3AED', stroke: '#6D28D9', accent: '#6D28D9', color: '#FFFFFF', strokeWidth: 1.5, bold: true, tail: 'none', align: 'center', ...T('#FFFFFF') }, { text: 'Version 2.0' }),
      P('l-key', 'arrow-tag', 'Arrow tag', { fill: '#FFFFFF', stroke: '#6D3FE0', accent: '#6D3FE0', color: '#111827', strokeWidth: 2, bold: true, tail: 'none', align: 'center', ...T('#111827') }, { text: 'Key Point' }),
      P('l-note', 'slant', 'Note with tail', { fill: '#4DA3FF', stroke: '#3B8FEA', accent: '#3B8FEA', color: '#FFFFFF', strokeWidth: 1.5, bold: true, tail: 'speech', align: 'center', ...T('#FFFFFF') }, { text: 'Note' }),
      P('l-best', 'slant', 'Slanted outline', { fill: '#F2FBF3', stroke: '#2E9E3E', accent: '#2E9E3E', color: '#14532D', strokeWidth: 2, bold: true, tail: 'none', align: 'center', ...T('#14532D') }, { text: 'Best Practice' }),
      P('l-important', 'arrow-tag', 'Red arrow tag', { fill: '#FFF1F2', stroke: '#E5484D', accent: '#E5484D', color: '#C81E3A', strokeWidth: 2, bold: true, tail: 'none', align: 'center', ...T('#C81E3A') }, { text: 'Important' }),
      P('l-user', 'soft', 'Leader label · yellow', { fill: '#FFF6D6', stroke: '#F2C14E', accent: '#F2A900', color: '#111827', radius: 12, strokeWidth: 2, bold: true, tail: 'leader', leaderEnd: 'ring', align: 'center', ...T('#111827') }, { text: 'User Menu' }),
      P('l-search', 'soft', 'Leader label · purple', { fill: '#FFFFFF', stroke: '#6D3FE0', accent: '#6D3FE0', color: '#111827', radius: 12, strokeWidth: 2, bold: true, tail: 'leader', leaderEnd: 'ring', align: 'center', ...T('#111827') }, { text: 'Search Box' }),
      P('l-tooltip', 'tooltip', 'Tooltip · purple', { fill: '#6D3FE0', stroke: '#6D3FE0', accent: '#B9A2FF', color: '#FFFFFF', radius: 10, strokeWidth: 1, tail: 'speech', align: 'center', bold: true, ...T('#FFFFFF') }, { text: 'Hover to see details' }),
      P('l-sale', 'offset-card', 'Offset label', { fill: '#FFE14D', stroke: '#2B6E73', accent: '#2B6E73', color: '#2B6E73', radius: 4, strokeWidth: 2, bold: true, tail: 'none', align: 'center', ...T('#2B6E73') }, { text: 'BIG SALE' }),
      P('l-outline', 'arrow-tag', 'Outline tag', { fill: '#FFFFFF', stroke: '#2B6E73', accent: '#2B6E73', color: '#2B6E73', strokeWidth: 2, bold: true, tail: 'none', align: 'center', ...T('#2B6E73') }, { text: 'FOR WORK' }),
      P('l-ribbon-y', 'ribbon-fold', 'Ribbon · yellow', { fill: '#F5C518', stroke: 'transparent', accent: '#B98A00', color: '#3A2E00', strokeWidth: 0, tail: 'speech', ...T('#3A2E00') }, { text: 'Your text here' }),
      P('l-ribbon-b', 'ribbon-fold', 'Ribbon · blue', { fill: '#2F80ED', stroke: 'transparent', accent: '#1B5DB8', color: '#FFFFFF', strokeWidth: 0, tail: 'speech', ...T('#FFFFFF') }, { text: 'Your text here' }),
      P('l-ribbon-p', 'ribbon-fold', 'Ribbon · pink', { fill: '#EC4899', stroke: 'transparent', accent: '#B8236F', color: '#FFFFFF', strokeWidth: 0, tail: 'speech', ...T('#FFFFFF') }, { text: 'Your text here' }),
      P('l-ribbon-v', 'ribbon-fold', 'Ribbon · purple', { fill: '#8B5CF6', stroke: 'transparent', accent: '#6D3FE0', color: '#FFFFFF', strokeWidth: 0, tail: 'speech', ...T('#FFFFFF') }, { text: 'Your text here' }),
    ],
  },
  {
    id: 'badges', label: 'Badges',
    items: [
      BADGE('b-tip', 'Tip', 'bulb', '#F7F0FF', '#C4A5F5', '#8B5CF6'),
      BADGE('b-info', 'Info', 'info', '#EEF5FF', '#9CC2F7', '#3B82F6'),
      BADGE('b-note', 'Note', 'check', '#EFFAF1', '#93D9A3', '#22A447'),
      BADGE('b-warning', 'Warning', 'warning', '#FFF6EC', '#F7C28F', '#F08C1A'),
      BADGE('b-error', 'Error', 'error', '#FFF1F1', '#F4A3A3', '#E5484D'),
      BADGE('b-important', 'Important', 'star', '#F7F0FF', '#C4A5F5', '#8B5CF6'),
      BADGE('b-action', 'Action', 'flag', '#EEF5FF', '#9CC2F7', '#2563EB'),
      BADGE('b-shortcut', 'Shortcut', 'bolt', '#F1FBEF', '#A6DB98', '#3FA62B'),
      BADGE('b-step', 'Step', 'calendar', '#F6F7F9', '#CBD2DC', '#4B5563'),
      BADGE('b-protip', 'Pro Tip', 'sparkles', '#F7F0FF', '#C4A5F5', '#8B5CF6'),
      BADGE('b-success', 'Success', 'check-filled', '#23A447', 'transparent', '#23A447', '#FFFFFF', true),
      BADGE('b-error2', 'Error', 'error', '#FFE9EA', '#F4A3A3', '#E5484D', '#D23B3F', true),
      BADGE('b-warning2', 'Warning', 'warning', '#FFE98A', '#F2C230', '#F08C1A', '#7A4B00', true),
      BADGE('b-info2', 'Info', 'info', '#DDEBFF', '#8DB8F5', '#2563EB', '#1E58C8', true),
      BADGE('b-protip2', 'Pro Tip', 'star', '#FFFFFF', '#7C3AED', '#7C3AED', '#6D28D9', true),
      BADGE('b-new', 'New', 'sparkles', '#DCF0FF', '#9DD0F7', '#1C64C8', '#1C64C8', true),
    ],
  },
  {
    id: 'frames', label: 'Frames',
    items: [
      P('f-title', 'soft', 'Title frame', { fill: '#F7F3FF', stroke: '#8B5CF6', accent: '#8B5CF6', color: '#374151', radius: 14, strokeWidth: 2.5, tail: 'none', ...T('#111827') }, { title: 'Title', text: 'Description goes here.' }),
      P('f-dashed', 'soft', 'Dashed frame', { fill: '#FCFAFF', stroke: '#8B5CF6', accent: '#8B5CF6', color: '#374151', radius: 14, strokeWidth: 2.5, dash: 'dashed', tail: 'none', ...T('#111827') }, { title: 'Title', text: 'Description goes here.' }),
      P('f-fold', 'fold-note', 'Folded frame', { fill: '#F7F3FF', stroke: '#8B5CF6', accent: '#C9B3F5', color: '#374151', strokeWidth: 2.5, tail: 'none', ...T('#111827') }, { title: 'Title', text: 'Description goes here.' }),
      P('f-side', 'card', 'Side accent frame', { fill: '#F7F3FF', stroke: '#E4DAFB', accent: '#8B5CF6', color: '#374151', radius: 12, strokeWidth: 2, tail: 'none', ...T('#111827') }, { title: 'Title', text: 'Description goes here.' }),
      P('f-glass', 'glass', 'Glass frame', { fill: '#FFFFFFCC', stroke: '#FFFFFFE6', accent: '#4F6BED', color: '#1D2939', radius: 16, strokeWidth: 1, tail: 'none', ...T('#101828') }, { title: 'Title', text: 'Description goes here.' }),
    ],
  },
  {
    id: 'classic', label: 'Classic',
    items: CALLOUT_DESIGNS.map((d) => P(`c-${d.id}`, d.id, d.label, d.patch)),
  },
];

export const ALL_CALLOUT_PRESETS: CalloutPreset[] = CALLOUT_GROUPS.flatMap((g) => g.items);
