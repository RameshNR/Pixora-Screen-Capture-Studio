/**
 * On-demand page overlay (injected only after a user action via activeTab + scripting):
 *  - area selection for screenshots and custom-area recording (drag, move, resize, confirm/cancel)
 *  - recording countdown
 *  - frame around the recorded area
 *  - click and (privacy-conscious) keyboard-shortcut highlights
 *
 * Everything renders inside a closed shadow root so page styles cannot leak in or out.
 * This file is bundled as a classic IIFE script; only type imports are allowed.
 */
import { CURSOR_DESIGNS, renderCursor } from '@/editor/tools/cursor';
import { describeKeys } from '@/shared/utils/keys';
import { clickCoversPage, clickReach, playClick, type ClickButton } from '@/shared/components/click-draw';
import { glideAlpha } from '@/shared/utils/cursor-glide';
import type { ContentMessage, OverlayMode } from '@/shared/messaging/messages';
import type { CursorEffects, PixelRect } from '@/shared/types';
import { AnnotateLayer } from './annotate-layer';
import { FlowTracker } from './flow-tracker';

type GlintWindow = Window & { __glintOverlayLoaded?: boolean };
const w = window as GlintWindow;

if (!w.__glintOverlayLoaded) {
  w.__glintOverlayLoaded = true;
  init();
}

function init(): void {
  const Z = '2147483647';
  let host: HTMLDivElement | null = null;
  let root: ShadowRoot | null = null;
  let cleanupSelection: (() => void) | null = null;
  let cleanupHighlights: (() => void) | null = null;
  let frameEl: HTMLDivElement | null = null;
  let countdownEl: HTMLDivElement | null = null;
  let annotate: AnnotateLayer | null = null;
  let flow: FlowTracker | null = null;
  let watchdog: ReturnType<typeof setInterval> | null = null;

  const CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; font-family: Inter, "Segoe UI", system-ui, -apple-system, sans-serif; }
    .layer { position: fixed; inset: 0; z-index: ${Z}; }
    .select { cursor: crosshair; }
    .shade { position: fixed; background: rgba(15, 23, 42, 0.45); pointer-events: none; }
    .hint { position: fixed; top: 20px; left: 50%; transform: translateX(-50%); padding: 10px 16px; border-radius: 999px;
      background: rgba(20, 26, 38, 0.92); color: #fff; font-size: 13px; font-weight: 500; letter-spacing: .1px;
      box-shadow: 0 8px 24px rgba(0,0,0,.25); pointer-events: none; white-space: nowrap; }
    .hint kbd { background: rgba(255,255,255,.14); border-radius: 4px; padding: 1px 6px; margin: 0 2px; font-size: 12px; }
    .sel { position: fixed; border: 2px solid #4F8DF7; box-shadow: 0 0 0 1px rgba(255,255,255,.6) inset; cursor: move; }
    .sel.rec { border-style: dashed; border-color: #EF5350; }
    .handle { position: absolute; width: 12px; height: 12px; background: #fff; border: 2px solid #4F8DF7; border-radius: 3px; }
    .sel.rec .handle { border-color: #EF5350; }
    .h-nw { left: -7px; top: -7px; cursor: nwse-resize; } .h-ne { right: -7px; top: -7px; cursor: nesw-resize; }
    .h-sw { left: -7px; bottom: -7px; cursor: nesw-resize; } .h-se { right: -7px; bottom: -7px; cursor: nwse-resize; }
    .h-n { left: calc(50% - 6px); top: -7px; cursor: ns-resize; } .h-s { left: calc(50% - 6px); bottom: -7px; cursor: ns-resize; }
    .h-w { left: -7px; top: calc(50% - 6px); cursor: ew-resize; } .h-e { right: -7px; top: calc(50% - 6px); cursor: ew-resize; }
    .dims { position: absolute; left: 0; top: -30px; padding: 3px 8px; border-radius: 6px; background: #202938; color: #fff;
      font-size: 12px; font-variant-numeric: tabular-nums; white-space: nowrap; }
    .bar { position: absolute; right: 0; bottom: -48px; display: flex; gap: 6px; padding: 5px; background: #fff; border-radius: 10px;
      box-shadow: 0 8px 24px rgba(15,23,42,.22); }
    .btn { border: 0; height: 32px; padding: 0 12px; border-radius: 7px; font-size: 13px; font-weight: 600; cursor: pointer;
      display: inline-flex; align-items: center; gap: 6px; transition: background .12s, transform .06s; }
    .btn:active { transform: translateY(1px); }
    .btn:focus-visible { outline: 2px solid #4F8DF7; outline-offset: 2px; }
    .ok { background: #4F8DF7; color: #fff; } .ok:hover { background: #3978E8; }
    .rec .ok, .ok.rec { background: #EF5350; } .ok.rec:hover { background: #E04340; }
    .cancel { background: #F6F7F9; color: #202938; } .cancel:hover { background: #E8EBF0; }
    .countdown { position: fixed; inset: 0; display: grid; place-items: center; pointer-events: none; z-index: ${Z};
      background: rgba(15, 23, 42, 0.25); }
    .count { width: 148px; height: 148px; border-radius: 50%; display: grid; place-items: center; color: #fff; font-size: 72px; font-weight: 700;
      background: rgba(32, 41, 56, 0.86); box-shadow: 0 16px 48px rgba(0,0,0,.35); animation: pop .9s ease-out both; }
    @keyframes pop { 0% { transform: scale(.6); opacity: 0 } 25% { transform: scale(1.05); opacity: 1 } 100% { transform: scale(1); opacity: .95 } }
    .frame { position: fixed; pointer-events: none; z-index: ${Z}; border: 2px dashed rgba(239, 83, 80, .9); border-radius: 2px; }
    .ripple { position: fixed; width: 44px; height: 44px; margin: -22px 0 0 -22px; border-radius: 50%; pointer-events: none; z-index: ${Z};
      background: rgba(79, 141, 247, .35); border: 2px solid rgba(79, 141, 247, .9); animation: ripple .55s ease-out forwards; }
    @keyframes ripple { from { transform: scale(.3); opacity: 1 } to { transform: scale(1.3); opacity: 0 } }
    .keys { position: fixed; left: 50%; bottom: 40px; transform: translateX(-50%); padding: 10px 18px; border-radius: 12px; pointer-events: none;
      z-index: ${Z}; background: rgba(20,26,38,.88); color: #fff; font-size: 20px; font-weight: 600; letter-spacing: .3px;
      transition: opacity .25s; }
    .halo { position: fixed; border-radius: 50%; pointer-events: none; z-index: ${Z}; transform: translate(-50%, -50%);
      transition: width .12s, height .12s; }
    .fx { position: fixed; border-radius: 50%; pointer-events: none; z-index: ${Z}; transform: translate(-50%, -50%) scale(.2); }
    .fx.ring { border: 3px solid currentColor; animation: fxRing var(--d) ease-out forwards; }
    .fx.ripple { background: currentColor; animation: fxRipple var(--d) ease-out forwards; }
    .fx.pulse { border: 3px solid currentColor; box-shadow: 0 0 0 6px currentColor; animation: fxPulse var(--d) ease-out forwards; }
    .fx.burst { border: 4px dotted currentColor; animation: fxRing var(--d) ease-out forwards; }
    .fx.target { border: 3px solid currentColor; background: radial-gradient(circle, currentColor 0 16%, transparent 17% 52%, currentColor 53% 56%, transparent 57%); animation: fxRipple var(--d) ease-out forwards; }
    .fx.glow { background: radial-gradient(circle, currentColor 0, transparent 70%); animation: fxRing var(--d) ease-out forwards; }
    .fx.click { border-radius: 0; transform: translate(-50%, -50%); }
    .fx.click.page { transform: none; left: 0; top: 0; }
    .pointer { position: fixed; left: 0; top: 0; pointer-events: none; z-index: ${Z}; will-change: transform; }
    @keyframes fxRing { from { transform: translate(-50%, -50%) scale(.2); opacity: var(--o) } to { transform: translate(-50%, -50%) scale(1); opacity: 0 } }
    @keyframes fxRipple { from { transform: translate(-50%, -50%) scale(.1); opacity: var(--o) } to { transform: translate(-50%, -50%) scale(1); opacity: 0 } }
    @keyframes fxPulse { 0% { transform: translate(-50%, -50%) scale(.3); opacity: var(--o) } 40% { transform: translate(-50%, -50%) scale(.75) }
      100% { transform: translate(-50%, -50%) scale(1); opacity: 0; box-shadow: 0 0 0 0 currentColor } }
    .annot { position: fixed; left: 0; top: 0; z-index: ${Z}; }
    .annot-hint { position: fixed; left: 50%; top: 10px; transform: translateX(-50%); padding: 6px 12px; border-radius: 999px; z-index: ${Z};
      background: rgba(20, 26, 38, .85); color: #fff; font-size: 12px; pointer-events: none; }
    .annot-text { position: fixed; z-index: ${Z}; min-width: 160px; padding: 2px 4px; border: 1px dashed rgba(79,141,247,.9);
      background: rgba(255,255,255,.85); outline: none; pointer-events: auto; }
    .toast { position: fixed; left: 50%; top: 24px; transform: translateX(-50%); padding: 10px 16px; border-radius: 10px; z-index: ${Z};
      background: #202938; color: #fff; font-size: 13px; pointer-events: none; box-shadow: 0 8px 24px rgba(0,0,0,.25); }
  `;

  const SUB_FRAME = window !== window.top;

  function ensureRoot(): ShadowRoot {
    if (root && host?.isConnected) return root;
    host = document.createElement('div');
    host.setAttribute('data-glint-overlay', '');
    host.style.cssText = `all: initial; position: fixed; inset: 0; pointer-events: none; z-index: ${Z};`;
    root = host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = CSS;
    root.appendChild(style);
    document.documentElement.appendChild(host);
    return root;
  }

  function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, parent?: Node): HTMLElementTagNameMap[K] {
    const node = document.createElement(tag);
    node.className = className;
    parent?.appendChild(node);
    return node;
  }

  function maybeRemoveHost(): void {
    if (!cleanupSelection && !cleanupHighlights && !frameEl && !countdownEl && !annotate) {
      host?.remove();
      host = null;
      root = null;
    }
  }

  function nextFrames(): Promise<void> {
    return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
  }

  /* --------------------------------- selection -------------------------------- */
  function startSelection(mode: OverlayMode): void {
    cleanupSelection?.();
    const r = ensureRoot();
    host!.style.pointerEvents = 'auto';
    const region = mode === 'region-highlight' || mode === 'region-zoom';
    const isRec = mode === 'area-record' || region;
    const layer = el('div', 'layer select', r);
    layer.tabIndex = -1;
    const shades = [0, 1, 2, 3].map(() => el('div', 'shade', layer));
    const hint = el('div', 'hint', layer);
    hint.append(
      region ? (mode === 'region-zoom' ? 'Click where to zoom in, or drag over an area · ' : 'Drag over the area to highlight · ') : isRec ? 'Drag to choose the area to record · ' : 'Drag to select an area · ',
      kbd('Enter'), ' confirm · ', kbd('Esc'), ' cancel',
    );
    const sel = el('div', isRec ? 'sel rec' : 'sel', layer);
    sel.style.display = 'none';
    const dims = el('div', 'dims', sel);
    for (const h of ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']) {
      el('div', `handle h-${h}`, sel).dataset.handle = h;
    }
    const bar = el('div', 'bar', sel);
    const cancelBtn = el('button', 'btn cancel', bar);
    cancelBtn.textContent = 'Cancel';
    const okBtn = el('button', isRec ? 'btn ok rec' : 'btn ok', bar);
    okBtn.textContent = region ? (mode === 'region-zoom' ? 'Zoom here' : 'Highlight') : isRec ? 'Record this area' : 'Capture';

    let rect: PixelRect | null = null;
    let drag: { kind: 'new' | 'move' | string; sx: number; sy: number; start: PixelRect } | null = null;

    const vw = () => document.documentElement.clientWidth || window.innerWidth;
    const vh = () => window.innerHeight;

    function render(): void {
      if (!rect || rect.width < 1 || rect.height < 1) {
        sel.style.display = 'none';
        shades[0]!.style.cssText = 'left:0;top:0;right:0;bottom:0;';
        shades.slice(1).forEach((s) => (s.style.cssText = 'display:none'));
        return;
      }
      const { x, y, width, height } = rect;
      sel.style.display = 'block';
      sel.style.left = `${x}px`;
      sel.style.top = `${y}px`;
      sel.style.width = `${width}px`;
      sel.style.height = `${height}px`;
      shades[0]!.style.cssText = `left:0;top:0;width:100%;height:${y}px;`;
      shades[1]!.style.cssText = `left:0;top:${y + height}px;width:100%;bottom:0;`;
      shades[2]!.style.cssText = `left:0;top:${y}px;width:${x}px;height:${height}px;`;
      shades[3]!.style.cssText = `left:${x + width}px;top:${y}px;right:0;height:${height}px;`;
      const dpr = window.devicePixelRatio || 1;
      dims.textContent = `${Math.round(width * dpr)} × ${Math.round(height * dpr)}`;
      dims.style.top = y < 34 ? '6px' : '-30px';
      dims.style.left = y < 34 ? '6px' : '0';
      // Keep the action bar on screen.
      bar.style.bottom = y + height + 52 > vh() ? '6px' : '-48px';
      bar.style.right = '0';
    }

    const clampRect = (rc: PixelRect): PixelRect => {
      let { x, y, width, height } = rc;
      if (width < 0) { x += width; width = -width; }
      if (height < 0) { y += height; height = -height; }
      x = Math.max(0, Math.min(x, vw()));
      y = Math.max(0, Math.min(y, vh()));
      width = Math.min(width, vw() - x);
      height = Math.min(height, vh() - y);
      return { x, y, width, height };
    };

    function onDown(e: PointerEvent): void {
      if (e.button !== 0) return;
      const target = e.composedPath()[0] as HTMLElement;
      if (bar.contains(target)) return;
      e.preventDefault();
      e.stopPropagation();
      const handle = target.dataset?.handle;
      if (rect && handle) drag = { kind: handle, sx: e.clientX, sy: e.clientY, start: { ...rect } };
      else if (rect && sel.contains(target)) drag = { kind: 'move', sx: e.clientX, sy: e.clientY, start: { ...rect } };
      else {
        rect = { x: e.clientX, y: e.clientY, width: 0, height: 0 };
        drag = { kind: 'new', sx: e.clientX, sy: e.clientY, start: { ...rect } };
      }
      layer.setPointerCapture(e.pointerId);
      render();
    }

    function onMove(e: PointerEvent): void {
      if (!drag) return;
      const dx = e.clientX - drag.sx;
      const dy = e.clientY - drag.sy;
      const s = drag.start;
      if (drag.kind === 'new') {
        rect = clampRect({ x: s.x, y: s.y, width: dx, height: dy });
      } else if (drag.kind === 'move') {
        rect = {
          x: Math.max(0, Math.min(s.x + dx, vw() - s.width)),
          y: Math.max(0, Math.min(s.y + dy, vh() - s.height)),
          width: s.width,
          height: s.height,
        };
      } else {
        let { x, y, width, height } = s;
        if (drag.kind.includes('w')) { x = s.x + dx; width = s.width - dx; }
        if (drag.kind.includes('e')) width = s.width + dx;
        if (drag.kind.includes('n')) { y = s.y + dy; height = s.height - dy; }
        if (drag.kind.includes('s')) height = s.height + dy;
        rect = clampRect({ x, y, width, height });
      }
      render();
    }

    function onUp(): void {
      // Zoom: a click (no drag) zooms 2× at that point — half the view, centred on it (kept inside).
      if (mode === 'region-zoom' && drag?.kind === 'new' && rect && rect.width < 4 && rect.height < 4) {
        const w = vw() / 2;
        const h = vh() / 2;
        rect = { x: Math.max(0, Math.min(vw() - w, drag.sx - w / 2)), y: Math.max(0, Math.min(vh() - h, drag.sy - h / 2)), width: w, height: h };
        drag = null;
        void confirm();
        return;
      }
      if (drag && rect && (rect.width < 4 || rect.height < 4)) rect = null;
      drag = null;
      render();
    }

    async function confirm(): Promise<void> {
      if (!rect || rect.width < 4 || rect.height < 4) return;
      const chosen = { ...rect };
      const viewport = { width: vw(), height: vh() };
      teardownSelection();
      await nextFrames();
      const rel = {
        x: chosen.x / viewport.width,
        y: chosen.y / viewport.height,
        width: chosen.width / viewport.width,
        height: chosen.height / viewport.height,
      };
      if (region) {
        void chrome.runtime.sendMessage({ target: 'background', type: 'recording/region-selected', purpose: mode === 'region-zoom' ? 'zoom' : 'highlight', rect: rel, page: pageGeometry() });
      } else if (isRec) {
        void chrome.runtime.sendMessage({
          target: 'background',
          type: 'recording/area-selected',
          rect: {
            x: chosen.x / viewport.width,
            y: chosen.y / viewport.height,
            width: chosen.width / viewport.width,
            height: chosen.height / viewport.height,
          },
        });
      } else {
        void chrome.runtime.sendMessage({
          target: 'background',
          type: 'screenshot/area-result',
          rect: chosen,
          viewport,
          dpr: window.devicePixelRatio || 1,
        });
      }
    }

    function cancel(): void {
      teardownSelection();
      if (region) {
        void chrome.runtime.sendMessage({ target: 'background', type: 'recording/region-cancelled' }).catch(() => undefined);
        return;
      }
      void chrome.runtime.sendMessage({ target: 'background', type: isRec ? 'recording/area-cancel' : 'screenshot/area-cancel' });
    }

    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancel(); }
      if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); void confirm(); }
    }

    function teardownSelection(): void {
      layer.remove();
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('resize', render);
      if (host) host.style.pointerEvents = 'none';
      cleanupSelection = null;
      maybeRemoveHost();
    }

    layer.addEventListener('pointerdown', onDown);
    layer.addEventListener('pointermove', onMove);
    layer.addEventListener('pointerup', onUp);
    layer.addEventListener('dblclick', () => void confirm());
    okBtn.addEventListener('click', (e) => { e.stopPropagation(); void confirm(); });
    cancelBtn.addEventListener('click', (e) => { e.stopPropagation(); cancel(); });
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', render);
    render();
    layer.focus();
    cleanupSelection = teardownSelection;
  }

  function kbd(text: string): HTMLElement {
    const k = document.createElement('kbd');
    k.textContent = text;
    return k;
  }

  /* --------------------------------- countdown -------------------------------- */
  function countdown(seconds: number): void {
    countdownEl?.remove();
    const r = ensureRoot();
    const wrap = el('div', 'countdown', r);
    countdownEl = wrap;
    let left = Math.round(seconds);
    const tick = () => {
      if (left <= 0 || countdownEl !== wrap) {
        wrap.remove();
        if (countdownEl === wrap) countdownEl = null;
        maybeRemoveHost();
        return;
      }
      wrap.replaceChildren();
      const c = el('div', 'count', wrap);
      c.textContent = String(left);
      left--;
      // The last tick hides slightly early so the overlay is gone when recording starts.
      setTimeout(tick, left === 0 ? 850 : 1000);
    };
    tick();
  }

  /* ----------------------------- recorded-area frame -------------------------- */
  function showFrame(rect: { x: number; y: number; width: number; height: number } | null): void {
    frameEl?.remove();
    frameEl = null;
    if (!rect) return maybeRemoveHost();
    const r = ensureRoot();
    const frame = el('div', 'frame', r);
    frameEl = frame;
    const place = () => {
      const vw = document.documentElement.clientWidth || window.innerWidth;
      const vh = window.innerHeight;
      // Drawn well outside the recorded area (the crop is rounded to even device pixels), so the
      // frame never shows up in the recording itself.
      frame.style.left = `${rect.x * vw - 6}px`;
      frame.style.top = `${rect.y * vh - 6}px`;
      frame.style.width = `${rect.width * vw + 12}px`;
      frame.style.height = `${rect.height * vh + 12}px`;
    };
    place();
    window.addEventListener('resize', place);
    startWatchdog();
  }

  /**
   * Safety net: if the "recording finished" message never arrives (service worker restarted,
   * message lost), recording-only overlays remove themselves once no recording is running.
   */
  function startWatchdog(): void {
    // Embedded frames are torn down with their page (the teardown message reaches every frame):
    // they never poll, so pages full of frames add no traffic while recording.
    if (watchdog || SUB_FRAME) return;
    let failures = 0;
    watchdog = setInterval(() => {
      chrome.runtime
        .sendMessage({ target: 'background', type: 'recording/get-state' })
        .then((res: { ok?: boolean; data?: { status?: string } }) => {
          failures = 0;
          const status = res?.data?.status;
          if (status && ['idle', 'error'].includes(status)) teardown();
        })
        // A busy or restarting service worker misses an answer now and then: only give up after
        // several in a row (one miss used to switch the click effects off for the whole recording).
        .catch(() => {
          if (++failures >= 4) teardown();
        });
    }, 3000);
  }

  /** Where this page is on screen (desktop / window recordings place page areas and the mouse on their frames). */
  function pageGeometry() {
    return {
      screenX: window.screenX, screenY: window.screenY, outerWidth: window.outerWidth, outerHeight: window.outerHeight,
      innerWidth: window.innerWidth, innerHeight: window.innerHeight, dpr: window.devicePixelRatio || 1,
    };
  }

  /* -------------------------------- highlights -------------------------------- */
  function highlights(clicks: boolean, keys: boolean, fx?: CursorEffects, track = false): void {
    cleanupHighlights?.();
    if (SUB_FRAME) {
      // Embedded frames only show their own clicks and shortcuts; the top page draws the cursor and reports the mouse.
      fx = fx ? { ...fx, cursor: false, pointer: false, hideSystemCursor: false } : fx;
      track = false;
    }
    const cursorHalo = Boolean(fx?.cursor);
    const styled = Boolean(fx?.pointer);
    if (!clicks && !keys && !cursorHalo && !track && !styled) return;
    const r = ensureRoot();
    let keyEl: HTMLDivElement | null = null;
    let keyTimer: ReturnType<typeof setTimeout> | null = null;
    let halo: HTMLDivElement | null = null;
    if (cursorHalo && fx) {
      halo = el('div', 'halo', r);
      halo.style.width = halo.style.height = `${fx.cursorSize}px`;
      halo.style.background = fx.cursorColor;
      halo.style.opacity = String(Math.min(1, fx.opacity * 0.55));
      halo.style.display = 'none';
    }
    // Styled cursor that glides after the mouse (drawn into the page, so tab recordings show it).
    let pointerEl: HTMLCanvasElement | null = null;
    let pointerRaf = 0;
    let hideStyle: HTMLStyleElement | null = null;
    const target = { x: -100, y: -100 };
    const cur = { x: -100, y: -100 };
    /** The pointer glides towards the mouse (smoothing on); otherwise it is moved in the mouse event. */
    let glide = false;
    let pointerOffset = { x: 0, y: 0 };
    if (styled && fx) {
      // The same cursor as Highlight mouse clicks shows with each click (one design, size and colour).
      const design = fx.clickDesign ?? fx.pointerDesign ?? 'arrow';
      const size = Math.max(12, fx.clickCursorSize ?? fx.pointerSize ?? 28);
      const dpr = window.devicePixelRatio || 1;
      const def = CURSOR_DESIGNS[design] ?? CURSOR_DESIGNS.arrow;
      const k = size / 24;
      const pad = 6;
      const w = Math.ceil(def.box.w * k + pad * 2);
      const h = Math.ceil(def.box.h * k + pad * 2);
      pointerOffset = { x: -def.box.x * k + pad, y: -def.box.y * k + pad };
      pointerEl = el('canvas', 'pointer', r);
      pointerEl.width = Math.ceil(w * dpr);
      pointerEl.height = Math.ceil(h * dpr);
      pointerEl.style.width = `${w}px`;
      pointerEl.style.height = `${h}px`;
      pointerEl.style.display = 'none';
      const pc = pointerEl.getContext('2d');
      if (pc) {
        pc.scale(dpr, dpr);
        renderCursor(pc, {
          id: 'p', type: 'cursor', x: pointerOffset.x, y: pointerOffset.y, size, design, color: fx.clickCursorColor ?? fx.pointerColor ?? '#FFFFFF', outline: fx.clickCursorOutline ?? fx.pointerOutline ?? '#111827',
          click: 'none', clickColor: '#000000', effect: 'none', effectColor: '#000000', effectSize: 1, opacity: 1,
        });
      }
      if (fx.hideSystemCursor) {
        hideStyle = document.createElement('style');
        hideStyle.textContent = '*, *::before, *::after { cursor: none !important; }';
        document.documentElement.appendChild(hideStyle);
      }
      const smoothing = fx.smoothing ?? 0;
      glide = smoothing >= 0.05;
      let last = performance.now();
      const tick = (now: number) => {
        // Glide towards the mouse (time-based, short: smooth on video without trailing behind).
        const k = glideAlpha(Math.min(100, now - last), smoothing);
        last = now;
        cur.x += (target.x - cur.x) * k;
        cur.y += (target.y - cur.y) * k;
        if (Math.abs(target.x - cur.x) < 0.1) cur.x = target.x;
        if (Math.abs(target.y - cur.y) < 0.1) cur.y = target.y;
        if (pointerEl) pointerEl.style.transform = `translate(${cur.x - pointerOffset.x}px, ${cur.y - pointerOffset.y}px)`;
        pointerRaf = requestAnimationFrame(tick);
      };
      // Without glide the pointer is moved in the mouse event itself (no frame of delay).
      if (glide) pointerRaf = requestAnimationFrame(tick);
    }
    // Cursor positions for zoom / spotlight in the recording (sent only while recording, only to Pixora).
    let port: chrome.runtime.Port | null = null;
    if (track) {
      try {
        port = chrome.runtime.connect({ name: 'glint-cursor' });
        port.onDisconnect.addListener(() => { port = null; });
      } catch {
        port = null;
      }
    }
    let pending: { x: number; y: number } | null = null;
    let raf = 0;
    const flush = () => {
      raf = 0;
      if (pending && port) port.postMessage({ x: pending.x, y: pending.y, page: pageGeometry() });
      pending = null;
    };
    const onMove = (e: PointerEvent) => {
      if (pointerEl) {
        if (pointerEl.style.display === 'none') {
          cur.x = e.clientX;
          cur.y = e.clientY;
          pointerEl.style.display = 'block';
        }
        target.x = e.clientX;
        target.y = e.clientY;
        if (!glide) {
          cur.x = e.clientX;
          cur.y = e.clientY;
          pointerEl.style.transform = `translate(${cur.x - pointerOffset.x}px, ${cur.y - pointerOffset.y}px)`;
        }
      }
      if (halo) {
        halo.style.display = 'block';
        halo.style.left = `${e.clientX}px`;
        halo.style.top = `${e.clientY}px`;
      }
      if (port) {
        pending = { x: e.clientX / window.innerWidth, y: e.clientY / window.innerHeight };
        if (!raf) raf = requestAnimationFrame(flush);
      }
    };

    let lastClick: { at: number; x: number; y: number } | null = null;
    const onClick = (e: PointerEvent) => {
      if (port) port.postMessage({ x: e.clientX / window.innerWidth, y: e.clientY / window.innerHeight, click: e.button === 2 ? 'right' : 'left', page: pageGeometry() });
      if (!clicks) return;
      if (!fx) {
        const dot = el('div', 'ripple', r);
        dot.style.left = `${e.clientX}px`;
        dot.style.top = `${e.clientY}px`;
        setTimeout(() => dot.remove(), 600);
        return;
      }
      // The image editor's cursor effect (and cursor, when chosen), animated frame by frame.
      let button: ClickButton = e.button === 2 ? 'right' : 'left';
      const now = performance.now();
      if (button === 'left' && lastClick && now - lastClick.at < 450 && Math.hypot(e.clientX - lastClick.x, e.clientY - lastClick.y) < 12) button = 'double';
      lastClick = button === 'double' ? null : { at: now, x: e.clientX, y: e.clientY };
      // The page may have replaced our layer (frameworks re-rendering <html>): always draw into the live one.
      const live = ensureRoot();
      if (clickCoversPage(fx)) {
        const dot = el('canvas', 'fx click page', live);
        playClick(dot, fx, e.clientX, e.clientY, window.innerWidth, window.innerHeight, button);
      } else {
        const reach = clickReach(fx);
        const dot = el('canvas', 'fx click', live);
        dot.style.left = `${e.clientX}px`;
        dot.style.top = `${e.clientY}px`;
        playClick(dot, fx, reach, reach, reach * 2, reach * 2, button);
      }
    };
    // Privacy: only shortcuts (with a modifier) and navigation keys are shown, never typed text,
    // and nothing is shown while focus is in a password field.
    const SPECIAL = new Set(['Enter', 'Escape', 'Tab', 'Backspace', 'Delete', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'Home', 'End']);
    const onKey = (e: KeyboardEvent) => {
      if (!keys) return;
      const active = document.activeElement as HTMLInputElement | null;
      if (active?.type === 'password') return;
      const isMod = ['Control', 'Meta', 'Alt', 'Shift'].includes(e.key);
      const hasRealMod = e.ctrlKey || e.metaKey || e.altKey;
      if (isMod || (!hasRealMod && !SPECIAL.has(e.key))) return;
      if (!keyEl) keyEl = el('div', 'keys', r);
      // Mac: ⌘⇧Z (Option letters by their key, not the character they type); others: Ctrl + Shift + Z.
      keyEl.textContent = describeKeys(e);
      keyEl.style.opacity = '1';
      if (keyTimer) clearTimeout(keyTimer);
      keyTimer = setTimeout(() => { if (keyEl) keyEl.style.opacity = '0'; }, 1200);
    };
    const onLeave = (e: MouseEvent) => {
      if (e.relatedTarget) return;
      if (pointerEl) pointerEl.style.display = 'none';
      if (halo) halo.style.display = 'none';
    };
    window.addEventListener('pointerdown', onClick, true);
    window.addEventListener('pointermove', onMove, true);
    window.addEventListener('mouseout', onLeave, true);
    window.addEventListener('keydown', onKey, true);
    startWatchdog();
    cleanupHighlights = () => {
      window.removeEventListener('pointerdown', onClick, true);
      window.removeEventListener('pointermove', onMove, true);
      window.removeEventListener('mouseout', onLeave, true);
      window.removeEventListener('keydown', onKey, true);
      if (raf) cancelAnimationFrame(raf);
      if (pointerRaf) cancelAnimationFrame(pointerRaf);
      pointerEl?.remove();
      hideStyle?.remove();
      port?.disconnect();
      halo?.remove();
      keyEl?.remove();
      cleanupHighlights = null;
      maybeRemoveHost();
    };
  }

  function toast(text: string, durationMs: number): void {
    const r = ensureRoot();
    const t = el('div', 'toast', r);
    t.textContent = text;
    setTimeout(() => { t.remove(); maybeRemoveHost(); }, durationMs);
  }

  /* --------------------------- markers & annotation --------------------------- */
  // Alt+Shift+M adds a chapter marker while recording (the service worker ignores it otherwise).
  window.addEventListener('keydown', (e) => {
    if (e.altKey && e.shiftKey && e.code === 'KeyM' && (cleanupHighlights || frameEl || annotate)) {
      e.preventDefault();
      void chrome.runtime.sendMessage({ target: 'background', type: 'recording/marker' }).catch(() => undefined);
    }
  }, true);

  function annotateAction(action: Parameters<AnnotateLayer['apply']>[0]): void {
    if (action.kind === 'stop' && !annotate) return;
    if (!annotate) {
      const r = ensureRoot();
      annotate = new AnnotateLayer(r, host!, {
        onStateChange: (drawing) => {
          void chrome.runtime.sendMessage({ target: 'background', type: 'recording/annotate', action: { kind: 'interact', on: !drawing } }).catch(() => undefined);
        },
      });
      startWatchdog();
    }
    annotate.apply(action);
  }

  function teardown(): void {
    if (watchdog) clearInterval(watchdog);
    watchdog = null;
    annotate?.destroy();
    annotate = null;
    cleanupSelection?.();
    cleanupHighlights?.();
    countdownEl?.remove();
    countdownEl = null;
    frameEl?.remove();
    frameEl = null;
    maybeRemoveHost();
  }

  chrome.runtime.onMessage.addListener((msg: ContentMessage, sender, sendResponse) => {
    if (sender.id !== chrome.runtime.id || !msg || msg.target !== 'content') return false;
    // Embedded frames get the overlay only for click highlights: everything else is the top page's.
    if (SUB_FRAME && msg.type !== 'overlay/effects' && msg.type !== 'overlay/highlights' && msg.type !== 'overlay/teardown') return false;
    switch (msg.type) {
      case 'overlay/select':
        startSelection(msg.mode);
        break;
      case 'overlay/countdown':
        countdown(msg.seconds);
        break;
      case 'overlay/area-frame':
        showFrame(msg.rect);
        break;
      case 'overlay/highlights':
        highlights(msg.clicks, msg.keys);
        break;
      case 'overlay/effects':
        highlights(msg.clicks, msg.keys, msg.cursor, msg.track);
        break;
      case 'overlay/annotate':
        annotateAction(msg.action);
        break;
      case 'overlay/flow':
        if (msg.action === 'start' && msg.config) {
          if (flow) flow.setConfig(msg.config);
          else flow = new FlowTracker(
            msg.config,
            (event) => void chrome.runtime.sendMessage({ target: 'background', type: 'flow/event', event }).catch(() => undefined),
            (selector) => void chrome.runtime.sendMessage({ target: 'background', type: 'flow/hover', selector }).catch(() => undefined),
            () => void chrome.runtime.sendMessage({ target: 'background', type: 'flow/activity' }).catch(() => undefined),
          );
          flow.pause(false);
        } else if (msg.action === 'pause' || msg.action === 'resume') {
          flow?.pause(msg.action === 'pause');
        } else if (msg.action === 'stop') {
          flow?.stop();
          flow = null;
        }
        break;
      case 'overlay/marker-added':
        toast(`Marker added · ${msg.marker.name}`, 1600);
        break;
      case 'overlay/toast':
        toast(msg.text, msg.durationMs);
        break;
      case 'overlay/teardown':
        teardown();
        break;
      default:
        return false;
    }
    sendResponse({ ok: true, data: null });
    return false;
  });
}
