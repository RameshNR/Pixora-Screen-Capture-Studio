import type { DashStyle, HeadStyle, LineBody } from '../types';

/** Line & arrow presets — each is a combination of design, heads, dash and number of bend points. */
export type LinePatch = { headStart: HeadStyle; headEnd: HeadStyle; dash: DashStyle; bends: number; body: LineBody };
const L = (headStart: HeadStyle, headEnd: HeadStyle, body: LineBody = 'line', dash: DashStyle = 'solid', bends = 0): LinePatch => ({ headStart, headEnd, dash, bends, body });
export const LINE_PRESETS: Array<{ id: string; label: string; patch: LinePatch }> = [
  { id: 'line', label: 'Line', patch: L('none', 'none') },
  { id: 'arrow', label: 'Arrow', patch: L('none', 'triangle') },
  { id: 'big', label: 'Big head', patch: L('none', 'big') },
  { id: 'pointer', label: 'Pointer', patch: L('none', 'triangle', 'pointer') },
  { id: 'open', label: 'Line arrow', patch: L('none', 'open') },
  { id: 'chevron', label: 'Chevron', patch: L('none', 'chevron') },
  { id: 'round', label: 'Rounded', patch: L('none', 'round') },
  { id: 'double', label: 'Double', patch: L('triangle', 'triangle') },
  { id: 'twin', label: 'Twin head', patch: L('none', 'twin') },
  { id: 'twin-open', label: 'Fast »', patch: L('none', 'twin-open') },
  { id: 'feather', label: 'Feathered', patch: L('feather', 'triangle') },
  { id: 'harpoon', label: 'Harpoon', patch: L('none', 'harpoon') },
  { id: 'block', label: 'Block', patch: L('none', 'triangle', 'block') },
  { id: 'outline', label: 'Outline', patch: L('none', 'triangle', 'outline') },
  { id: 'block-double', label: 'Block ⇄', patch: L('triangle', 'triangle', 'block') },
  { id: 'tapered', label: 'Tapered', patch: L('none', 'triangle', 'tapered') },
  { id: 'double-line', label: 'Double line', patch: L('none', 'open', 'double') },
  { id: 'chevrons', label: 'Chevrons', patch: L('none', 'chevron', 'chevrons') },
  { id: 'dash-tail', label: 'Dash tail', patch: L('none', 'triangle', 'dash-tail') },
  { id: 'dashed', label: 'Dashed', patch: L('none', 'open', 'line', 'dashed') },
  { id: 'dotted', label: 'Dotted', patch: L('circle', 'circle', 'line', 'dotted') },
  { id: 'curved', label: 'Curved', patch: L('none', 'triangle', 'line', 'solid', 1) },
  { id: 's-curve', label: 'S-curve', patch: L('none', 'triangle', 'line', 'solid', 2) },
  { id: 'wave', label: 'Wave', patch: L('none', 'open', 'line', 'solid', 4) },
  { id: 'measure', label: 'Measure', patch: L('bar', 'bar') },
  { id: 'ring', label: 'Pin', patch: L('ring', 'triangle') },
  { id: 'square', label: 'Square ends', patch: L('square', 'square') },
  { id: 'diamond', label: 'Diamond', patch: L('diamond', 'triangle') },
  { id: 'block-curve', label: 'Curved block', patch: L('none', 'triangle', 'block', 'solid', 1) },
  { id: 'stealth', label: 'Stealth', patch: L('none', 'stealth') },
  { id: 'notched', label: 'Notched', patch: L('none', 'triangle', 'notched') },
  { id: 'triple', label: 'Triple ›››', patch: L('none', 'triple') },
  { id: 'curved-head', label: 'Bowed »', patch: L('none', 'curved') },
  { id: 'echo', label: 'Echo', patch: L('none', 'echo') },
  { id: 'framed', label: 'Framed', patch: L('none', 'framed') },
  { id: 'dots', label: 'Dot trail', patch: L('none', 'chevron', 'dots') },
  { id: 'squares', label: 'Square trail', patch: L('none', 'triangle', 'squares') },
  { id: 'bars', label: 'Bar trail', patch: L('none', 'triangle', 'bars') },
  { id: 'loop', label: 'Loop', patch: L('none', 'open', 'loop') },
  { id: 'triple-line', label: 'Triple line', patch: L('none', 'open', 'triple') },
  { id: 'stealth-curve', label: 'Swoosh', patch: L('none', 'stealth', 'tapered', 'solid', 1) },
];

/** Ready-made coloured arrows and connectors (pointer arrows, connector lines, elbow, outlined block). */
export type PremiumLine = LinePatch & { color: string; width: number; route?: 'elbow'; outline?: string };
const PL = (id: string, label: string, color: string, width: number, patch: LinePatch, extra: Partial<PremiumLine> = {}) => ({ id, label, patch: { ...patch, color, width, ...extra } as PremiumLine });
export const PREMIUM_LINES: Array<{ id: string; label: string; patch: PremiumLine }> = [
  PL('pl-block', 'Purple block', '#7C3AED', 24, L('none', 'triangle', 'block')),
  PL('pl-curve', 'Purple curve', '#7C3AED', 7, L('none', 'open', 'line', 'solid', 1)),
  PL('pl-dashed', 'Purple dashed', '#7C3AED', 6, L('none', 'open', 'line', 'dashed')),
  PL('pl-hook', 'Purple hook', '#6D3FE0', 7, L('none', 'chevron', 'line', 'solid', 1)),
  PL('pl-orange', 'Orange block', '#F59E0B', 24, L('none', 'triangle', 'block')),
  PL('pl-ocurve', 'Orange curve', '#F59E0B', 7, L('none', 'open', 'line', 'solid', 1)),
  PL('pl-red', 'Red swoosh', '#E5484D', 8, L('none', 'stealth', 'tapered', 'solid', 1)),
  PL('pl-pointer', 'Red pointer', '#FF0000', 14, L('none', 'triangle', 'pointer')),
  PL('pl-loop', 'Purple loop', '#7C3AED', 6, L('none', 'open', 'loop')),
  PL('pl-dots', 'Dot connector', '#7C3AED', 6, L('circle', 'circle')),
  PL('pl-rings', 'Ring connector', '#7C3AED', 5, L('ring', 'ring', 'line', 'dashed')),
  PL('pl-elbow', 'Elbow connector', '#7C3AED', 6, L('circle', 'circle'), { route: 'elbow' }),
  PL('pl-curvedots', 'Curved connector', '#7C3AED', 6, L('circle', 'circle', 'line', 'solid', 1)),
  PL('pl-yellow', 'Yellow outlined', '#FFD21F', 28, L('none', 'triangle', 'block'), { outline: '#111827' }),
  PL('pl-chev', 'Double chevron', '#8B5CF6', 12, L('none', 'twin-open')),
  PL('pl-dotted', 'Blue dotted', '#2D9CDB', 6, L('none', 'triangle', 'line', 'dotted')),
  PL('pl-elbowarrow', 'Elbow arrow', '#6D3FE0', 7, L('none', 'triangle'), { route: 'elbow' }),
  PL('pl-navy', 'Navy curve', '#3B2AA8', 7, L('none', 'triangle', 'line', 'solid', 1)),
  PL('pl-navydash', 'Dashed curve', '#1D2433', 5, L('none', 'triangle', 'line', 'dashed', 1)),
];

