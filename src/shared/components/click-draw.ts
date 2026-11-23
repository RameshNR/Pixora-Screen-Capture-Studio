import type { CursorEffects } from '@/shared/types';
import type { CursorAnnotation, CursorDesign, CursorEffect } from '@/editor/types';
import { renderCursorEffect, renderCursorFrame } from '@/editor/tools/cursor';

/** Click effect of the recording settings (older settings stored one of the same names in `style`). */
export const clickEffectOf = (fx: CursorEffects): CursorEffect => fx.clickEffect ?? fx.style;

export type ClickButton = 'left' | 'right' | 'double';

/** Size of the cursor shown with the clicks (px). */
export const clickCursorSize = (fx: CursorEffects): number => Math.max(12, fx.clickCursorSize ?? fx.pointerSize ?? 28);

/** The click as an image-editor cursor (design, mark, effect, motion and colours). */
export function clickCursorOf(fx: CursorEffects, x: number, y: number, button: ClickButton): CursorAnnotation {
  const size = clickCursorSize(fx);
  const colour = button === 'right' ? fx.rightColor : fx.leftColor;
  return {
    id: 'click', type: 'cursor', x, y, size, opacity: 1,
    design: (fx.clickDesign ?? fx.pointerDesign ?? 'arrow') as CursorDesign,
    color: fx.clickCursorColor ?? fx.pointerColor ?? '#FFFFFF', outline: fx.clickCursorOutline ?? fx.pointerOutline ?? '#111827',
    click: fx.clickCursor && fx.clickMark !== false ? button : 'none', clickColor: colour,
    effect: clickEffectOf(fx), effectColor: colour, effectSize: Math.max(0.1, fx.radius / (size * 0.62)),
    trail: fx.clickCursor ? fx.clickTrail ?? 'none' : 'none',
  };
}

/**
 * One moment (`t` 0–1) of a click as it is drawn into the recorded page, the settings preview and
 * the try-it pad: the image editor's effect, plus the cursor (pressed, moving, with its click mark).
 */
export function drawClickFrame(ctx: CanvasRenderingContext2D, fx: CursorEffects, x: number, y: number, button: ClickButton, t: number, fadeOut = true): void {
  const a = clickCursorOf(fx, x, y, button);
  if (fx.clickCursor) renderCursorFrame(ctx, a, t, fadeOut);
  else renderCursorEffect(ctx, a, t);
}

/** A still picture of a click (the middle of its animation). */
export function drawClick(ctx: CanvasRenderingContext2D, fx: CursorEffects, x: number, y: number, right: boolean): void {
  drawClickFrame(ctx, fx, x, y, right ? 'right' : 'left', 0.4);
}

/** Half the side of the canvas a click needs around its point (px). */
export function clickReach(fx: CursorEffects): number {
  const cursor = fx.clickCursor ? clickCursorSize(fx) * (fx.clickTrail && fx.clickTrail !== 'none' ? 3.6 : 3) : 0;
  return Math.ceil(Math.max(fx.radius * 2.4, cursor)) + 8;
}

/** Spotlight dims the whole page, so its canvas covers the viewport. */
export const clickCoversPage = (fx: CursorEffects): boolean => clickEffectOf(fx) === 'spotlight';

/**
 * Plays a click on `canvas` (sized by the caller, in CSS px `w` × `h`, the click at `x`, `y`), frame by
 * frame for the animation length, then removes the canvas.
 */
export function playClick(canvas: HTMLCanvasElement, fx: CursorEffects, x: number, y: number, w: number, h: number, button: ClickButton): void {
  // Sharp on small canvases; a page-sized one (spotlight) at 1× so each frame stays cheap.
  const dpr = w * h > 400_000 ? 1 : Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.ceil(w * dpr);
  canvas.height = Math.ceil(h * dpr);
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  const ctx = canvas.getContext('2d');
  const duration = Math.max(100, fx.durationMs);
  // Starts a little in, so even the very first frame shows the effect; the clock starts with the
  // first painted frame, so a busy page (a click that loads something) never skips the animation.
  const T0 = 0.06;
  let start = -1;
  // Next frame with the screen (smooth), or after 40 ms when the browser holds screen frames back
  // (covered or busy windows): the click always plays to the end.
  let pending = false;
  const schedule = () => {
    if (pending) return;
    pending = true;
    const go = () => {
      if (!pending) return;
      pending = false;
      frame(performance.now());
    };
    requestAnimationFrame(go);
    setTimeout(go, 40);
  };
  const frame = (now: number) => {
    if (start < 0) start = now - T0 * duration;
    const t = Math.min(1, (now - start) / duration);
    if (ctx) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      ctx.globalAlpha = fx.opacity;
      drawClickFrame(ctx, fx, x, y, button, t);
    }
    if (t < 1 && canvas.isConnected) schedule();
    else canvas.remove();
  };
  if (ctx) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalAlpha = fx.opacity;
    drawClickFrame(ctx, fx, x, y, button, T0);
  }
  schedule();
  // Hidden tabs pause animation frames: make sure the canvas never stays behind.
  setTimeout(() => canvas.remove(), duration + 1500);
}

type Look = Partial<CursorAnnotation>;

/** What a quick look sets in the click settings (the cursor, its motion and mark, the effect and colours). */
export function lookToClickFx(look: Look): Partial<CursorEffects> {
  return {
    clickCursor: true,
    clickDesign: look.design ?? 'arrow',
    clickCursorColor: look.color ?? '#FFFFFF',
    clickCursorOutline: look.outline ?? '#111827',
    clickEffect: look.effect ?? 'none',
    clickTrail: look.trail ?? 'none',
    clickMark: (look.click ?? 'none') !== 'none',
    ...(look.effectColor || look.clickColor ? { leftColor: (look.effectColor ?? look.clickColor)! } : {}),
  };
}

const same = (a: unknown, b: unknown) => (typeof a === 'string' && typeof b === 'string' ? a.toUpperCase() === b.toUpperCase() : a === b);

/** The quick look in use: the click settings are exactly what it sets. */
export function isLookActive(fx: CursorEffects, look: Look): boolean {
  const now: Partial<CursorEffects> = {
    ...fx, clickEffect: clickEffectOf(fx), clickTrail: fx.clickTrail ?? 'none', clickMark: fx.clickMark !== false,
    clickDesign: fx.clickDesign ?? 'arrow',
  };
  return Object.entries(lookToClickFx(look)).every(([k, v]) => same(now[k as keyof CursorEffects], v));
}
