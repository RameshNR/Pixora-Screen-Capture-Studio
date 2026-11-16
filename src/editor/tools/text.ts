import type { Rect, TextAnnotation, TextPart, TextStyle } from '../types';
import { dashPattern, getMeasureContext, makePaint, viewScale, type Ctx2D } from './common';
import { alpha, shade, shapeGeometry } from './shape-lib';

export const TEXT_PADDING = 0.3; // × fontSize, default space around text with a background or border
export const LINE_HEIGHT = 1.25;

export function fontString(a: Pick<TextStyle, 'bold' | 'italic' | 'fontSize' | 'fontFamily'>): string {
  return `${a.italic ? 'italic ' : ''}${a.bold ? '700' : '400'} ${a.fontSize}px ${a.fontFamily}`;
}

/** The text as displayed (upper-cased when the style asks for it). */
export function displayText(text: string, style: Pick<TextStyle, 'caps'>): string {
  return style.caps ? text.toUpperCase() : text;
}

function applyFont(ctx: Ctx2D, style: TextStyle): void {
  ctx.font = fontString(style);
  (ctx as CanvasRenderingContext2D).letterSpacing = `${style.letterSpacing ?? 0}px`;
}

export interface TextLayout {
  lines: string[];
  lineWidths: number[];
  width: number;
  height: number;
}

function measureLines(lines: string[], style: TextStyle, ctx?: Ctx2D | null): number[] {
  const m = ctx ?? getMeasureContext();
  if (!m) return lines.map((l) => Math.max(1, l.length) * style.fontSize * 0.55 + (style.letterSpacing ?? 0) * l.length);
  m.save();
  applyFont(m, style);
  const out = lines.map((l) => m.measureText(l || ' ').width);
  m.restore();
  return out;
}

export function layoutText(a: { text: string } & TextStyle, ctx?: Ctx2D | null): TextLayout {
  const lines = displayText(a.text, a).split('\n');
  const lineWidths = measureLines(lines, a, ctx);
  return { lines, lineWidths, width: Math.max(...lineWidths, a.fontSize * 0.5), height: lines.length * a.fontSize * LINE_HEIGHT };
}

/** Word-wraps text to a maximum width (explicit line breaks are kept). */
export function wrapText(text: string, style: TextStyle, maxWidth: number, ctx?: Ctx2D | null): TextLayout {
  const out: string[] = [];
  for (const para of displayText(text, style).split('\n')) {
    const words = para.split(/(\s+)/);
    let line = '';
    for (const word of words) {
      const candidate = line + word;
      if (line && measureLines([candidate.trimEnd()], style, ctx)[0]! > maxWidth) {
        out.push(line.trimEnd());
        line = word.trimStart();
      } else {
        line = candidate;
      }
    }
    out.push(line.trimEnd());
  }
  const lineWidths = measureLines(out, style, ctx);
  return { lines: out, lineWidths, width: Math.max(...lineWidths, 1), height: out.length * style.fontSize * LINE_HEIGHT };
}

/**
 * Draws laid-out lines with every text effect: outline, shadow, underline and strike-through.
 * `boxWidth` is the width alignment is computed in.
 */
export function drawTextLines(ctx: Ctx2D, l: TextLayout, style: TextStyle, x: number, y: number, boxWidth: number, autoShadow = false): void {
  ctx.save();
  applyFont(ctx, style);
  ctx.fillStyle = style.color;
  ctx.textBaseline = 'top';
  const fs = style.fontSize;
  const shadow = style.shadow ?? autoShadow;
  // Canvas shadows are in device pixels: scale them with the view so exports match the screen.
  const k = viewScale(ctx);
  const setShadow = () => {
    if (!shadow) return;
    ctx.shadowColor = alpha(style.shadowColor ?? '#000000', style.shadowOpacity ?? 0.3);
    ctx.shadowBlur = (style.shadowBlur ?? Math.max(2, fs * 0.12)) * k;
    ctx.shadowOffsetX = (style.shadowX ?? 0) * k;
    ctx.shadowOffsetY = (style.shadowY ?? Math.max(1, fs * 0.04)) * k;
  };
  setShadow();
  const outline = style.outlineWidth ?? 0;
  const depth = Math.max(0, style.extrude ?? 0);
  l.lines.forEach((line, i) => {
    const lw = l.lineWidths[i]!;
    const dx = style.align === 'center' ? (boxWidth - lw) / 2 : style.align === 'right' ? boxWidth - lw : 0;
    const ty = y + i * fs * LINE_HEIGHT + fs * 0.1;
    if (depth > 0) {
      // 3D: stacked copies down-right in the side colour (shadow only under the deepest one).
      ctx.save();
      ctx.fillStyle = style.extrudeColor ?? shade(style.color, -0.45);
      ctx.strokeStyle = style.outlineColor ?? '#FFFFFF';
      ctx.lineJoin = 'round';
      ctx.lineWidth = outline * 2;
      const step = Math.max(0.5, depth / Math.ceil(depth));
      for (let d = depth; d > 0; d -= step) {
        if (outline > 0) ctx.strokeText(line, x + dx + d, ty + d);
        ctx.fillText(line, x + dx + d, ty + d);
        ctx.shadowColor = 'transparent';
      }
      ctx.restore();
      ctx.shadowColor = 'transparent';
    }
    if (outline > 0) {
      ctx.save();
      ctx.lineJoin = 'round';
      ctx.lineWidth = outline * 2;
      ctx.strokeStyle = style.outlineColor ?? '#FFFFFF';
      if (style.outlineDash && style.outlineDash !== 'solid') ctx.setLineDash(dashPattern(style.outlineDash, outline));
      ctx.strokeText(line, x + dx, ty);
      ctx.restore();
      ctx.shadowColor = 'transparent';
    }
    if (style.gradient) {
      const g = ctx.createLinearGradient(x + dx, ty, x + dx + lw, ty + fs);
      g.addColorStop(0, style.gradient[0]);
      g.addColorStop(1, style.gradient[1]);
      ctx.fillStyle = g;
    }
    ctx.fillText(line, x + dx, ty);
    ctx.fillStyle = style.color;
    if ((style.underline || style.strike) && line) {
      const th = Math.max(1, fs * 0.07);
      if (style.underline) ctx.fillRect(x + dx, ty + fs * 0.98, lw, th);
      if (style.strike) ctx.fillRect(x + dx, ty + fs * 0.52, lw, th);
    }
  });
  ctx.restore();
}

/* ----------------------------------- text ----------------------------------- */

export function hasBox(a: Pick<TextAnnotation, 'background' | 'borderWidth'> & { deco?: TextAnnotation['deco'] }): boolean {
  return a.background !== 'transparent' || (a.borderWidth ?? 0) > 0 || (!!a.deco && a.deco !== 'none');
}

/** How far a decoration reaches beyond the text box (left, top, right, bottom), in px. */
function decoReach(a: TextAnnotation): [number, number, number, number] {
  const f = a.fontSize;
  switch (a.deco) {
    case 'brush': case 'tape': return [f * 0.35, f * 0.2, f * 0.35, f * 0.2];
    case 'brush-under': return [f * 0.3, 0, f * 0.3, f * 0.15];
    case 'banner': case 'ribbon': return [f * 0.7, f * 0.15, f * 0.7, f * 0.15];
    case 'burst': return [f * 0.9, f * 0.9, f * 0.9, f * 0.9];
    case 'swash': return [f * 0.1, 0, f * 0.2, f * 0.45];
    case 'ring': return [f * 0.5, f * 0.35, f * 0.5, f * 0.35];
    case 'speech': case 'cloud': return [f * 0.3, f * 0.3, f * 0.3, f * 0.8];
    case 'chevron': return [f * 0.2, 0, f * 0.7, 0];
    case 'megaphone': return [f * 1.7, f * 0.1, f * 0.1, f * 0.1];
    case 'bar': return [f * 0.5, 0, 0, 0];
    case 'tilted-box': return [f * 0.2, f * 0.25, f * 0.2, f * 0.25];
    default: return [0, 0, 0, 0];
  }
}

/** Draws the decorative design behind the text block (`r` is the padded text box). */
function drawDeco(ctx: Ctx2D, a: TextAnnotation, r: Rect): void {
  const d = a.deco;
  if (!d || d === 'none') return;
  const f = a.fontSize;
  const c1 = a.decoColor ?? '#FACC15';
  const c2 = a.decoColor2 ?? shade(c1, 0.35);
  const grad = (x0: number, x1: number) => {
    const g = ctx.createLinearGradient(x0, r.y, x1, r.y + r.h);
    g.addColorStop(0, c1);
    g.addColorStop(1, c2);
    return g;
  };
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  switch (d) {
    case 'brush':
      ctx.fillStyle = c1;
      ctx.fill(shapeGeometry('brush', { x: r.x - f * 0.35, y: r.y - f * 0.2, w: r.w + f * 0.7, h: r.h + f * 0.4 }).outline);
      break;
    case 'brush-under':
      ctx.fillStyle = c1;
      ctx.fill(shapeGeometry('brush', { x: r.x - f * 0.3, y: r.y + r.h * 0.5, w: r.w + f * 0.6, h: r.h * 0.5 + f * 0.15 }).outline);
      break;
    case 'banner': {
      const s = f * 0.25;
      const n = f * 0.45;
      ctx.fillStyle = grad(r.x, r.x + r.w);
      ctx.beginPath();
      ctx.moveTo(r.x - n - f * 0.25 + s, r.y - f * 0.15);
      ctx.lineTo(r.x + r.w + n + f * 0.25 + s, r.y - f * 0.15);
      ctx.lineTo(r.x + r.w + f * 0.25 + s * 0.2, r.y + r.h / 2);
      ctx.lineTo(r.x + r.w + n + f * 0.25 - s, r.y + r.h + f * 0.15);
      ctx.lineTo(r.x - n - f * 0.25 - s, r.y + r.h + f * 0.15);
      ctx.lineTo(r.x - f * 0.25 - s * 0.2, r.y + r.h / 2);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'ribbon': {
      const n = f * 0.4;
      ctx.fillStyle = c1;
      ctx.beginPath();
      ctx.moveTo(r.x - f * 0.7, r.y - f * 0.1);
      ctx.lineTo(r.x + r.w + f * 0.7, r.y - f * 0.1);
      ctx.lineTo(r.x + r.w + f * 0.7 - n, r.y + r.h / 2);
      ctx.lineTo(r.x + r.w + f * 0.7, r.y + r.h + f * 0.1);
      ctx.lineTo(r.x - f * 0.7, r.y + r.h + f * 0.1);
      ctx.lineTo(r.x - f * 0.7 + n, r.y + r.h / 2);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'burst': {
      const g = shapeGeometry('burst', { x: r.x - f * 0.9, y: r.y - f * 0.9, w: r.w + f * 1.8, h: r.h + f * 1.8 });
      ctx.fillStyle = c1;
      ctx.fill(g.outline);
      ctx.lineWidth = Math.max(1.5, f * 0.07);
      ctx.strokeStyle = a.decoColor2 ?? '#111827';
      ctx.stroke(g.outline);
      break;
    }
    case 'swash': {
      ctx.strokeStyle = c1;
      ctx.lineWidth = Math.max(2, f * 0.13);
      ctx.beginPath();
      ctx.moveTo(r.x + r.w * 0.04, r.y + r.h + f * 0.12);
      ctx.quadraticCurveTo(r.x + r.w * 0.55, r.y + r.h - f * 0.05, r.x + r.w + f * 0.15, r.y + r.h + f * 0.02);
      ctx.stroke();
      ctx.lineWidth = Math.max(1.5, f * 0.07);
      ctx.beginPath();
      ctx.moveTo(r.x + r.w * 0.15, r.y + r.h + f * 0.32);
      ctx.quadraticCurveTo(r.x + r.w * 0.6, r.y + r.h + f * 0.12, r.x + r.w * 0.95, r.y + r.h + f * 0.22);
      ctx.stroke();
      break;
    }
    case 'ring': {
      ctx.strokeStyle = c1;
      ctx.lineWidth = Math.max(2, f * 0.08);
      const cx = r.x + r.w / 2;
      const cy = r.y + r.h / 2;
      ctx.beginPath();
      ctx.ellipse(cx, cy, r.w / 2 + f * 0.45, r.h / 2 + f * 0.3, -0.04, Math.PI * 0.05, Math.PI * 2.08);
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(cx + f * 0.05, cy - f * 0.03, r.w / 2 + f * 0.38, r.h / 2 + f * 0.24, 0.03, Math.PI * 1.1, Math.PI * 1.7);
      ctx.stroke();
      break;
    }
    case 'tape': {
      ctx.fillStyle = alpha(c1, 0.92);
      const t = f * 0.16;
      const R = { x: r.x - f * 0.35, y: r.y - f * 0.2, w: r.w + f * 0.7, h: r.h + f * 0.4 };
      ctx.beginPath();
      ctx.moveTo(R.x, R.y);
      ctx.lineTo(R.x + R.w, R.y);
      for (let i = 1; i <= 4; i++) ctx.lineTo(R.x + R.w + (i % 2 ? -t : 0), R.y + (R.h / 4) * i);
      ctx.lineTo(R.x, R.y + R.h);
      for (let i = 3; i >= 0; i--) ctx.lineTo(R.x + (i % 2 ? t : 0), R.y + (R.h / 4) * i);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'tilted-box': {
      ctx.strokeStyle = c1;
      ctx.lineWidth = Math.max(1.5, f * 0.07);
      ctx.translate(r.x + r.w / 2, r.y + r.h / 2);
      ctx.rotate(-0.03);
      ctx.beginPath();
      ctx.roundRect(-r.w / 2 - f * 0.15, -r.h / 2 - f * 0.15, r.w + f * 0.3, r.h + f * 0.3, f * 0.12);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(r.w / 2 + f * 0.05, r.h / 2 - f * 0.25);
      ctx.lineTo(r.w / 2 - f * 0.25, r.h / 2 + f * 0.05);
      ctx.stroke();
      break;
    }
    case 'bar':
      ctx.fillStyle = c1;
      ctx.beginPath();
      ctx.roundRect(r.x - f * 0.45, r.y, Math.max(2, f * 0.16), r.h, f * 0.08);
      ctx.fill();
      break;
    case 'pill-gradient':
      ctx.fillStyle = grad(r.x, r.x + r.w);
      ctx.beginPath();
      ctx.roundRect(r.x, r.y, r.w, r.h, r.h / 2);
      ctx.fill();
      break;
    case 'pill-dark':
      ctx.fillStyle = c1;
      ctx.beginPath();
      ctx.roundRect(r.x, r.y, r.w, r.h, r.h / 2);
      ctx.fill();
      break;
    case 'pill-outline':
      ctx.fillStyle = '#FFFFFF';
      ctx.strokeStyle = grad(r.x, r.x + r.w);
      ctx.lineWidth = Math.max(1.5, f * 0.07);
      ctx.beginPath();
      ctx.roundRect(r.x, r.y, r.w, r.h, r.h / 2);
      ctx.fill();
      ctx.stroke();
      break;
    case 'speech':
    case 'cloud': {
      const g = shapeGeometry(d === 'speech' ? 'speech-round' : 'speech-cloud', { x: r.x - f * 0.3, y: r.y - f * 0.3, w: r.w + f * 0.6, h: r.h + f * 1.1 }, f * 0.5);
      ctx.fillStyle = a.decoColor2 ?? shade(c1, 0.85);
      ctx.fill(g.outline);
      ctx.strokeStyle = c1;
      ctx.lineWidth = Math.max(1.5, f * 0.08);
      ctx.stroke(g.outline);
      break;
    }
    case 'chevron': {
      const p = r.h * 0.45;
      ctx.fillStyle = grad(r.x, r.x + r.w);
      ctx.beginPath();
      ctx.moveTo(r.x - f * 0.2, r.y);
      ctx.lineTo(r.x + r.w + f * 0.7 - p, r.y);
      ctx.lineTo(r.x + r.w + f * 0.7, r.y + r.h / 2);
      ctx.lineTo(r.x + r.w + f * 0.7 - p, r.y + r.h);
      ctx.lineTo(r.x - f * 0.2, r.y + r.h);
      ctx.lineTo(r.x - f * 0.2 + p * 0.6, r.y + r.h / 2);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'dashed-box':
      ctx.strokeStyle = c1;
      ctx.lineWidth = Math.max(1.5, f * 0.06);
      ctx.setLineDash([f * 0.3, f * 0.2]);
      ctx.beginPath();
      ctx.roundRect(r.x, r.y, r.w, r.h, f * 0.25);
      ctx.stroke();
      break;
    case 'megaphone':
      ctx.strokeStyle = c1;
      ctx.lineWidth = Math.max(1.5, f * 0.07);
      ctx.beginPath();
      ctx.roundRect(r.x, r.y, r.w, r.h, f * 0.25);
      ctx.stroke();
      ctx.font = `${Math.round(f * 1.4)}px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif`;
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'right';
      ctx.fillText('📣', r.x - f * 0.05, r.y + r.h / 2);
      break;
    default:
      break;
  }
  ctx.restore();
}

/** Inner space between text and box edge: [top, right, bottom, left]. */
export function textPadding(a: TextAnnotation): [number, number, number, number] {
  if (!hasBox(a)) return [0, 0, 0, 0];
  if (a.padding) return a.padding;
  const p = a.fontSize * TEXT_PADDING;
  return [p, p, p, p];
}

export interface PartLayout extends TextLayout {
  style: TextStyle;
  /** Offset from the top of the text block. */
  y: number;
  kind: 'header' | 'body' | 'footer';
  /** Padding of this section's background (0 when it has none). */
  pad: number;
}

/** Padding around a text section that has its own background colour. */
export function sectionPad(style: TextStyle): number {
  return style.sectionBg && style.sectionBg !== 'transparent' ? Math.max(0, style.sectionPad ?? 6) : 0;
}

export interface TextBlockLayout {
  parts: PartLayout[];
  body: PartLayout;
  width: number;
  height: number;
  /** Y positions (block-relative) of divider rules. */
  rules: number[];
  /** Largest section padding (section backgrounds reach this far left and right of the text). */
  sidePad: number;
}

function activePart(p: TextPart | null | undefined): p is TextPart {
  return !!p && p.text.trim().length > 0;
}

/** Lays out header, body and footer as one block whose top-left is (a.x, a.y). */
export function textBlock(a: TextAnnotation, ctx?: Ctx2D | null): TextBlockLayout {
  const gap = a.fontSize * (a.dividers ? 0.6 : 0.3);
  const parts: PartLayout[] = [];
  const rules: number[] = [];
  let y = 0;
  const add = (kind: PartLayout['kind'], text: string, style: TextStyle) => {
    if (parts.length) {
      if (a.dividers) rules.push(y + gap / 2);
      y += gap;
    }
    const l = layoutText({ ...style, text }, ctx);
    const pad = sectionPad(style);
    y += pad;
    parts.push({ ...l, style, y, kind, pad });
    y += l.height + pad;
  };
  if (activePart(a.header)) add('header', a.header.text, { ...a.header, align: a.align });
  add('body', a.text, a);
  if (activePart(a.footer)) add('footer', a.footer.text, { ...a.footer, align: a.align });
  const width = Math.max(...parts.map((p) => p.width));
  return { parts, body: parts.find((p) => p.kind === 'body')!, width, height: y, rules, sidePad: Math.max(0, ...parts.map((p) => p.pad)) };
}

/** Text box bounds (box, padding and border included). */
export function textBounds(a: TextAnnotation): Rect {
  const l = textBlock(a);
  const [t, r, b, lft] = textPadding(a);
  const bw = hasBox(a) ? (a.borderWidth ?? 0) / 2 : 0;
  const side = Math.max(0, l.sidePad - lft);
  const [dl, dt, dr, db] = decoReach(a);
  const ext = Math.max(0, a.extrude ?? 0);
  return { x: a.x - lft - bw - side - dl, y: a.y - t - bw - dt, w: l.width + lft + r + bw * 2 + side * 2 + dl + dr + ext, h: l.height + t + b + bw * 2 + dt + db + ext };
}

export function renderText(ctx: Ctx2D, a: TextAnnotation): void {
  if (!a.text && !activePart(a.header) && !activePart(a.footer)) return;
  const l = textBlock(a, ctx);
  ctx.save();
  ctx.globalAlpha = a.opacity;
  const boxed = hasBox(a);
  if (boxed) {
    const [t, r, b, lft] = textPadding(a);
    const box = { x: a.x - lft, y: a.y - t, w: l.width + lft + r, h: l.height + t + b };
    drawDeco(ctx, a, box);
    ctx.beginPath();
    ctx.roundRect(box.x, box.y, box.w, box.h, Math.max(0, a.borderRadius ?? a.fontSize * 0.2));
    if (a.background !== 'transparent') {
      ctx.fillStyle = makePaint(ctx, a.background, box);
      ctx.fill();
    }
    if ((a.borderWidth ?? 0) > 0) {
      ctx.lineWidth = a.borderWidth;
      ctx.strokeStyle = a.borderColor;
      ctx.lineCap = a.borderStyle === 'dotted' ? 'round' : 'butt';
      ctx.setLineDash(dashPattern(a.borderStyle ?? 'solid', a.borderWidth));
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }
  for (const part of l.parts) {
    if (part.pad > 0 || (part.style.sectionBg && part.style.sectionBg !== 'transparent')) {
      ctx.save();
      ctx.fillStyle = part.style.sectionBg!;
      ctx.beginPath();
      ctx.roundRect(a.x - part.pad, a.y + part.y - part.pad, l.width + part.pad * 2, part.height + part.pad * 2, Math.min(8, part.pad));
      ctx.fill();
      ctx.restore();
    }
    drawTextLines(ctx, part, part.style, a.x, a.y + part.y, l.width, !boxed);
  }
  if (l.rules.length) {
    ctx.fillStyle = a.borderWidth > 0 ? a.borderColor : a.color;
    ctx.globalAlpha = a.opacity * 0.6;
    for (const ry of l.rules) ctx.fillRect(a.x, a.y + ry - 0.5, l.width, Math.max(1, a.fontSize * 0.05));
  }
  ctx.restore();
}

/** Scales every size in a text annotation (corner-handle resize). */
export function scaleTextStyle<T extends TextStyle>(s: T, k: number): T {
  return {
    ...s,
    fontSize: Math.max(4, s.fontSize * k),
    letterSpacing: s.letterSpacing ? s.letterSpacing * k : s.letterSpacing,
    outlineWidth: s.outlineWidth ? s.outlineWidth * k : s.outlineWidth,
    shadowBlur: s.shadowBlur !== undefined ? s.shadowBlur * k : s.shadowBlur,
    shadowX: s.shadowX !== undefined ? s.shadowX * k : s.shadowX,
    shadowY: s.shadowY !== undefined ? s.shadowY * k : s.shadowY,
    extrude: s.extrude ? s.extrude * k : s.extrude,
  };
}

export function scaleText(a: TextAnnotation, k: number): TextAnnotation {
  return {
    ...scaleTextStyle(a, k),
    borderWidth: (a.borderWidth ?? 0) * k,
    borderRadius: (a.borderRadius ?? 0) * k,
    padding: a.padding ? (a.padding.map((v) => v * k) as [number, number, number, number]) : a.padding,
    header: a.header ? scaleTextStyle(a.header, k) : a.header,
    footer: a.footer ? scaleTextStyle(a.footer, k) : a.footer,
  };
}
