import type { ImageFilters } from './tools/filters';
import type { ShapeKind, ShapeLook } from './tools/shape-lib';
import type { BadgeIcon } from './tools/callout-recipes';

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type DashStyle =
  | 'solid' | 'dashed' | 'dotted' | 'dashdot'
  | 'loose-dotted' | 'dense-dotted' | 'long-dash' | 'loose-dashed' | 'dense-dashed'
  | 'loose-dashdot' | 'dense-dashdot' | 'dashdotdot' | 'loose-dashdotdot' | 'dense-dashdotdot';
export type HeadStyle =
  | 'none' | 'triangle' | 'big' | 'open' | 'circle' | 'bar' | 'diamond'
  | 'chevron' | 'twin' | 'twin-open' | 'square' | 'ring' | 'feather' | 'harpoon' | 'round'
  | 'stealth' | 'triple' | 'curved' | 'echo' | 'framed';
/** How the line itself is drawn (heads are separate). */
export type LineBody =
  | 'line' | 'block' | 'outline' | 'tapered' | 'double' | 'chevrons' | 'dash-tail'
  | 'notched' | 'dots' | 'squares' | 'bars' | 'loop' | 'triple' | 'pointer'
  | 'zigzag' | 'wavy' | 'scallop' | 'curly' | 'spiral';
export type TextAlign = 'left' | 'center' | 'right';

interface Base {
  id: string;
  opacity: number;
  /** Hidden from the canvas and export (toggled in the Layers panel). */
  hidden?: boolean;
  /** Rotation in degrees around the object's centre (box-like objects). */
  rotation?: number;
  /** 'all': can't be moved or changed; 'move': can be moved but not changed. */
  lock?: 'all' | 'move';
}

/** Pen designs: standard, brush, dotted / dashed, sketch, creative, pressure, textured and special effects. */
export type PenDesign =
  | 'standard' | 'brush' | 'dotted' | 'dashed' | 'dashdot' | 'sketch' | 'hatch' | 'sketch-arrow'
  | 'tube' | 'beads' | 'hearts' | 'stars' | 'zigzag' | 'loops' | 'taper' | 'chalk' | 'spray' | 'neon' | 'outlined' | 'hollow';
/** Highlighter designs: marker, rectangle, underline, scribble, wavy, circle, text box, tape, spotlight, arrow, cloud… */
export type HighlightDesign =
  | 'flat' | 'marker' | 'rect' | 'underline' | 'scribble' | 'wavy' | 'circle' | 'circle-double' | 'circle-dashed'
  | 'box' | 'tape' | 'spotlight' | 'arrow' | 'cloud' | 'sketch-box' | 'hatch-box' | 'gradient';

export interface StrokeAnnotation extends Base {
  type: 'pen' | 'highlighter';
  points: Point[];
  color: string;
  width: number;
  /** Pen or highlighter design (unset = the classic round pen / flat highlighter). */
  design?: PenDesign | HighlightDesign;
  /** Second colour (outline of outlined pens, border of text-box highlights, arrow of annotation highlights). */
  accent?: string;
  /** Cut by a shape: only the part inside it is kept, or its area is cut out. */
  clip?: StrokeClip;
}

export interface StrokeClip extends Rect {
  /** The shape it was cut with (an annotation id). */
  from: string;
  keep: 'inside' | 'outside';
  /** Outline of the shape (a shape-library kind). */
  kind: string;
  radius: number;
  rotation: number;
}

export interface BoxAnnotation extends Base, Rect {
  type: 'rect' | 'ellipse';
  stroke: string;
  fill: string;
  width: number;
  /** Corner radius (rectangles only). */
  radius: number;
  dash: DashStyle;
  /** Shape from the shape library (hexagon, cloud, speech, badge…); unset = plain rectangle / ellipse. */
  shape?: ShapeKind;
  /** Finish: flat, soft shadow, glow, gradient, 3D or glass. */
  look?: ShapeLook;
}

export interface LineAnnotation extends Base {
  /** One model for lines and arrows; the heads decide what is drawn ('line' kept for older docs). */
  type: 'line' | 'arrow';
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: string;
  width: number;
  headStart: HeadStyle;
  headEnd: HeadStyle;
  dash: DashStyle;
  /** Up to six points the line bends through (smooth spline). Empty = straight. */
  bends: Point[];
  /** Line design (default 'line'). */
  body?: LineBody;
  /** Several lines side by side (1–20; unset = one). */
  count?: number;
  /** Space between the side-by-side lines (px, edge to edge). */
  gap?: number;
  /** 'elbow': a right-angle connector (up / down, then across) instead of a straight or curved line. */
  route?: 'elbow';
  /** Outline colour around block arrows (e.g. a yellow arrow with a dark edge). */
  outline?: string;
}

export interface TextStyle {
  fontFamily: string;
  fontSize: number;
  bold: boolean;
  italic: boolean;
  color: string;
  align: TextAlign;
  underline?: boolean;
  strike?: boolean;
  /** Upper-case letters. */
  caps?: boolean;
  /** Extra space between letters (px). */
  letterSpacing?: number;
  /** Outline around the letters. */
  outlineWidth?: number;
  outlineColor?: string;
  /** Soft drop shadow behind the letters (undefined = automatic for text without a box). */
  shadow?: boolean;
  /** Background colour behind this text section (header, text, footer, title). */
  sectionBg?: string;
  /** Space between the text and its section background (px). */
  sectionPad?: number;
  /** Outline line style. */
  outlineDash?: DashStyle;
  /** Shadow details (used when `shadow` is on): blur (px), opacity (0–1), colour, offset (px). */
  shadowBlur?: number;
  shadowOpacity?: number;
  shadowColor?: string;
  shadowX?: number;
  shadowY?: number;
  /** Gradient letters: two colours, left to right (unset = solid `color`). */
  gradient?: [string, string] | null;
  /** 3D extruded letters: depth (px) and side colour. */
  extrude?: number;
  extrudeColor?: string;
}

/** A separately styled line of text (text header / footer). */
export interface TextPart extends TextStyle {
  text: string;
}

export interface TextAnnotation extends Base, TextStyle {
  type: 'text';
  x: number;
  y: number;
  text: string;
  background: string;
  borderColor: string;
  borderWidth: number;
  borderStyle: DashStyle;
  borderRadius: number;
  /** Space between text and box edge: top, right, bottom, left (undefined = from the font size). */
  padding?: [number, number, number, number] | null;
  /** Optional title above and footer below the text, each with its own style. */
  header?: TextPart | null;
  footer?: TextPart | null;
  /** Thin rules between header / text / footer. */
  dividers?: boolean;
  /** Decorative design behind / around the text: brush, banner, burst, swash, ring, tape, bar… */
  deco?: TextDeco;
  /** Colours of the decoration (deco2 = second colour of gradients and two-tone designs). */
  decoColor?: string;
  decoColor2?: string;
}

export type TextDeco =
  | 'none' | 'brush' | 'brush-under' | 'banner' | 'ribbon' | 'burst' | 'swash' | 'ring' | 'tape' | 'tilted-box' | 'bar'
  | 'pill-gradient' | 'pill-dark' | 'pill-outline' | 'speech' | 'cloud' | 'chevron' | 'dashed-box' | 'megaphone';

export type CalloutDesign =
  | 'bubble' | 'oval' | 'titled' | 'quote' | 'divided' | 'sidebar' | 'brackets' | 'braces' | 'arrow' | 'ribbon'
  | 'leader' | 'tag' | 'hexagon' | 'circle' | 'number' | 'underline' | 'corners' | 'stripes' | 'banner'
  | 'card' | 'tooltip' | 'note' | 'pill' | 'step' | 'glass'
  // premium designs (drawn from recipes)
  | 'soft' | 'pill-glow' | 'speech-soft' | 'cloud' | 'quote-card' | 'highlight' | 'fold-note' | 'sketch' | 'ribbon-fold' | 'arrow-soft'
  | 'step-seal' | 'step-circle' | 'quote-bubble' | 'quote-brush' | 'quote-frame' | 'slant' | 'arrow-tag' | 'parallelogram' | 'hex' | 'offset-card'
  | 'quote-badge' | 'double-frame' | 'circle-quote' | 'heart' | 'flower-quote' | 'quote-open' | 'quote-lines' | 'quote-curve' | 'quote-ring'
  | 'scribble' | 'step-box' | 'step-banner' | 'corner-chip' | 'peel-card' | 'top-band' | 'circle-arc' | 'badge' | 'rule-box'
  | 'sketch-quote' | 'offset-frame';
export type CalloutTail = 'none' | 'speech' | 'leader';
export type LeaderEnd = 'dot' | 'ring' | 'square' | 'diamond' | 'arrow' | 'none';

export interface CalloutAnnotation extends Base, Rect, TextStyle {
  type: 'callout';
  text: string;
  /** Where the tail points to. */
  tailX: number;
  tailY: number;
  fill: string;
  stroke: string;
  strokeWidth: number;
  radius: number;
  /** Shape and layout (default 'bubble'). */
  design?: CalloutDesign;
  /** Pointer style (default 'speech'). */
  tail?: CalloutTail;
  leaderEnd?: LeaderEnd;
  /** Colour of the leader line's end point (default: the line's colour). */
  leaderEndColor?: string;
  /** How far the title and the body text were dragged from their place in the design. */
  titleOffset?: Point;
  textOffset?: Point;
  /** How far the number badge / icon was dragged from its place in the design. */
  badgeOffset?: Point;
  /** The size chosen by the user while the box is enlarged to fit its text. */
  fitBase?: { w: number; h: number };
  /** Secondary colour: title bars, quote marks, stripes. */
  accent?: string;
  dash?: DashStyle;
  /** Title with its own font, size and colour (empty = no title). */
  title?: string;
  titleStyle?: TextStyle;
  /** Number / short label in the design's badge (step designs). */
  badge?: string;
  /** Icon of compact badges (Tip, Info, Warning…). */
  icon?: BadgeIcon;
  /** Body shape override for premium designs (cloud, hexagon, heart…). */
  shape?: ShapeKind;
}

export type BlurMode = 'gaussian' | 'motion-h' | 'motion-v' | 'motion-d' | 'zoom' | 'spin' | 'noise' | 'bokeh';
export type PixelPattern = 'square' | 'wide' | 'mixed' | 'mosaic' | 'dir-h' | 'dir-v' | 'dir-d' | 'radial';
export type RedactFade = 'none' | 'top' | 'bottom' | 'left' | 'right' | 'edges' | 'tilt';
export type RedactTone = 'none' | 'dim' | 'gray' | 'mono' | 'tint';
/** Border of a blur / pixelate / mask area. ('white' and 'color' are older names for a solid line.) */
export type RedactBorder = 'none' | 'solid' | 'dashed' | 'dotted' | 'glow' | 'white' | 'color';
export type MaskPattern = 'solid' | 'lines' | 'multi' | 'dots' | 'rows' | 'grid' | 'mixed' | 'person' | 'card' | 'id' | 'address';

export interface RedactAnnotation extends Base, Rect {
  /** Blur, pixelate, or a solid colour mask. */
  type: 'blur' | 'pixelate' | 'mask';
  /** Blur radius (px) or pixel block size (px). */
  intensity: number;
  /** Mask colour. */
  color?: string;
  /** Region shape (rectangle when unset): rounded, ellipse, cloud, star, heart, hexagon… */
  shape?: ShapeKind;
  /** Corner radius of rectangular regions. */
  radius?: number;
  /** Blur style: gaussian, motion (horizontal / vertical / diagonal), zoom, spin, noise, bokeh. */
  mode?: BlurMode;
  /** Pixelate pattern: square, rectangular, mixed, mosaic tiles, directional, radial. */
  pattern?: PixelPattern;
  /** Pixelate + soft blur. */
  soft?: boolean;
  /** Effect fades out towards one side (gradient blur), the edges or both ends (tilt-shift). */
  fade?: RedactFade;
  /** Focus: blur / pixelate everything except the region. */
  invert?: boolean;
  /**
   * Made by an area action in the video editor (where the frame itself can't change): a deleted /
   * cut area (covered) or a crop (everything outside covered). Shown under that name.
   */
  role?: 'delete' | 'cut' | 'crop';
  /** Colour treatment: dim, grayscale, monochrome or brand tint. */
  tone?: RedactTone;
  tint?: string;
  /** Frosted glass: light tint, edge and shine over the blur. */
  glass?: boolean;
  border?: RedactBorder;
  borderColor?: string;
  /** Border thickness in image pixels (default: a little of the area's size). */
  borderWidth?: number;
  /** Solid masks: what the mask looks like (solid block, text lines, password dots, ID card…). */
  maskPattern?: MaskPattern;
}

export type MarkerShape =
  | 'circle' | 'square' | 'rounded' | 'diamond' | 'hexagon' | 'pin' | 'star' | 'shield' | 'tag' | 'heart' | 'seal'
  | 'speech' | 'speech-square' | 'cloud' | 'pin-ring' | 'pin-square' | 'chevron' | 'triangle' | 'parallelogram'
  | 'brush' | 'blob' | 'note' | 'folded' | 'stack' | 'rosette' | 'ribbon' | 'ribbon-curved' | 'ring';
export type MarkerStyle = 'filled' | 'outline' | 'soft' | 'gradient' | 'dashed' | 'layered';
export type MarkerCounter = 'number' | 'upper' | 'lower' | 'roman' | 'step';
/** Label shown beside a marker ("Step One", "Note"…): pill, slanted or square tag. */
export type MarkerLabelStyle = 'pill' | 'slant' | 'tag';

export interface MarkerAnnotation extends Base {
  type: 'marker';
  x: number;
  y: number;
  n: number;
  color: string;
  size: number;
  shape?: MarkerShape;
  style?: MarkerStyle;
  counter?: MarkerCounter;
  /** Custom colours (off unless chosen): shape background, number and border colour. */
  fillColor?: string;
  textColor?: string;
  borderColor?: string;
  /** Text beside the marker ("Step One") and its style. */
  label?: string;
  labelStyle?: MarkerLabelStyle;
}

export type StickerBadgeStyle = 'pill' | 'burst' | 'tilted' | 'soft' | 'outline';

export interface StickerAnnotation extends Base {
  type: 'sticker';
  /** Centre point. */
  x: number;
  y: number;
  size: number;
  /** Emoji character, badge text ('badge') or icon id ('icon': check, toggle, arrows, speech…). */
  glyph: string;
  variant: 'emoji' | 'badge' | 'icon';
  color: string;
  /** Badge look and an optional emoji before the words (🔥 HOT, 💡 TIP, 👑 PRO). */
  badgeStyle?: StickerBadgeStyle;
  badgeIcon?: string;
  /** White die-cut edge and soft shadow (sticker look). */
  cutout?: boolean;
}

export type CursorDesign =
  | 'arrow' | 'modern' | 'outlined' | 'pointer' | 'hand' | 'ibeam' | 'crosshair' | 'dot' | 'touch'
  | 'grab' | 'pan' | 'drag' | 'move' | 'not-allowed'
  | 'resize-h' | 'resize-v' | 'resize-ne' | 'resize-nw' | 'resize-corner' | 'resize-all'
  | 'add' | 'remove' | 'rotate' | 'refresh' | 'link' | 'picker'
  | 'heart' | 'star' | 'pencil' | 'eraser' | 'magnify' | 'target'
  | 'gradient' | 'neon' | 'pastel' | 'gaming' | 'pixel' | 'plane'
  | 'recording' | 'pause' | 'play' | 'focus'
  | 'pizza' | 'rocket' | 'sword' | 'dart' | 'leaf' | 'lightning';
export type CursorClick = 'none' | 'left' | 'right' | 'double';
export type CursorEffect = 'none' | 'ring' | 'ripple' | 'glow' | 'halo' | 'burst' | 'spotlight' | 'target' | 'rays' | 'pulse' | 'emphasis';
/** Motion drawn behind the cursor in a still image: trail, dotted trail, ghost copies, bounce, wave, loading dots. */
export type CursorTrail = 'none' | 'trail' | 'dots' | 'ghost' | 'bounce' | 'wave' | 'loading' | 'signal';

/** A mouse cursor on the screenshot, with an optional click indicator and emphasis effect. */
export interface CursorAnnotation extends Base {
  type: 'cursor';
  /** The hot spot: the exact point the cursor points at. */
  x: number;
  y: number;
  /** Height of the pointer (px). */
  size: number;
  design: CursorDesign;
  /** Pointer fill and outline colours. */
  color: string;
  outline: string;
  click: CursorClick;
  clickColor: string;
  effect: CursorEffect;
  effectColor: string;
  /** Effect size as a multiple of the automatic size (1 = default). */
  effectSize: number;
  /** Motion trail (animated-cursor look in a still image). */
  trail?: CursorTrail;
  /** Click animation length (ms): the preview, and videos when `anim` plays it. */
  animMs?: number;
  /** In videos: a still cursor, the click animation once when it appears, or repeated. */
  anim?: 'off' | 'once' | 'loop';
}

export interface ImageAnnotation extends Base, Rect {
  type: 'image';
  bitmap: ImageBitmap;
}

export type Annotation =
  | StrokeAnnotation
  | BoxAnnotation
  | LineAnnotation
  | TextAnnotation
  | CalloutAnnotation
  | RedactAnnotation
  | MarkerAnnotation
  | StickerAnnotation
  | CursorAnnotation
  | ImageAnnotation;

export type AnnotationType = Annotation['type'];

export type WatermarkPosition = 'tile' | 'center' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
/** How the watermark is drawn: plain text, pill, stamp, signature, logo, ribbon, corner mark, brush, tape… */
export type WatermarkStyle =
  | 'plain' | 'pill' | 'stamp' | 'signature' | 'stamp-round' | 'stamp-box' | 'ribbon' | 'corner' | 'brush' | 'tape' | 'dashed' | 'glass' | 'logo-text';

export interface Watermark {
  text: string;
  fontFamily: string;
  /** Font size as a fraction of the image's shorter side, so it scales with the image. */
  size: number;
  color: string;
  opacity: number;
  position: WatermarkPosition;
  /** How far it was dragged from `position`, as a share of the image's width and height. */
  offset?: Point;
  /** Degrees. */
  rotation: number;
  style?: WatermarkStyle;
  /** Second colour (stamp ring, ribbon, brush, pill background). */
  accent?: string;
  /** Small second line (logo + text designs, stamps). */
  subtitle?: string;
  /** Logo image ('image:<data URL>', kept on this computer). */
  logo?: string;
}

export interface BrowserFrame {
  /** Chrome on Windows (controls on the right), Chrome on macOS (traffic lights), Edge or Safari. */
  style: 'windows' | 'mac' | 'edge' | 'safari';
  position: 'top' | 'bottom';
  theme: 'light' | 'dark';
  url: string;
  title: string;
  /** Show a Home button next to reload (Chrome / Edge styles). */
  home?: boolean;
}

export type DeviceKind = 'laptop' | 'desktop' | 'tablet' | 'phone';
export type DeviceFinish = 'space' | 'silver' | 'black' | 'white' | 'gold';

/** Device mockup around the screenshot (laptop, monitor, tablet, phone). */
export interface DeviceFrame {
  kind: DeviceKind;
  finish: DeviceFinish;
}

export type FrameTilt = 'none' | 'left' | 'right' | 'float' | 'back';

/** Decorative frame around the image: padding/background, border, rounded corners, shadow, browser window. */
export interface Frame {
  padding: number;
  background: string;
  radius: number;
  shadow: boolean;
  borderWidth: number;
  borderColor: string;
  borderStyle?: DashStyle;
  browser: BrowserFrame | null;
  /** Device mockup around the window. */
  device?: DeviceFrame | null;
  /** Perspective: tilt the window / device inside the background. */
  tilt?: FrameTilt;
  /** Shadow strength (multiplier, default 1). */
  shadowSize?: number;
  /** Where the window sits inside the background: -1 (left / top) … 1 (right / bottom). */
  offsetX?: number;
  offsetY?: number;
}

/**
 * Immutable editing state. `base` is the current raster (the original capture until a geometry
 * operation creates a derived bitmap). Older bitmaps stay referenced by history entries, so every
 * operation – including crop / rotate / resize – is undoable and the original is never modified.
 * Annotations, the watermark and the frame stay individually editable / removable (Layers panel).
 */
export interface EditorDoc {
  base: ImageBitmap;
  width: number;
  height: number;
  annotations: Annotation[];
  watermark: Watermark | null;
  frame: Frame | null;
  /** Filters (a look, adjustments, effects): settings applied when drawn, never baked into `base`. */
  filters?: ImageFilters | null;
}

export type Tool =
  | 'select'
  | 'hand'
  | 'pen'
  | 'highlighter'
  | 'rect'
  | 'ellipse'
  | 'arrow'
  | 'text'
  | 'callout'
  | 'blur'
  | 'pixelate'
  | 'mask'
  | 'marker'
  | 'sticker'
  | 'cursor'
  | 'eraser'
  | 'eraseImage'
  | 'removeObject'
  | 'removeBg'
  | 'filters'
  | 'crop'
  | 'cut'
  | 'watermark'
  | 'frame';

export type TextToolStyle = TextStyle & {
  background: string;
  opacity: number;
  borderColor: string;
  borderWidth: number;
  borderStyle: DashStyle;
  borderRadius: number;
  padding: [number, number, number, number] | null;
  header: TextPart | null;
  footer: TextPart | null;
  dividers: boolean;
};

export type CalloutToolStyle = TextStyle & {
  fill: string;
  stroke: string;
  strokeWidth: number;
  radius: number;
  opacity: number;
  design: CalloutDesign;
  tail: CalloutTail;
  leaderEnd: LeaderEnd;
  leaderEndColor?: string;
  accent: string;
  dash: DashStyle;
  title: string;
  titleStyle: TextStyle;
};

/** Default style per tool, editable in the properties panel when nothing is selected. */
export interface ToolStyles {
  pen: { color: string; width: number; opacity: number; design?: PenDesign; accent?: string };
  highlighter: { color: string; width: number; opacity: number; design?: HighlightDesign; accent?: string };
  shape: { stroke: string; fill: string; width: number; opacity: number; radius: number; dash: DashStyle; shape?: ShapeKind; look?: ShapeLook };
  /** `curve`: new lines with bends start curved (a curved preset) instead of straight. */
  line: { color: string; width: number; opacity: number; headStart: HeadStyle; headEnd: HeadStyle; dash: DashStyle; bends: number; body: LineBody; curve?: boolean; route?: 'elbow'; outline?: string; count?: number; gap?: number };
  text: TextToolStyle;
  callout: CalloutToolStyle;
  blur: { intensity: number } & RedactLook;
  pixelate: { intensity: number } & RedactLook;
  mask: { color: string } & RedactLook;
  marker: { color: string; size: number; shape: MarkerShape; style: MarkerStyle; counter: MarkerCounter; fillColor?: string; textColor?: string; borderColor?: string; label?: string; labelStyle?: MarkerLabelStyle };
  sticker: { glyph: string; variant: 'emoji' | 'badge' | 'icon'; color: string; size: number; badgeStyle?: StickerBadgeStyle; badgeIcon?: string; cutout?: boolean };
  cursor: Pick<CursorAnnotation, 'design' | 'color' | 'outline' | 'size' | 'click' | 'clickColor' | 'effect' | 'effectColor' | 'effectSize' | 'opacity' | 'trail'>;
  eraser: { size: number };
  /** Erases the picture itself (not annotations): painted white, or see-through in PNG. */
  eraseImage: { size: number; fill: 'white' | 'transparent' | 'smart'; hardness?: number; feather?: number; strength?: number; preserve?: boolean };
  /** Remove objects: pick them (AI click, brush or box), then rebuild the background behind them. */
  removeObject: { mode: 'ai' | 'brush' | 'box' | 'erase'; size: number; grow: number };
  /** Remove background: what goes behind the subject, edge settings and the restore / remove brush. */
  removeBg: { fill: 'transparent' | 'white' | 'color' | 'image' | 'blur'; color: string; blur: number; edge: number; feather: number; shift: number; size: number; hardness: number };
}

/** Look of a blur / pixelate / mask region (everything except its position and strength). */
export type RedactLook = Partial<Pick<RedactAnnotation, 'shape' | 'radius' | 'mode' | 'pattern' | 'soft' | 'fade' | 'invert' | 'tone' | 'tint' | 'glass' | 'border' | 'borderColor' | 'borderWidth' | 'maskPattern' | 'opacity'>>;

export const DEFAULT_FONT = 'Inter Variable, Inter, Segoe UI, sans-serif';

export const DEFAULT_TOOL_STYLES: ToolStyles = {
  pen: { color: '#E05252', width: 14, opacity: 1 },
  // The highlighter's 60 % opacity lives in its colour (#rrggbbaa), so there is one opacity control.
  highlighter: { color: '#FFD84D99', width: 35, opacity: 1 },
  shape: { stroke: '#E05252', fill: 'transparent', width: 10, opacity: 1, radius: 6, dash: 'solid' },
  line: { color: '#E05252', width: 10, opacity: 1, headStart: 'none', headEnd: 'triangle', dash: 'solid', bends: 0, body: 'line' },
  text: {
    color: '#E05252', fontFamily: DEFAULT_FONT, fontSize: 28, bold: true, italic: false, align: 'left', background: 'transparent', opacity: 1,
    borderColor: '#E05252', borderWidth: 0, borderStyle: 'solid', borderRadius: 6, padding: null, header: null, footer: null, dividers: false,
  },
  callout: {
    color: '#475467', fontFamily: DEFAULT_FONT, fontSize: 18, bold: false, italic: false, align: 'left', fill: '#FFFFFF', stroke: '#E4E7EC',
    strokeWidth: 1, radius: 10, opacity: 1, design: 'card', tail: 'none', leaderEnd: 'ring', accent: '#4F6BED', dash: 'solid', title: '',
    titleStyle: { color: '#101828', fontFamily: DEFAULT_FONT, fontSize: 22, bold: true, italic: false, align: 'left' },
  },
  blur: { intensity: 12 },
  pixelate: { intensity: 14 },
  mask: { color: '#000000' },
  marker: { color: '#E05252', size: 50, shape: 'circle', style: 'filled', counter: 'number' },
  sticker: { glyph: '✅', variant: 'emoji', color: '#E05252', size: 64, cutout: true },
  cursor: { design: 'arrow', color: '#FFFFFF', outline: '#000000', size: 56, click: 'left', clickColor: '#E05252', effect: 'ripple', effectColor: '#F59E0B', effectSize: 1, opacity: 1 },
  eraser: { size: 24 },
  eraseImage: { size: 40, fill: 'white', hardness: 80, feather: 4, strength: 100, preserve: true },
  removeObject: { mode: 'ai', size: 40, grow: 6 },
  removeBg: { fill: 'transparent', color: '#4F8DF7', blur: 50, edge: 60, feather: 2, shift: 0, size: 40, hardness: 70 },
};

export const DEFAULT_WATERMARK: Watermark = {
  text: '© Your name',
  fontFamily: DEFAULT_FONT,
  size: 0.045,
  color: '#FFFFFF',
  opacity: 0.35,
  position: 'bottom-right',
  rotation: 0,
};

/** A frame with nothing switched on; background, border and browser window are turned on separately. */
export const EMPTY_FRAME: Frame = {
  padding: 0,
  background: 'linear:#6aa1fa:#7c5cf6',
  radius: 0,
  shadow: false,
  borderWidth: 0,
  borderColor: '#202938',
  borderStyle: 'solid',
  browser: null,
};

/** Applied when "Background & padding" is switched on. */
export const BACKGROUND_DEFAULTS = { padding: 48, background: 'linear:#6aa1fa:#7c5cf6', radius: 12, shadow: true };
/** Applied when "Border" is switched on. */
export const BORDER_DEFAULTS = { borderWidth: 6, borderColor: '#202938', borderStyle: 'solid' as DashStyle };

/** Background + padding on (used by tests and older call sites). */
export const DEFAULT_FRAME: Frame = { ...EMPTY_FRAME, ...BACKGROUND_DEFAULTS };

export const PALETTE = ['#E05252', '#F59E0B', '#FFD84D', '#24A36A', '#4F8DF7', '#7C5CF6', '#202938', '#FFFFFF'];
