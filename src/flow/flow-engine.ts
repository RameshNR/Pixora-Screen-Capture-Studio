import type { FlowConfig, FlowElement, FlowEvent, FlowShotKind, FlowStep } from '@/shared/types/flow';

/* --------------------------------- privacy --------------------------------- */

const SENSITIVE_WORDS = /pass(word|code|phrase)?|pwd|otp|one[-_ ]?time|2fa|mfa|verification|security[-_ ]?code|pin\b|cvv|cvc|csc|card|cc[-_]?(num|number|exp)|expir|iban|account[-_ ]?(no|num|number)|routing|sort[-_ ]?code|ssn|social[-_ ]?security|tax[-_ ]?id|secret|token|api[-_ ]?key|private[-_ ]?key/i;
const SENSITIVE_AUTOCOMPLETE = /^(current-password|new-password|one-time-code|cc-|transaction-)/i;

export interface FieldInfo {
  type?: string;
  name?: string;
  id?: string;
  label?: string;
  autocomplete?: string;
  inputMode?: string;
}

/** Passwords, one-time codes, payment and other secrets are always masked, whatever the settings. */
export function isSensitiveField(f: FieldInfo): boolean {
  if ((f.type ?? '').toLowerCase() === 'password') return true;
  if (f.autocomplete && SENSITIVE_AUTOCOMPLETE.test(f.autocomplete.trim())) return true;
  return [f.name, f.id, f.label, f.autocomplete].some((s) => !!s && SENSITIVE_WORDS.test(s));
}

export const MASK = '••••••';

/* ------------------------------- descriptions ------------------------------ */

function quote(s: string, max = 60): string {
  const t = s.replace(/\s+/g, ' ').trim();
  return `“${t.length > max ? `${t.slice(0, max - 1)}…` : t}”`;
}

/** Human name for an element: its label or visible text, else its kind. */
export function elementName(e: FlowElement | null | undefined): string {
  if (!e) return 'the page';
  const named = e.label || e.text || e.name || e.id;
  if (named) return quote(named);
  if (e.tag === 'a') return 'a link';
  if (e.tag === 'button' || e.role === 'button') return 'a button';
  if (e.tag === 'img') return 'an image';
  return `the ${e.tag} element`;
}

function fieldName(e: FlowElement): string {
  const named = e.label || e.name || e.id;
  return named ? `the ${quote(named)} field` : 'a field';
}

export interface Described {
  action: FlowStep['action'];
  title: string;
  value?: string;
  masked?: boolean;
  element?: FlowElement;
  point?: { x: number; y: number };
  highlight?: FlowStep['highlight'];
  scrollPx?: number;
}

/** Turns an event into a step description, applying the value privacy policy. */
export function describeEvent(ev: FlowEvent, policy: FlowConfig['values']): Described {
  switch (ev.kind) {
    case 'click': {
      const e = ev.element;
      const isLink = e.tag === 'a' || e.role === 'link';
      const verb = ev.button === 'right' ? 'Right-click' : 'Click';
      if (e.popup && ev.button === 'left') {
        const what = e.role === 'menu' || e.role === 'menuitem' || /menu/i.test(e.text ?? '') ? 'menu' : 'dropdown';
        return { action: 'open', title: `Open the ${elementName(e)} ${what}`, element: e, point: { x: ev.x, y: ev.y }, highlight: e.rect };
      }
      const title = isLink ? `${verb} the ${elementName(e)} link` : e.tag === 'button' || e.role === 'button' || e.type === 'submit' ? `${verb} ${elementName(e)}` : `${verb} ${elementName(e)}`;
      return { action: 'click', title, element: e, point: { x: ev.x, y: ev.y }, highlight: e.rect };
    }
    case 'type': {
      const e = ev.element;
      if (ev.sensitive) return { action: 'type', title: `Enter ${fieldName(e)} (hidden)`, value: MASK, masked: true, element: e, highlight: e.rect };
      if (policy === 'never' || !ev.value) return { action: 'type', title: ev.value ? `Fill in ${fieldName(e)}` : `Clear ${fieldName(e)}`, element: e, highlight: e.rect };
      return { action: 'type', title: `Type ${quote(ev.value, 40)} in ${fieldName(e)}`, value: ev.value, element: e, highlight: e.rect };
    }
    case 'select': {
      const e = ev.element;
      if (ev.sensitive) return { action: 'select', title: `Choose an option in ${fieldName(e)} (hidden)`, value: MASK, masked: true, element: e, highlight: e.rect };
      if (policy === 'never') return { action: 'select', title: `Choose an option in ${fieldName(e)}`, element: e, highlight: e.rect };
      return { action: 'select', title: `Choose ${quote(ev.value, 40)} in ${fieldName(e)}`, value: ev.value, element: e, highlight: e.rect };
    }
    case 'check':
      return { action: ev.checked ? 'check' : 'uncheck', title: `${ev.checked ? 'Check' : 'Uncheck'} ${elementName(ev.element)}`, value: ev.checked ? 'on' : 'off', element: ev.element, highlight: ev.element.rect };
    case 'radio':
      return { action: 'radio', title: `Select ${elementName(ev.element)}`, value: policy === 'never' ? undefined : ev.value, element: ev.element, highlight: ev.element.rect };
    case 'submit':
      return { action: 'submit', title: ev.element.label || ev.element.text ? `Submit the ${quote(ev.element.label || ev.element.text || '')} form` : 'Submit the form', element: ev.element };
    case 'key':
      return { action: 'key', title: `Press ${ev.key}${ev.element ? ` in ${fieldName(ev.element)}` : ''}`, element: ev.element ?? undefined };
    case 'scroll': {
      const px = Math.round(Math.abs(ev.dy));
      return { action: 'scroll', title: `Scroll ${ev.dy > 0 ? 'down' : 'up'} ${px.toLocaleString('en-US')} px`, scrollPx: ev.dy };
    }
    case 'navigate':
      return { action: 'navigate', title: `Go to ${ev.title ? quote(ev.title) : ev.url}` };
  }
}

/* ------------------------------ dedup & merging ----------------------------- */

export interface EngineContext {
  now: number;
  /** URL the flow currently is on (last navigation). */
  currentUrl: string;
  config: FlowConfig;
}

export type EngineResult =
  | { kind: 'add'; step: Omit<FlowStep, 'id' | 'url' | 'pageTitle' | 'at' | 'elapsedMs'> }
  | { kind: 'update'; index: number; patch: Partial<FlowStep> }
  | { kind: 'skip'; reason: string };

const MEANINGFUL_KEYS = new Set(['Enter', 'Escape']);

/**
 * Decides whether an event becomes a new step, updates the previous one (continued typing, a longer
 * scroll) or is ignored (repeats, tiny scrolls, duplicate navigation, keys that are not actions).
 */
export function applyEvent(steps: FlowStep[], ev: FlowEvent, ctx: EngineContext): EngineResult {
  const last = steps[steps.length - 1];
  const sameEl = (e?: FlowElement) => !!last?.element && !!e && last.element.selector === e.selector;
  const since = last ? ctx.now - last.at : Infinity;

  switch (ev.kind) {
    case 'click':
      if (last?.action === 'click' && sameEl(ev.element) && since < 700) return { kind: 'skip', reason: 'double click' };
      break;
    case 'type': {
      if (last?.action === 'type' && sameEl(ev.element)) {
        const d = describeEvent(ev, ctx.config.values);
        if (last.value === d.value && last.title === d.title) return { kind: 'skip', reason: 'unchanged value' };
        // Same field edited again right away: keep one step with the final value.
        if (since < 15_000) return { kind: 'update', index: steps.length - 1, patch: { title: d.title, value: d.value, masked: d.masked, at: ctx.now } };
      }
      break;
    }
    case 'select':
    case 'radio':
      if (last && sameEl(ev.element) && (last.action === 'select' || last.action === 'radio')) {
        const d = describeEvent(ev, ctx.config.values);
        if (last.value === d.value) return { kind: 'skip', reason: 'unchanged choice' };
        if (since < 3000) return { kind: 'update', index: steps.length - 1, patch: { title: d.title, value: d.value, at: ctx.now } };
      }
      break;
    case 'check':
      if (last && sameEl(ev.element) && (last.action === 'check' || last.action === 'uncheck') && since < 600) {
        return { kind: 'update', index: steps.length - 1, patch: describeEvent(ev, ctx.config.values) };
      }
      break;
    case 'submit':
      if (last?.action === 'submit' && sameEl(ev.element) && since < 1500) return { kind: 'skip', reason: 'repeated submit' };
      break;
    case 'key':
      if (!MEANINGFUL_KEYS.has(ev.key)) return { kind: 'skip', reason: 'not an action key' };
      break;
    case 'scroll': {
      if (!ctx.config.scroll) return { kind: 'skip', reason: 'scroll steps off' };
      if (last?.action === 'scroll' && since < 8000 && Math.sign(last.scrollPx ?? 0) === Math.sign(ev.dy)) {
        const total = (last.scrollPx ?? 0) + ev.dy;
        return { kind: 'update', index: steps.length - 1, patch: { scrollPx: total, title: describeEvent({ ...ev, dy: total }, ctx.config.values).title, at: ctx.now } };
      }
      if (Math.abs(ev.dy) < ctx.config.scrollThresholdPx) return { kind: 'skip', reason: 'small scroll' };
      break;
    }
    case 'navigate':
      if (normalizeUrl(ev.url) === normalizeUrl(ctx.currentUrl)) return { kind: 'skip', reason: 'same page' };
      break;
  }
  return { kind: 'add', step: describeEvent(ev, ctx.config.values) };
}

/** URLs compared without a trailing slash. */
export function normalizeUrl(u: string): string {
  return u.replace(/\/(?=$|[?#])/, '');
}

/** Whether a step should get a fresh screenshot under the chosen settings. */
/** The screenshot option that covers an action. */
export function shotKindOf(action: FlowStep['action']): FlowShotKind | null {
  switch (action) {
    case 'click':
      return 'click';
    case 'open':
    case 'select':
      return 'dropdown';
    case 'type':
      return 'input';
    case 'check':
    case 'uncheck':
      return 'checkbox';
    case 'radio':
      return 'radio';
    case 'submit':
      return 'submit';
    case 'navigate':
      return 'navigate';
    case 'scroll':
      return 'scroll';
    case 'key':
      return 'key';
    default:
      return null;
  }
}

export function wantsScreenshot(action: FlowStep['action'], config: FlowConfig, isNewPage: boolean): boolean {
  if (config.screenshots === 'none') return false;
  const kind = shotKindOf(action);
  // Interaction types the user turned off never take a screenshot (missing settings mean "on").
  if (kind && config.captureOn && config.captureOn[kind] === false) return false;
  if (config.screenshotWhen === 'page-change') return action === 'navigate' || isNewPage;
  return action !== 'key' || isNewPage;
}

/* ------------------------------ screenshot hash ----------------------------- */

/** 64-bit average hash of an 8×8 grayscale thumbnail (row-major luminance values). */
export function averageHash(gray: ArrayLike<number>): string {
  let sum = 0;
  for (let i = 0; i < 64; i++) sum += gray[i] ?? 0;
  const avg = sum / 64;
  let hex = '';
  for (let i = 0; i < 64; i += 4) {
    let nibble = 0;
    for (let b = 0; b < 4; b++) nibble = (nibble << 1) | ((gray[i + b] ?? 0) > avg ? 1 : 0);
    hex += nibble.toString(16);
  }
  return hex;
}

export function hashDistance(a: string, b: string): number {
  let d = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    let x = parseInt(a[i]!, 16) ^ parseInt(b[i]!, 16);
    while (x) {
      d += x & 1;
      x >>= 1;
    }
  }
  return d + Math.abs(a.length - b.length) * 4;
}

/** Screens closer than this are treated as unchanged (the previous screenshot is reused). */
export const SAME_SCREEN_DISTANCE = 2;

/** Mean absolute difference (0–255) between two equally sized grayscale samples. */
export function sampleDifference(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const n = Math.min(a.length, b.length);
  if (!n) return 255;
  let sum = 0;
  for (let i = 0; i < n; i++) sum += Math.abs((a[i] ?? 0) - (b[i] ?? 0));
  return sum / n;
}

/** Below these differences a new screenshot is considered the same screen as the previous one. */
export const SAME_SCREEN_GLOBAL = 1.2;
export const SAME_SCREEN_REGION = 2.5;
