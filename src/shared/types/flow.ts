import type { RelativeRect } from './capture';

/** How each flow image is captured (the existing screenshot engines). */
export type FlowCaptureMode = 'visible' | 'full' | 'area' | 'screen' | 'window';
/** Screenshots taken automatically for auto steps. */
export type FlowScreenshotMode = 'visible' | 'none';
/** Which steps get a screenshot. */
export type FlowScreenshotWhen = 'every-step' | 'page-change';
/**
 * When a click step's screenshot is taken: after the page reacted, at the moment of the press
 * (mouse down, or Enter / Space on a focused control), or while hovering the control (before the click).
 */
export type FlowShotTiming = 'after-click' | 'on-click' | 'on-hover';
/** Ordinary (non-sensitive) form values: never stored, or stored. Sensitive fields are always masked. */
export type FlowValuePolicy = 'never' | 'non-sensitive';

/** Kinds of interaction that can trigger an automatic screenshot. */
export type FlowShotKind = 'click' | 'dropdown' | 'input' | 'checkbox' | 'radio' | 'submit' | 'navigate' | 'scroll' | 'key';

export const FLOW_SHOT_KINDS: FlowShotKind[] = ['click', 'dropdown', 'input', 'checkbox', 'radio', 'submit', 'navigate', 'scroll', 'key'];

export interface FlowSettings {
  /** Default capture mode of the flow toolbar. */
  mode: FlowCaptureMode;
  /** Automatically add a screenshot at meaningful interactions (clicks, form steps, page changes). */
  autoSteps: boolean;
  /** Screenshot style for automatic steps. */
  screenshots: FlowScreenshotMode;
  screenshotWhen: FlowScreenshotWhen;
  /** Click steps: picture after the click (default) or of the hovered control just before it. */
  shotTiming: FlowShotTiming;
  values: FlowValuePolicy;
  /** Record scrolling as steps. */
  scroll: boolean;
  /** Minimum scroll distance (CSS px) before a scroll counts as a step. */
  scrollThresholdPx: number;
  /** Minimum time between screenshots (ms); 0 = every step. Chrome allows about two per second. */
  minShotIntervalMs: number;
  /** Wait after a step before its picture (ms): -1 = automatic (until the page settles), 0 = no delay. */
  shotDelayMs?: number;
  /** Which interactions take an automatic screenshot (all on by default). */
  captureOn: Record<FlowShotKind, boolean>;
  /** Track the browser flow while recording video (tab, area, desktop). */
  withRecording: boolean;
  /** Also track it during Camera Only recordings (off unless chosen explicitly). */
  inCameraMode: boolean;
  /** Ask before deleting images in the Flow Editor ("Don't ask me again" turns it off). */
  confirmDelete: boolean;
}

/** Settings for one flow session (plus an area for the Selected Area style). */
export interface FlowConfig extends FlowSettings {
  area: RelativeRect | null;
}

/** What the page overlay knows about the element a user worked with. */
export interface FlowElement {
  tag: string;
  role?: string;
  type?: string;
  /** Visible text (buttons, links), trimmed. */
  text?: string;
  /** Field label (label element, aria-label, placeholder, name). */
  label?: string;
  name?: string;
  id?: string;
  /** Short CSS path that identifies the element. */
  selector: string;
  href?: string;
  /** Position in the viewport (fractions). */
  rect?: RelativeRect;
  /** Opens a dropdown, menu or list (aria-haspopup, combobox, aria-expanded). */
  popup?: boolean;
}

/** Raw interaction reported by the page overlay (already grouped: one typing event per field edit). */
export type FlowEvent =
  | { kind: 'click'; element: FlowElement; x: number; y: number; button: 'left' | 'right' | 'middle' }
  | { kind: 'type'; element: FlowElement; value: string; sensitive: boolean }
  | { kind: 'select'; element: FlowElement; value: string; sensitive: boolean }
  | { kind: 'check'; element: FlowElement; checked: boolean }
  | { kind: 'radio'; element: FlowElement; value: string }
  | { kind: 'submit'; element: FlowElement }
  | { kind: 'key'; element: FlowElement | null; key: string }
  | { kind: 'scroll'; dy: number; scrollY: number; pageHeight: number }
  | { kind: 'navigate'; url: string; title: string; via: 'spa' | 'load' };

export type FlowAction = 'click' | 'open' | 'type' | 'select' | 'check' | 'uncheck' | 'radio' | 'submit' | 'key' | 'scroll' | 'navigate' | 'note';

export interface FlowStep {
  id: string;
  action: FlowAction;
  /** Step description shown in the viewer (editable). */
  title: string;
  /** Extra notes added in the viewer. */
  note?: string;
  element?: FlowElement;
  /** Form value, when the privacy settings allow it ("••••••" for masked fields). */
  value?: string;
  masked?: boolean;
  url: string;
  pageTitle: string;
  /** Epoch ms. */
  at: number;
  /** Time since the flow started (pauses excluded). */
  elapsedMs: number;
  /** Position in the linked video recording. */
  videoMs?: number;
  /** Flow image this step belongs to (auto step screenshot, or the next manual capture). */
  itemId?: string;
  /** Click position in the screenshot (fractions). */
  point?: { x: number; y: number };
  /** Element box in the screenshot (fractions). */
  highlight?: RelativeRect;
  /** Scroll distance for merged scroll steps. */
  scrollPx?: number;
}

/** One captured image of a flow session (stored as a screenshot capture record with this id). */
export interface FlowItem {
  id: string;
  mode: FlowCaptureMode;
  /** Captured automatically for an interaction step. */
  auto: boolean;
  at: number;
  url: string;
  pageTitle: string;
  width: number;
  height: number;
  /** Editable caption (auto steps start with the action description). */
  description: string;
  /** Click position / element box (fractions) for auto steps. */
  point?: { x: number; y: number };
  highlight?: RelativeRect;
  /** 8×8 average hash (hex) used to skip unchanged screens. */
  hash?: string;
  /** Fingerprint of the picture (downscaled, quantised pixels) used to refuse duplicate images. */
  digest?: string;
  /** The saved image is the original plus a frame from "Apply to all" (nothing else edited). */
  framedOnly?: boolean;
}

/** An image deleted in the Flow Editor; kept until the user deletes it for good, so it can be restored. */
export interface DeletedFlowItem extends FlowItem {
  deletedAt: number;
  /** Position it had, so a restore puts it back where it was. */
  index: number;
  /** Its workflow steps (removed with it, restored with it), with their old positions. */
  steps?: Array<FlowStep & { index: number }>;
}

export interface FlowDoc {
  id: string;
  name: string;
  config: FlowConfig;
  /** Images in their capture (or user-chosen) order. */
  items: FlowItem[];
  /** Interaction log (clicks, typing, navigation…), linked to images by itemId. */
  steps: FlowStep[];
  startedAt: number;
  endedAt?: number;
  /** Video recorded at the same time, if any. */
  recordingId?: string;
  /** Other pages could not be followed (host access not granted). */
  limited?: boolean;
  /** Deleted images that can still be restored. */
  deleted?: DeletedFlowItem[];
}

export type FlowStatus = 'idle' | 'recording' | 'paused' | 'finishing';

export interface FlowState {
  status: FlowStatus;
  flowId: string | null;
  /** Tabs being followed. */
  tabIds: number[];
  startedAt: number | null;
  accumulatedMs: number;
  resumedAt: number | null;
  steps: number;
  items: number;
  config: FlowConfig | null;
  /** Window whose active tab is captured. */
  windowId: number | null;
  /** A capture is in progress (e.g. full page scrolling, area selection, screen picker). */
  busy: boolean;
  minimized: boolean;
  /** Started together with a video recording (finishes with it). */
  withRecording: boolean;
  /** Window / desktop recordings: every page the user switches to is followed, not just the first tab. */
  followAll?: boolean;
  limited: boolean;
  barWindowId: number | null;
  lastStep: string | null;
}
