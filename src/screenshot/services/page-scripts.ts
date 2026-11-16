/**
 * Functions injected into the captured page with chrome.scripting.executeScript({ func }).
 * Each one is serialised by Chrome, so it MUST be completely self-contained: no imports, no
 * references to anything outside its own body.
 */

export interface PageMetrics {
  totalHeight: number;
  viewportWidth: number;
  viewportHeight: number;
  dpr: number;
  /** Region of the viewport that scrolls (whole viewport for normal pages, a box for app-like pages). */
  clip: { x: number; y: number; width: number; height: number };
  usesInnerScroller: boolean;
  originalScrollTop: number;
  title: string;
  url: string;
}

export interface PrepareOptions {
  hideScrollbars: boolean;
}

/** Measures the page, finds the scrolling element and disables smooth scrolling. */
export function preparePageForCapture(opts: PrepareOptions): PageMetrics {
  const w = window as unknown as Window & { __glintCapture?: Record<string, unknown> };
  const doc = document;
  const root = (doc.scrollingElement || doc.documentElement) as HTMLElement;
  const vw = doc.documentElement.clientWidth || window.innerWidth;
  const vh = window.innerHeight;
  let scroller: HTMLElement = root;
  let total = Math.max(root.scrollHeight, doc.body ? doc.body.scrollHeight : 0, doc.documentElement.scrollHeight);
  let clip = { x: 0, y: 0, width: vw, height: vh };
  let inner = false;

  if (total <= vh + 4) {
    // App-like pages (Gmail, docs viewers…) scroll an inner element instead of the document.
    let best: HTMLElement | null = null;
    let bestScore = 0;
    const all = doc.querySelectorAll<HTMLElement>('body *');
    for (let i = 0; i < all.length && i < 20000; i++) {
      const el = all[i]!;
      if (el.scrollHeight <= el.clientHeight + 20) continue;
      const style = getComputedStyle(el);
      if (!/(auto|scroll|overlay)/.test(style.overflowY)) continue;
      const r = el.getBoundingClientRect();
      if (r.width < vw * 0.4 || r.height < vh * 0.4) continue;
      const score = r.width * r.height;
      if (score > bestScore) {
        bestScore = score;
        best = el;
      }
    }
    if (best) {
      scroller = best;
      inner = true;
      const r = best.getBoundingClientRect();
      clip = {
        x: Math.max(0, r.left + best.clientLeft),
        y: Math.max(0, r.top + best.clientTop),
        width: Math.min(best.clientWidth, vw),
        height: Math.min(best.clientHeight, vh),
      };
      total = best.scrollHeight;
    }
  }

  const style = doc.createElement('style');
  style.setAttribute('data-glint-capture', '');
  style.textContent =
    'html,body,*{scroll-behavior:auto!important;}' +
    (opts.hideScrollbars ? 'html,body{scrollbar-width:none!important;}::-webkit-scrollbar{display:none!important;width:0!important;height:0!important;}' : '');
  doc.documentElement.appendChild(style);

  w.__glintCapture = {
    scroller,
    originalScrollTop: scroller.scrollTop,
    originalScrollLeft: scroller.scrollLeft,
    hidden: [] as HTMLElement[],
    style,
  };
  if (inner) scroller.setAttribute('data-glint-scroller', '');

  return {
    totalHeight: Math.ceil(total),
    viewportWidth: vw,
    viewportHeight: vh,
    dpr: window.devicePixelRatio || 1,
    clip,
    usesInnerScroller: inner,
    originalScrollTop: scroller.scrollTop,
    title: doc.title,
    url: location.href,
  };
}

/** Scrolls through the page once so lazy-loaded images and infinite lists render. */
export async function preloadLazyContent(maxHeight: number): Promise<number> {
  const w = window as unknown as Window & { __glintCapture?: { scroller: HTMLElement } };
  const scroller = w.__glintCapture?.scroller ?? ((document.scrollingElement || document.documentElement) as HTMLElement);
  const step = Math.max(200, scroller.clientHeight || window.innerHeight);
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  let y = 0;
  const started = Date.now();
  while (y < Math.min(scroller.scrollHeight, maxHeight) && Date.now() - started < 15000) {
    y += step;
    scroller.scrollTop = y;
    await wait(120);
  }
  scroller.scrollTop = 0;
  await wait(250);
  return scroller.scrollHeight;
}

/** Which screen of a full-page capture is being taken. */
export type CapturePhase = 'only' | 'first' | 'middle' | 'last';

/**
 * Scrolls to `y`, waits for scroll-driven UI to settle, and — when `hideFixed` — hides what would
 * otherwise be repeated on every screen:
 *  - fixed / sticky elements on screen (scanned on *every* step, because many sites only make their
 *    header fixed after the page has scrolled). Those in the top half (headers) stay on the first
 *    screen; those in the bottom half (chat buttons, cookie bars, toolbars like XRebel) show only on
 *    the last screen, where they belong at the bottom of the page;
 *  - on pages that scroll an inner box under a fixed header (`data-glint-scroller`), everything
 *    outside that box from the second screen on — including bits that hang over it, like a menu's
 *    “current page” arrow — since only the box is used from those screens.
 * Elements are hidden by an attribute matched in the capture stylesheet, so a widget that rewrites
 * its own `style` can't bring itself back. Returns the actual scroll position.
 */
export async function scrollPageTo(y: number, hideFixed: boolean, phase: CapturePhase = 'middle'): Promise<number> {
  // Injected with executeScript: helpers must live inside the function.
  /** True when a sticky element's nearest scrolling ancestor is a panel, not the page. */
  const stickyInsidePanel = (el: HTMLElement, pageScroller: HTMLElement): boolean => {
    for (let p = el.parentElement; p && p !== document.body && p !== document.documentElement; p = p.parentElement) {
      if (p === pageScroller) return false;
      if (p.hasAttribute('data-glint-area')) return true;
      if (/(auto|scroll|hidden|clip|overlay)/.test(getComputedStyle(p).overflowY)) return true;
    }
    return false;
  };
  type Where = 'top' | 'bottom';
  const w = window as unknown as Window & {
    __glintCapture?: {
      scroller: HTMLElement; hidden: HTMLElement[]; style: HTMLStyleElement;
      hiddenSet?: Set<HTMLElement>; where?: WeakMap<HTMLElement, Where>; hideRule?: boolean;
    };
  };
  const state = w.__glintCapture;
  const scroller = state?.scroller ?? ((document.scrollingElement || document.documentElement) as HTMLElement);
  const frames = () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

  scroller.scrollTop = y;
  // Scroll listeners (sticky headers, "back to top" buttons, lazy images) react asynchronously.
  await frames();
  await wait(150);

  if (hideFixed && state && phase !== 'only') {
    if (!state.hiddenSet) state.hiddenSet = new Set();
    if (!state.where) state.where = new WeakMap();
    if (!state.hideRule) {
      state.style.textContent += '[data-glint-hide]{visibility:hidden!important;}';
      state.hideRule = true;
    }
    const vh = window.innerHeight;
    const hiddenSet = state.hiddenSet;
    const where = state.where;
    let changed = false;
    const hide = (el: HTMLElement) => {
      if (hiddenSet.has(el)) return;
      hiddenSet.add(el);
      state.hidden.push(el);
      el.setAttribute('data-glint-hide', '');
      changed = true;
    };
    const show = (el: HTMLElement) => {
      if (!hiddenSet.has(el)) return;
      hiddenSet.delete(el);
      el.removeAttribute('data-glint-hide');
      changed = true;
    };
    /**
     * Where an element belongs, decided the first time it is seen. Only header-like elements (at the
     * top edge, less than half the window tall) belong to the first screen; every other fixed
     * element — a bottom bar, a floating button, or a full-height transparent strip whose visible
     * part sits at the bottom (XRebel's toolbar) — belongs to the last screen only. Sticky elements
     * always count as "top": shown again at the end, they could stick at the top a second time.
     */
    const place = (el: HTMLElement, r: { top: number; height: number }, fixed: boolean): Where => {
      let p = where.get(el);
      if (!p) {
        const headerLike = r.top <= vh * 0.25 && r.height <= vh * 0.5;
        p = !fixed || headerLike ? 'top' : 'bottom';
        where.set(el, p);
      }
      return p;
    };
    /** First screen: keep the top ones; middle screens: none; last screen: only the bottom ones. */
    const apply = (el: HTMLElement, p: Where, fixedOnly: boolean) => {
      if (phase === 'first') {
        if (p === 'bottom' && fixedOnly) hide(el);
      } else if (phase === 'last') {
        if (p === 'bottom') show(el);
        else hide(el);
      } else hide(el);
    };

    /**
     * Where an element is drawn: its own box, or — for a zero-size wrapper whose visible parts
     * overflow it (toolbars injected by dev tools often are) — the box around its visible contents,
     * including open shadow DOM. Null when nothing of it is visible.
     */
    const drawnRect = (el: Element): { top: number; bottom: number; height: number } | null => {
      const own = el.getBoundingClientRect();
      if (own.width > 0 && own.height > 0) return own;
      let top = Infinity;
      let bottom = -Infinity;
      const stack: Element[] = [...Array.from(el.children), ...(el.shadowRoot ? Array.from(el.shadowRoot.children) : [])];
      for (let n = 0; stack.length && n < 400; n++) {
        const d = stack.pop()!;
        const rr = d.getBoundingClientRect();
        if (rr.width > 0 && rr.height > 0) {
          const cs = getComputedStyle(d);
          if (cs.visibility !== 'hidden' && cs.opacity !== '0' && cs.display !== 'none') {
            top = Math.min(top, rr.top);
            bottom = Math.max(bottom, rr.bottom);
          }
        }
        stack.push(...Array.from(d.children));
        if (d.shadowRoot) stack.push(...Array.from(d.shadowRoot.children));
      }
      return top < bottom ? { top, bottom, height: bottom - top } : null;
    };

    // 1. Fixed and sticky elements on screen — also inside open shadow DOM (widgets injected by
    //    dev tools / extensions). One inside a shadow tree is hidden through its outermost host, since
    //    the capture stylesheet can't reach into the shadow tree.
    const stack: Array<[Element, HTMLElement | null]> = [];
    const root = document.body ?? document.documentElement;
    for (let i = root.children.length - 1; i >= 0; i--) stack.push([root.children[i]!, null]);
    for (let count = 0; stack.length && count < 60000; count++) {
      const [node, host] = stack.pop()!;
      if (node.hasAttribute('data-glint-overlay')) continue;
      for (let i = node.children.length - 1; i >= 0; i--) stack.push([node.children[i]!, host]);
      const shadow = (node as HTMLElement).shadowRoot;
      if (shadow) for (let i = shadow.children.length - 1; i >= 0; i--) stack.push([shadow.children[i]!, host ?? (node as HTMLElement)]);
      const style = getComputedStyle(node);
      if (style.position !== 'fixed' && style.position !== 'sticky') continue;
      if (style.display === 'none') continue;
      const target = host ?? (node as HTMLElement);
      if (style.visibility === 'hidden' && !hiddenSet.has(target)) continue;
      const r = drawnRect(node);
      if (!r) continue;
      if (!hiddenSet.has(target) && (r.bottom <= 0 || r.top >= vh)) continue;
      // A sticky element that sticks inside its own panel (a table header in a scrolling list) is
      // part of that panel's content, not a page header repeated on every frame: keep it.
      if (style.position === 'sticky' && stickyInsidePanel(node as HTMLElement, scroller)) continue;
      // Sticky elements in the first screen are usually still in their normal place: leave them.
      if (style.position === 'sticky' && phase === 'first') continue;
      apply(target, place(target, r, style.position === 'fixed'), style.position === 'fixed');
    }

    // 2. Pages scrolling an inner box: everything outside the box (the header strip, side bars,
    //    overlays that hang over the box). Only the box is used from screens after the first.
    if (scroller.hasAttribute('data-glint-scroller')) {
      let child: HTMLElement = scroller;
      let parent = scroller.parentElement;
      while (parent) {
        for (const sib of Array.from(parent.children) as HTMLElement[]) {
          if (sib === child || sib.hasAttribute('data-glint-overlay')) continue;
          if (/^(SCRIPT|STYLE|LINK|META|NOSCRIPT|TEMPLATE|HEAD)$/.test(sib.tagName)) continue;
          // Zero-size wrappers count by what they draw (their visible contents).
          const r = drawnRect(sib);
          if (!r && !hiddenSet.has(sib)) continue;
          apply(sib, place(sib, r ?? { top: 0, height: 0 }, true), true);
        }
        if (parent === document.body) break;
        child = parent;
        parent = parent.parentElement;
      }
    }
    if (changed) await frames();
  }
  await wait(40);
  return scroller.scrollTop;
}

/** Restores scroll position, hidden elements and removes the capture stylesheet. */
export function restorePageAfterCapture(): void {
  const w = window as unknown as Window & {
    __glintCapture?: {
      scroller: HTMLElement;
      originalScrollTop: number;
      originalScrollLeft: number;
      hidden: HTMLElement[];
      style: HTMLStyleElement;
    };
  };
  const state = w.__glintCapture;
  if (!state) return;
  for (const el of state.hidden) el.removeAttribute('data-glint-hide');
  state.style.remove();
  state.scroller.removeAttribute('data-glint-scroller');
  state.scroller.scrollTop = state.originalScrollTop;
  state.scroller.scrollLeft = state.originalScrollLeft;
  delete w.__glintCapture;
}

/** Returns basic info about the page for naming captures. */
/**
 * Waits (up to `maxMs`) until running CSS transitions / animations end, so a dropdown or menu that
 * grows open is captured fully open instead of squashed mid-animation. Endless animations
 * (spinners) are ignored. Runs in the page.
 */
export async function waitForAnimations(maxMs: number): Promise<number> {
  const start = performance.now();
  const frame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));
  await frame();
  for (;;) {
    const left = maxMs - (performance.now() - start);
    if (left <= 0) break;
    const running = (document.getAnimations?.() ?? []).filter((a) => {
      if (a.playState !== 'running') return false;
      const end = a.effect?.getComputedTiming().endTime;
      return typeof end === 'number' && Number.isFinite(end);
    });
    if (!running.length) break;
    await Promise.race([Promise.all(running.map((a) => a.finished.catch(() => undefined))), new Promise((r) => setTimeout(r, left))]);
  }
  await frame();
  await frame();
  return Math.round(performance.now() - start);
}

/**
 * Waits (up to `maxMs`) until the page looks ready after a click: no visible loader (spinner,
 * progress bar, skeleton, aria-busy), the document is loaded, no network response arrived in the
 * last `quietMs`, and opening animations are done. Loaders that never go away (a permanent
 * progress bar) are remembered and ignored next time, so they cannot slow down every capture.
 * Self-contained: runs in the page.
 */
export async function waitForPageReady(maxMs: number, quietMs: number): Promise<{ waitedMs: number; loader: boolean }> {
  const start = performance.now();
  const w = window as unknown as { __glintStaticLoaders?: WeakSet<Element> };
  const known = (w.__glintStaticLoaders ??= new WeakSet<Element>());
  const SELECTOR = [
    '[aria-busy="true"]', '[role="progressbar"]', 'progress', '[data-loading="true"]',
    '[class*="spinner" i]', '[class*="loader" i]', '[class*="loading" i]', '[class*="skeleton" i]', '[class*="shimmer" i]', '[class*="preload" i]',
  ].join(',');
  const visibleLoaders = (): Element[] => {
    const out: Element[] = [];
    const list = document.querySelectorAll(SELECTOR);
    for (let i = 0; i < list.length && i < 400; i++) {
      const el = list[i]!;
      if (known.has(el) || el.closest('[data-glint-overlay]')) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 4 || r.height < 4 || r.bottom < 0 || r.right < 0 || r.top > innerHeight || r.left > innerWidth) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || Number(cs.opacity) < 0.05 || cs.display === 'none') continue;
      out.push(el);
    }
    return out;
  };
  const networkBusy = () => {
    const now = performance.now();
    const entries = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
    for (let i = entries.length - 1; i >= 0 && i >= entries.length - 50; i--) if (entries[i]!.responseEnd > now - quietMs) return true;
    return false;
  };
  const animating = () =>
    (document.getAnimations?.() ?? []).some((a) => {
      if (a.playState !== 'running') return false;
      const end = a.effect?.getComputedTiming().endTime;
      return typeof end === 'number' && Number.isFinite(end);
    });
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  let calm = 0;
  let sawLoader = false;
  let lastLoaders: Element[] = [];
  while (performance.now() - start < maxMs) {
    lastLoaders = visibleLoaders();
    if (lastLoaders.length) sawLoader = true;
    const busy = lastLoaders.length > 0 || document.readyState !== 'complete' || networkBusy() || animating();
    calm = busy ? 0 : calm + 1;
    // Ready when calm for two checks in a row (about 200 ms).
    if (calm >= 2) break;
    await sleep(100);
  }
  // Timed out with loaders still showing: they are part of the page, ignore them from now on.
  if (performance.now() - start >= maxMs) for (const el of lastLoaders) known.add(el);
  await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
  return { waitedMs: Math.round(performance.now() - start), loader: sawLoader };
}

export function readPageInfo(): { title: string; url: string; dpr: number; width: number; height: number } {
  return {
    title: document.title,
    url: location.href,
    dpr: window.devicePixelRatio || 1,
    width: document.documentElement.clientWidth || window.innerWidth,
    height: window.innerHeight,
  };
}

/* ------------------------------ scrollable areas ------------------------------ */

/** A scrollable region inside the page (besides the page itself). */
export interface ScrollArea {
  index: number;
  label: string;
  /** Extra text from the area's title bar, e.g. "25 packages". */
  detail?: string;
  rect: { x: number; y: number; width: number; height: number };
  /** Content height and visible height (CSS px). */
  scrollHeight: number;
  clientHeight: number;
  /** How many screens of this area there are. */
  screens: number;
}

export interface ScrollAreaReport {
  /** The page itself scrolls. */
  pageScrolls: boolean;
  pageScreens: number;
  areas: ScrollArea[];
}

/**
 * Finds every visible element whose content scrolls vertically (sidebars, chat panes, code views,
 * tables, app main panes) and tags it with data-glint-area so later steps can find it again.
 */
export function detectScrollAreas(): ScrollAreaReport {
  const doc = document;
  doc.querySelectorAll('[data-glint-area]').forEach((el) => el.removeAttribute('data-glint-area'));
  const vw = doc.documentElement.clientWidth || window.innerWidth;
  const vh = window.innerHeight;
  const root = (doc.scrollingElement || doc.documentElement) as HTMLElement;
  const areas: ScrollArea[] = [];
  const all = doc.querySelectorAll<HTMLElement>('body *');
  for (let i = 0; i < all.length && i < 30000 && areas.length < 24; i++) {
    const el = all[i]!;
    if (el.scrollHeight <= el.clientHeight + 40 || el.clientHeight < 80) continue;
    const style = getComputedStyle(el);
    if (!/(auto|scroll|overlay)/.test(style.overflowY)) continue;
    if (style.visibility === 'hidden' || style.display === 'none') continue;
    const r = el.getBoundingClientRect();
    // Areas further down the page count too (not only those on screen now).
    if (r.width < 120 || r.height < 80 || r.right <= 0 || r.left >= vw) continue;
    const index = areas.length;
    el.setAttribute('data-glint-area', String(index));
    const aria = el.getAttribute('aria-label') || el.getAttribute('title') || '';
    // Name it after the section it belongs to (its title bar or heading), else its own first heading.
    const clean = (t: string | null | undefined) => (t ?? '').replace(/\s+/g, ' ').trim().slice(0, 48);
    const section = el.closest('section, article, [role="region"], fieldset');
    const bar = section ? section.querySelector<HTMLElement>('h1, h2, h3, h4, legend, [role="heading"], [class*="header" i], [class*="title" i]') : null;
    // A title bar often holds a count or badge too ("25 packages"): name the area after the title itself.
    let sectionTitle = '';
    if (bar) {
      const inner = bar.querySelector('h1, h2, h3, h4, h5, h6, [role="heading"], [class*="title" i]');
      // The bar's own text ("CONTENT 1 - …" next to a <span class="count">), else its heading, else its first labelled child.
      const own = clean(Array.from(bar.childNodes).filter((n) => n.nodeType === 3).map((n) => n.textContent).join(' '));
      const firstChild = Array.from(bar.children).find((c) => clean(c.textContent).length > 2);
      sectionTitle = (inner && clean(inner.textContent)) || (own.length > 2 ? own : '') || (bar.children.length > 1 && firstChild ? clean(firstChild.textContent) : '') || clean(bar.textContent);
    }
    const barText = clean(bar?.textContent);
    const detail = sectionTitle && barText.startsWith(sectionTitle) ? barText.slice(sectionTitle.length).trim().slice(0, 32) : '';
    const heading = sectionTitle || clean(el.querySelector('h1, h2, h3, [role="heading"]')?.textContent);
    const role = el.getAttribute('role') || el.tagName.toLowerCase();
    const id = el.id ? '#' + el.id : '';
    const mid = r.left + r.width / 2;
    const where = mid < vw / 3 ? 'left' : mid > (vw * 2) / 3 ? 'right' : 'centre';
    areas.push({
      index,
      label: aria || heading || role + id + ' (' + where + ')',
      ...(detail && !aria ? { detail } : {}),
      rect: { x: r.left, y: r.top, width: r.width, height: r.height },
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
      screens: Math.ceil(el.scrollHeight / Math.max(1, el.clientHeight)),
    });
  }
  const pageHeight = Math.max(root.scrollHeight, doc.body ? doc.body.scrollHeight : 0);
  return { pageScrolls: pageHeight > vh + 4, pageScreens: Math.ceil(pageHeight / vh), areas };
}

/** Outlines the detected areas with numbered labels (`focus` drawn stronger); show=false removes them. */
export function highlightScrollAreas(focus: number | null, show: boolean): void {
  const doc = document;
  doc.getElementById('glint-scroll-areas')?.remove();
  if (!show) return;
  const layer = doc.createElement('div');
  layer.id = 'glint-scroll-areas';
  // Outlines sit on the page (they scroll with it), not fixed to the screen.
  layer.style.cssText = 'position:absolute;left:0;top:0;width:0;height:0;pointer-events:none;z-index:2147483646;';
  doc.querySelectorAll<HTMLElement>('[data-glint-area]').forEach((el) => {
    const i = Number(el.getAttribute('data-glint-area'));
    const r = el.getBoundingClientRect();
    const box = doc.createElement('div');
    const strong = focus === null || focus === i;
    if (focus === i) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    box.style.cssText = 'position:absolute;left:' + (r.left + window.scrollX) + 'px;top:' + (r.top + window.scrollY) + 'px;width:' + r.width + 'px;height:' + r.height + 'px;' +
      'border:' + (strong ? 3 : 2) + 'px ' + (strong ? 'solid' : 'dashed') + ' rgba(79,141,247,' + (strong ? 1 : 0.55) + ');' +
      'background:rgba(79,141,247,' + (focus === i ? 0.16 : 0.05) + ');border-radius:4px;box-sizing:border-box;';
    const tag = doc.createElement('div');
    tag.textContent = String(i + 1);
    tag.textContent = 'Area ' + (i + 1);
    tag.style.cssText = 'position:absolute;left:-3px;top:-24px;height:22px;padding:0 9px;border-radius:6px 6px 6px 0;white-space:nowrap;' +
      'background:#4F8DF7;color:#fff;font:700 12px/22px system-ui,sans-serif;box-shadow:0 2px 6px rgba(0,0,0,.25);';
    box.appendChild(tag);
    layer.appendChild(box);
  });
  doc.documentElement.appendChild(layer);
}

/**
 * Lets chosen scroll areas grow to show their content (all of it, or the first `screens` screens),
 * and loosens the height limits of their parents so the page itself becomes taller. The normal
 * scroll-and-stitch capture then records the content. Everything is undone by restoreScrollAreas.
 */
export function expandScrollAreas(areas: Array<{ index: number; screens: number }>): number {
  const doc = document;
  doc.getElementById('glint-scroll-areas')?.remove();
  const w = window as unknown as Window & { __glintExpand?: Array<[HTMLElement, string, string, string]> };
  const saved: Array<[HTMLElement, string, string, string]> = w.__glintExpand ?? [];
  const vh = window.innerHeight;
  const set = (el: HTMLElement, prop: string, value: string) => {
    saved.push([el, prop, el.style.getPropertyValue(prop), el.style.getPropertyPriority(prop)]);
    el.style.setProperty(prop, value, 'important');
  };
  for (const { index, screens } of areas) {
    const el = doc.querySelector<HTMLElement>('[data-glint-area="' + index + '"]');
    if (!el) continue;
    const full = el.scrollHeight;
    const target = screens > 0 ? Math.min(full, el.clientHeight * screens) : full;
    el.scrollTop = 0;
    set(el, 'height', target + 'px');
    set(el, 'min-height', target + 'px');
    set(el, 'max-height', 'none');
    set(el, 'flex', 'none');
    set(el, 'overflow-y', target < full ? 'hidden' : 'visible');
    // The area no longer scrolls, so its sticky parts (table header rows, group titles) would stick
    // to the page instead and float over other content: show them where they belong, in place.
    el.querySelectorAll<HTMLElement>('*').forEach((child) => {
      if (getComputedStyle(child).position === 'sticky') set(child, 'position', 'static');
    });
    for (let p = el.parentElement; p && p !== doc.documentElement; p = p.parentElement) {
      const cs = getComputedStyle(p);
      if (/(hidden|auto|scroll|clip|overlay)/.test(cs.overflowY)) set(p, 'overflow-y', 'visible');
      if (cs.maxHeight !== 'none') set(p, 'max-height', 'none');
      if (p.scrollHeight > p.clientHeight + 1 || cs.height.endsWith('px')) set(p, 'height', 'auto');
      // App shells pinned to the viewport would otherwise never grow the page.
      if (cs.position === 'fixed' && p.getBoundingClientRect().height >= vh * 0.5) set(p, 'position', 'absolute');
    }
  }
  for (const el of [doc.documentElement, doc.body].filter(Boolean) as HTMLElement[]) {
    set(el, 'overflow-y', 'visible');
    set(el, 'height', 'auto');
  }
  w.__glintExpand = saved;
  return Math.max(doc.documentElement.scrollHeight, doc.body ? doc.body.scrollHeight : 0);
}

/** Undoes expandScrollAreas and removes the area tags and outlines. */
export function restoreScrollAreas(): void {
  const doc = document;
  const w = window as unknown as Window & { __glintExpand?: Array<[HTMLElement, string, string, string]> };
  const saved = w.__glintExpand ?? [];
  for (let i = saved.length - 1; i >= 0; i--) {
    const [el, prop, value, priority] = saved[i]!;
    if (value) el.style.setProperty(prop, value, priority);
    else el.style.removeProperty(prop);
  }
  delete w.__glintExpand;
  doc.getElementById('glint-scroll-areas')?.remove();
  doc.querySelectorAll('[data-glint-area]').forEach((el) => el.removeAttribute('data-glint-area'));
}
