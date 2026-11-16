/**
 * Flow Capture tracker, part of the page overlay. Reports meaningful interactions to the service
 * worker, already grouped: one "type" event per field edit (sent when the field loses focus, its
 * value is committed, Enter is pressed or the form is submitted), debounced scrolls, and SPA URL
 * changes. Mouse movements are never reported. Values of sensitive fields never leave the page.
 */
import type { FlowConfig, FlowElement, FlowEvent } from '@/shared/types/flow';
import { isSensitiveField } from '@/flow/flow-engine';

const CLICKABLE = '[aria-haspopup]:not([aria-haspopup="false"]),[role="combobox"],[aria-expanded],a[href],button,[role="button"],[role="link"],[role="tab"],[role="menuitem"],[role="menuitemcheckbox"],[role="option"],[role="switch"],[role="treeitem"],summary,input[type="submit"],input[type="button"],input[type="image"],input[type="reset"],[onclick],[data-action]';
/** How long the pointer rests on a control before its capture-on-hover picture is taken. */
const HOVER_DWELL_MS = 300;
const TEXT_TYPES = new Set(['text', 'email', 'search', 'tel', 'url', 'password', 'number', 'date', 'datetime-local', 'month', 'week', 'time', '']);

function isTextField(el: Element | null): el is HTMLInputElement | HTMLTextAreaElement | HTMLElement {
  if (!el) return false;
  if (el instanceof HTMLTextAreaElement) return true;
  if (el instanceof HTMLInputElement) return TEXT_TYPES.has((el.type || '').toLowerCase());
  return el instanceof HTMLElement && el.isContentEditable;
}

function clean(s: string | null | undefined, max = 80): string | undefined {
  const t = (s ?? '').replace(/\s+/g, ' ').trim();
  if (!t) return undefined;
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

function labelOf(el: Element): string | undefined {
  const aria = el.getAttribute('aria-label');
  if (aria) return clean(aria);
  const labelledBy = el.getAttribute('aria-labelledby');
  if (labelledBy) {
    const text = labelledBy.split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? '').join(' ');
    if (clean(text)) return clean(text);
  }
  if (el.id) {
    const forLabel = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
    if (forLabel?.textContent && clean(forLabel.textContent)) return clean(forLabel.textContent);
  }
  const wrap = el.closest('label');
  if (wrap?.textContent && clean(wrap.textContent)) return clean(wrap.textContent);
  return clean(el.getAttribute('placeholder')) ?? clean(el.getAttribute('title')) ?? clean(el.getAttribute('alt'));
}

/** Short CSS path: #id when unique, else up to four tag.class:nth-of-type steps. */
export function selectorOf(el: Element): string {
  if (el.id && document.querySelectorAll(`#${CSS.escape(el.id)}`).length === 1) return `#${CSS.escape(el.id)}`;
  const parts: string[] = [];
  let node: Element | null = el;
  for (let depth = 0; node && node !== document.documentElement && depth < 4; depth++) {
    let part = node.tagName.toLowerCase();
    if (node.id) {
      parts.unshift(`#${CSS.escape(node.id)}`);
      break;
    }
    const cls = Array.from(node.classList).filter((c) => /^[a-zA-Z][\w-]{0,30}$/.test(c)).slice(0, 2);
    if (cls.length) part += `.${cls.join('.')}`;
    const parent: Element | null = node.parentElement;
    if (parent) {
      const same = Array.from(parent.children).filter((c) => c.tagName === node!.tagName);
      if (same.length > 1) part += `:nth-of-type(${same.indexOf(node) + 1})`;
    }
    parts.unshift(part);
    node = parent;
  }
  return parts.join(' > ');
}

/** A control that opens a dropdown / menu / list that is currently closed. */
function opensPopup(el: Element): boolean {
  const hasPopup = el.getAttribute('aria-haspopup');
  const expanded = el.getAttribute('aria-expanded');
  if (expanded === 'true') return false;
  return (hasPopup !== null && hasPopup !== 'false') || el.getAttribute('role') === 'combobox' || expanded === 'false';
}

export function describeElement(el: Element): FlowElement {
  const r = el.getBoundingClientRect();
  const vw = window.innerWidth || 1;
  const vh = window.innerHeight || 1;
  const input = el as HTMLInputElement;
  const isField = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement;
  const text = isField
    ? input.type === 'submit' || input.type === 'button' ? clean(input.value) : undefined
    : clean((el as HTMLElement).innerText ?? el.textContent, 80);
  return {
    tag: el.tagName.toLowerCase(),
    ...(el.getAttribute('role') ? { role: el.getAttribute('role')! } : {}),
    ...(input.type && isField ? { type: input.type } : {}),
    ...(text ? { text } : {}),
    ...(labelOf(el) ? { label: labelOf(el) } : {}),
    ...(el.getAttribute('name') ? { name: el.getAttribute('name')! } : {}),
    ...(el.id ? { id: el.id } : {}),
    selector: selectorOf(el),
    ...(el instanceof HTMLAnchorElement && el.href ? { href: el.href } : {}),
    rect: { x: Math.max(0, r.left / vw), y: Math.max(0, r.top / vh), width: Math.min(1, r.width / vw), height: Math.min(1, r.height / vh) },
    ...(opensPopup(el) ? { popup: true } : {}),
  };
}

function sensitive(el: Element): boolean {
  const input = el as HTMLInputElement;
  return isSensitiveField({
    type: input.type,
    name: el.getAttribute('name') ?? undefined,
    id: el.id || undefined,
    label: labelOf(el),
    autocomplete: el.getAttribute('autocomplete') ?? undefined,
  });
}

export class FlowTracker {
  private paused = false;
  private focused: { el: HTMLElement; initial: string } | null = null;
  private lastUrl = location.href;
  private lastScrollY = window.scrollY;
  private scrollTimer: ReturnType<typeof setTimeout> | null = null;
  private poll: ReturnType<typeof setInterval> | null = null;

  private hoverTimer: ReturnType<typeof setTimeout> | null = null;
  private hovered: Element | null = null;
  private hoverSent: string | null = null;

  constructor(
    private config: FlowConfig,
    private readonly send: (ev: FlowEvent) => void,
    /** Capture-on-hover: the pointer rests on a control (only its CSS path is sent). */
    private readonly sendHover: (selector: string) => void = () => undefined,
    /** The user starts scrolling / presses a navigation key (before the page moves). */
    private readonly sendActivity: () => void = () => undefined,
  ) {
    window.addEventListener('wheel', this.onActivity, { capture: true, passive: true });
    window.addEventListener('touchstart', this.onActivity, { capture: true, passive: true });
    window.addEventListener('pointerdown', this.onPointer, true);
    window.addEventListener('pointerover', this.onHover, true);
    window.addEventListener('focusin', this.onFocusIn, true);
    window.addEventListener('focusout', this.onFocusOut, true);
    window.addEventListener('change', this.onChange, true);
    window.addEventListener('keydown', this.onKey, true);
    window.addEventListener('submit', this.onSubmit, true);
    window.addEventListener('scroll', this.onScroll, true);
    window.addEventListener('popstate', this.checkUrl);
    window.addEventListener('hashchange', this.checkUrl);
    // SPAs change the URL with history.pushState, which fires no event the overlay can see.
    this.poll = setInterval(this.checkUrl, 400);
    if (document.activeElement && isTextField(document.activeElement)) this.onFocusIn({ target: document.activeElement } as unknown as FocusEvent);
  }

  setConfig(config: FlowConfig): void {
    this.config = config;
  }

  pause(paused: boolean): void {
    if (paused) this.commitTyping();
    else {
      // Scrolling done while paused (or by a full-page capture) is not a step.
      if (this.scrollTimer) clearTimeout(this.scrollTimer);
      this.scrollTimer = null;
      this.lastScrollY = window.scrollY;
    }
    this.paused = paused;
  }

  stop(): void {
    this.commitTyping();
    window.removeEventListener('pointerdown', this.onPointer, true);
    window.removeEventListener('wheel', this.onActivity, true);
    window.removeEventListener('touchstart', this.onActivity, true);
    window.removeEventListener('pointerover', this.onHover, true);
    if (this.hoverTimer) clearTimeout(this.hoverTimer);
    window.removeEventListener('focusin', this.onFocusIn, true);
    window.removeEventListener('focusout', this.onFocusOut, true);
    window.removeEventListener('change', this.onChange, true);
    window.removeEventListener('keydown', this.onKey, true);
    window.removeEventListener('submit', this.onSubmit, true);
    window.removeEventListener('scroll', this.onScroll, true);
    window.removeEventListener('popstate', this.checkUrl);
    window.removeEventListener('hashchange', this.checkUrl);
    if (this.poll) clearInterval(this.poll);
    if (this.scrollTimer) clearTimeout(this.scrollTimer);
  }

  private lastActivity = 0;
  /**
   * Wheel / touch / navigation keys fire before the page moves: a step picture that is still
   * waiting (page loading after "Go to", a scroll picture) is taken now, while it still shows the
   * previous step. Sent at most every 400 ms; carries no data.
   */
  private readonly onActivity = (): void => {
    if (this.paused) return;
    const now = Date.now();
    if (now - this.lastActivity < 400) return;
    this.lastActivity = now;
    this.sendActivity();
  };

  private emit(ev: FlowEvent): void {
    if (!this.paused) this.send(ev);
  }

  /**
   * Capture-on-hover: when the pointer rests on a button or link for a moment, the service worker
   * takes the step picture then (control highlighted by the page's own hover style, before the click
   * changes anything). The following click on the same control uses that picture.
   */
  private readonly onHover = (e: PointerEvent): void => {
    if (this.paused || this.config.shotTiming !== 'on-hover' || !this.config.autoSteps || e.pointerType === 'touch') return;
    const raw = e.composedPath()[0] as Element | undefined;
    if (!(raw instanceof Element) || raw.closest('[data-glint-overlay]')) return;
    const target = raw.closest(CLICKABLE);
    if (target === this.hovered) return;
    this.hovered = target;
    if (this.hoverTimer) clearTimeout(this.hoverTimer);
    this.hoverTimer = null;
    if (!target) return;
    this.hoverTimer = setTimeout(() => {
      this.hoverTimer = null;
      if (this.paused || this.hovered !== target || !target.isConnected) return;
      const selector = describeElement(target).selector;
      if (selector === this.hoverSent) return;
      this.hoverSent = selector;
      this.sendHover(selector);
    }, HOVER_DWELL_MS);
  };

  private readonly onPointer = (e: PointerEvent): void => {
    this.flushScroll();
    // A new picture is wanted the next time the pointer rests on a control.
    this.hoverSent = null;
    const raw = e.composedPath()[0] as Element | undefined;
    if (!(raw instanceof Element) || raw.closest('[data-glint-overlay]')) return;
    // Fields report their own (grouped) events; clicking into them is not a step.
    if (isTextField(raw) || raw instanceof HTMLSelectElement || raw.closest('select')) return;
    const control = raw.closest('input[type="checkbox"],input[type="radio"]');
    if (control) return;
    const label = raw.closest('label');
    if (label && (label.control instanceof HTMLInputElement) && ['checkbox', 'radio'].includes(label.control.type)) return;
    if (label?.control && isTextField(label.control)) return;
    let target = raw.closest(CLICKABLE);
    if (!target) {
      // A click on plain text counts only when it is short, specific text (not a page background).
      const text = clean((raw as HTMLElement).innerText ?? raw.textContent, 200);
      if (!text || text.length > 80 || raw === document.body || raw === document.documentElement) return;
      target = raw;
    }
    this.commitTyping();
    this.emit({
      kind: 'click',
      element: describeElement(target),
      x: e.clientX / (window.innerWidth || 1),
      y: e.clientY / (window.innerHeight || 1),
      button: e.button === 2 ? 'right' : e.button === 1 ? 'middle' : 'left',
    });
  };

  private fieldValue(el: HTMLElement): string {
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return el.value;
    return clean(el.innerText, 500) ?? '';
  }

  private readonly onFocusIn = (e: FocusEvent): void => {
    const el = e.target as HTMLElement;
    if (!isTextField(el) || el.closest('[data-glint-overlay]')) return;
    if (this.focused?.el !== el) this.commitTyping();
    this.focused = { el, initial: this.fieldValue(el) };
  };

  private readonly onFocusOut = (e: FocusEvent): void => {
    if (this.focused && e.target === this.focused.el) this.commitTyping();
  };

  /** Sends one "type" event with the final value (only what the privacy settings allow). */
  private commitTyping(): void {
    const f = this.focused;
    if (!f) return;
    const value = this.fieldValue(f.el);
    this.focused = { el: f.el, initial: value };
    if (value === f.initial) return;
    const secret = sensitive(f.el);
    const allowed = this.config.values === 'non-sensitive' && !secret;
    this.emit({ kind: 'type', element: describeElement(f.el), value: allowed ? value : value ? '•' : '', sensitive: secret });
  }

  private readonly onChange = (e: Event): void => {
    const el = e.target as Element;
    if (el.closest('[data-glint-overlay]')) return;
    if (el instanceof HTMLSelectElement) {
      const secret = sensitive(el);
      const text = Array.from(el.selectedOptions).map((o) => clean(o.textContent) ?? o.value).join(', ');
      this.emit({ kind: 'select', element: describeElement(el), value: secret || this.config.values === 'never' ? '' : text, sensitive: secret });
    } else if (el instanceof HTMLInputElement && el.type === 'checkbox') {
      this.emit({ kind: 'check', element: describeElement(el), checked: el.checked });
    } else if (el instanceof HTMLInputElement && el.type === 'radio' && el.checked) {
      this.emit({ kind: 'radio', element: describeElement(el), value: labelOf(el) ?? el.value });
    } else if (isTextField(el) && this.focused?.el === el) {
      this.commitTyping();
    }
  };

  private readonly onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Enter') this.flushScroll();
    // Keys that scroll the page (not typing in a field) end the wait of a step picture.
    if (['PageDown', 'PageUp', 'ArrowDown', 'ArrowUp', ' ', 'End', 'Home'].includes(e.key) && !isTextField(e.target as Element)) this.onActivity();
    if (e.key !== 'Enter' && e.key !== 'Escape' && e.key !== ' ') return;
    const el = e.target as Element;
    if (el instanceof HTMLTextAreaElement && e.key === 'Enter') return; // new line, not an action
    // Enter / Space on a focused button or link "clicks" it from the keyboard: same step as a mouse click.
    if ((e.key === 'Enter' || e.key === ' ') && !e.repeat && el instanceof Element && !isTextField(el) && !el.closest('[data-glint-overlay]')) {
      const target = el.closest(CLICKABLE);
      const isLink = target instanceof HTMLAnchorElement;
      if (target && !(e.key === ' ' && isLink) && !target.matches('input[type="checkbox"],input[type="radio"],select')) {
        this.commitTyping();
        this.hoverSent = null;
        const r = target.getBoundingClientRect();
        this.emit({
          kind: 'click',
          element: describeElement(target),
          x: (r.left + r.width / 2) / (window.innerWidth || 1),
          y: (r.top + r.height / 2) / (window.innerHeight || 1),
          button: 'left',
        });
        return;
      }
    }
    if (e.key === ' ') return;
    this.commitTyping();
    this.emit({ kind: 'key', key: e.key, element: el instanceof Element && el !== document.body ? describeElement(el) : null });
  };

  private readonly onSubmit = (e: Event): void => {
    this.flushScroll();
    const form = e.target as HTMLFormElement;
    this.commitTyping();
    const el = describeElement(form);
    const heading = clean(form.querySelector('h1,h2,h3,legend')?.textContent);
    const button = clean(form.querySelector('[type="submit"],button:not([type="button"])')?.textContent);
    this.emit({ kind: 'submit', element: { ...el, label: el.label ?? heading ?? button } });
  };

  private readonly onScroll = (): void => {
    if (this.paused) return;
    if (this.scrollTimer) clearTimeout(this.scrollTimer);
    this.scrollTimer = setTimeout(this.reportScroll, 500);
  };

  private readonly reportScroll = (): void => {
    this.scrollTimer = null;
    const y = window.scrollY;
    const dy = y - this.lastScrollY;
    this.lastScrollY = y;
    if (Math.abs(dy) < Math.max(40, this.config.scrollThresholdPx / 2)) return;
    this.emit({ kind: 'scroll', dy, scrollY: y, pageHeight: document.documentElement.scrollHeight });
  };

  /**
   * A scroll is reported 500 ms after it stops; an action within that time (click, Enter, submit)
   * reports it first, so the steps arrive in order and the scroll picture is not taken after the click.
   */
  private flushScroll(): void {
    if (!this.scrollTimer || this.paused) return;
    clearTimeout(this.scrollTimer);
    this.reportScroll();
  }

  private readonly checkUrl = (): void => {
    if (location.href === this.lastUrl) return;
    this.lastUrl = location.href;
    this.commitTyping();
    this.lastScrollY = window.scrollY;
    this.emit({ kind: 'navigate', url: location.href, title: document.title, via: 'spa' });
  };
}
