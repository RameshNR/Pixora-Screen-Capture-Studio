import type { CameraShape } from './settings';
import type { RelativeRect } from './capture';
import type { CursorDesign, CursorEffect, CursorTrail } from '@/editor/types';

/**
 * Camera background, changed on this computer: blurred, removed (transparent in the bubble), a plain
 * colour, or a picture (kept under its own storage key; `image` is filled in for the recording).
 */
export interface CameraBackground {
  mode: 'none' | 'blur' | 'remove' | 'color' | 'image';
  /** Blur strength (px at 640 wide). */
  blur: number;
  color: string;
  /** Data URL of the picture (only in a recording's config). */
  image?: string;
}

/** Webcam bubble appearance. Position is the bubble centre as a fraction of the video frame. */
export interface CameraStyle {
  shape: CameraShape;
  /** Bubble height as a percentage of the video's shorter side (8–50). */
  sizePct: number;
  opacity: number;
  borderWidth: number;
  borderColor: string;
  mirror: boolean;
  x: number;
  y: number;
}

export type ClickStyle = 'ring' | 'ripple' | 'pulse' | 'burst' | 'target' | 'glow';

/** Pointer designs drawn into recordings: every design of the screenshot editor's cursor tool. */
export type PointerDesign = CursorDesign;

/** Mouse cursor and click effects drawn over the recorded page. */
export interface CursorEffects {
  /** Halo that follows the cursor. */
  cursor: boolean;
  cursorSize: number;
  cursorColor: string;
  style: ClickStyle;
  leftColor: string;
  rightColor: string;
  /** Click ring radius (px). */
  radius: number;
  opacity: number;
  durationMs: number;
  /** Click effect: any of the image editor's cursor effects (falls back to `style`). */
  clickEffect?: CursorEffect;
  /** Show the cursor (with its left / right click mark) at each click. */
  clickCursor?: boolean;
  /** Cursor design shown with the clicks (falls back to `pointerDesign`), and its colours. */
  clickDesign?: CursorDesign;
  clickCursorColor?: string;
  clickCursorOutline?: string;
  /** Size of that cursor (px). */
  clickCursorSize?: number;
  /** Motion of that cursor at each click (trail, ghost, bounce, wave …), as in the image editor. */
  clickTrail?: CursorTrail;
  /** Show the small mouse with the pressed button (left, right or double click) next to the cursor. */
  clickMark?: boolean;
  /** Draw a styled cursor into the recorded page (Chrome never records the cursor in tab recordings). */
  pointer?: boolean;
  pointerDesign?: PointerDesign;
  pointerSize?: number;
  pointerColor?: string;
  pointerOutline?: string;
  /** 0 = follows the mouse exactly … 0.9 = very smooth, gliding movement. */
  smoothing?: number;
  /** Hide the real mouse cursor inside the recorded page (only the styled one shows). */
  hideSystemCursor?: boolean;
}

export type Easing = 'ease-in-out' | 'ease-out' | 'linear' | 'spring';

export interface ZoomSettings {
  /** Zoom in on every click, then back out after `holdMs`. */
  autoOnClick: boolean;
  level: number;
  transitionMs: number;
  holdMs: number;
  easing: Easing;
}

export interface SpotlightSettings {
  /** Spotlight radius as a fraction of the video's shorter side. */
  radius: number;
  /** 0–1: how dark the area outside the spotlight / highlighted region becomes. */
  dim: number;
}

/** Teleprompter text as it should be drawn into the recording (scroll position is derived from time). */
export interface TeleprompterLive {
  text: string;
  fontFamily: string;
  fontSize: number;
  color: string;
  background: string;
  backgroundOpacity: number;
  align: 'left' | 'center' | 'right';
  lineHeight: number;
  /** Width of the text column as a fraction of the video width. */
  widthPct: number;
  position: 'top' | 'bottom';
  /** Pixels per second at the teleprompter's own font size. */
  speed: number;
  /** Scroll offset (px) at `since`. */
  offset: number;
  since: number;
  playing: boolean;
}

/** Live changes requested from the control bar, the recorder page or the page overlay. */
export type LiveEffect =
  | { kind: 'camera'; patch: Partial<CameraStyle> }
  | { kind: 'zoom'; level: number; center: { x: number; y: number } | null }
  | { kind: 'spotlight'; on: boolean }
  | { kind: 'highlight'; rect: RelativeRect | null }
  | { kind: 'teleprompter'; state: TeleprompterLive | null };

/** What the control bar shows as switched on. */
export interface LiveEffectsState {
  zoom: number;
  spotlight: boolean;
  highlight: boolean;
  annotating: boolean;
  teleprompter: boolean;
  camera: CameraStyle | null;
}

export interface Marker {
  id: string;
  /** Position in the recording (active time, pauses excluded). */
  timeMs: number;
  name: string;
  description?: string;
}

/** Cursor / click report from the page overlay (coordinates as fractions of the viewport). */
export interface CursorReport {
  x: number;
  y: number;
  click?: 'left' | 'right';
}

/** A privacy region applied to a video on export. */
export interface VideoRedaction {
  id: string;
  rect: RelativeRect;
  kind: 'blur' | 'pixelate' | 'mask';
  /** Blur radius / block size as a fraction of the video's shorter side. */
  strength: number;
  color: string;
  /** Seconds; null = whole video. */
  start: number | null;
  end: number | null;
}
