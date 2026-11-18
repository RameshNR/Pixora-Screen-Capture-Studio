import { useThemeInk } from '@/shared/hooks/useTheme';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  AlignCenter, AlignLeft, AlignRight, AppWindow, ArrowUpRight, Baseline, Bold, Brush, CaseUpper, Check, CopyCheck, Droplet, Eraser, EyeOff, Frame as FrameIcon, Grid3x3, Hash, Highlighter,
  ImagePlus, Italic, LayoutGrid, Link, Monitor, MousePointerClick, Move, MessageSquareText, Palette, PenLine, Pointer, RotateCcw, Ruler, Shapes, SlidersHorizontal, Smile, Sparkles,
  Spline, Square, Stamp, Strikethrough, Tag, TextCursorInput, Trash2, Type, Underline, Unlink, Wand2, X,
} from 'lucide-react';
import type {
  Annotation, CalloutAnnotation, CalloutTail, CursorClick, CursorDesign, CursorEffect, DashStyle, Frame, HeadStyle, LeaderEnd, LineAnnotation, LineBody, MarkerCounter, MarkerShape, MarkerStyle, Rect, TextAlign, TextPart,
  TextStyle, Tool, ToolStyles, Watermark, WatermarkPosition,
} from '../types';
import type {
  BlurMode, CursorTrail, EditorDoc, MarkerLabelStyle, MaskPattern, PixelPattern, RedactAnnotation, RedactBorder, RedactFade, RedactTone, StickerAnnotation, TextAnnotation, WatermarkStyle,
} from '../types';
import { renderStroke } from '../tools/pen';
import { HIGHLIGHT_GROUPS, PEN_GROUPS, type StrokePreset } from '../tools/pen-styles';
import { BLUR_GROUPS, CLEAR_LOOK, MASK_GROUPS, MASK_REGIONS, PIXEL_GROUPS, renderRedact } from '../tools/blur';
import { renderSticker } from '../tools/shapes';
import { GRADIENT_PAIRS, TEXT_DECOS, TEXT_GROUPS, TEXT_LOOK_RESET, type TextPreset } from '../tools/text-presets';
import { renderText, textBounds } from '../tools/text';
import { drawWatermark, WATERMARK_PRESETS } from '../tools/decorations';
import { CURSOR_GROUPS, CURSOR_TRAILS, cursorGroupOf, type CursorGroup } from '../tools/cursor';
import type { DeviceFinish, DeviceKind } from '../types';
import { rememberFrameImage } from '../tools/decorations';
import { BACKGROUND_DEFAULTS, BORDER_DEFAULTS, DEFAULT_FONT, DEFAULT_TOOL_STYLES, DEFAULT_WATERMARK, EMPTY_FRAME, PALETTE } from '../types';
import { Button, IconButton } from '@/shared/components/Button';
import { ColorSwatches, RadioGroup, Slider, TextField, ToggleSwitch } from '@/shared/components/FormControls';
import { Select } from '@/shared/components/Dropdown';
import { cutBand, type AspectRatio, type CutBand } from '../tools/crop';
import { IMAGE_ACCEPT } from '@/shared/utils/image-types';
import { FONT_OPTIONS } from '../fonts';
import { alphaOf, cssPaint, withAlpha } from '@/shared/utils/color';
import { MAX_BENDS, defaultBends, markerAutoColors, renderLine, renderMarker } from '../tools/shapes';
import { fitCallout, renderCallout, type DesignPatch } from '../tools/callouts';
import { CALLOUT_GROUPS, ALL_CALLOUT_PRESETS, type CalloutPreset } from '../tools/callout-presets';
import { recipeOf, type BadgeIcon } from '../tools/callout-recipes';
import type { ShapeKind } from '../tools/shape-lib';
import { canRotate, rotationOf } from '../tools/annotations';
import { SHAPE_GROUPS, paintShape, type ShapeLook, type ShapePreset } from '../tools/shape-lib';
import { CURSOR_CLICKS, CURSOR_DESIGNS, CURSOR_DESIGN_IDS, CURSOR_EFFECTS, CURSOR_LOOKS, renderCursor } from '../tools/cursor';
import { RotationControl } from './RotationControl';
import styles from './editor.module.css';

export type StyleKind = keyof ToolStyles;

export function styleKindFor(t: Tool | Annotation['type']): StyleKind | null {
  switch (t) {
    case 'pen':
    case 'highlighter':
    case 'text':
    case 'callout':
    case 'blur':
    case 'pixelate':
    case 'mask':
    case 'marker':
    case 'sticker':
    case 'cursor':
    case 'eraser':
      return t;
    case 'rect':
    case 'ellipse':
      return 'shape';
    case 'line':
    case 'arrow':
      return 'line';
    default:
      return null;
  }
}

const TITLES: Partial<Record<Tool | Annotation['type'], string>> = {
  pen: 'Pen', highlighter: 'Highlighter', rect: 'Shapes', ellipse: 'Shapes', arrow: 'Line & arrow', line: 'Line', text: 'Text',
  callout: 'Callout', blur: 'Blur', pixelate: 'Pixelate', mask: 'Solid mask', marker: 'Numbered marker', sticker: 'Sticker', cursor: 'Cursor & click', image: 'Image',
  eraser: 'Eraser', select: 'Select', hand: 'Pan', crop: 'Crop', cut: 'Cut out & join', watermark: 'Watermark', frame: 'Border & frame',
};

import { STICKER_GROUPS, STICKERS, sameSticker, type StickerDef } from '../tools/sticker-lib';
export { STICKER_GROUPS, STICKERS };

import { LINE_PRESETS, PREMIUM_LINES, type LinePatch, type PremiumLine } from '../tools/line-presets';

const HEAD_OPTIONS: Array<{ value: HeadStyle; label: string }> = [
  { value: 'none', label: 'None' },
  { value: 'triangle', label: '▶ Arrow' },
  { value: 'big', label: '➤ Big head' },
  { value: 'round', label: '▲ Rounded' },
  { value: 'open', label: '> Open' },
  { value: 'chevron', label: '❯ Chevron' },
  { value: 'twin', label: '▶▶ Twin' },
  { value: 'twin-open', label: '» Fast' },
  { value: 'harpoon', label: '⇀ Harpoon' },
  { value: 'stealth', label: '➢ Stealth' },
  { value: 'triple', label: '››› Triple' },
  { value: 'curved', label: '❫❫ Bowed' },
  { value: 'echo', label: '›) Echo' },
  { value: 'framed', label: '◇ Framed' },
  { value: 'feather', label: '⫸ Feathers' },
  { value: 'diamond', label: '◆ Diamond' },
  { value: 'circle', label: '● Dot' },
  { value: 'ring', label: '○ Ring' },
  { value: 'square', label: '■ Square' },
  { value: 'bar', label: '| Bar' },
];

const BODY_OPTIONS: Array<{ value: LineBody; label: string }> = [
  { value: 'line', label: 'Line' },
  { value: 'block', label: 'Block (filled)' },
  { value: 'outline', label: 'Block outline' },
  { value: 'tapered', label: 'Tapered' },
  { value: 'pointer', label: 'Pointer (tapered, big head)' },
  { value: 'double', label: 'Double line' },
  { value: 'chevrons', label: 'Chevron trail' },
  { value: 'dash-tail', label: 'Dash tail' },
  { value: 'notched', label: 'Notched block' },
  { value: 'triple', label: 'Triple line' },
  { value: 'dots', label: 'Dot trail' },
  { value: 'squares', label: 'Square trail' },
  { value: 'bars', label: 'Bar trail' },
  { value: 'loop', label: 'Loop' },
];

const DASH_OPTIONS = [
  { value: 'solid' as const, label: <span className={styles.dashPreview} style={{ borderTopStyle: 'solid' }} aria-label="Solid" /> },
  { value: 'dashed' as const, label: <span className={styles.dashPreview} style={{ borderTopStyle: 'dashed' }} aria-label="Dashed" /> },
  { value: 'dotted' as const, label: <span className={styles.dashPreview} style={{ borderTopStyle: 'dotted' }} aria-label="Dotted" /> },
];

const BACKGROUNDS = [
  'linear:#6aa1fa:#7c5cf6', 'linear:#f6d365:#fda085', 'linear:#84fab0:#8fd3f4', 'linear:#232526:#414345', 'linear:#ff9a9e:#fecfef',
  'linear:#a18cd1:#fbc2eb', 'linear:#4facfe:#00f2fe', 'linear:#43e97b:#38f9d7', 'linear:#fa709a:#fee140', 'linear:#30cfd0:#330867',
  'linear:#667eea:#764ba2', 'linear:#ff9966:#ff5e62', 'linear:#e0c3fc:#8ec5fc', 'linear:#0f2027:#2c5364', 'linear:#fdfbfb:#ebedee',
  '#FFFFFF', '#F6F7F9', '#202938',
];

interface CropProps {
  rect: Rect;
  aspect: AspectRatio;
  onAspect: (a: AspectRatio) => void;
  onRect: (r: Rect) => void;
  onApply: () => void;
  onCancel: () => void;
  maxW: number;
  maxH: number;
}

interface Props {
  tool: Tool;
  selected: Annotation | null;
  toolStyles: ToolStyles;
  /** Applies a style change to the selection (if any) and to the tool defaults. */
  onChange: (kind: StyleKind, patch: Record<string, unknown>, coalesceKey: string) => void;
  onOpacity: (opacity: number) => void;
  /** Sets the selected object's rotation (degrees). */
  onRotation: (deg: number) => void;
  onDelete: () => void;
  crop: CropProps | null;
  /** Cut out & join while its tool is active. */
  cut?: CutProps | null;
  watermark: Watermark | null;
  onWatermark: (w: Watermark | null, key: string) => void;
  frame: Frame | null;
  onFrame: (f: Frame | null, key: string) => void;
  /** Last-used frame / watermark, restored when they are switched on again. */
  lastFrame?: Frame | null;
  lastWatermark?: Watermark | null;
  sourceUrl: string;
  sourceTitle: string;
  /** Flow Editor: save the frame on this image now / give every image of the flow this frame. */
  frameApply?: FrameApply;
  /** Image size (one-click mask placements). */
  docSize?: { w: number; h: number };
}

export interface FrameApply {
  apply: () => Promise<void> | void;
  applyAll: (frame: Frame | null) => Promise<void> | void;
  /** Number of images the frame would go to. */
  count: number;
}

export function Section({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className={styles.section}>
      <div className={styles.sectionTitle}>
        {title}
        {action}
      </div>
      {children}
    </section>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <span className={styles.label}>{label}</span>
      {children}
    </div>
  );
}

function FontSelect({ value, onChange, label = 'Font' }: { value: string; onChange: (f: string) => void; label?: string }) {
  return (
    <Select
      label={label}
      variant="dark"
      value={FONT_OPTIONS.some((f) => f.family === value) ? value : FONT_OPTIONS[0]!.family}
      minWidth={236}
      onChange={onChange}
      renderValue={(o) => <span style={{ fontFamily: String(o?.value ?? '') }}>{FONT_OPTIONS.find((f) => f.family === o?.value)?.label}</span>}
      options={FONT_OPTIONS.map((f) => ({ value: f.family, label: <span style={{ fontFamily: f.family, fontSize: 16 }}>{f.label}</span> }))}
    />
  );
}

/**
 * Every text style control: font, size, bold / italic / underline / strike-through / capitals,
 * alignment, colour, letter spacing, outline and shadow. `name` prefixes the accessible labels
 * ("Title colour", "Header size"…) when several text styles share a panel.
 */
function TextStyleFields({
  v, set, name = '', alignment = true, effects = true, section = true, maxSize = 200,
}: {
  v: Partial<TextStyle>; set: (patch: Partial<TextStyle>, key: string) => void; name?: string; alignment?: boolean; effects?: boolean; section?: boolean; maxSize?: number;
}) {
  const n = (label: string) => (name ? `${name} ${label.toLowerCase()}` : label);
  const key = (k: string) => (name ? `${name}-${k}` : k);
  const toggle = (k: 'bold' | 'italic' | 'underline' | 'strike' | 'caps') => set({ [k]: !v[k] }, key(k));
  return (
    <>
      <Field label={n('Font')}>
        <FontSelect label={n('Font')} value={String(v.fontFamily ?? DEFAULT_FONT)} onChange={(f) => set({ fontFamily: f }, key('font'))} />
      </Field>
      <Slider tone="dark" label={n('Size')} min={8} max={maxSize} value={Math.round(Number(v.fontSize ?? 28))} format={(x) => `${x}px`} onChange={(x) => set({ fontSize: x }, key('fontSize'))} />
      <Field label={n('Style')}>
        <div className={styles.styleToggles} role="group" aria-label={n('Text style')}>
          <IconButton tone="dark" size="sm" label={n('Bold')} shortcut={name ? undefined : 'Ctrl+B'} icon={<Bold size={15} />} active={Boolean(v.bold)} onClick={() => toggle('bold')} />
          <IconButton tone="dark" size="sm" label={n('Italic')} icon={<Italic size={15} />} active={Boolean(v.italic)} onClick={() => toggle('italic')} />
          <IconButton tone="dark" size="sm" label={n('Underline')} icon={<Underline size={15} />} active={Boolean(v.underline)} onClick={() => toggle('underline')} />
          <IconButton tone="dark" size="sm" label={n('Strikethrough')} icon={<Strikethrough size={15} />} active={Boolean(v.strike)} onClick={() => toggle('strike')} />
          <IconButton tone="dark" size="sm" label={n('Capitals')} icon={<CaseUpper size={15} />} active={Boolean(v.caps)} onClick={() => toggle('caps')} />
        </div>
      </Field>
      {alignment && (
        <Field label={n('Alignment')}>
          <RadioGroup<TextAlign>
            label={n('Alignment')}
            tone="dark"
            size="sm"
            value={(v.align as TextAlign) ?? 'left'}
            onChange={(a) => set({ align: a }, key('align'))}
            options={[
              { value: 'left', label: <AlignLeft size={14} aria-label="Left" /> },
              { value: 'center', label: <AlignCenter size={14} aria-label="Center" /> },
              { value: 'right', label: <AlignRight size={14} aria-label="Right" /> },
            ]}
          />
        </Field>
      )}
      <Field label={n('Text colour')}>
        <ColorSwatches label={n('Text colour')} colors={PALETTE} value={String(v.color ?? '#202938')} onChange={(c) => set({ color: c }, key('color'))} />
      </Field>
      {section && (
        <>
          <Field label={n('Section background')}>
            <ColorSwatches label={n('Section background')} colors={['transparent', ...PALETTE.slice(0, 7)]} value={String(v.sectionBg ?? 'transparent')} onChange={(c) => set({ sectionBg: c }, key('sectionBg'))} />
          </Field>
          {(v.sectionBg ?? 'transparent') !== 'transparent' && (
            <Slider tone="dark" label={n('Section padding')} min={0} max={60} value={Number(v.sectionPad ?? 6)} format={(x) => `${x}px`} onChange={(x) => set({ sectionPad: x }, key('sectionPad'))} />
          )}
        </>
      )}
      {effects && <TextEffectFields v={v} set={set} name={name} />}
    </>
  );
}

/** Letter spacing, outline and shadow. */
function TextEffectFields({ v, set, name = '' }: { v: Partial<TextStyle>; set: (patch: Partial<TextStyle>, key: string) => void; name?: string }) {
  const n = (label: string) => (name ? `${name} ${label.toLowerCase()}` : label);
  const key = (k: string) => (name ? `${name}-${k}` : k);
  return (
    <>
      <Slider tone="dark" label={n('Letter spacing')} min={-2} max={30} value={Number(v.letterSpacing ?? 0)} format={(x) => `${x}px`} onChange={(x) => set({ letterSpacing: x }, key('letterSpacing'))} />
      <Slider tone="dark" label={n('Text outline')} min={0} max={12} value={Number(v.outlineWidth ?? 0)} format={(x) => (x ? `${x}px` : 'None')} onChange={(x) => set({ outlineWidth: x }, key('outlineWidth'))} />
      {Number(v.outlineWidth ?? 0) > 0 && (
        <ColorSwatches label={n('Outline colour')} colors={PALETTE} value={String(v.outlineColor ?? '#FFFFFF')} onChange={(c) => set({ outlineColor: c }, key('outlineColor'))} />
      )}
      <div className={styles.inlineToggle}>
        {n('Shadow')}
        <ToggleSwitch size="sm" label={n('Shadow')} checked={Boolean(v.shadow)} onChange={(x) => set({ shadow: x }, key('shadow'))} />
      </div>
    </>
  );
}

/** A titled, collapsible group of settings (keeps long panels readable). */
function Group({ title, children, open = true, action, disabled, icon }: { title: string; children: ReactNode; open?: boolean; action?: ReactNode; disabled?: boolean; icon?: ReactNode }) {
  return (
    <details className={`${styles.setGroup} ${disabled ? styles.setGroupDisabled : ''}`} open={open}>
      <summary className={styles.setGroupTitle}>
        {icon && <span className={styles.setGroupIcon} aria-hidden>{icon}</span>}
        <span className={styles.setGroupLabel}>{title}</span>
        {action && <span className={styles.setGroupAction} onClick={(e) => { e.stopPropagation(); e.preventDefault(); }}>{action}</span>}
      </summary>
      <div className={styles.setGroupBody}>{children}</div>
    </details>
  );
}

/** Which tab each panel had open (kept while switching tools). */
const tabMemory = new Map<string, string>();

/** Segmented tabs at the top of a tool panel (the Text Settings look, used by every panel). */
function PanelTabs({ id, name, tabs }: { id: string; name: string; tabs: Array<{ id: string; label: string; content: ReactNode }> }) {
  const [cur, setCur] = useState(() => tabMemory.get(id) ?? tabs[0]!.id);
  const active = tabs.find((t) => t.id === cur) ?? tabs[0]!;
  return (
    <div className={styles.textSettings}>
      <div className={styles.segTabs} style={{ gridTemplateColumns: `repeat(${tabs.length}, 1fr)` }} role="tablist" aria-label={`${name} settings`}>
        {tabs.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={active.id === t.id} className={active.id === t.id ? styles.segOn : undefined}
            onClick={() => { tabMemory.set(id, t.id); setCur(t.id); }}>
            {t.label}
          </button>
        ))}
      </div>
      {active.content}
    </div>
  );
}

/** Text box that grows with its content and can be resized by dragging. */
function AutoTextarea({ value, onChange, label, placeholder }: { value: string; onChange: (v: string) => void; label: string; placeholder?: string }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(320, Math.max(64, el.scrollHeight + 2))}px`;
  }, [value]);
  return <textarea ref={ref} className={styles.textInput} value={value} rows={2} aria-label={label} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />;
}

/** Small canvas preview drawn with the real renderer, so presets look exactly like the result. */
function PreviewCanvas({ width, height, draw, light = false }: { width: number; height: number; draw: (ctx: CanvasRenderingContext2D) => void; light?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = width * dpr;
    c.height = height * dpr;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    if (light) {
      ctx.fillStyle = '#F4F6FA';
      ctx.fillRect(0, 0, width, height);
    }
    try {
      draw(ctx);
    } catch {
      /* previews are best effort */
    }
  });
  return <canvas ref={ref} style={{ width, height }} aria-hidden />;
}

function LinePresetPreview({ patch }: { patch: LinePatch & Partial<PremiumLine> }) {
  const W = 52;
  const H = 30;
  // Plain styles are drawn in the theme's ink (dark on light themes); coloured presets keep theirs.
  const ink = useThemeInk();
  return (
    <PreviewCanvas
      width={W}
      height={H}
      draw={(ctx) => {
        const base = { x1: 7, y1: H - 7, x2: W - 7, y2: 8 };
        const line: LineAnnotation = {
          id: 'p', type: 'arrow', ...base, color: ink, width: 2.6, opacity: 1, ...patch,
          ...(patch.width ? { width: Math.max(2, Math.min(9, patch.width * 0.35)) } : {}),
          bends: patch.route === 'elbow' ? [] : defaultBends(base, Math.min(patch.bends, 4), true),
        };
        renderLine(ctx, line);
      }}
    />
  );
}

function CalloutPreview({ patch, design, sample }: { patch: DesignPatch; design: CalloutAnnotation['design']; sample?: CalloutPreset['sample'] }) {
  const W = 78;
  const H = 54;
  return (
    <PreviewCanvas
      width={W}
      height={H}
      light
      draw={(ctx) => {
        const leader = patch.tail === 'leader';
        const titled = ['titled', 'tag', 'hexagon', 'number', 'underline', 'banner', 'circle', 'leader', 'divided', 'quote', 'card', 'step', 'note', 'glass', 'tooltip'].includes(design ?? '');
        const recipe = recipeOf({ design });
        if (recipe) {
          // Premium designs: drawn at a larger size, then scaled into the preview.
          const short = !sample?.title && (sample?.text ?? '').length < 14;
          const bw = 170;
          const bh = short ? 50 : 96;
          const leader = patch.tail === 'leader';
          const pa: CalloutAnnotation = {
            id: 'p', type: 'callout', opacity: 1, x: leader ? 34 : 14, y: 14, w: leader ? bw - 22 : bw, h: bh, tailX: leader ? 8 : 40, tailY: bh + 34,
            text: sample?.text ?? 'Your text here', fill: '#FFFFFF', stroke: '#7C3AED', strokeWidth: 2, radius: 12, fontFamily: DEFAULT_FONT, fontSize: 13,
            bold: false, italic: false, color: '#202938', align: 'left', ...(patch as Partial<CalloutAnnotation>), design,
            title: sample?.title ?? '', badge: sample?.badge ?? patch.badge,
            titleStyle: { fontFamily: DEFAULT_FONT, fontSize: 15, bold: true, italic: false, align: 'left', color: '#202938', ...(patch.titleStyle ?? {}) },
          } as CalloutAnnotation;
          const fitted = fitCallout(pa, true);
          const totalW = bw + 28 + (leader ? 20 : 0);
          const totalH = fitted.h + 28 + (patch.tail === 'speech' ? 30 : 0);
          const k = Math.min(W / totalW, H / totalH);
          ctx.save();
          ctx.translate((W - totalW * k) / 2, (H - totalH * k) / 2);
          ctx.scale(k, k);
          renderCallout(ctx, fitted);
          ctx.restore();
          return;
        }
        const a: CalloutAnnotation = {
          id: 'p', type: 'callout', opacity: 1, x: leader ? 16 : 6, y: 5, w: leader ? 56 : 66, h: patch.tail && patch.tail !== 'none' ? 32 : 42,
          tailX: leader ? 6 : 16, tailY: leader ? 48 : 50, text: 'Text text text text', fill: '#FFFFFF', stroke: '#E05252', strokeWidth: 1.2, radius: 5,
          fontFamily: DEFAULT_FONT, fontSize: 5.5, bold: false, italic: false, color: '#202938', align: 'left',
          ...(patch as Partial<CalloutAnnotation>),
          design,
          title: titled ? (design === 'number' ? '01' : design === 'step' ? '1' : 'Title') : '',
          titleStyle: { fontFamily: DEFAULT_FONT, fontSize: 7.5, bold: true, italic: false, align: 'left', color: '#202938', ...(patch.titleStyle ?? {}) },
        } as CalloutAnnotation;
        if (design === 'circle') Object.assign(a, { x: 14, w: 42, h: 42, y: 3, tailX: 8, tailY: 50 });
        a.strokeWidth = Math.min(2, Math.max(a.strokeWidth ? 1.2 : 0, 0));
        renderCallout(ctx, a);
      }}
    />
  );
}

const MARKER_SHAPES: MarkerShape[] = [
  'circle', 'pin', 'seal', 'square', 'rounded', 'diamond', 'hexagon', 'star', 'shield', 'tag', 'heart',
  'speech', 'speech-square', 'cloud', 'pin-ring', 'pin-square', 'chevron', 'triangle', 'parallelogram', 'ring', 'brush', 'blob',
  'note', 'folded', 'stack', 'rosette', 'ribbon', 'ribbon-curved',
];
const MARKER_SHAPE_NAMES: Partial<Record<MarkerShape, string>> = {
  'speech-square': 'square speech', 'pin-ring': 'pin with rings', 'pin-square': 'square pin', 'ribbon-curved': 'curved ribbon', ring: 'progress ring', brush: 'brush splash', note: 'sticky note', folded: 'folded card', stack: 'layered square',
};

function ShapePreview({ preset }: { preset: ShapePreset }) {
  const tall = preset.kind === 'bookmark' || preset.kind === 'badge-pentagon' || preset.kind === 'shield' || preset.kind === 'cylinder' || preset.kind === 'cone' || preset.kind === 'layers';
  const wide = ['rect', 'rrect', 'pill', 'brush', 'banner', 'banner-curved', 'flag-wavy', 'tag-arrow', 'slant', 'parallelogram', 'trapezoid', 'wavy', 'ticket', 'display', 'speech-rect', 'speech-round', 'speech-oval', 'speech-slant', 'speech-cloud', 'thought', 'cloud'].includes(preset.kind)
    || preset.id === 'rect' || preset.id === 'rrect' || preset.id === 'ellipse';
  const w = wide ? 36 : tall ? 22 : 28;
  const h = wide ? 22 : 28;
  return (
    <PreviewCanvas
      width={40}
      height={34}
      draw={(ctx) => paintShape(ctx, preset.kind, { x: (40 - w) / 2, y: (34 - h) / 2, w, h }, preset.kind === 'rect' ? 1 : 0, {
        fill: preset.fill, stroke: preset.stroke, width: Math.min(2, preset.width ?? 2), dash: preset.dash === 'dashed' ? [4, 3] : preset.dash === 'dotted' ? [0.01, 3] : [], look: preset.look,
      })}
    />
  );
}

/** Shape library picker: categories of shapes, each with its own colours and finish. */
function ShapePicker({ value, onPick }: { value: string; onPick: (p: ShapePreset) => void }) {
  const [group, setGroup] = useState(() => SHAPE_GROUPS.find((g) => g.items.some((i) => i.kind === value))?.id ?? 'basic');
  const items = SHAPE_GROUPS.find((g) => g.id === group)?.items ?? [];
  return (
    <Field label="Shape">
      <div className={styles.stickerTabs} role="tablist" aria-label="Shape categories">
        {SHAPE_GROUPS.map((g) => (
          <button key={g.id} type="button" role="tab" aria-selected={group === g.id} className={group === g.id ? styles.stickerTabOn : undefined} onClick={() => setGroup(g.id)}>{g.label}</button>
        ))}
      </div>
      <div className={styles.shapeGrid} role="listbox" aria-label="Shapes">
        {items.map((it) => (
          <button key={it.id} type="button" role="option" aria-selected={value === it.kind} aria-label={it.label} title={it.label}
            className={value === it.kind ? styles.presetActive : undefined} onClick={() => onPick(it)}>
            <ShapePreview preset={it} />
          </button>
        ))}
      </div>
    </Field>
  );
}

const LOOK_OPTIONS: Array<{ value: ShapeLook; label: string; description: string }> = [
  { value: 'flat', label: 'Flat', description: 'Plain fill and line' },
  { value: 'shadow', label: 'Soft shadow', description: 'Floating card look' },
  { value: 'glow', label: 'Glow', description: 'Coloured glow around the shape' },
  { value: 'gradient', label: 'Gradient', description: 'Light-to-colour shine' },
  { value: '3d', label: '3D', description: 'Raised with a darker edge' },
  { value: 'glass', label: 'Glass', description: 'Glossy highlight on top' },
];

function CursorPreview({ design, color, outline }: { design: CursorDesign; color: string; outline: string }) {
  const box = CURSOR_DESIGNS[design].box;
  const size = 28;
  const k = size / 24;
  return (
    <PreviewCanvas
      width={40}
      height={40}
      draw={(ctx) => renderCursor(ctx, {
        id: 'p', type: 'cursor', x: 20 - (box.x + box.w / 2) * k, y: 20 - (box.y + box.h / 2) * k, size, design, color, outline,
        click: 'none', clickColor: color, effect: 'none', effectColor: color, effectSize: 1, opacity: 1,
      })}
    />
  );
}

const CALLOUT_BODY_SHAPES: Array<{ value: ShapeKind; label: string }> = [
  { value: 'rounded', label: 'Rounded rectangle' }, { value: 'rect', label: 'Rectangle' }, { value: 'pill', label: 'Pill' }, { value: 'ellipse', label: 'Circle / oval' },
  { value: 'cloud', label: 'Cloud' }, { value: 'thought', label: 'Thought bubble' }, { value: 'hexagon', label: 'Hexagon' }, { value: 'octagon', label: 'Octagon' },
  { value: 'pentagon', label: 'Pentagon' }, { value: 'parallelogram', label: 'Parallelogram' }, { value: 'slant', label: 'Slanted' }, { value: 'tag-arrow', label: 'Arrow tag' },
  { value: 'heart', label: 'Heart' }, { value: 'flower', label: 'Flower' }, { value: 'scallop', label: 'Scalloped' }, { value: 'leaf', label: 'Leaf' },
  { value: 'brush', label: 'Brush stroke' }, { value: 'folded', label: 'Folded corner' }, { value: 'notched', label: 'Notched corners' }, { value: 'chamfer', label: 'Chamfered' },
  { value: 'ticket', label: 'Ticket' }, { value: 'banner', label: 'Banner' }, { value: 'flag', label: 'Flag' }, { value: 'wavy', label: 'Wavy' },
];

const BADGE_ICONS: Array<{ value: BadgeIcon; label: string }> = [
  { value: 'bulb', label: 'Light bulb (tip)' }, { value: 'info', label: 'Info' }, { value: 'check', label: 'Check (note)' }, { value: 'check-filled', label: 'Check circle (success)' },
  { value: 'warning', label: 'Warning' }, { value: 'error', label: 'Error' }, { value: 'star', label: 'Star (important)' }, { value: 'flag', label: 'Flag (action)' },
  { value: 'bolt', label: 'Lightning (shortcut)' }, { value: 'calendar', label: 'Calendar (step)' }, { value: 'sparkles', label: 'Sparkles (pro tip / new)' },
];

/** Callout designs grouped by category, each in the colours of its sample. */
function CalloutPicker({ design, fill, onPick }: { design: string; fill: string; onPick: (p: CalloutPreset) => void }) {
  const current = ALL_CALLOUT_PRESETS.find((p) => p.id === design && (p.patch.fill ?? '') === fill) ?? ALL_CALLOUT_PRESETS.find((p) => p.id === design);
  const [group, setGroup] = useState(() => CALLOUT_GROUPS.find((g) => g.items.includes(current!))?.id ?? 'premium');
  const items = CALLOUT_GROUPS.find((g) => g.id === group)?.items ?? [];
  return (
    <div>
      <div className={styles.stickerTabs} role="tablist" aria-label="Callout categories">
        {CALLOUT_GROUPS.map((g) => (
          <button key={g.id} type="button" role="tab" aria-selected={group === g.id} className={group === g.id ? styles.stickerTabOn : undefined} onClick={() => setGroup(g.id)}>{g.label}</button>
        ))}
      </div>
      <div className={styles.presetGrid3} role="listbox" aria-label="Callout designs">
        {items.map((d) => {
          const active = current?.key === d.key;
          return (
            <button key={d.key} type="button" role="option" aria-selected={active} aria-label={d.label} title={d.label} className={active ? styles.presetActive : undefined} onClick={() => onPick(d)}>
              <CalloutPreview patch={d.patch} design={d.id} sample={d.sample} />
              <span>{d.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function MarkerPreview({ shape, style, color, counter }: { shape: MarkerShape; style: MarkerStyle; color: string; counter: MarkerCounter }) {
  return (
    <PreviewCanvas
      width={40}
      height={40}
      draw={(ctx) => {
        const tall = shape === 'pin' || shape === 'pin-ring' || shape === 'pin-square' || shape === 'rosette' || shape === 'speech' || shape === 'speech-square';
        const wide = shape === 'chevron' || shape === 'ribbon' || shape === 'ribbon-curved' || shape === 'parallelogram';
        renderMarker(ctx, { id: 'p', type: 'marker', x: 20, y: tall ? 15 : 20, n: 1, color, size: tall ? 19 : wide ? 18 : 24, shape, style, counter: counter === 'step' ? 'number' : counter, opacity: 1 });
      }}
    />
  );
}

/** Sticker picker with categories (general, developer, designer, editor, status badges). */
/** Text stickers with the user's own words ("SHIP IT", "Step 2", "Ask Priya"…). */
function CustomBadgeField({ value, color, onChange }: { value: string; color: string; onChange: (text: string) => void }) {
  const [draft, setDraft] = useState(value);
  // Follow the selected sticker (or a picked badge) unless the user is mid-way through clearing it.
  useEffect(() => {
    if (value) setDraft(value);
  }, [value]);
  return (
    <Field label="Your text sticker">
      <div className={styles.customBadge}>
        <TextField
          tone="dark"
          value={draft}
          maxLength={40}
          placeholder="Type your words, e.g. SHIP IT"
          aria-label="Text sticker words"
          onChange={(e) => {
            setDraft(e.target.value);
            if (e.target.value.trim()) onChange(e.target.value);
          }}
        />
        {draft.trim() && <span className={styles.customBadgePreview} style={{ background: color }}>{draft.trim()}</span>}
      </div>
    </Field>
  );
}

function matchesLine(v: Record<string, unknown>, p: LinePatch): boolean {
  return v.headStart === p.headStart && v.headEnd === p.headEnd && (v.dash ?? 'solid') === p.dash && (v.body ?? 'line') === p.body && Number(v.bends ?? 0) === p.bends;
}

function newPart(name: 'Header' | 'Footer', base: TextStyle): TextPart {
  return {
    ...base, text: name === 'Header' ? 'Title' : 'Footer note', fontSize: Math.round(base.fontSize * (name === 'Header' ? 1.3 : 0.7)),
    bold: name === 'Header', underline: false, strike: false, sectionBg: undefined, sectionPad: undefined,
  };
}

/* -------------------------------- cursor groups -------------------------------- */

/** Cursor designs by group (classic, themed, shape, recording, gesture, resize, action, creative). */
function CursorDesignGrid({ value, onPick }: { value: CursorDesign; onPick: (d: CursorDesign) => void }) {
  const [group, setGroup] = useState<CursorGroup>(() => cursorGroupOf(value));
  return (
    <>
      <div className={styles.stickerTabs} role="tablist" aria-label="Cursor design groups">
        {CURSOR_GROUPS.map((g) => (
          <button key={g.id} type="button" role="tab" aria-selected={group === g.id} className={group === g.id ? styles.stickerTabOn : undefined} onClick={() => setGroup(g.id)}>{g.label}</button>
        ))}
      </div>
      <div className={styles.shapeGrid} role="radiogroup" aria-label="Cursor design">
        {CURSOR_DESIGN_IDS.filter((d) => cursorGroupOf(d) === group).map((d) => (
          <button key={d} type="button" role="radio" aria-checked={value === d} aria-label={CURSOR_DESIGNS[d].label} title={CURSOR_DESIGNS[d].label}
            className={value === d ? styles.presetActive : undefined} onClick={() => onPick(d)}>
            <CursorPreview design={d} color={CURSOR_DESIGNS[d].fill} outline={CURSOR_DESIGNS[d].outline} />
          </button>
        ))}
      </div>
    </>
  );
}

/* ------------------------- pen & highlighter designs ------------------------- */

function StrokePreview({ preset, kind }: { preset: StrokePreset; kind: 'pen' | 'highlighter' }) {
  const W = 62;
  const H = 30;
  return (
    <PreviewCanvas
      width={W}
      height={H}
      light
      draw={(ctx) => {
        const n = 26;
        const pts = Array.from({ length: n }, (_, i) => ({ x: 10 + (i / (n - 1)) * (W - 20), y: H / 2 + (kind === 'pen' ? Math.sin((i / (n - 1)) * Math.PI * 2) * 6 : 0) }));
        const w = kind === 'pen' ? Math.min(4.5, Math.max(1.6, (preset.width ?? 6) * 0.34)) : 10;
        if (kind === 'highlighter') {
          // Shown the way it is used: over a line of dark text on white paper, so pale highlighter
          // colours are easy to tell apart.
          ctx.fillStyle = '#FFFFFF';
          ctx.fillRect(0, 0, W, H);
          ctx.fillStyle = '#1F2937';
          ctx.font = '600 11px Inter, "Segoe UI", sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('Highlight', W / 2, H / 2 + 0.5);
        }
        renderStroke(ctx, { id: 'p', type: kind, points: pts, color: preset.color, width: w, opacity: 1, design: preset.design, accent: preset.accent });
      }}
    />
  );
}

/** Pen / highlighter design sheet with categories. */
function StrokePicker({ kind, design, color, onPick }: { kind: 'pen' | 'highlighter'; design: string; color: string; onPick: (p: StrokePreset) => void }) {
  const groups = kind === 'pen' ? PEN_GROUPS : HIGHLIGHT_GROUPS;
  const [group, setGroup] = useState(() => groups.find((g) => g.items.some((i) => i.design === design))?.id ?? groups[0]!.id);
  const items = groups.find((g) => g.id === group)?.items ?? [];
  const name = kind === 'pen' ? 'Pen' : 'Highlighter';
  return (
    <Field label="Design">
      <div className={styles.stickerTabs} role="tablist" aria-label={`${name} design categories`}>
        {groups.map((g) => (
          <button key={g.id} type="button" role="tab" aria-selected={group === g.id} className={group === g.id ? styles.stickerTabOn : undefined} onClick={() => setGroup(g.id)}>{g.label}</button>
        ))}
      </div>
      <div className={styles.presetGrid3} role="listbox" aria-label={`${name} designs`}>
        {items.map((p) => {
          const active = design === p.design && color.toUpperCase() === p.color.toUpperCase();
          return (
            <button key={p.id} type="button" role="option" aria-selected={active} aria-label={p.label} title={p.label} className={active ? styles.presetActive : undefined} onClick={() => onPick(p)}>
              <StrokePreview preset={p} kind={kind} />
            </button>
          );
        })}
      </div>
    </Field>
  );
}

const ACCENT_DESIGNS = new Set(['outlined', 'stars', 'box', 'arrow']);

/* -------------------------- blur / pixelate / mask -------------------------- */

let sampleScene: OffscreenCanvas | null = null;
/** A small mountain picture the blur / pixelate / mask previews are drawn on. */
function previewScene(): OffscreenCanvas | null {
  if (sampleScene || typeof OffscreenCanvas === 'undefined') return sampleScene;
  const c = new OffscreenCanvas(120, 80);
  const x = c.getContext('2d');
  if (!x) return null;
  const sky = x.createLinearGradient(0, 0, 0, 80);
  sky.addColorStop(0, '#3B82F6');
  sky.addColorStop(1, '#DBEAFE');
  x.fillStyle = sky;
  x.fillRect(0, 0, 120, 80);
  x.fillStyle = '#FDBA74';
  x.beginPath();
  x.arc(92, 20, 9, 0, Math.PI * 2);
  x.fill();
  x.fillStyle = '#334155';
  x.beginPath();
  x.moveTo(0, 80); x.lineTo(30, 30); x.lineTo(48, 50); x.lineTo(70, 18); x.lineTo(100, 58); x.lineTo(120, 44); x.lineTo(120, 80);
  x.fill();
  x.fillStyle = '#F8FAFC';
  x.beginPath();
  x.moveTo(70, 18); x.lineTo(78, 30); x.lineTo(70, 27); x.lineTo(63, 29);
  x.fill();
  x.fillStyle = '#166534';
  x.fillRect(0, 68, 120, 12);
  sampleScene = c;
  return c;
}

function RedactPreview({ type, patch, intensity, color }: { type: RedactAnnotation['type']; patch: Partial<RedactAnnotation>; intensity: number; color: string }) {
  return (
    <PreviewCanvas
      width={56}
      height={38}
      draw={(ctx) => {
        const scene = previewScene();
        if (!scene) return;
        ctx.save();
        ctx.scale(56 / 120, 38 / 80);
        ctx.drawImage(scene, 0, 0);
        renderRedact(ctx, scene, { id: 'p', type, x: 22, y: 14, w: 76, h: 52, intensity: Math.max(2, (patch.intensity ?? intensity) * 0.8), opacity: 1, color, ...patch } as RedactAnnotation);
        ctx.restore();
      }}
    />
  );
}

const REDACT_SHAPES: Array<{ value: ShapeKind | ''; label: string }> = [
  { value: '', label: 'Rectangle' }, { value: 'rounded', label: 'Rounded' }, { value: 'pill', label: 'Pill' }, { value: 'ellipse', label: 'Circle / oval' },
  { value: 'cloud', label: 'Cloud' }, { value: 'star', label: 'Star' }, { value: 'heart', label: 'Heart' }, { value: 'hexagon', label: 'Hexagon' },
  { value: 'octagon', label: 'Polygon' }, { value: 'triangle', label: 'Triangle' }, { value: 'diamond', label: 'Diamond' }, { value: 'flower', label: 'Flower' },
  { value: 'burst', label: 'Badge' }, { value: 'slant', label: 'Slanted' }, { value: 'parallelogram', label: 'Parallelogram' }, { value: 'trapezoid', label: 'Trapezoid' }, { value: 'wavy', label: 'Wave' },
];

/** Blur / pixelate / mask design sheet plus every look setting. */
function RedactDesigns({ kind, v, set, selected, docSize, part }: { kind: 'blur' | 'pixelate' | 'mask'; v: Record<string, unknown>; set: (patch: Record<string, unknown>, key: string) => void; selected: boolean; docSize?: { w: number; h: number }; part: 'designs' | 'adjust' }) {
  const groups = kind === 'blur' ? BLUR_GROUPS : kind === 'pixelate' ? PIXEL_GROUPS : MASK_GROUPS;
  const [group, setGroup] = useState(groups[0]!.id);
  const items = groups.find((g) => g.id === group)?.items ?? [];
  const name = kind === 'blur' ? 'Blur' : kind === 'pixelate' ? 'Pixelate' : 'Mask';
  const s = (k: string, d = '') => (typeof v[k] === 'string' ? (v[k] as string) : d);
  const intensity = typeof v.intensity === 'number' ? (v.intensity as number) : 12;
  const color = s('color', '#000000');
  if (part === 'designs') return (
    <>
      <div>
        <div className={styles.stickerTabs} role="tablist" aria-label={`${name} design categories`}>
          {groups.map((g) => (
            <button key={g.id} type="button" role="tab" aria-selected={group === g.id} className={group === g.id ? styles.stickerTabOn : undefined} onClick={() => setGroup(g.id)}>{g.label}</button>
          ))}
        </div>
        <div className={styles.presetGrid4} role="listbox" aria-label={`${name} designs`}>
          {items.map((p) => (
            <button key={p.id} type="button" role="option" aria-selected={false} aria-label={p.label} title={p.label} onClick={() => set({ ...p.patch }, `look-${p.id}`)}>
              <RedactPreview type={kind} patch={p.patch} intensity={intensity} color={color} />
              <span>{p.label}</span>
            </button>
          ))}
        </div>
      </div>
      {kind === 'mask' && selected && docSize && (
        <Field label="Place mask">
          <div className={styles.presetGrid4}>
            {MASK_REGIONS.map((r) => (
              <button key={r.id} type="button" title={r.label} aria-label={r.label} onClick={() => set({ ...r.rect(docSize.w, docSize.h) }, `place-${r.id}`)}>
                <span>{r.label}</span>
              </button>
            ))}
          </div>
        </Field>
      )}
    </>
  );
  return (
    <>
      {kind !== 'mask' && (
        <Slider tone="dark" label={kind === 'blur' ? 'Blur intensity' : 'Block size'} min={2} max={kind === 'blur' ? 40 : 48} value={intensity} format={(x) => `${x}px`} onChange={(x) => set({ intensity: x }, 'intensity')} />
      )}
      {kind === 'mask' && (
        <>
          <Field label="Mask colour">
            <ColorSwatches label="Mask colour" colors={['#000000', '#FFFFFF', '#6B7280', '#202938', '#E05252', '#4F8DF7', '#169A1E', '#FFE500', '#8B3FD9', '#F59E0B']} value={color} onChange={(c) => set({ color: c }, 'color')} />
          </Field>
          <Field label="Mask look">
            <Select<MaskPattern> label="Mask look" variant="dark" minWidth={200} value={(s('maskPattern', 'solid') as MaskPattern)} onChange={(m) => set({ maskPattern: m }, 'maskPattern')}
              options={[
                { value: 'solid', label: 'Solid block' }, { value: 'lines', label: 'Text lines' }, { value: 'multi', label: 'Multi-block' }, { value: 'dots', label: 'Password dots' },
                { value: 'rows', label: 'Rows' }, { value: 'grid', label: 'Grid cells' }, { value: 'mixed', label: 'Mixed shapes' }, { value: 'person', label: 'Person (face)' },
                { value: 'card', label: 'Card info' }, { value: 'id', label: 'ID document' }, { value: 'address', label: 'Address' },
              ]} />
          </Field>
        </>
      )}
      <div className={styles.row}>
        <Field label="Shape">
          <Select<ShapeKind | ''> label={`${name} shape`} variant="dark" minWidth={170} value={(s('shape') as ShapeKind) || ''} onChange={(sh) => set({ shape: sh || undefined }, 'shape')} options={REDACT_SHAPES} />
        </Field>
        {kind === 'blur' && (
          <Field label="Style">
            <Select<BlurMode> label="Blur style" variant="dark" minWidth={170} value={(s('mode', 'gaussian') as BlurMode)} onChange={(m) => set({ mode: m === 'gaussian' ? undefined : m }, 'mode')}
              options={[{ value: 'gaussian', label: 'Gaussian' }, { value: 'motion-h', label: 'Motion ↔' }, { value: 'motion-v', label: 'Motion ↕' }, { value: 'motion-d', label: 'Motion ⤡' }, { value: 'zoom', label: 'Zoom / radial' }, { value: 'spin', label: 'Spin' }, { value: 'noise', label: 'Noise' }, { value: 'bokeh', label: 'Bokeh / lens' }]} />
          </Field>
        )}
        {kind === 'pixelate' && (
          <Field label="Pattern">
            <Select<PixelPattern> label="Pixel pattern" variant="dark" minWidth={170} value={(s('pattern', 'square') as PixelPattern)} onChange={(m) => set({ pattern: m === 'square' ? undefined : m }, 'pattern')}
              options={[{ value: 'square', label: 'Square blocks' }, { value: 'wide', label: 'Rectangular' }, { value: 'mixed', label: 'Mixed blocks' }, { value: 'mosaic', label: 'Mosaic tiles' }, { value: 'dir-h', label: 'Directional ↔' }, { value: 'dir-v', label: 'Directional ↕' }, { value: 'dir-d', label: 'Directional ⤡' }, { value: 'radial', label: 'Radial' }]} />
          </Field>
        )}
      </div>
      {(!s('shape') || s('shape') === 'rect') && (
        <Slider tone="dark" label="Region corner radius" min={0} max={80} value={typeof v.radius === 'number' ? (v.radius as number) : 0} format={(x) => `${x}px`} onChange={(x) => set({ radius: x || undefined }, 'radius')} />
      )}
      {kind !== 'mask' && (
        <>
          <div className={styles.row}>
            <Field label="Fade">
              <Select<RedactFade> label="Fade" variant="dark" minWidth={160} value={(s('fade', 'none') as RedactFade)} onChange={(f) => set({ fade: f === 'none' ? undefined : f }, 'fade')}
                options={[{ value: 'none', label: 'None' }, { value: 'top', label: 'Top fade' }, { value: 'bottom', label: 'Bottom fade' }, { value: 'left', label: 'Left fade' }, { value: 'right', label: 'Right fade' }, { value: 'edges', label: 'Soft edges' }, { value: 'tilt', label: 'Tilt-shift' }]} />
            </Field>
            <Field label="Colour">
              <Select<RedactTone> label="Colour treatment" variant="dark" minWidth={160} value={(s('tone', 'none') as RedactTone)} onChange={(t) => set({ tone: t === 'none' ? undefined : t }, 'tone')}
                options={[{ value: 'none', label: 'Original' }, { value: 'dim', label: 'Dim' }, { value: 'gray', label: 'Grayscale' }, { value: 'mono', label: 'Black & white' }, { value: 'tint', label: 'Brand tint' }]} />
            </Field>
          </div>
          {s('tone') === 'tint' && (
            <Field label="Tint colour">
              <ColorSwatches label="Tint colour" colors={['#7C3AED', '#6D28D9', '#2563EB', '#0EA5E9', '#16A34A', '#E05252', '#F59E0B', '#EC4899']} value={s('tint', '#7C3AED')} onChange={(c) => set({ tint: c }, 'tint')} />
            </Field>
          )}
          <div className={styles.toggleLine}>
            <span>{kind === 'blur' ? 'Focus: blur everything else' : 'Focus: pixelate everything else'}</span>
            <ToggleSwitch size="sm" label="Focus (effect outside the region)" checked={Boolean(v.invert)} onChange={(on) => set({ invert: on || undefined }, 'invert')} />
          </div>
          {kind === 'pixelate' && (
            <div className={styles.toggleLine}>
              <span>Soft pixelate (+ blur)</span>
              <ToggleSwitch size="sm" label="Soft pixelate" checked={Boolean(v.soft)} onChange={(on) => set({ soft: on || undefined }, 'soft')} />
            </div>
          )}
          {kind === 'blur' && (
            <div className={styles.toggleLine}>
              <span>Frosted glass</span>
              <ToggleSwitch size="sm" label="Frosted glass" checked={Boolean(v.glass)} onChange={(on) => set({ glass: on || undefined }, 'glass')} />
            </div>
          )}
        </>
      )}
      <Field label="Border">
        <RadioGroup<RedactBorder> label={`${name} border`} tone="dark" size="sm" value={(s('border', 'none') as RedactBorder)} onChange={(b) => set({ border: b === 'none' ? undefined : b }, 'border')}
          options={[{ value: 'none', label: 'None' }, { value: 'white', label: 'White' }, { value: 'color', label: 'Colour' }, { value: 'dashed', label: 'Dashed' }, { value: 'glow', label: 'Glow' }]} />
      </Field>
      {(s('border') === 'color' || s('border') === 'glow') && (
        <ColorSwatches label="Border colour" colors={['#7C3AED', '#A855F7', '#2563EB', '#16A34A', '#E05252', '#F59E0B', '#FFFFFF', '#111827']} value={s('borderColor', '#7C3AED')} onChange={(c) => set({ borderColor: c }, 'borderColor')} />
      )}
      <Button size="sm" variant="secondary" onClick={() => set({ ...CLEAR_LOOK }, 'look-reset')}>Reset look</Button>
    </>
  );
}

/* ---------------------------------- stickers --------------------------------- */

/** Rendered stickers with their ink measured, so every cell shows the art centred and fitted. */
const stickerArt = new Map<string, { canvas: OffscreenCanvas; x: number; y: number; w: number; h: number } | null>();

function stickerArtOf(def: StickerDef) {
  const key = `${def.variant}|${def.glyph}|${def.badgeStyle ?? ''}|${def.badgeIcon ?? ''}|${def.color ?? ''}`;
  if (stickerArt.has(key)) return stickerArt.get(key)!;
  let art: { canvas: OffscreenCanvas; x: number; y: number; w: number; h: number } | null = null;
  if (typeof OffscreenCanvas !== 'undefined') {
    const S = 240;
    const c = new OffscreenCanvas(S, S);
    const ctx = c.getContext('2d', { willReadFrequently: true });
    if (ctx) {
      renderSticker(ctx, { id: 'p', type: 'sticker', x: S / 2, y: S / 2, size: 96, glyph: def.glyph, variant: def.variant, color: def.color ?? '#E05252', opacity: 1, badgeStyle: def.badgeStyle, badgeIcon: def.badgeIcon });
      // Bounding box of everything drawn (icons with rays or effects reach past their nominal size).
      const d = ctx.getImageData(0, 0, S, S).data;
      let x0 = S;
      let y0 = S;
      let x1 = -1;
      let y1 = -1;
      for (let y = 0; y < S; y++) {
        for (let x = 0; x < S; x++) {
          if (d[(y * S + x) * 4 + 3]! > 8) {
            if (x < x0) x0 = x;
            if (x > x1) x1 = x;
            if (y < y0) y0 = y;
            if (y > y1) y1 = y;
          }
        }
      }
      if (x1 >= x0) art = { canvas: c, x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
    }
  }
  stickerArt.set(key, art);
  return art;
}

function StickerCell({ def }: { def: StickerDef }) {
  if (def.variant === 'emoji') return <span className={styles.stickerEmoji} aria-hidden>{def.glyph}</span>;
  const W = def.variant === 'badge' ? 92 : 40;
  const H = 30;
  return (
    <PreviewCanvas
      width={W}
      height={H}
      draw={(ctx) => {
        const art = stickerArtOf(def);
        if (!art) return;
        const k = Math.min((W - 6) / art.w, (H - 6) / art.h, 0.5);
        const w = art.w * k;
        const h = art.h * k;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(art.canvas, art.x, art.y, art.w, art.h, (W - w) / 2, (H - h) / 2, w, h);
      }}
    />
  );
}

/** Sticker picker with the full sticker sheet. */
function StickerPicker({ value, onPick }: { value: Pick<StickerDef, 'glyph' | 'variant' | 'badgeStyle'>; onPick: (s: StickerDef) => void }) {
  const [group, setGroup] = useState(() => STICKER_GROUPS.find((g) => g.items.some((i) => sameSticker(i, value)))?.id ?? 'emoji');
  const items = STICKER_GROUPS.find((g) => g.id === group)?.items ?? [];
  return (
    <Field label="Sticker">
      <div className={styles.stickerTabs} role="tablist" aria-label="Sticker categories">
        {STICKER_GROUPS.map((g) => (
          <button key={g.id} type="button" role="tab" aria-selected={group === g.id} className={group === g.id ? styles.stickerTabOn : undefined} onClick={() => setGroup(g.id)}>
            {g.label}
          </button>
        ))}
      </div>
      <div className={styles.stickerGrid} role="listbox" aria-label="Stickers">
        {items.map((s) => (
          <button
            key={`${s.variant}-${s.glyph}-${s.badgeStyle ?? ''}`}
            type="button"
            role="option"
            aria-selected={sameSticker(s, value)}
            aria-label={s.label ?? s.glyph}
            title={s.label ?? s.glyph}
            className={`${styles.sticker} ${s.variant === 'badge' ? styles.stickerWide : ''} ${sameSticker(s, value) ? styles.stickerActive : ''}`}
            onClick={() => onPick(s)}
          >
            <StickerCell def={s} />
          </button>
        ))}
      </div>
    </Field>
  );
}

/* --------------------------------- text design -------------------------------- */

function TextPresetPreview({ preset }: { preset: TextPreset }) {
  return (
    <PreviewCanvas
      width={78}
      height={40}
      light
      draw={(ctx) => {
        const a = { ...TEXT_DEFAULT_LOOK, ...TEXT_LOOK_RESET, ...preset.patch, id: 'p', type: 'text', x: 0, y: 0, text: preset.sample, fontSize: 26, opacity: 1, align: 'left' } as TextAnnotation;
        const b = textBounds(a);
        const k = Math.min(72 / b.w, 34 / b.h, 1.2);
        ctx.translate(39, 20);
        ctx.scale(k, k);
        ctx.translate(-(b.x + b.w / 2), -(b.y + b.h / 2));
        renderText(ctx, a);
      }}
    />
  );
}

const TEXT_DEFAULT_LOOK: Partial<TextAnnotation> = { color: '#202938', fontFamily: DEFAULT_FONT, fontSize: 28, bold: true, italic: false, align: 'left', background: 'transparent', borderColor: '#E05252', borderWidth: 0, borderStyle: 'solid', borderRadius: 6 };

/** Style fields of a text (everything except its words and place) — what "Apply to all" copies. */
function textStyleOf(v: Record<string, unknown>): Record<string, unknown> {
  const { id: _i, type: _t, x: _x, y: _y, text: _tx, rotation: _r, hidden: _h, header: _hd, footer: _f, ...rest } = v;
  return rest;
}

type TextPartKey = 'body' | 'header' | 'footer';
type TextTab = 'basic' | 'design' | 'advanced';

/** Text Settings: Basic (content, typography, colour, presets), Design (background, border, spacing), Advanced (effects, title & footer). */
function TextSettings({ v, set, selected }: { v: Record<string, unknown>; set: (patch: Record<string, unknown>, key: string) => void; selected: boolean }) {
  const [tab, setTab] = useState<TextTab>('basic');
  const [partKey, setPartKey] = useState<TextPartKey>('body');
  const [allPresets, setAllPresets] = useState(false);
  const [presetGroup, setPresetGroup] = useState('title');
  const header = (v.header as TextPart | null | undefined) ?? null;
  const footer = (v.footer as TextPart | null | undefined) ?? null;
  const part = partKey === 'header' ? header : partKey === 'footer' ? footer : null;
  const style = (partKey === 'body' ? v : part ?? {}) as Partial<TextStyle>;
  const prefix = partKey === 'header' ? 'Header' : partKey === 'footer' ? 'Footer' : '';
  const setStyle = (patch: Partial<TextStyle>, key: string) => {
    if (partKey === 'body') set(patch as Record<string, unknown>, key);
    else if (part) set({ [partKey]: { ...part, ...patch } }, key);
  };
  const num = (k: string, d = 0) => (typeof v[k] === 'number' ? (v[k] as number) : d);
  const str = (k: string, d = '') => (typeof v[k] === 'string' ? (v[k] as string) : d);
  const padding = (): [number, number, number, number] => {
    const p = v.padding as [number, number, number, number] | null | undefined;
    if (p) return p;
    const d = Math.round(num('fontSize', 28) * 0.3);
    return [d, d, d, d];
  };
  const padLinked = padding().every((x) => x === padding()[0]);
  const deco = str('deco', 'none');
  const bg = str('background', 'transparent');
  const bgMode = deco !== 'none' ? 'design' : bg.startsWith('linear:') ? 'gradient' : bg !== 'transparent' ? 'solid' : 'none';
  const applyPreset = (p: TextPreset) => set({ ...TEXT_LOOK_RESET, ...p.patch, header: p.patch.header ?? header, footer: p.patch.footer ?? footer }, `text-preset-${p.id}`);
  const togglePart = (k: 'header' | 'footer', on: boolean) => set({ [k]: on ? newPart(k === 'header' ? 'Header' : 'Footer', v as unknown as TextStyle) : null }, `${k}-toggle`);
  const presetItems = allPresets ? TEXT_GROUPS.find((g) => g.id === presetGroup)?.items ?? [] : TEXT_GROUPS[0]!.items;
  return (
    <div className={styles.textSettings}>
      <div className={styles.segTabs} role="tablist" aria-label="Text settings">
        {(['basic', 'design', 'advanced'] as const).map((t) => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} className={tab === t ? styles.segOn : undefined} onClick={() => setTab(t)}>
            {t === 'basic' ? 'Basic' : t === 'design' ? 'Design' : 'Advanced'}
          </button>
        ))}
      </div>
      <Field label="Edit style for">
        <RadioGroup<TextPartKey> label="Edit style for" tone="dark" size="sm" value={partKey} onChange={setPartKey}
          options={[{ value: 'header', label: 'Title' }, { value: 'body', label: 'Body' }, { value: 'footer', label: 'Footer' }]} />
      </Field>
      {partKey !== 'body' && !part && (
        <Button size="sm" variant="secondary" onClick={() => togglePart(partKey, true)}>{partKey === 'header' ? 'Add a title above the text' : 'Add a footer below the text'}</Button>
      )}

      {tab === 'basic' && (partKey === 'body' || part) && (
        <>
          <Group title="Text content" icon={<TextCursorInput size={15} />}>
            {partKey === 'body' ? (
              selected ? <AutoTextarea label="Edit text" value={str('text')} placeholder="Enter your text here…" onChange={(t) => set({ text: t }, 'text')} />
                : <div className={styles.hint}>Click on the image to add text. Click a selected text again, press Enter, or type here to change it. Ctrl+Enter finishes.</div>
            ) : (
              <TextField tone="dark" value={part!.text} placeholder={`${prefix} text`} onChange={(e) => set({ [partKey]: { ...part!, text: e.target.value } }, `${partKey}-text`)} aria-label={`${prefix} text`} />
            )}
          </Group>
          <Group title="Typography" icon={<Type size={15} />}>
            <TextStyleFields v={style} name={prefix} alignment={partKey === 'body'} effects={false} section={false} set={setStyle} />
          </Group>
          <Group title="Quick presets" icon={<Sparkles size={15} />} action={<button type="button" className={styles.linkBtn} onClick={() => setAllPresets((x) => !x)}>{allPresets ? 'Fewer' : 'See all'}</button>}>
            {allPresets && (
              <div className={styles.stickerTabs} role="tablist" aria-label="Text design categories">
                {TEXT_GROUPS.slice(1).map((g) => (
                  <button key={g.id} type="button" role="tab" aria-selected={presetGroup === g.id} className={presetGroup === g.id ? styles.stickerTabOn : undefined} onClick={() => setPresetGroup(g.id)}>{g.label}</button>
                ))}
              </div>
            )}
            <div className={styles.presetGrid3} role="listbox" aria-label="Text designs">
              {presetItems.map((p) => (
                <button key={p.id} type="button" role="option" aria-selected={false} aria-label={p.label} title={p.label} onClick={() => applyPreset(p)}>
                  <TextPresetPreview preset={p} />
                  <span>{p.label}</span>
                </button>
              ))}
            </div>
          </Group>
        </>
      )}

      {tab === 'design' && (
        <>
          <Group title="Background" icon={<Square size={15} />}>
            <RadioGroup label="Background type" tone="dark" size="sm" value={bgMode}
              onChange={(m) => {
                if (m === 'none') set({ background: 'transparent', deco: 'none' }, 'bg-none');
                else if (m === 'solid') set({ background: bg !== 'transparent' && !bg.startsWith('linear:') ? bg : '#FFFFFF', deco: 'none' }, 'bg-solid');
                else if (m === 'gradient') set({ background: 'linear:#7C3AED:#EC4899', deco: 'none', color: '#FFFFFF' }, 'bg-gradient');
                else set({ deco: 'brush', decoColor: str('decoColor', '#FDE047') }, 'bg-design');
              }}
              options={[{ value: 'none', label: 'None' }, { value: 'solid', label: 'Solid' }, { value: 'gradient', label: 'Gradient' }, { value: 'design', label: 'Design' }]} />
            {bgMode === 'solid' && (
              <ColorSwatches label="Background colour" colors={[...PALETTE.slice(0, 7), '#EDE9FE', '#DCFCE7', '#FFE4E6', '#E0F2FE', '#FFFFFF']} value={bg} onChange={(c) => set({ background: c }, 'background')} />
            )}
            {bgMode === 'gradient' && (
              <div className={styles.gradientRow} role="radiogroup" aria-label="Background gradient">
                {GRADIENT_PAIRS.map(([a, b]) => {
                  const val = `linear:${a}:${b}`;
                  return <button key={val} type="button" role="radio" aria-checked={bg === val} aria-label={`${a} to ${b}`} className={bg === val ? styles.presetActive : undefined} style={{ background: `linear-gradient(135deg, ${a}, ${b})` }} onClick={() => set({ background: val }, 'background')} />;
                })}
              </div>
            )}
            {bgMode === 'design' && (
              <>
                <Select<NonNullable<TextAnnotation['deco']>> label="Background design" variant="dark" minWidth={180} value={deco as NonNullable<TextAnnotation['deco']>} onChange={(d) => set({ deco: d }, 'deco')} options={TEXT_DECOS} />
                <Field label="Design colour">
                  <ColorSwatches label="Design colour" colors={['#FDE047', '#F9A8D4', '#8B5CF6', '#3B82F6', '#22C55E', '#EF4444', '#F97316', '#111827']} value={str('decoColor', '#FDE047')} onChange={(c) => set({ decoColor: c }, 'decoColor')} />
                </Field>
                <Field label="Second colour">
                  <ColorSwatches label="Design second colour" colors={['#FFFFFF', '#A855F7', '#2563EB', '#EC4899', '#F43F5E', '#FEF9C3', '#EFF6FF', '#111827']} value={str('decoColor2', '#FFFFFF')} onChange={(c) => set({ decoColor2: c }, 'decoColor2')} />
                </Field>
              </>
            )}
            {(partKey === 'body' || part) && (
              <>
                <Field label={prefix ? `${prefix} section background` : 'Section background'}>
                  <ColorSwatches label={prefix ? `${prefix} section background` : 'Section background'} colors={['transparent', ...PALETTE.slice(0, 7)]} value={String(style.sectionBg ?? 'transparent')} onChange={(c) => setStyle({ sectionBg: c }, `${prefix}sectionBg`)} />
                </Field>
                {(style.sectionBg ?? 'transparent') !== 'transparent' && (
                  <Slider tone="dark" label={prefix ? `${prefix} section padding` : 'Section padding'} min={0} max={60} value={Number(style.sectionPad ?? 6)} format={(x) => `${x}px`} onChange={(x) => setStyle({ sectionPad: x }, `${prefix}sectionPad`)} />
                )}
              </>
            )}
          </Group>
          <Group title="Border" icon={<LayoutGrid size={15} />} action={<ToggleSwitch size="sm" label="Text border" checked={num('borderWidth', 0) > 0} onChange={(x) => set({ borderWidth: x ? 3 : 0 }, 'borderWidth')} />}>
            {num('borderWidth', 0) > 0 ? (
              <>
                <Slider tone="dark" label="Border width" min={1} max={24} value={num('borderWidth', 0)} format={(x) => `${x}px`} onChange={(x) => set({ borderWidth: x }, 'borderWidth')} />
                <Field label="Border colour">
                  <ColorSwatches label="Border colour" colors={PALETTE} value={str('borderColor', '#E05252')} onChange={(c) => set({ borderColor: c }, 'borderColor')} />
                </Field>
                <Field label="Border style">
                  <RadioGroup label="Border style" tone="dark" size="sm" value={str('borderStyle', 'solid') as DashStyle} onChange={(d) => set({ borderStyle: d }, 'borderStyle')} options={DASH_OPTIONS} />
                </Field>
              </>
            ) : <div className={styles.hint}>Turn on for a line around the text.</div>}
          </Group>
          <Group title="Spacing & corners" icon={<Move size={15} />}>
            <Slider tone="dark" label="Corner radius" min={0} max={80} value={Math.min(80, num('borderRadius', 6))} format={(x) => `${x}px`} onChange={(x) => set({ borderRadius: x }, 'borderRadius')} />
            <div className={styles.subTitle}>
              Padding
              <IconButton tone="dark" size="sm" label={padLinked ? 'Set each side separately' : 'Same on all sides'} icon={padLinked ? <Link size={14} /> : <Unlink size={14} />} active={padLinked}
                onClick={() => { const p = padding(); set({ padding: padLinked ? [p[0], p[1] + 1, p[2], p[3] + 1] : [p[0], p[0], p[0], p[0]] }, 'padding-link'); }} />
            </div>
            {padLinked ? (
              <Slider tone="dark" label="All sides" min={0} max={120} value={padding()[0]} format={(x) => `${x}px`} onChange={(x) => set({ padding: [x, x, x, x] }, 'padding')} />
            ) : (
              <div className={styles.padGrid}>
                {(['Top', 'Right', 'Bottom', 'Left'] as const).map((side, i) => (
                  <Slider key={side} tone="dark" label={side} min={0} max={120} value={padding()[i]!} format={(x) => `${x}px`}
                    onChange={(x) => { const p = [...padding()] as [number, number, number, number]; p[i] = x; set({ padding: p }, `padding-${side}`); }} />
                ))}
              </div>
            )}
            {deco === 'none' && bg === 'transparent' && num('borderWidth', 0) === 0 && <div className={styles.hint}>Padding and corners show once the text has a background, design or border.</div>}
          </Group>
        </>
      )}

      {tab === 'advanced' && (
        <>
          {(partKey === 'body' || part) && (
            <Group title="Effects" icon={<Wand2 size={15} />}>
              <TextEffectFields v={style} name={prefix} set={setStyle} />
            </Group>
          )}
          <Group title="Header & footer" icon={<Baseline size={15} />}>
            <div className={styles.inlineToggle}>
              Title (header)
              <ToggleSwitch size="sm" label="Header" checked={Boolean(header)} onChange={(x) => togglePart('header', x)} />
            </div>
            {header && <TextField tone="dark" value={header.text} placeholder="Header text" onChange={(e) => set({ header: { ...header, text: e.target.value } }, 'header-text')} aria-label="Header text" />}
            <div className={styles.inlineToggle}>
              Footer
              <ToggleSwitch size="sm" label="Footer" checked={Boolean(footer)} onChange={(x) => togglePart('footer', x)} />
            </div>
            {footer && <TextField tone="dark" value={footer.text} placeholder="Footer text" onChange={(e) => set({ footer: { ...footer, text: e.target.value } }, 'footer-text')} aria-label="Footer text" />}
            {Boolean(header || footer) && (
              <div className={styles.inlineToggle}>
                Divider lines
                <ToggleSwitch size="sm" label="Divider lines" checked={Boolean(v.dividers)} onChange={(x) => set({ dividers: x }, 'dividers')} />
              </div>
            )}
            <div className={styles.hint}>Pick Title or Footer in “Edit style for” to give it its own font, colours and effects.</div>
          </Group>
        </>
      )}
      <div className={styles.textActions}>
        <Button size="sm" variant="secondary" icon={<RotateCcw size={14} />} onClick={() => set({ ...TEXT_LOOK_RESET, ...TEXT_DEFAULT_LOOK, color: '#E05252', fontSize: num('fontSize', 28) }, 'text-reset')}>Reset</Button>
        <Button size="sm" variant="primary" icon={<CopyCheck size={14} />} onClick={() => set(textStyleOf(v), 'text:apply-all')} title="Give every text on the image this style (their words stay)">Apply to all text</Button>
      </div>
    </div>
  );
}

/* --------------------------------- watermark --------------------------------- */

function WatermarkPreview({ wm }: { wm: Watermark }) {
  return (
    <PreviewCanvas
      width={74}
      height={46}
      light
      draw={(ctx) => {
        const g = ctx.createLinearGradient(0, 0, 74, 46);
        g.addColorStop(0, '#EEF2FF');
        g.addColorStop(1, '#F5F3FF');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, 74, 46);
        drawWatermark(ctx, { width: 74, height: 46 } as EditorDoc, { ...wm, size: Math.min(0.3, wm.size * 2.2) });
      }}
    />
  );
}

/** Watermark design sheet (applies style, colours, position, rotation and opacity). */
function WatermarkDesigns({ wm, set }: { wm: Watermark; set: (patch: Partial<Watermark>, key: string) => void }) {
  const groups = [...new Set(WATERMARK_PRESETS.map((p) => p.group))];
  const [group, setGroup] = useState(groups[0]!);
  return (
    <Field label="Designs">
      <div className={styles.stickerTabs} role="tablist" aria-label="Watermark design categories">
        {groups.map((g) => (
          <button key={g} type="button" role="tab" aria-selected={group === g} className={group === g ? styles.stickerTabOn : undefined} onClick={() => setGroup(g)}>{g}</button>
        ))}
      </div>
      <div className={styles.presetGrid3} role="listbox" aria-label="Watermark designs">
        {WATERMARK_PRESETS.filter((p) => p.group === group).map((p) => (
          <button key={p.id} type="button" role="option" aria-selected={false} aria-label={p.label} title={p.label} onClick={() => set({ ...p.patch, text: p.patch.text ?? wm.text, subtitle: p.patch.subtitle ?? wm.subtitle }, `design-${p.id}`)}>
            <WatermarkPreview wm={{ ...wm, ...p.patch, text: p.patch.text ?? wm.text }} />
            <span>{p.label}</span>
          </button>
        ))}
      </div>
    </Field>
  );
}

/** Reads a picked logo, keeps it small (max 512 px, PNG with transparency) and returns 'image:<data URL>'. */
async function readLogo(file: File): Promise<string> {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, 512 / Math.max(bmp.width, bmp.height));
  const c = new OffscreenCanvas(Math.max(1, Math.round(bmp.width * k)), Math.max(1, Math.round(bmp.height * k)));
  const cx = c.getContext('2d');
  if (!cx) throw new Error('Canvas unavailable');
  cx.imageSmoothingQuality = 'high';
  cx.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close();
  const blob = await c.convertToBlob({ type: 'image/png' });
  const url = await new Promise<string>((res) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.readAsDataURL(blob); });
  rememberFrameImage(url, await createImageBitmap(blob));
  return `image:${url}`;
}

export function PropertiesPanel({
  tool, selected, toolStyles, onChange, onOpacity, onRotation, onDelete, crop, cut, watermark, onWatermark, frame, onFrame, lastFrame, lastWatermark, sourceUrl, sourceTitle, frameApply, docSize,
}: Props) {
  if (crop) return <CropSection crop={crop} />;
  if (cut) return <CutSection cut={cut} />;
  if (tool === 'watermark' && !selected) return <WatermarkSection watermark={watermark} onChange={onWatermark} last={lastWatermark ?? null} />;
  if (tool === 'frame' && !selected) return <FrameSection frame={frame} onChange={onFrame} last={lastFrame ?? null} sourceUrl={sourceUrl} sourceTitle={sourceTitle} apply={frameApply} />;

  const subject = selected?.type ?? tool;
  const kind = styleKindFor(subject);
  // Values come from the selected object when there is one, otherwise from the tool defaults.
  const v: Record<string, unknown> = { ...((selected ?? (kind ? toolStyles[kind] : {})) as Record<string, unknown>) };
  if (selected && (selected.type === 'line' || selected.type === 'arrow')) v.bends = selected.bends?.length ?? 0;
  const num = (k: string, fallback = 0) => (typeof v[k] === 'number' ? (v[k] as number) : fallback);
  const str = (k: string, fallback = '') => (typeof v[k] === 'string' ? (v[k] as string) : fallback);
  const set = (patch: Record<string, unknown>, key: string) => kind && onChange(kind, patch, key);

  const onDefaults = () => {
    if (!kind) return;
    const base = { ...(DEFAULT_TOOL_STYLES[kind] as Record<string, unknown>) };
    if (kind === 'blur' || kind === 'pixelate' || kind === 'mask') Object.assign(base, CLEAR_LOOK);
    set(base, `${kind}-reset`);
  };
  const resetButton = kind && kind !== 'text' && kind !== 'eraser' && (
    <Button size="sm" variant="secondary" icon={<RotateCcw size={14} />} onClick={onDefaults} title="Back to the default look of this tool">Reset</Button>
  );
  const strokeKind = kind === 'pen' || kind === 'highlighter';
  const designName = str('design', 'bubble') as CalloutAnnotation['design'];
  const recipe = kind === 'callout' ? recipeOf({ design: designName }) : null;
  const hasCustomMarkerColours = v.fillColor !== undefined || v.textColor !== undefined || v.borderColor !== undefined;

  let body: ReactNode = null;
  if (strokeKind) {
    body = (
      <PanelTabs
        key={kind}
        id={kind}
        name={kind === 'pen' ? 'Pen' : 'Highlighter'}
        tabs={[
          {
            id: 'design', label: 'Design', content: (
              <Group title="Designs" icon={kind === 'pen' ? <PenLine size={15} /> : <Highlighter size={15} />}>
                <StrokePicker
                  kind={kind}
                  design={str('design', kind === 'pen' ? 'standard' : 'flat')}
                  color={str('color')}
                  onPick={(p) => set({ design: p.design, color: p.color, accent: p.accent, ...(p.width ? { width: p.width } : {}) }, `design-${p.id}`)}
                />
                {str('design') && str('design') !== 'standard' && str('design') !== 'flat' && (
                  <Button size="sm" variant="secondary" onClick={() => set({ design: kind === 'pen' ? 'standard' : 'flat', accent: undefined }, 'design-plain')}>
                    {kind === 'pen' ? 'Plain pen' : 'Plain highlighter'}
                  </Button>
                )}
              </Group>
            ),
          },
          {
            id: 'style', label: 'Style', content: (
              <>
                <Group title="Colour" icon={<Palette size={15} />}>
                  <ColorSwatches label="Colour" colors={PALETTE} value={str('color')} onChange={(c) => set({ color: c }, 'color')} />
                  {ACCENT_DESIGNS.has(str('design')) && (
                    <Field label="Second colour">
                      <ColorSwatches label="Second colour" colors={['#111827', '#FFFFFF', '#6D28D9', '#D4A000', ...PALETTE.slice(0, 5)]} value={str('accent', '#111827')} onChange={(c) => set({ accent: c }, 'accent')} />
                    </Field>
                  )}
                </Group>
                <Group title="Size" icon={<Ruler size={15} />}>
                  <Slider tone="dark" label="Thickness" min={1} max={kind === 'highlighter' ? 200 : 100} value={Math.round(num('width', 4))} format={(x) => `${x}px`} onChange={(x) => set({ width: x }, 'width')} />
                </Group>
              </>
            ),
          },
        ]}
      />
    );
  } else if (kind === 'line') {
    body = (
      <PanelTabs
        key="line"
        id="line"
        name="Line"
        tabs={[
          {
            id: 'styles', label: 'Styles', content: (
              <>
                <Group title="Line & arrow styles" icon={<ArrowUpRight size={15} />}>
                  <div className={styles.presetGrid4} role="listbox" aria-label="Line and arrow styles">
                    {LINE_PRESETS.map((p) => {
                      const active = matchesLine(v, p.patch);
                      return (
                        <button key={p.id} type="button" role="option" aria-selected={active} aria-label={p.label} className={active ? styles.presetActive : undefined} onClick={() => set({ ...p.patch, curve: p.patch.bends > 0 }, `preset-${p.id}`)} title={p.label}>
                          <LinePresetPreview patch={p.patch} />
                          <span>{p.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </Group>
                <Group title="Ready-made arrows & connectors" icon={<Sparkles size={15} />}>
                  <div className={styles.presetGrid4} role="listbox" aria-label="Coloured arrows and connectors">
                    {PREMIUM_LINES.map((p) => (
                      <button key={p.id} type="button" role="option" aria-selected={false} aria-label={p.label} title={p.label}
                        onClick={() => set({ ...p.patch, curve: p.patch.bends > 0, route: p.patch.route, outline: p.patch.outline }, `preset-${p.id}`)}>
                        <LinePresetPreview patch={p.patch} />
                        <span>{p.label}</span>
                      </button>
                    ))}
                  </div>
                </Group>
              </>
            ),
          },
          {
            id: 'custom', label: 'Customize', content: (
              <>
                <Group title="Colour & thickness" icon={<Palette size={15} />}>
                  <ColorSwatches label="Colour" colors={PALETTE} value={str('color')} onChange={(c) => set({ color: c }, 'color')} />
                  <Slider tone="dark" label="Thickness" min={1} max={60} value={Math.round(num('width', 4))} format={(x) => `${x}px`} onChange={(x) => set({ width: x }, 'width')} />
                </Group>
                <Group title="Shape of the line" icon={<Spline size={15} />}>
                  <Field label="Route">
                    <RadioGroup label="Line route" tone="dark" size="sm" value={str('route', 'straight')} onChange={(r) => set({ route: r === 'elbow' ? 'elbow' : undefined, ...(r === 'elbow' ? { bends: 0 } : {}) }, 'route')} options={[{ value: 'straight', label: 'Straight / curved' }, { value: 'elbow', label: 'Elbow' }]} />
                  </Field>
                  <Field label="Design">
                    <Select label="Line design" variant="dark" value={str('body', 'line') as LineBody} minWidth={170} onChange={(b) => set({ body: b }, 'body')} options={BODY_OPTIONS} />
                  </Field>
                  <Field label="Line style">
                    <RadioGroup label="Line style" tone="dark" size="sm" value={str('dash', 'solid') as DashStyle} onChange={(d) => set({ dash: d }, 'dash')} options={DASH_OPTIONS} />
                  </Field>
                  <Field label="Curve points">
                    <RadioGroup label="Curve points" tone="dark" size="sm" value={num('bends', 0)} onChange={(n) => set({ bends: n, curve: false }, 'bends')}
                      options={[{ value: 0, label: 'None' }, ...Array.from({ length: MAX_BENDS }, (_, i) => ({ value: i + 1, label: String(i + 1) }))]} />
                  </Field>
                </Group>
                <Group title="Arrow heads" icon={<ArrowUpRight size={15} />}>
                  <div className={styles.row}>
                    <Field label="Start">
                      <Select label="Start head" variant="dark" value={str('headStart', 'none') as HeadStyle} minWidth={150} onChange={(h) => set({ headStart: h }, 'headStart')} options={HEAD_OPTIONS} />
                    </Field>
                    <Field label="End">
                      <Select label="End head" variant="dark" value={str('headEnd', 'triangle') as HeadStyle} minWidth={150} onChange={(h) => set({ headEnd: h }, 'headEnd')} options={HEAD_OPTIONS} />
                    </Field>
                  </div>
                </Group>
                <div className={styles.hint}>{num('bends', 0) > 0 && selected ? 'Drag the round handles to shape the curve.' : 'Drag from A to B, or click A then click B. Shift keeps 45° angles; Esc cancels. A line is an arrow without heads.'}</div>
              </>
            ),
          },
        ]}
      />
    );
  } else if (kind === 'shape') {
    body = (
      <PanelTabs
        key="shape"
        id="shape"
        name="Shapes"
        tabs={[
          {
            id: 'shapes', label: 'Shapes', content: (
              <Group title="Shape library" icon={<Shapes size={15} />}>
                <ShapePicker
                  value={str('shape', subject === 'ellipse' ? 'ellipse' : 'rect')}
                  onPick={(pr) => set({ shape: pr.kind, stroke: pr.stroke, fill: pr.fill, look: pr.look ?? 'flat', dash: pr.dash ?? 'solid', ...(pr.width !== undefined ? { width: pr.width } : {}), ...(pr.id === 'rsq' || pr.id === 'rrect' ? { radius: 14 } : pr.kind === 'rect' ? { radius: 0 } : {}) }, 'shape-preset')}
                />
              </Group>
            ),
          },
          {
            id: 'style', label: 'Style', content: (
              <>
                <Group title="Colours" icon={<Palette size={15} />}>
                  <Field label="Stroke">
                    <ColorSwatches label="Stroke colour" colors={PALETTE} value={str('stroke')} onChange={(c) => set({ stroke: c }, 'stroke')} />
                  </Field>
                  <Field label="Fill">
                    <ColorSwatches label="Fill colour" colors={['transparent', ...PALETTE.slice(0, 7), '#EFE7FF', '#DCEBFF', '#FFE680']} value={str('fill', 'transparent')} onChange={(c) => set({ fill: c }, 'fill')} />
                  </Field>
                  <Field label="Finish">
                    <Select<ShapeLook> label="Shape finish" variant="dark" value={(str('look', 'flat') || 'flat') as ShapeLook} minWidth={200} onChange={(l) => set({ look: l }, 'look')} options={LOOK_OPTIONS} />
                  </Field>
                </Group>
                <Group title="Border & corners" icon={<Square size={15} />}>
                  <Slider tone="dark" label="Thickness" min={1} max={40} value={Math.round(num('width', 4))} format={(x) => `${x}px`} onChange={(x) => set({ width: x }, 'width')} />
                  <Field label="Border style">
                    <RadioGroup label="Border style" tone="dark" size="sm" value={str('dash', 'solid') as DashStyle} onChange={(d) => set({ dash: d }, 'dash')} options={DASH_OPTIONS} />
                  </Field>
                  {(subject === 'rect' || (!selected && tool === 'rect')) && (
                    <Slider tone="dark" label="Corner radius" min={0} max={120} value={num('radius', 0)} format={(x) => `${x}px`} onChange={(x) => set({ radius: x }, 'radius')} />
                  )}
                </Group>
              </>
            ),
          },
        ]}
      />
    );
  } else if (kind === 'text') {
    body = <TextSettings key={selected?.id ?? 'tool'} v={v} set={set} selected={Boolean(selected)} />;
  } else if (kind === 'callout') {
    const ts = (v.titleStyle as TextStyle | undefined) ?? toolStyles.callout.titleStyle;
    body = (
      <PanelTabs
        key="callout"
        id="callout"
        name="Callout"
        tabs={[
          {
            id: 'design', label: 'Design', content: (
              <Group title="Callout designs" icon={<MessageSquareText size={15} />}>
                <CalloutPicker
                  design={str('design', 'bubble')}
                  fill={str('fill')}
                  onPick={(d) => {
                    const titled = ['titled', 'tag', 'hexagon', 'number', 'underline', 'banner', 'circle', 'leader', 'divided', 'card', 'step', 'note', 'glass', 'tooltip'].includes(d.id);
                    const curTitle = str('title');
                    const nts = { ...ts, ...(d.patch.titleStyle ?? {}) };
                    const sampleTitle = d.sample?.title ?? (titled ? (d.id === 'number' ? '01' : d.id === 'step' ? '1' : 'Title') : '');
                    set({
                      shape: undefined, icon: undefined, badge: undefined, dash: 'solid', bold: false, italic: false, leaderEndColor: undefined, titleOffset: undefined, textOffset: undefined,
                      ...d.patch, design: d.id, titleStyle: nts,
                      // A new callout starts with the design's sample words; an existing one keeps its own.
                      title: selected ? curTitle || (d.sample?.title && !str('text') ? d.sample.title : curTitle) : sampleTitle,
                      ...(selected ? {} : { placeholderText: d.sample?.text ?? '' }),
                    }, `design-${d.key}`);
                  }}
                />
                {recipe && (
                  <>
                    <Field label="Body shape">
                      <Select<ShapeKind | ''> label="Callout body shape" variant="dark" minWidth={190} value={(str('shape') as ShapeKind) || ''} onChange={(s) => set({ shape: s || undefined }, 'shape')} options={[{ value: '', label: 'Design default' }, ...CALLOUT_BODY_SHAPES]} />
                    </Field>
                    {recipe.badge && recipe.badge !== 'icon' && recipe.badge !== 'band' && (
                      <Field label="Badge text">
                        <TextField tone="dark" value={str('badge')} placeholder="1" maxLength={12} onChange={(e) => set({ badge: e.target.value }, 'badge')} aria-label="Badge text" />
                      </Field>
                    )}
                    {recipe.badge === 'icon' && (
                      <Field label="Icon">
                        <Select<BadgeIcon> label="Badge icon" variant="dark" minWidth={170} value={(str('icon') || 'info') as BadgeIcon} onChange={(i) => set({ icon: i }, 'icon')} options={BADGE_ICONS} />
                      </Field>
                    )}
                  </>
                )}
              </Group>
            ),
          },
          {
            id: 'text', label: 'Text', content: (
              <>
                <Group title="Text content" icon={<TextCursorInput size={15} />}>
                  {selected ? <AutoTextarea label="Edit text" value={str('text')} placeholder="Type your text…" onChange={(t) => set({ text: t }, 'text')} /> : <div className={styles.hint}>Click (or drag) on the image to add a callout and start typing; it grows to fit.</div>}
                </Group>
                <Group title="Typography" icon={<Type size={15} />}>
                  <TextStyleFields v={v as Partial<TextStyle>} set={set} maxSize={160} effects={false} />
                </Group>
                <Group title="Title" icon={<Baseline size={15} />}>
                  <TextField tone="dark" value={str('title')} placeholder="No title" onChange={(e) => set({ title: e.target.value }, 'title')} aria-label="Callout title" />
                  {str('title') && <TextStyleFields name="Title" v={ts} maxSize={160} effects={false} set={(patch, key) => set({ titleStyle: { ...ts, ...patch } }, key)} />}
                </Group>
                {selected && (
                  <Group title="Text position" icon={<Move size={15} />}>
                    <div className={styles.hint}>Drag the round four-arrow handle next to the title or the text to place it anywhere.</div>
                    <button type="button" className={styles.ocrBtn} disabled={!v.titleOffset && !v.textOffset} onClick={() => set({ titleOffset: undefined, textOffset: undefined }, 'textPosition')}>Reset text position</button>
                  </Group>
                )}
              </>
            ),
          },
          {
            id: 'advanced', label: 'Advanced', content: (
              <>
                <Group title="Pointer" icon={<Pointer size={15} />}>
                  <Field label="Pointer">
                    <RadioGroup<CalloutTail> label="Pointer" tone="dark" size="sm" value={(str('tail', 'speech') as CalloutTail) ?? 'speech'} onChange={(t) => set({ tail: t }, 'tail')}
                      options={[{ value: 'none', label: 'None' }, { value: 'speech', label: 'Tail' }, { value: 'leader', label: 'Leader line' }]} />
                  </Field>
                  {str('tail', 'speech') === 'leader' && (
                    <Field label="Line end">
                      <RadioGroup<LeaderEnd> label="Leader end" tone="dark" size="sm" value={(str('leaderEnd', 'ring') as LeaderEnd)} onChange={(t) => set({ leaderEnd: t }, 'leaderEnd')}
                        options={[{ value: 'ring', label: '◎' }, { value: 'dot', label: '●' }, { value: 'square', label: '■' }, { value: 'diamond', label: '◇' }, { value: 'arrow', label: '▶' }, { value: 'none', label: '—' }]} />
                    </Field>
                  )}
                  {str('tail', 'speech') === 'leader' && str('leaderEnd', 'ring') !== 'none' && (
                    <Field label="Line end colour">
                      <ColorSwatches label="Line end colour" colors={PALETTE} value={str('leaderEndColor', str('stroke'))} onChange={(c) => set({ leaderEndColor: c }, 'leaderEndColor')} />
                    </Field>
                  )}
                </Group>
                <Group title="Colours & lines" icon={<Palette size={15} />}>
                  <Field label="Fill">
                    <ColorSwatches label="Bubble fill" colors={['transparent', ...PALETTE.slice(0, 5), '#202938', '#FFFFFF']} value={str('fill', '#FFFFFF')} onChange={(c) => set({ fill: c }, 'fill')} />
                  </Field>
                  <Field label="Accent (title bar, marks)">
                    <ColorSwatches label="Accent colour" colors={PALETTE} value={str('accent', str('stroke'))} onChange={(c) => set({ accent: c }, 'accent')} />
                  </Field>
                  <Field label="Lines">
                    <ColorSwatches label="Outline colour" colors={PALETTE} value={str('stroke')} onChange={(c) => set({ stroke: c }, 'stroke')} />
                  </Field>
                  <Slider tone="dark" label="Line width" min={0} max={16} value={num('strokeWidth', 3)} format={(x) => `${x}px`} onChange={(x) => set({ strokeWidth: x }, 'strokeWidth')} />
                  <Field label="Line style">
                    <RadioGroup label="Callout line style" tone="dark" size="sm" value={str('dash', 'solid') as DashStyle} onChange={(d) => set({ dash: d }, 'dash')} options={DASH_OPTIONS} />
                  </Field>
                  <Slider tone="dark" label="Corner radius" min={0} max={60} value={num('radius', 12)} format={(x) => `${x}px`} onChange={(x) => set({ radius: x }, 'radius')} />
                </Group>
                <div className={styles.hint}>Drag the round handle to point the callout; click a selected callout to edit its text on the image.</div>
              </>
            ),
          },
        ]}
      />
    );
  } else if (kind === 'sticker') {
    body = (
      <PanelTabs
        key="sticker"
        id="sticker"
        name="Sticker"
        tabs={[
          {
            id: 'stickers', label: 'Stickers', content: (
              <>
                <Group title="Sticker library" icon={<Smile size={15} />}>
                  <StickerPicker
                    value={{ glyph: str('glyph'), variant: (str('variant', 'emoji') as StickerDef['variant']), badgeStyle: (str('badgeStyle') || undefined) as StickerDef['badgeStyle'] }}
                    onPick={(st) => set({ glyph: st.glyph, variant: st.variant, badgeStyle: st.badgeStyle, badgeIcon: st.badgeIcon, ...(st.color ? { color: st.color } : {}) }, 'glyph')}
                  />
                </Group>
                <Group title="Your own words" icon={<Tag size={15} />}>
                  <CustomBadgeField value={str('variant') === 'badge' ? str('glyph') : ''} color={str('color', '#E05252')} onChange={(text) => set({ glyph: text, variant: 'badge' }, 'glyph-text')} />
                </Group>
              </>
            ),
          },
          {
            id: 'style', label: 'Style', content: (
              <>
                {str('variant') === 'badge' && (
                  <Group title="Badge" icon={<Tag size={15} />}>
                    <Field label="Badge style">
                      <RadioGroup<NonNullable<StickerAnnotation['badgeStyle']>> label="Badge style" tone="dark" size="sm" value={(str('badgeStyle', 'pill') as NonNullable<StickerAnnotation['badgeStyle']>)} onChange={(b) => set({ badgeStyle: b }, 'badgeStyle')}
                        options={[{ value: 'pill', label: 'Pill' }, { value: 'burst', label: 'Burst' }, { value: 'tilted', label: 'Tilted' }, { value: 'soft', label: 'Soft' }, { value: 'outline', label: 'Outline' }]} />
                    </Field>
                    <Field label="Badge icon">
                      <RadioGroup label="Badge icon" tone="dark" size="sm" value={str('badgeIcon', '')} onChange={(i) => set({ badgeIcon: i || undefined }, 'badgeIcon')}
                        options={[{ value: '', label: 'None' }, { value: '🔥', label: '🔥' }, { value: '👑', label: '👑' }, { value: '💡', label: '💡' }, { value: '✨', label: '✨' }, { value: '🔄', label: '🔄' }, { value: '⭐', label: '⭐' }]} />
                    </Field>
                  </Group>
                )}
                <Group title="Look" icon={<Palette size={15} />}>
                  {str('variant') !== 'emoji' && (
                    <Field label={str('variant') === 'badge' ? 'Badge colour' : 'Sticker colour'}>
                      <ColorSwatches label={str('variant') === 'badge' ? 'Badge colour' : 'Sticker colour'} colors={[...PALETTE, '#7C3AED', '#22C55E', '#3B82F6']} value={str('color', '#E05252')} onChange={(c) => set({ color: c }, 'color')} />
                    </Field>
                  )}
                  <div className={styles.toggleLine}>
                    <span>Sticker edge (white die-cut + shadow)</span>
                    <ToggleSwitch size="sm" label="Sticker edge" checked={Boolean(v.cutout)} onChange={(on) => set({ cutout: on }, 'cutout')} />
                  </div>
                  <Slider tone="dark" label="Size" min={20} max={300} value={Math.round(num('size', 64))} format={(x) => `${Math.round(x)}px`} onChange={(x) => set({ size: x }, 'size')} />
                </Group>
              </>
            ),
          },
        ]}
      />
    );
  } else if (kind === 'blur' || kind === 'pixelate' || kind === 'mask') {
    const name = kind === 'blur' ? 'Blur' : kind === 'pixelate' ? 'Pixelate' : 'Mask';
    body = (
      <PanelTabs
        key={kind}
        id={kind}
        name={name}
        tabs={[
          {
            id: 'designs', label: 'Designs', content: (
              <Group title={`${name} designs`} icon={kind === 'blur' ? <Droplet size={15} /> : kind === 'pixelate' ? <Grid3x3 size={15} /> : <EyeOff size={15} />}>
                <RedactDesigns part="designs" kind={kind} v={v} set={set} selected={Boolean(selected)} docSize={docSize} />
              </Group>
            ),
          },
          {
            id: 'adjust', label: 'Adjust', content: (
              <Group title="Settings" icon={<SlidersHorizontal size={15} />}>
                <RedactDesigns part="adjust" kind={kind} v={v} set={set} selected={Boolean(selected)} docSize={docSize} />
              </Group>
            ),
          },
        ]}
      />
    );
  } else if (kind === 'marker') {
    body = (
      <PanelTabs
        key="marker"
        id="marker"
        name="Marker"
        tabs={[
          {
            id: 'design', label: 'Design', content: (
              <>
                <Group title="Shape" icon={<Hash size={15} />}>
                  <div className={styles.shapeGrid} role="radiogroup" aria-label="Marker shape">
                    {MARKER_SHAPES.map((shape) => (
                      <button key={shape} type="button" role="radio" aria-checked={str('shape', 'circle') === shape} aria-label={MARKER_SHAPE_NAMES[shape] ?? shape} title={MARKER_SHAPE_NAMES[shape] ?? shape}
                        className={str('shape', 'circle') === shape ? styles.presetActive : undefined} onClick={() => set({ shape }, 'shape')}>
                        <MarkerPreview shape={shape} style={str('style', 'filled') as MarkerStyle} color={str('color', '#E05252')} counter={str('counter', 'number') as MarkerCounter} />
                      </button>
                    ))}
                  </div>
                  <Field label="Style">
                    <RadioGroup<MarkerStyle> label="Marker style" tone="dark" size="sm" value={str('style', 'filled') as MarkerStyle} onChange={(st) => set({ style: st }, 'style')} options={[{ value: 'gradient', label: 'Premium' }, { value: 'filled', label: 'Filled' }, { value: 'outline', label: 'Outline' }, { value: 'soft', label: 'Soft' }, { value: 'dashed', label: 'Dashed' }, { value: 'layered', label: 'Layered' }]} />
                  </Field>
                </Group>
                <Group title="Numbers & label" icon={<Tag size={15} />}>
                  <Field label="Counting">
                    <RadioGroup<MarkerCounter> label="Marker counting" tone="dark" size="sm" value={str('counter', 'number') as MarkerCounter} onChange={(c) => set({ counter: c }, 'counter')} options={[{ value: 'number', label: '1 2 3' }, { value: 'upper', label: 'A B C' }, { value: 'lower', label: 'a b c' }, { value: 'roman', label: 'i ii iii' }, { value: 'step', label: 'Step 1' }]} />
                  </Field>
                  <Field label="Label beside the number">
                    <TextField tone="dark" value={str('label')} placeholder="e.g. Step One, Note, Tip" maxLength={40} onChange={(e) => set({ label: e.target.value || undefined }, 'label')} aria-label="Marker label" />
                  </Field>
                  {str('label').trim() && (
                    <Field label="Label style">
                      <RadioGroup<MarkerLabelStyle> label="Marker label style" tone="dark" size="sm" value={(str('labelStyle', 'pill') as MarkerLabelStyle)} onChange={(l) => set({ labelStyle: l }, 'labelStyle')}
                        options={[{ value: 'pill', label: 'Pill' }, { value: 'slant', label: 'Slanted' }, { value: 'tag', label: 'Tag' }]} />
                    </Field>
                  )}
                </Group>
              </>
            ),
          },
          {
            id: 'style', label: 'Colours & size', content: (
              <>
                <Group title="Colour & size" icon={<Palette size={15} />}>
                  <ColorSwatches label="Colour" colors={PALETTE} value={str('color')} onChange={(c) => set({ color: c }, 'color')} />
                  <Slider tone="dark" label="Size" min={16} max={160} value={Math.round(num('size', 50))} format={(x) => `${x}px`} onChange={(x) => set({ size: x }, 'size')} />
                </Group>
                <Group title="Custom colours" icon={<Brush size={15} />} action={
                  <ToggleSwitch size="sm" label="Custom marker colours" checked={hasCustomMarkerColours}
                    onChange={(on) => {
                      const auto = markerAutoColors({ color: str('color', '#E05252'), style: str('style', 'filled') as MarkerStyle });
                      set(on ? { fillColor: auto.fill, textColor: auto.text, borderColor: auto.border } : { fillColor: undefined, textColor: undefined, borderColor: undefined }, 'marker-colors');
                    }} />
                }>
                  {hasCustomMarkerColours ? (
                    <>
                      <Field label="Border colour">
                        <ColorSwatches label="Marker border colour" colors={['#FFFFFF', '#101828', ...PALETTE.filter((c) => c !== '#FFFFFF' && c !== '#101828')]} value={str('borderColor', '#FFFFFF')} onChange={(c) => set({ borderColor: c }, 'borderColor')} />
                      </Field>
                      <Field label="Background colour">
                        <ColorSwatches label="Marker background colour" colors={['#FFFFFF', '#101828', ...PALETTE.filter((c) => c !== '#FFFFFF' && c !== '#101828')]} value={str('fillColor', '#FFFFFF')} onChange={(c) => set({ fillColor: c }, 'fillColor')} />
                      </Field>
                      <Field label="Text colour">
                        <ColorSwatches label="Marker text colour" colors={['#FFFFFF', '#101828', ...PALETTE.filter((c) => c !== '#FFFFFF' && c !== '#101828')]} value={str('textColor', '#FFFFFF')} onChange={(c) => set({ textColor: c }, 'textColor')} />
                      </Field>
                    </>
                  ) : <div className={styles.hint}>Turn on to pick the border, background and number colours yourself.</div>}
                </Group>
              </>
            ),
          },
        ]}
      />
    );
  } else if (kind === 'cursor') {
    body = (
      <PanelTabs
        key="cursor"
        id="cursor"
        name="Cursor"
        tabs={[
          {
            id: 'design', label: 'Design', content: (
              <>
                <Group title="Quick looks" icon={<Sparkles size={15} />}>
                  <div className={styles.shapeGrid} role="listbox" aria-label="Cursor quick looks">
                    {CURSOR_LOOKS.map((l) => (
                      <button key={l.id} type="button" role="option" aria-selected={false} aria-label={l.label} title={l.label} onClick={() => set({ ...l.patch }, `look-${l.id}`)}>
                        <PreviewCanvas
                          width={40}
                          height={40}
                          draw={(ctx) => {
                            const d = l.patch.design ?? 'arrow';
                            const box = CURSOR_DESIGNS[d].box;
                            const size = 20;
                            const k = size / 24;
                            const fx = l.patch.effect && l.patch.effect !== 'none' ? 0.6 : 1;
                            renderCursor(ctx, {
                              id: 'q', type: 'cursor', size, design: d, color: '#FFFFFF', outline: '#111827', click: 'none', clickColor: '#E05252', effect: 'none', effectColor: '#F59E0B', effectSize: 1, opacity: 1,
                              ...l.patch, x: 20 - (box.x + box.w / 2) * k * fx, y: 20 - (box.y + box.h / 2) * k * fx,
                            } as never);
                          }}
                        />
                      </button>
                    ))}
                  </div>
                </Group>
                <Group title="Cursor designs" icon={<MousePointerClick size={15} />}>
                  {/* A new design starts with its own colours; change them in the other tab. */}
                  <CursorDesignGrid value={str('design', 'arrow') as CursorDesign} onPick={(d) => set({ design: d, color: CURSOR_DESIGNS[d].fill, outline: CURSOR_DESIGNS[d].outline }, 'design')} />
                  <Field label="Motion (animated look)">
                    <Select<CursorTrail> label="Cursor motion" variant="dark" minWidth={170} value={(str('trail', 'none') as CursorTrail)} onChange={(t) => set({ trail: t }, 'trail')} options={CURSOR_TRAILS} />
                  </Field>
                </Group>
              </>
            ),
          },
          {
            id: 'effects', label: 'Click & effects', content: (
              <>
                <Group title="Cursor" icon={<Palette size={15} />}>
                  <Slider tone="dark" label="Cursor size" min={16} max={240} value={Math.round(num('size', 56))} format={(x) => `${Math.round(x)}px`} onChange={(x) => set({ size: x }, 'size')} />
                  <Field label="Cursor colour">
                    <ColorSwatches label="Cursor colour" colors={['#FFFFFF', '#101828', ...PALETTE.filter((c) => c !== '#FFFFFF' && c !== '#101828')]} value={str('color', '#FFFFFF')} onChange={(c) => set({ color: c }, 'color')} />
                  </Field>
                  <Field label="Outline colour">
                    <ColorSwatches label="Cursor outline colour" colors={['#000000', '#FFFFFF', ...PALETTE.filter((c) => c !== '#FFFFFF')]} value={str('outline', '#000000')} onChange={(c) => set({ outline: c }, 'outline')} />
                  </Field>
                  <Slider tone="dark" label="Cursor opacity" min={0.1} max={1} step={0.05} value={num('opacity', 1)} format={(x) => `${Math.round(x * 100)}%`} onChange={(x) => set({ opacity: x }, 'opacity')} />
                </Group>
                <Group title="Click" icon={<MousePointerClick size={15} />}>
                  <RadioGroup<CursorClick> label="Click indicator" tone="dark" size="sm" value={str('click', 'left') as CursorClick} onChange={(c) => set({ click: c }, 'click')}
                    options={CURSOR_CLICKS.map((c) => ({ value: c.value, label: c.value === 'none' ? 'None' : c.value === 'left' ? 'Left' : c.value === 'right' ? 'Right' : 'Double' }))} />
                  {str('click', 'left') !== 'none' && (
                    <Field label="Click colour">
                      <ColorSwatches label="Click colour" colors={PALETTE} value={str('clickColor', '#E05252')} onChange={(c) => set({ clickColor: c }, 'clickColor')} />
                    </Field>
                  )}
                </Group>
                <Group title="Effect" icon={<Wand2 size={15} />}>
                  <Select<CursorEffect> label="Cursor effect" variant="dark" value={str('effect', 'ripple') as CursorEffect} minWidth={220} onChange={(e) => set({ effect: e }, 'effect')}
                    options={CURSOR_EFFECTS.map((e) => ({ value: e.value, label: e.label, description: e.description }))} />
                  {str('effect', 'ripple') !== 'none' && (
                    <>
                      <Field label="Effect colour">
                        <ColorSwatches label="Effect colour" colors={['#F59E0B', ...PALETTE.filter((c) => c !== '#F59E0B')]} value={str('effectColor', '#F59E0B')} onChange={(c) => set({ effectColor: c }, 'effectColor')} />
                      </Field>
                      <Slider tone="dark" label="Effect size" min={0.4} max={3} step={0.05} value={num('effectSize', 1)} format={(x) => `${Math.round(x * 100)}%`} onChange={(x) => set({ effectSize: x }, 'effectSize')} />
                    </>
                  )}
                </Group>
              </>
            ),
          },
        ]}
      />
    );
  } else if (kind === 'eraser') {
    body = (
      <Group title="Eraser" icon={<Eraser size={15} />}>
        <Slider tone="dark" label="Eraser size" min={4} max={200} value={num('size', 24)} format={(x) => `${x}px`} onChange={(x) => set({ size: x }, 'size')} />
        <div className={styles.hint}>Click or drag across annotations to remove them; the circle shows what the eraser touches. Press [ and ] to change the size. The screenshot itself is never erased.</div>
      </Group>
    );
  }

  const objectCard = selected && (
    (canRotate(selected) && selected.type !== 'pen' && selected.type !== 'highlighter') || selected.type === 'image' || selected.type === 'sticker'
  );

  return (
    <Section
      title={selected ? `${TITLES[selected.type] ?? 'Object'} · selected` : TITLES[tool] ?? 'Tool'}
      action={selected && <IconButton tone="danger" size="sm" label="Delete (Del)" icon={<Trash2 size={15} />} onClick={onDelete} tooltipSide="left" />}
    >
      {body}
      {selected && objectCard && (
        <Group title="Rotation & opacity" icon={<Move size={15} />}>
          {canRotate(selected) && selected.type !== 'pen' && selected.type !== 'highlighter' && <RotationControl value={rotationOf(selected)} onChange={onRotation} />}
          {(selected.type === 'image' || selected.type === 'sticker') && (
            <Slider tone="dark" label="Opacity" min={0.05} max={1} step={0.05} value={selected.opacity} format={(x) => `${Math.round(x * 100)}%`} onChange={onOpacity} />
          )}
        </Group>
      )}
      {(kind === 'blur' || kind === 'pixelate' || kind === 'mask') && selected && 'w' in selected && (
        <div className={styles.hint}>Region: {Math.round(selected.w)} × {Math.round(selected.h)} px — drag the handles to resize.</div>
      )}
      {(kind === 'blur' || kind === 'pixelate' || kind === 'mask') && !selected && (
        <div className={styles.hint}>
          {kind === 'mask' ? 'Drag over private details to cover them. Use “Find sensitive info” in the toolbar to detect emails, numbers and keys automatically.' : 'Drag over sensitive information to hide it. Redactions are rendered into the exported image.'}
        </div>
      )}
      {strokeKind && !selected && <div className={styles.hint}>Hold Shift to draw a straight line. Use the colour's opacity slider for transparency.</div>}
      {kind === 'sticker' && <div className={styles.hint}>Pick a sticker or type your own words, then click on the image to place it. Selecting a text sticker lets you change its words.</div>}
      {kind === 'marker' && <div className={styles.hint}>Click to place the next number. Numbers continue from the highest marker. Counting applies to every marker in the image.</div>}
      {kind === 'cursor' && <div className={styles.hint}>Click on the image where the cursor should point; drag it to move, drag a corner to resize. Each cursor keeps its own design, click and effect, and every change can be undone.</div>}
      {selected && selected.type !== 'blur' && selected.type !== 'pixelate' && selected.type !== 'line' && selected.type !== 'arrow' && (
        <div className={styles.hint}>Drag the corner handles to resize and the round handle on top to rotate (Shift snaps to 15°).</div>
      )}
      {tool === 'select' && !selected && <div className={styles.hint}>Click an annotation to select it. Drag to move, use the handles to resize or rotate, press Delete to remove. Press ? for all keyboard shortcuts.</div>}
      {tool === 'hand' && <div className={styles.hint}>Drag to pan. Hold Space with any tool to pan temporarily; Ctrl + scroll zooms.</div>}
      {(resetButton || kind === 'marker') && (
        <div className={styles.textActions}>
          {resetButton || <span />}
          {kind === 'marker' && (
            <Button size="sm" variant="primary" icon={<CopyCheck size={14} />}
              onClick={() => set({ shape: str('shape', 'circle'), style: str('style', 'filled'), size: Math.round(num('size', 50)), color: str('color', '#E05252'), fillColor: v.fillColor, textColor: v.textColor, borderColor: v.borderColor }, 'markers:apply-all')}
              title="Give every numbered marker in the image this shape, style, size and colours">
              Apply to all markers
            </Button>
          )}
        </div>
      )}
    </Section>
  );
}

export interface CutProps {
  band: CutBand;
  width: number;
  height: number;
  onChange: (band: CutBand) => void;
  onApply: () => void;
  onCancel: () => void;
}

const SEAMS: Array<{ value: CutBand['seam']; label: string }> = [
  { value: 'none', label: 'Seamless' },
  { value: 'line', label: 'Dashed line' },
  { value: 'torn', label: 'Torn edge' },
];

function CutSection({ cut }: { cut: CutProps }) {
  const { band, width, height } = cut;
  const rows = band.axis === 'rows';
  const len = rows ? height : width;
  const lo = Math.min(band.from, band.to);
  const hi = Math.max(band.from, band.to);
  const valid = cutBand(len, lo, hi);
  const removed = valid ? valid.end - valid.start : 0;
  const num = (v: string) => Math.max(0, Math.min(len, Math.round(Number(v) || 0)));
  return (
    <Section title="Cut out & join">
      <div className={styles.hint}>
        Drag across the image to mark the part to remove (red). Drag the red edges to adjust, or the band to move it. The rest is joined together.
      </div>
      <div role="radiogroup" aria-label="Remove a" className={styles.cutTabs}>
        {(['rows', 'columns'] as const).map((a) => (
          <button key={a} type="button" role="radio" aria-checked={band.axis === a} className={`${styles.cutTab} ${band.axis === a ? styles.cutTabOn : ''}`}
            onClick={() => band.axis !== a && cut.onChange({ ...band, axis: a, from: Math.round((a === 'rows' ? height : width) * 0.4), to: Math.round((a === 'rows' ? height : width) * 0.6) })}>
            {a === 'rows' ? 'Horizontal band' : 'Vertical band'}
            <span className={styles.cutTabHint}>{a === 'rows' ? 'keep top + bottom' : 'keep left + right'}</span>
          </button>
        ))}
      </div>
      <div className={styles.row}>
        <Field label={rows ? 'From top (px)' : 'From left (px)'}>
          <input className={styles.numberField} type="number" min={0} max={len} value={lo} aria-label="Remove from" onChange={(e) => { const n = num(e.target.value); cut.onChange({ ...band, from: n, to: Math.max(n, hi) }); }} />
        </Field>
        <Field label="to (px)">
          <input className={styles.numberField} type="number" min={0} max={len} value={hi} aria-label="Remove to" onChange={(e) => { const n = num(e.target.value); cut.onChange({ ...band, from: Math.min(n, lo), to: n }); }} />
        </Field>
      </div>
      <Field label="Join">
        <div role="radiogroup" aria-label="Join style" className={styles.formatCards}>
          {SEAMS.map((s) => (
            <button key={s.value} type="button" role="radio" aria-checked={band.seam === s.value} className={`${styles.formatCard} ${band.seam === s.value ? styles.formatCardOn : ''}`} onClick={() => cut.onChange({ ...band, seam: s.value })}>
              <span className={styles.seamLabel}>{s.label}</span>
            </button>
          ))}
        </div>
      </Field>
      <div className={styles.cutResult} aria-live="polite">
        {valid ? (
          <>
            Removes <b>{removed} px</b> · result <b>{rows ? width : width - removed} × {rows ? height - removed : height}</b> px
          </>
        ) : (
          'Mark a part to remove (at least 2 px must stay).'
        )}
      </div>
      <div className={styles.row}>
        <Button size="sm" className={styles.darkBtn} icon={<X size={14} />} onClick={cut.onCancel}>
          Cancel
        </Button>
        <Button size="sm" variant="primary" icon={<Check size={14} />} onClick={cut.onApply} disabled={!valid}>
          Cut out & join
        </Button>
      </div>
      <div className={styles.hint}>Enter applies, Esc cancels. One Ctrl+Z brings the part back.</div>
    </Section>
  );
}

function CropSection({ crop }: { crop: CropProps }) {
  return (
    <Section title="Crop">
      <Field label="Aspect ratio">
        <Select
          label="Aspect ratio"
          variant="dark"
          value={crop.aspect}
          minWidth={200}
          onChange={crop.onAspect}
          options={(['free', 'original', '1:1', '4:3', '3:2', '16:9', '9:16'] as AspectRatio[]).map((a) => ({ value: a, label: a === 'free' ? 'Free' : a === 'original' ? 'Original' : a }))}
        />
      </Field>
      <div className={styles.row}>
        <Field label="Width">
          <input className={styles.numberField} type="number" min={1} max={crop.maxW} value={Math.round(crop.rect.w)} onChange={(e) => crop.onRect({ ...crop.rect, w: Math.min(crop.maxW - crop.rect.x, Math.max(1, Number(e.target.value))) })} aria-label="Crop width" />
        </Field>
        <Field label="Height">
          <input className={styles.numberField} type="number" min={1} max={crop.maxH} value={Math.round(crop.rect.h)} onChange={(e) => crop.onRect({ ...crop.rect, h: Math.min(crop.maxH - crop.rect.y, Math.max(1, Number(e.target.value))) })} aria-label="Crop height" />
        </Field>
      </div>
      <div className={styles.row}>
        <Field label="X">
          <input className={styles.numberField} type="number" min={0} value={Math.round(crop.rect.x)} onChange={(e) => crop.onRect({ ...crop.rect, x: Math.max(0, Math.min(crop.maxW - crop.rect.w, Number(e.target.value))) })} aria-label="Crop X" />
        </Field>
        <Field label="Y">
          <input className={styles.numberField} type="number" min={0} value={Math.round(crop.rect.y)} onChange={(e) => crop.onRect({ ...crop.rect, y: Math.max(0, Math.min(crop.maxH - crop.rect.h, Number(e.target.value))) })} aria-label="Crop Y" />
        </Field>
      </div>
      <div className={styles.row}>
        <Button size="sm" className={styles.darkBtn} icon={<X size={14} />} onClick={crop.onCancel}>
          Cancel
        </Button>
        <Button size="sm" variant="primary" icon={<Check size={14} />} onClick={crop.onApply}>
          Apply
        </Button>
      </div>
      <div className={styles.hint}>Drag on the image to draw a new crop area. Enter applies, Esc cancels.</div>
    </Section>
  );
}

function WatermarkSection({ watermark, onChange, last }: { watermark: Watermark | null; onChange: (w: Watermark | null, key: string) => void; last: Watermark | null }) {
  const wm = watermark;
  const set = (patch: Partial<Watermark>, key: string) => wm && onChange({ ...wm, ...patch }, `watermark:${key}`);
  return (
    <Section
      title="Watermark"
      action={<ToggleSwitch size="sm" label="Watermark" checked={wm !== null} onChange={(on) => onChange(on ? last ?? DEFAULT_WATERMARK : null, 'watermark:toggle')} />}
    >
      {!wm ? (
        <div className={styles.hint}>Turn on to stamp text (your name, “Confidential”, a URL…) on the image. It is included when you copy or download, and your last watermark is remembered.</div>
      ) : (
        <PanelTabs
          key="watermark"
          id="watermark"
          name="Watermark"
          tabs={[
            {
              id: 'designs', label: 'Designs', content: (
                <>
                  <Group title="Text" icon={<TextCursorInput size={15} />}>
                    <TextField tone="dark" value={wm.text} onChange={(e) => set({ text: e.target.value }, 'text')} aria-label="Watermark text" />
                  </Group>
                  <Group title="Watermark designs" icon={<Stamp size={15} />}>
                    <WatermarkDesigns wm={wm} set={set} />
                  </Group>
                </>
              ),
            },
            {
              id: 'content', label: 'Text & logo', content: (
                <>
                  <Group title="Text" icon={<Type size={15} />}>
                    <TextField tone="dark" value={wm.text} onChange={(e) => set({ text: e.target.value }, 'text')} aria-label="Watermark text" />
                    <TextField tone="dark" value={wm.subtitle ?? ''} placeholder="Second line (optional)" onChange={(e) => set({ subtitle: e.target.value || undefined }, 'subtitle')} aria-label="Watermark second line" />
                    <Field label="Font">
                      <FontSelect value={wm.fontFamily} onChange={(f) => set({ fontFamily: f }, 'font')} />
                    </Field>
                  </Group>
                  <Group title="Logo" icon={<ImagePlus size={15} />}>
                    <div className={styles.row}>
                      <label className={styles.logoPick} title="Add your logo (stays on this computer)">
                        <ImagePlus size={14} /> {wm.logo ? 'Change logo' : 'Add logo'}
                        <input type="file" accept={IMAGE_ACCEPT} aria-label="Upload watermark logo" style={{ display: 'none' }}
                          onChange={async (e) => {
                            const file = e.target.files?.[0];
                            e.target.value = '';
                            if (file) set({ logo: await readLogo(file) }, 'logo');
                          }} />
                      </label>
                      {wm.logo && <Button size="sm" variant="secondary" onClick={() => set({ logo: undefined }, 'logo-remove')}>Remove logo</Button>}
                    </div>
                  </Group>
                </>
              ),
            },
            {
              id: 'style', label: 'Style', content: (
                <>
                  <Group title="Look" icon={<Palette size={15} />}>
                    <Field label="Style">
                      <Select<WatermarkStyle> label="Watermark style" variant="dark" minWidth={190} value={wm.style ?? 'plain'} onChange={(st) => set({ style: st }, 'style')}
                        options={[
                          { value: 'plain', label: 'Plain text' }, { value: 'pill', label: 'Pill' }, { value: 'glass', label: 'Frosted glass' }, { value: 'stamp', label: 'Stamp' },
                          { value: 'stamp-round', label: 'Round stamp' }, { value: 'stamp-box', label: 'Dashed stamp' }, { value: 'signature', label: 'Signature' }, { value: 'ribbon', label: 'Corner ribbon' },
                          { value: 'corner', label: 'Corner mark' }, { value: 'brush', label: 'Brush' }, { value: 'tape', label: 'Tape' }, { value: 'dashed', label: 'Dashed box' }, { value: 'logo-text', label: 'Logo + text' },
                        ]} />
                    </Field>
                    <Field label="Colour">
                      <ColorSwatches label="Watermark colour" colors={PALETTE} value={withAlpha(wm.color, wm.opacity)} onChange={(c) => set({ color: withAlpha(c, 1), opacity: alphaOf(c) }, 'color')} />
                    </Field>
                    <Field label="Accent colour">
                      <ColorSwatches label="Watermark accent colour" colors={['#FFFFFF', '#7C3AED', '#DC2626', '#2563EB', '#16A34A', '#F5D78E', '#111827', '#F59E0B']} value={wm.accent ?? '#7C3AED'} onChange={(c) => set({ accent: c }, 'accent')} />
                    </Field>
                    <Slider tone="dark" label="Opacity" min={0.05} max={1} step={0.05} value={wm.opacity} format={(x) => `${Math.round(x * 100)}%`} onChange={(x) => set({ opacity: x }, 'opacity')} />
                  </Group>
                  <Group title="Position & size" icon={<Move size={15} />}>
                    <Field label="Position">
                      <Select<WatermarkPosition>
                        label="Position"
                        variant="dark"
                        value={wm.position}
                        minWidth={180}
                        onChange={(p) => set({ position: p, rotation: p === 'tile' && wm.rotation === 0 ? -30 : wm.rotation }, 'position')}
                        options={[
                          { value: 'bottom-right', label: 'Bottom right' },
                          { value: 'bottom-left', label: 'Bottom left' },
                          { value: 'top-right', label: 'Top right' },
                          { value: 'top-left', label: 'Top left' },
                          { value: 'center', label: 'Centre' },
                          { value: 'tile', label: 'Tiled (repeat)' },
                        ]}
                      />
                    </Field>
                    <Slider tone="dark" label="Size" min={0.015} max={0.2} step={0.005} value={wm.size} format={(x) => `${Math.round(x * 100)}%`} onChange={(x) => set({ size: x }, 'size')} />
                    <Slider tone="dark" label="Rotation" min={-90} max={90} value={wm.rotation} format={(x) => `${x}°`} onChange={(x) => set({ rotation: x }, 'rotation')} />
                  </Group>
                </>
              ),
            },
          ]}
        />
      )}
    </Section>
  );
}

function FrameSection({ frame, onChange, last, sourceUrl, sourceTitle, apply }: { frame: Frame | null; onChange: (f: Frame | null, key: string) => void; last: Frame | null; sourceUrl: string; sourceTitle: string; apply?: FrameApply }) {
  const [applying, setApplying] = useState<'one' | 'all' | null>(null);
  const runApply = async (which: 'one' | 'all') => {
    if (!apply) return;
    setApplying(which);
    try {
      await (which === 'one' ? apply.apply() : apply.applyAll(frame));
    } finally {
      setApplying(null);
    }
  };
  const f = frame;
  const base = f ?? { ...EMPTY_FRAME, browser: null };
  /** Applies a change; when nothing is left switched on, the frame is removed. */
  const update = (patch: Partial<Frame>, key: string) => {
    const next = { ...base, ...patch };
    const empty = next.padding <= 0 && next.borderWidth <= 0 && !next.browser && !next.device;
    onChange(empty ? null : next, `frame:${key}`);
  };
  const bgOn = !!f && f.padding > 0;
  const borderOn = !!f && f.borderWidth > 0;
  const browser = f?.browser ?? null;
  return (
    <Section title="Border & frame">
      <PanelTabs
        key="frame"
        id="frame"
        name="Frame"
        tabs={[
          {
            id: 'background', label: 'Background', content: (
              <>
              <div className={styles.subPanel}>
                <div className={styles.subTitle}>
                  <span className={styles.subTitleIcon}><FrameIcon size={15} /> Background & padding</span>
                  <ToggleSwitch
                    size="sm"
                    label="Background & padding"
                    checked={bgOn}
                    onChange={(on) =>
                      update(
                        on
                          ? {
                              padding: last && last.padding > 0 ? last.padding : BACKGROUND_DEFAULTS.padding,
                              background: last?.background ?? BACKGROUND_DEFAULTS.background,
                              shadow: last?.shadow ?? BACKGROUND_DEFAULTS.shadow,
                              radius: base.radius || (last?.radius ?? BACKGROUND_DEFAULTS.radius),
                            }
                          : { padding: 0, shadow: false, borderWidth: 0 },
                        'toggle-background',
                      )
                    }
                  />
                </div>
                {bgOn && f && (
                  <>
                    <Slider tone="dark" label="Padding" min={4} max={240} value={f.padding} format={(x) => `${x}px`} onChange={(x) => update({ padding: x }, 'padding')} />
                    <Field label="Background">
                      <div className={styles.bgGrid}>
                        <label className={styles.bgSwatch} title="Your own image" aria-label="Background image" style={{ background: f.background.startsWith('image:') ? `center / cover url("${f.background.slice(6)}")` : 'repeating-linear-gradient(45deg,#cbd5e1 0 4px,#f1f5f9 4px 8px)' }}>
                          <input
                            type="file"
                            accept={IMAGE_ACCEPT}
                            aria-label="Upload background image"
                            style={{ display: 'none' }}
                            onChange={async (e) => {
                              const file = e.target.files?.[0];
                              e.target.value = '';
                              if (!file) return;
                              // Kept small enough to store with the frame (max 2560 px, high-quality JPEG).
                              const bmp = await createImageBitmap(file);
                              const k = Math.min(1, 2560 / Math.max(bmp.width, bmp.height));
                              const c = new OffscreenCanvas(Math.max(1, Math.round(bmp.width * k)), Math.max(1, Math.round(bmp.height * k)));
                              const cx = c.getContext('2d')!;
                              cx.imageSmoothingQuality = 'high';
                              cx.drawImage(bmp, 0, 0, c.width, c.height);
                              bmp.close();
                              const blob = await c.convertToBlob({ type: 'image/jpeg', quality: 0.92 });
                              const url = await new Promise<string>((res) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.readAsDataURL(blob); });
                              rememberFrameImage(url, await createImageBitmap(blob));
                              update({ background: `image:${url}` }, 'background');
                            }}
                          />
                        </label>
                        {BACKGROUNDS.map((bg) => (
                          <button
                            key={bg}
                            type="button"
                            aria-label={`Background ${bg}`}
                            className={`${styles.bgSwatch} ${withAlpha(f.background, 1) === bg ? styles.stickerActive : ''}`}
                            style={{ background: cssPaint(bg) }}
                            onClick={() => update({ background: withAlpha(bg, alphaOf(f.background) || 1) }, 'background')}
                          />
                        ))}
                        <label className={styles.bgSwatch} title="Custom colour" style={{ background: 'conic-gradient(red, yellow, lime, aqua, blue, magenta, red)' }}>
                          <input type="color" aria-label="Custom background colour" onChange={(e) => update({ background: withAlpha(e.target.value, alphaOf(f.background)) }, 'background')} style={{ opacity: 0, width: '100%', height: '100%' }} />
                        </label>
                      </div>
                    </Field>
                    {!f.background.startsWith('image:') && (
                      <Slider tone="dark" label="Background opacity" min={0} max={1} step={0.05} value={alphaOf(f.background)} format={(x) => `${Math.round(x * 100)}%`} onChange={(x) => update({ background: withAlpha(f.background === 'transparent' ? '#FFFFFF' : f.background, x) }, 'background-alpha')} />
                    )}
                    <div className={styles.inlineToggle}>
                      Shadow
                      <ToggleSwitch size="sm" label="Shadow" checked={f.shadow} onChange={(x) => update({ shadow: x }, 'shadow')} />
                    </div>
                    {f.shadow && <Slider tone="dark" label="Shadow strength" min={0.2} max={3} step={0.1} value={f.shadowSize ?? 1} format={(x) => `${Math.round(x * 100)}%`} onChange={(x) => update({ shadowSize: x }, 'shadowSize')} />}
                    <Field label="Perspective">
                      <Select<NonNullable<Frame['tilt']>>
                        label="Perspective"
                        variant="dark"
                        minWidth={190}
                        value={f.tilt ?? 'none'}
                        onChange={(t) => update({ tilt: t }, 'tilt')}
                        options={[
                          { value: 'none', label: 'Flat' },
                          { value: 'left', label: 'Tilt left', description: 'Turned towards the left' },
                          { value: 'right', label: 'Tilt right', description: 'Turned towards the right' },
                          { value: 'back', label: 'Lean back', description: 'Laid back, like on a desk' },
                          { value: 'float', label: 'Float', description: 'Slightly rotated' },
                        ]}
                      />
                    </Field>
                    <Slider tone="dark" label="Position ↔" min={-1} max={1} step={0.05} value={f.offsetX ?? 0} format={(x) => (Math.abs(x) < 0.01 ? 'Centre' : `${Math.round(x * 100)}%`)} onChange={(x) => update({ offsetX: x }, 'offsetX')} />
                    <Slider tone="dark" label="Position ↕" min={-1} max={1} step={0.05} value={f.offsetY ?? 0} format={(x) => (Math.abs(x) < 0.01 ? 'Centre' : `${Math.round(x * 100)}%`)} onChange={(x) => update({ offsetY: x }, 'offsetY')} />
                  </>
                )}
              </div>

              <div className={`${styles.subPanel} ${!bgOn ? styles.setGroupDisabled : ''}`} aria-disabled={!bgOn}>
                <div className={styles.subTitle}>
                  <span className={styles.subTitleIcon}><Square size={15} /> Border</span>
                  <ToggleSwitch
                    size="sm"
                    label="Border"
                    disabled={!bgOn}
                    checked={borderOn}
                    onChange={(on) =>
                      update(
                        on
                          ? { borderWidth: last && last.borderWidth > 0 ? last.borderWidth : BORDER_DEFAULTS.borderWidth, borderColor: last?.borderColor ?? BORDER_DEFAULTS.borderColor, borderStyle: last?.borderStyle ?? BORDER_DEFAULTS.borderStyle }
                          : { borderWidth: 0 },
                        'toggle-border',
                      )
                    }
                  />
                </div>
                {!bgOn && <div className={styles.hint}>Turn on Background & padding first; the border goes around the padded frame.</div>}
                {borderOn && f && (
                  <>
                    <Slider tone="dark" label="Border width" min={1} max={40} value={f.borderWidth} format={(x) => `${x}px`} onChange={(x) => update({ borderWidth: x }, 'borderWidth')} />
                    <ColorSwatches label="Border colour" colors={PALETTE} value={f.borderColor} onChange={(c) => update({ borderColor: c }, 'borderColor')} />
                    <RadioGroup label="Frame border style" tone="dark" size="sm" value={f.borderStyle ?? 'solid'} onChange={(d) => update({ borderStyle: d }, 'borderStyle')} options={DASH_OPTIONS} />
                  </>
                )}
              </div>

              {f && <Slider tone="dark" label="Corner radius" min={0} max={60} value={f.radius} format={(x) => `${x}px`} onChange={(x) => update({ radius: x }, 'radius')} />}
              </>
            ),
          },
          {
            id: 'window', label: 'Window', content: (
              <>
              <div className={styles.subPanel}>
                <div className={styles.subTitle}>
                  <span className={styles.subTitleIcon}><AppWindow size={15} /> Browser window</span>
                  <ToggleSwitch
                    size="sm"
                    label="Browser window"
                    checked={browser !== null}
                    onChange={(on) =>
                      update(
                        {
                          browser: on
                            ? last?.browser ?? { style: navigator.platform.toLowerCase().includes('mac') ? 'mac' : 'windows', position: 'top', theme: 'light', url: sourceUrl || 'https://example.com', title: sourceTitle || 'New Tab' }
                            : null,
                        },
                        'browser',
                      )
                    }
                  />
                </div>
                {browser && (
                  <>
                    <Field label="Window style">
                      <RadioGroup
                        label="Window style"
                        tone="dark"
                        size="sm"
                        value={browser.style ?? 'windows'}
                        onChange={(st) => update({ browser: { ...browser, style: st } }, 'browser-style')}
                        options={[
                          { value: 'windows', label: 'Chrome' },
                          { value: 'mac', label: 'Chrome mac' },
                          { value: 'edge', label: 'Edge' },
                          { value: 'safari', label: 'Safari' },
                        ]}
                      />
                    </Field>
                    <div className={styles.row}>
                      <RadioGroup label="Bar position" tone="dark" size="sm" value={browser.position} onChange={(p) => update({ browser: { ...browser, position: p } }, 'browser-pos')} options={[{ value: 'top', label: 'Top' }, { value: 'bottom', label: 'Bottom' }]} />
                      <RadioGroup label="Bar theme" tone="dark" size="sm" value={browser.theme} onChange={(t) => update({ browser: { ...browser, theme: t } }, 'browser-theme')} options={[{ value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }]} />
                    </div>
                    {browser.style !== 'safari' && (
                      <div className={styles.toggleLine}>
                        <span>Home button</span>
                        <ToggleSwitch size="sm" label="Home button" checked={Boolean(browser.home)} onChange={(v) => update({ browser: { ...browser, home: v } }, 'browser-home')} />
                      </div>
                    )}
                    <Field label="Address">
                      <TextField tone="dark" value={browser.url} onChange={(e) => update({ browser: { ...browser, url: e.target.value } }, 'browser-url')} aria-label="Browser URL" />
                    </Field>
                    <Field label="Tab title">
                      <TextField tone="dark" value={browser.title} onChange={(e) => update({ browser: { ...browser, title: e.target.value } }, 'browser-title')} aria-label="Tab title" />
                    </Field>
                  </>
                )}
              </div>
              </>
            ),
          },
          {
            id: 'device', label: 'Device', content: (
              <>

              <div className={styles.subPanel}>
                <div className={styles.subTitle}>
                  <span className={styles.subTitleIcon}><Monitor size={15} /> Device mockup</span>
                  <ToggleSwitch
                    size="sm"
                    label="Device mockup"
                    checked={Boolean(f?.device)}
                    onChange={(on) => update({ device: on ? last?.device ?? { kind: 'laptop', finish: 'space' } : null, ...(on && !(f && f.padding > 0) ? { padding: BACKGROUND_DEFAULTS.padding, background: last?.background ?? BACKGROUND_DEFAULTS.background, shadow: true } : {}) }, 'device')}
                  />
                </div>
                {f?.device && (
                  <>
                    <RadioGroup<DeviceKind>
                      label="Device"
                      tone="dark"
                      size="sm"
                      value={f.device.kind}
                      onChange={(kind) => update({ device: { ...f.device!, kind } }, 'device-kind')}
                      options={[{ value: 'laptop', label: 'Laptop' }, { value: 'desktop', label: 'Desktop' }, { value: 'tablet', label: 'Tablet' }, { value: 'phone', label: 'Mobile' }]}
                    />
                    <Field label="Finish">
                      <div className={styles.bgGrid} role="radiogroup" aria-label="Device finish">
                        {([['space', '#3A3C41', 'Space grey'], ['silver', '#D5D8DD', 'Silver'], ['black', '#1E1F22', 'Black'], ['white', '#F2F3F5', 'White'], ['gold', '#E8D5B5', 'Gold']] as Array<[DeviceFinish, string, string]>).map(([id, col, name]) => (
                          <button key={id} type="button" role="radio" aria-checked={f.device!.finish === id} aria-label={name} title={name}
                            className={`${styles.bgSwatch} ${f.device!.finish === id ? styles.stickerActive : ''}`} style={{ background: col }}
                            onClick={() => update({ device: { ...f.device!, finish: id } }, 'device-finish')} />
                        ))}
                      </div>
                    </Field>
                  </>
                )}
              </div>

              </>
            ),
          },
        ]}
      />
      {!f && <div className={styles.hint}>Switch on a background with padding, a border, or a browser window — each one separately. Your last choices are remembered.</div>}
      {apply && (
        <div className={styles.applyRow}>
          <Button size="sm" variant="secondary" icon={<Check size={14} />} loading={applying === 'one'} disabled={applying !== null} onClick={() => void runApply('one')}
            title="Save these frame settings on this image">
            Apply
          </Button>
          <Button size="sm" variant="primary" icon={<CopyCheck size={14} />} loading={applying === 'all'} disabled={applying !== null || apply.count < 2} onClick={() => void runApply('all')}
            title={f ? 'Give every image of this flow these frame settings' : 'Remove the frame from every image of this flow'}>
            Apply to all ({apply.count})
          </Button>
        </div>
      )}
    </Section>
  );
}
