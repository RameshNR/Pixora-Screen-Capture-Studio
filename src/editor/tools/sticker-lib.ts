import type { Rect, StickerAnnotation, StickerBadgeStyle } from '../types';
import { viewScale, type Ctx2D } from './common';
import { renderCursor } from './cursor';
import { alpha, shade, shapeGeometry, type ShapeKind } from './shape-lib';

/**
 * Sticker library: emoji (reactions, symbols, people, objects, decorative, seasonal), text badges
 * (NEW burst, 🔥 HOT, 👑 PRO, BETA, UPDATE, 💡 TIP…) and vector icons (check & status, check boxes,
 * toggles, arrows & pointers, shapes & highlights, speech bubbles, devices & UI). Every sticker can
 * have a white die-cut edge with a soft shadow.
 */

export interface StickerDef {
  glyph: string;
  variant: 'emoji' | 'badge' | 'icon';
  /** Colour the sticker starts with (badges and icons). */
  color?: string;
  badgeStyle?: StickerBadgeStyle;
  badgeIcon?: string;
  label?: string;
}

const emoji = (list: string[]): StickerDef[] => list.map((glyph) => ({ glyph, variant: 'emoji' as const }));
const badge = (list: string[]): StickerDef[] => list.map((glyph) => ({ glyph, variant: 'badge' as const }));
const B = (glyph: string, color: string, badgeStyle: StickerBadgeStyle = 'pill', badgeIcon?: string): StickerDef => ({ glyph, variant: 'badge', color, badgeStyle, badgeIcon });
const I = (glyph: string, color: string, label: string): StickerDef => ({ glyph, variant: 'icon', color, label });

/* ------------------------------------ icons ----------------------------------- */

type IconDraw = (ctx: Ctx2D, s: number, color: string) => void;

const circle = (ctx: Ctx2D, s: number, color: string) => {
  const g = ctx.createLinearGradient(0, -s / 2, 0, s / 2);
  g.addColorStop(0, shade(color, 0.22));
  g.addColorStop(1, shade(color, -0.12));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, s * 0.46, 0, Math.PI * 2);
  ctx.fill();
};

const tick = (ctx: Ctx2D, s: number, color: string, w = 0.1) => {
  ctx.strokeStyle = color;
  ctx.lineWidth = s * w;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(-s * 0.2, 0);
  ctx.lineTo(-s * 0.05, s * 0.15);
  ctx.lineTo(s * 0.22, -s * 0.15);
  ctx.stroke();
};

const glyphText = (ctx: Ctx2D, text: string, size: number, color: string, y = 0) => {
  ctx.fillStyle = color;
  ctx.font = `900 ${Math.round(size)}px Inter Variable, Inter, Segoe UI, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 0, y + size * 0.04);
};

const box = (ctx: Ctx2D, s: number, stroke: string, fill: string) => {
  ctx.beginPath();
  ctx.roundRect(-s * 0.38, -s * 0.38, s * 0.76, s * 0.76, s * 0.12);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = s * 0.07;
  ctx.strokeStyle = stroke;
  ctx.stroke();
};

const shapeAt = (ctx: Ctx2D, kind: ShapeKind, s: number, w: number, h: number, fill: string, stroke: string, lw: number, dash: number[] = []) => {
  const g = shapeGeometry(kind, { x: (-s * w) / 2, y: (-s * h) / 2, w: s * w, h: s * h }, s * 0.12);
  ctx.setLineDash(dash);
  if (fill !== 'transparent') {
    ctx.fillStyle = fill;
    ctx.fill(g.outline);
  }
  if (lw > 0) {
    ctx.lineWidth = lw;
    ctx.lineJoin = 'round';
    ctx.strokeStyle = stroke;
    ctx.stroke(g.outline);
  }
  ctx.setLineDash([]);
};

const curvedArrow = (ctx: Ctx2D, s: number, color: string, wobble: boolean) => {
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = s * 0.1;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-s * 0.4, s * 0.25);
  if (wobble) {
    ctx.bezierCurveTo(-s * 0.3, -s * 0.15, -s * 0.15, s * 0.3, 0, 0);
    ctx.bezierCurveTo(s * 0.1, -s * 0.2, s * 0.15, s * 0.1, s * 0.25, -s * 0.1);
  } else ctx.quadraticCurveTo(-s * 0.25, -s * 0.3, s * 0.25, -s * 0.12);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(s * 0.42, -s * 0.12);
  ctx.lineTo(s * 0.16, -s * 0.3);
  ctx.lineTo(s * 0.2, s * 0.05);
  ctx.closePath();
  ctx.fill();
};

const speechText = (ctx: Ctx2D, kind: ShapeKind, s: number, fill: string, stroke: string, text: string) => {
  shapeAt(ctx, kind, s, 1.0, 0.72, fill, stroke, s * 0.045);
  ctx.fillStyle = '#111827';
  ctx.font = `800 ${Math.round(s * 0.18)}px Inter Variable, Inter, Segoe UI, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 0, -s * 0.06);
};

const uiWindow = (ctx: Ctx2D, s: number, color: string, code: boolean) => {
  ctx.beginPath();
  ctx.roundRect(-s * 0.44, -s * 0.34, s * 0.88, s * 0.68, s * 0.07);
  ctx.fillStyle = code ? '#E5E7EB' : '#FFFFFF';
  ctx.fill();
  ctx.lineWidth = s * 0.05;
  ctx.strokeStyle = color;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(-s * 0.44, -s * 0.18);
  ctx.lineTo(s * 0.44, -s * 0.18);
  ctx.stroke();
  ['#EF4444', '#F59E0B', '#22C55E'].forEach((c, i) => {
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.arc(-s * 0.35 + i * s * 0.08, -s * 0.26, s * 0.027, 0, Math.PI * 2);
    ctx.fill();
  });
  if (code) {
    ctx.strokeStyle = color;
    ctx.lineWidth = s * 0.06;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(-s * 0.14, -s * 0.02);
    ctx.lineTo(-s * 0.26, s * 0.08);
    ctx.lineTo(-s * 0.14, s * 0.18);
    ctx.moveTo(s * 0.14, -s * 0.02);
    ctx.lineTo(s * 0.26, s * 0.08);
    ctx.lineTo(s * 0.14, s * 0.18);
    ctx.moveTo(s * 0.05, -s * 0.06);
    ctx.lineTo(-s * 0.05, s * 0.22);
    ctx.stroke();
  }
};

const cursorIcon = (design: 'arrow' | 'hand' | 'gaming', click: 'none' | 'burst' | 'ripple') => (ctx: Ctx2D, s: number, color: string) => {
  renderCursor(ctx, {
    id: 's', type: 'cursor', x: -s * 0.12, y: -s * 0.3, size: s * 0.62, design, color: design === 'gaming' ? color : '#FFFFFF', outline: '#111827',
    click: 'none', clickColor: color, effect: click === 'none' ? 'none' : click, effectColor: color, effectSize: 0.9, opacity: 1,
  });
};

export const STICKER_ICONS: Record<string, IconDraw> = {
  'check-circle': (ctx, s, c) => { circle(ctx, s, c); tick(ctx, s, '#FFFFFF', 0.11); },
  'x-circle': (ctx, s, c) => {
    circle(ctx, s, c);
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = s * 0.1;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-s * 0.15, -s * 0.15);
    ctx.lineTo(s * 0.15, s * 0.15);
    ctx.moveTo(s * 0.15, -s * 0.15);
    ctx.lineTo(-s * 0.15, s * 0.15);
    ctx.stroke();
  },
  'alert-circle': (ctx, s, c) => { circle(ctx, s, c); glyphText(ctx, '!', s * 0.58, '#FFFFFF'); },
  'info-circle': (ctx, s, c) => { circle(ctx, s, c); glyphText(ctx, 'i', s * 0.56, '#FFFFFF'); },
  'question-circle': (ctx, s, c) => { circle(ctx, s, c); glyphText(ctx, '?', s * 0.54, '#FFFFFF'); },
  'box-check': (ctx, s, c) => { box(ctx, s, c, '#FFFFFF'); tick(ctx, s, c, 0.09); },
  'box-empty': (ctx, s, c) => box(ctx, s, c, '#FFFFFF'),
  'box-check-filled': (ctx, s, c) => { box(ctx, s, c, c); tick(ctx, s, '#FFFFFF', 0.09); },
  'box-minus': (ctx, s, c) => {
    box(ctx, s, c, '#FFFFFF');
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.roundRect(-s * 0.2, -s * 0.04, s * 0.4, s * 0.08, s * 0.04);
    ctx.fill();
  },
  'toggle-on': (ctx, s, c) => {
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.roundRect(-s * 0.46, -s * 0.24, s * 0.92, s * 0.48, s * 0.24);
    ctx.fill();
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    ctx.arc(s * 0.22, 0, s * 0.19, 0, Math.PI * 2);
    ctx.fill();
  },
  'toggle-off': (ctx, s, c) => {
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.roundRect(-s * 0.46, -s * 0.24, s * 0.92, s * 0.48, s * 0.24);
    ctx.fill();
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    ctx.arc(-s * 0.22, 0, s * 0.19, 0, Math.PI * 2);
    ctx.fill();
  },
  'arrow-curved': (ctx, s, c) => curvedArrow(ctx, s, c, false),
  'arrow-squiggle': (ctx, s, c) => curvedArrow(ctx, s, c, true),
  'arrow-block': (ctx, s, c) => {
    const p = new Path2D();
    [[-0.42, -0.14], [0.05, -0.14], [0.05, -0.32], [0.44, 0], [0.05, 0.32], [0.05, 0.14], [-0.42, 0.14]].forEach(([x, y], i) => (i ? p.lineTo(x! * s, y! * s) : p.moveTo(x! * s, y! * s)));
    p.closePath();
    ctx.fillStyle = c;
    ctx.fill(p);
    ctx.lineJoin = 'round';
    ctx.lineWidth = s * 0.05;
    ctx.strokeStyle = '#111827';
    ctx.stroke(p);
  },
  'arrow-swoosh': (ctx, s, c) => {
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.moveTo(-s * 0.45, -s * 0.1);
    ctx.quadraticCurveTo(-s * 0.1, s * 0.35, s * 0.25, -s * 0.02);
    ctx.lineTo(s * 0.16, -s * 0.12);
    ctx.lineTo(s * 0.44, -s * 0.18);
    ctx.lineTo(s * 0.36, s * 0.12);
    ctx.lineTo(s * 0.3, s * 0.04);
    ctx.quadraticCurveTo(-s * 0.1, s * 0.48, -s * 0.45, -s * 0.1);
    ctx.fill();
  },
  'arrow-cycle': (ctx, s, c) => {
    ctx.strokeStyle = c;
    ctx.fillStyle = c;
    ctx.lineWidth = s * 0.08;
    ctx.lineCap = 'round';
    for (const off of [0, Math.PI]) {
      ctx.beginPath();
      ctx.arc(0, 0, s * 0.32, off + 0.25, off + Math.PI - 0.35);
      ctx.stroke();
      const t = off + Math.PI - 0.35;
      const x = Math.cos(t) * s * 0.32;
      const y = Math.sin(t) * s * 0.32;
      ctx.beginPath();
      ctx.moveTo(x + Math.cos(t - Math.PI / 2) * s * 0.02 - Math.sin(t) * s * 0.11, y + Math.sin(t - Math.PI / 2) * s * 0.02 + Math.cos(t) * s * 0.11);
      ctx.lineTo(x + Math.cos(t + Math.PI / 2) * s * 0.16, y + Math.sin(t + Math.PI / 2) * s * 0.16);
      ctx.lineTo(x + Math.sin(t) * s * 0.11, y - Math.cos(t) * s * 0.11);
      ctx.closePath();
      ctx.fill();
    }
  },
  'cursor-rays': cursorIcon('arrow', 'burst'),
  'cursor-hand': cursorIcon('hand', 'none'),
  'cursor-tap': cursorIcon('hand', 'ripple'),
  'cursor-red': cursorIcon('gaming', 'none'),
  'cursor-click': cursorIcon('arrow', 'burst'),
  'shape-ellipse': (ctx, s, c) => shapeAt(ctx, 'ellipse', s, 0.9, 0.55, 'transparent', c, s * 0.07),
  'shape-brush': (ctx, s, c) => shapeAt(ctx, 'brush', s, 0.95, 0.4, c, c, 0),
  'shape-sketch': (ctx, s, c) => {
    ctx.strokeStyle = c;
    ctx.lineWidth = s * 0.05;
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.rect(-s * 0.42 + i * s * 0.015, -s * 0.24 - i * s * 0.012, s * 0.84, s * 0.48);
      ctx.stroke();
    }
  },
  'shape-dashed': (ctx, s, c) => shapeAt(ctx, 'rounded', s, 0.88, 0.56, 'transparent', c, s * 0.05, [s * 0.09, s * 0.06]),
  'shape-rect': (ctx, s, c) => shapeAt(ctx, 'rect', s, 0.88, 0.56, 'transparent', c, s * 0.06),
  'shape-rounded': (ctx, s, c) => shapeAt(ctx, 'rounded', s, 0.88, 0.56, alpha(c, 0.35), c, s * 0.05),
  'shape-circle': (ctx, s, c) => shapeAt(ctx, 'ellipse', s, 0.72, 0.72, 'transparent', c, s * 0.06),
  'shape-cloud': (ctx, s, c) => shapeAt(ctx, 'cloud', s, 0.95, 0.65, 'transparent', c, s * 0.05),
  'shape-star': (ctx, s, c) => shapeAt(ctx, 'star', s, 0.85, 0.82, c, shade(c, -0.3), s * 0.04),
  'speech-round': (ctx, s, c) => shapeAt(ctx, 'speech-round', s, 0.9, 0.75, '#FFFFFF', c, s * 0.06),
  'speech-cloud': (ctx, s, c) => shapeAt(ctx, 'speech-cloud', s, 0.95, 0.75, '#FFFFFF', c, s * 0.05),
  'speech-burst': (ctx, s, c) => shapeAt(ctx, 'burst', s, 0.95, 0.8, '#FFFFFF', c, s * 0.05),
  'speech-thought': (ctx, s, c) => shapeAt(ctx, 'thought', s, 0.95, 0.75, '#FFFFFF', c, s * 0.05),
  'speech-square': (ctx, s, c) => shapeAt(ctx, 'speech-rect', s, 0.9, 0.72, '#FFFFFF', c, s * 0.05),
  'step-1': (ctx, s, c) => speechText(ctx, 'speech-round', s, alpha(c, 0.18), c, 'Step 1'),
  'step-2': (ctx, s, c) => speechText(ctx, 'speech-rect', s, alpha(c, 0.25), c, 'Step 2'),
  'step-3': (ctx, s, c) => speechText(ctx, 'speech-cloud', s, alpha(c, 0.22), c, 'Step 3'),
  'quote-box': (ctx, s, c) => {
    shapeAt(ctx, 'rounded', s, 0.9, 0.6, '#FFFFFF', c, s * 0.05);
    glyphText(ctx, '“', s * 0.4, c, -s * 0.3);
    ctx.fillStyle = c;
    [0.28, 0.5].forEach((w, i) => ctx.fillRect(-s * 0.25, -s * 0.02 + i * s * 0.12, s * w * 1.4, s * 0.04));
  },
  browser: (ctx, s, c) => uiWindow(ctx, s, c, false),
  'code-window': (ctx, s, c) => uiWindow(ctx, s, c, true),
};

/* ----------------------------------- library ---------------------------------- */

/** Sticker sheet groups (new premium sheet first, then the earlier developer / designer / editor sets). */
export const STICKER_GROUPS: Array<{ id: string; label: string; items: StickerDef[] }> = [
  { id: 'emoji', label: 'Emojis & reactions', items: emoji(['👍', '❤️', '👏', '🔥', '😎', '😍', '😂', '😮', '🤔', '🎉', '🙂', '😢', '😡', '🙏', '💯', '👀']) },
  {
    id: 'badges', label: 'Badges & labels',
    items: [
      B('NEW', '#EF4444', 'burst'), B('HOT', '#EF4444', 'pill', '🔥'), B('PRO', '#7C3AED', 'pill', '👑'), B('BETA', '#2563EB', 'pill'),
      B('UPDATE', '#2563EB', 'tilted'), B('TIP', '#FACC15', 'pill', '💡'), B('NOTE', '#16A34A', 'tilted'), B('IMPORTANT', '#EF4444', 'tilted'),
      B('Beta', '#7C3AED', 'soft'), B('New', '#EF4444', 'pill'), B('Free', '#16A34A', 'pill'), B('Hot', '#F97316', 'soft', '🔥'),
      B('Update', '#0EA5E9', 'soft', '🔄'), B('AI', '#A855F7', 'soft', '✨'), B('v2.0', '#7C3AED', 'outline'),
    ],
  },
  {
    id: 'status', label: 'Check & status',
    items: [
      I('check-circle', '#22C55E', 'Done'), I('x-circle', '#EF4444', 'Wrong'), I('alert-circle', '#F59E0B', 'Warning'), I('info-circle', '#3B82F6', 'Info'), I('question-circle', '#A855F7', 'Question'),
      I('box-check', '#22C55E', 'Checked box'), I('box-empty', '#9CA3AF', 'Empty box'), I('box-check-filled', '#3B82F6', 'Ticked box'), I('box-minus', '#7C3AED', 'Partly checked'),
      I('toggle-on', '#22C55E', 'Toggle on'), I('toggle-off', '#D1D5DB', 'Toggle off'),
    ],
  },
  {
    id: 'arrows', label: 'Arrows & pointers',
    items: [
      I('arrow-curved', '#EF4444', 'Curved arrow'), I('arrow-block', '#FACC15', 'Block arrow'), I('arrow-swoosh', '#3B82F6', 'Swoosh arrow'), I('arrow-squiggle', '#9333EA', 'Squiggle arrow'), I('arrow-cycle', '#7C3AED', 'Cycle'),
      I('cursor-rays', '#111827', 'Click'), I('cursor-hand', '#111827', 'Hand pointer'), I('cursor-tap', '#EF4444', 'Tap'), I('cursor-red', '#E11D48', 'Red cursor'), I('cursor-click', '#64748B', 'Cursor click'),
    ],
  },
  {
    id: 'shapes', label: 'Shapes & highlights',
    items: [
      I('shape-ellipse', '#EF4444', 'Red circle'), I('shape-brush', '#FACC15', 'Yellow brush'), I('shape-sketch', '#9333EA', 'Sketch box'), I('shape-dashed', '#3B82F6', 'Dashed box'), I('shape-rect', '#1E3A8A', 'Box'),
      I('shape-rounded', '#38BDF8', 'Soft box'), I('shape-circle', '#7C3AED', 'Ring'), I('shape-cloud', '#A855F7', 'Cloud'), I('shape-star', '#FACC15', 'Star'),
    ],
  },
  {
    id: 'speech', label: 'Callouts & speech',
    items: [
      I('speech-round', '#1E3A8A', 'Speech'), I('speech-cloud', '#A855F7', 'Cloud speech'), I('speech-burst', '#EF4444', 'Shout'), I('speech-thought', '#38BDF8', 'Thought'), I('speech-square', '#7C3AED', 'Square speech'),
      I('step-1', '#3B82F6', 'Step 1'), I('step-2', '#FACC15', 'Step 2'), I('step-3', '#EC4899', 'Step 3'), I('quote-box', '#7C3AED', 'Quote'),
    ],
  },
  { id: 'symbols', label: 'Symbols & icons', items: emoji(['💡', '🎯', '🚀', '⭕', '🏆', '⭐', '🚩', '📅', '🔔', '⚙️', '📌', '✨', '⚠️', '❗', '❓', '🔒']) },
  { id: 'people', label: 'People & expressions', items: emoji(['🧑‍💻', '👩‍💻', '👨‍💼', '👩‍🏫', '🙋‍♀️', '🤷‍♂️', '🙋', '💁', '🧑‍🎨', '👨‍🔧', '👍', '👌', '✌️', '🤝', '👋', '💪']) },
  { id: 'devices', label: 'Devices & UI', items: [...emoji(['💻', '🖥️', '📱', '⌨️', '🖱️', '🖨️']), I('browser', '#111827', 'Browser window'), I('code-window', '#111827', 'Code window')] },
  { id: 'objects', label: 'Objects & everyday', items: emoji(['📋', '📄', '📁', '🔍', '🔒', '🔗', '📎', '✉️', '📩', '🗑️', '📦', '🧾', '📊', '🕒', '🔑', '🛒']) },
  { id: 'decor', label: 'Decorative & fun', items: emoji(['👑', '🎁', '🎉', '💕', '🌈', '✨', '⚡', '💎', '🎆', '🎊', '🦄', '🌟', '💫', '🍀', '🎈', '🪄']) },
  { id: 'seasonal', label: 'Seasonal & special', items: emoji(['🎂', '🎄', '🎃', '🎅', '🎓', '🎗️', '💓', '☘️', '🎆', '❄️', '🐣', '🪔', '🧧', '🌸', '☀️', '🍂']) },
  {
    id: 'developer', label: 'Developer',
    items: [
      ...emoji(['🐞', '🐛', '💻', '🖥️', '⌨️', '🖱️', '🧪', '🔧', '🛠️', '⚙️', '📦', '🔗', '🧩', '🗄️', '☁️', '🔑', '🛡️', '📡', '🧵', '♻️', '🚧', '🔥', '⚡', '🧠']),
      ...badge(['API', 'JS', 'TS', 'CSS', 'HTML', 'SQL', 'JSON', '200 OK', '404', '500', 'DEBUG', 'ERROR', 'WARN', 'INFO', 'DEPRECATED', 'BREAKING', 'HOTFIX', 'PR', 'MERGED', 'LGTM']),
    ],
  },
  {
    id: 'designer', label: 'Designer',
    items: [
      ...emoji(['🎨', '🖌️', '🖍️', '✏️', '📐', '📏', '🧭', '🔍', '🖼️', '🌈', '💎', '🪄', '📱', '💬', '🗯️', '🔤', '🅰️', '⬛', '🟦', '🟥', '🟩', '🟨']),
      ...badge(['UI', 'UX', 'SPACING', 'ALIGN', 'CONTRAST', 'FONT', 'COLOR', 'ICON', 'MOBILE', 'DESKTOP', 'A11Y', 'PIXEL', '8PX', 'GRID']),
    ],
  },
  {
    id: 'editor', label: 'Editor',
    items: [
      ...emoji(['📝', '✂️', '📋', '📄', '📑', '🗂️', '📁', '🔖', '🏷️', '📸', '🎬', '🎞️', '🎧', '🎙️', '🔊', '🔇', '⏪', '⏩', '⏯️', '🔁', '🔀', '➕', '➖', '✔️']),
      ...badge(['EDIT', 'CUT', 'KEEP', 'DELETE', 'MOVE', 'TYPO', 'REWRITE', 'CHECK', 'SOURCE', 'DRAFT', 'FINAL', 'v1', 'v2', 'UPDATED']),
    ],
  },
  { id: 'review', label: 'Status words', items: badge(['NEW', 'BUG', 'FIX', 'TODO', 'DONE', 'WIP', 'OK', 'NOTE', 'IMPORTANT', 'BEFORE', 'AFTER', 'REVIEW', 'APPROVED', 'REJECTED', 'PENDING', 'BLOCKED', 'QA', 'BETA', 'P0', 'P1', 'P2', 'SHIPPED']) },
];

export const STICKERS: StickerDef[] = STICKER_GROUPS.flatMap((g) => g.items);

/** Same sticker (the same glyph can be both an emoji and a status word, or a badge in two styles). */
export function sameSticker(a: Pick<StickerDef, 'glyph' | 'variant' | 'badgeStyle'>, b: Pick<StickerDef, 'glyph' | 'variant' | 'badgeStyle'>): boolean {
  return a.glyph === b.glyph && a.variant === b.variant && (a.badgeStyle ?? 'pill') === (b.badgeStyle ?? 'pill');
}

export function stickerIconLabel(id: string): string {
  return STICKERS.find((s) => s.variant === 'icon' && s.glyph === id)?.label ?? 'Icon';
}

/* ------------------------------------ drawing --------------------------------- */

/**
 * Draws `draw` with a white die-cut edge and a soft shadow: renders the art into a layer, builds a
 * white silhouette, spreads it around the art, then puts the art on top.
 */
export function drawCutout(ctx: Ctx2D, b: Rect, edge: number, draw: (l: Ctx2D) => void): void {
  if (typeof OffscreenCanvas === 'undefined') {
    draw(ctx);
    return;
  }
  let k = Math.max(1, viewScale(ctx));
  const pad = edge * 2 + 4;
  const bw = b.w + pad * 2;
  const bh = b.h + pad * 2;
  k = Math.min(k, 4096 / Math.max(bw, bh, 1));
  const W = Math.max(1, Math.ceil(bw * k));
  const H = Math.max(1, Math.ceil(bh * k));
  const art = new OffscreenCanvas(W, H);
  const a = art.getContext('2d');
  const sil = new OffscreenCanvas(W, H);
  const s = sil.getContext('2d');
  if (!a || !s) {
    draw(ctx);
    return;
  }
  a.scale(k, k);
  a.translate(-(b.x - pad), -(b.y - pad));
  draw(a);
  // White silhouette, grown by stamping the art's shape around a circle.
  const e = edge * k;
  for (let i = 0; i < 16; i++) {
    const t = (i / 16) * Math.PI * 2;
    s.drawImage(art, Math.cos(t) * e, Math.sin(t) * e);
  }
  s.drawImage(art, 0, 0);
  s.globalCompositeOperation = 'source-in';
  s.fillStyle = '#FFFFFF';
  s.fillRect(0, 0, W, H);
  ctx.save();
  ctx.shadowColor = 'rgba(15,23,42,0.28)';
  ctx.shadowBlur = edge * 1.6 * k;
  ctx.shadowOffsetY = edge * 0.5 * k;
  ctx.drawImage(sil, b.x - pad, b.y - pad, W / k, H / k);
  ctx.restore();
  ctx.drawImage(art, b.x - pad, b.y - pad, W / k, H / k);
}

export function drawStickerIcon(ctx: Ctx2D, a: StickerAnnotation): void {
  const draw = STICKER_ICONS[a.glyph];
  if (!draw) return;
  ctx.save();
  ctx.translate(a.x, a.y);
  draw(ctx, a.size, a.color);
  ctx.restore();
}
