import { useEffect, useRef, useState } from 'react';
import type { CursorAnnotation, CursorDesign, CursorEffect, CursorTrail } from '../types';
import { CURSOR_DESIGN_IDS, CURSOR_DESIGNS, CURSOR_EFFECTS, CURSOR_GROUPS, CURSOR_LOOKS, CURSOR_TRAILS, cursorBounds, cursorGroupOf, renderCursor, renderCursorFrame, type CursorGroup } from '../tools/cursor';
import styles from './CursorPickers.module.css';

/**
 * Cursor pickers shared by the image editor's Cursor tool and the recording settings (click
 * highlights, styled cursor): the same quick looks, designs and effects, each shown as a picture.
 */

function Thumb({ width = 40, height = 40, draw }: { width?: number; height?: number; draw: (ctx: CanvasRenderingContext2D) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    const ctx = c?.getContext('2d');
    if (!c || !ctx) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = width * dpr;
    c.height = height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    try {
      draw(ctx);
    } catch {
      /* previews are best effort */
    }
  });
  return <canvas ref={ref} style={{ width, height }} aria-hidden />;
}

const base = (patch: Partial<CursorAnnotation>): CursorAnnotation => ({
  id: 'p', type: 'cursor', x: 0, y: 0, size: 28, design: 'arrow', color: '#FFFFFF', outline: '#111827',
  click: 'none', clickColor: '#E05252', effect: 'none', effectColor: '#F59E0B', effectSize: 1, opacity: 1, ...patch,
});

/** Draws a cursor centred in a w × h box (smaller when it has an effect around it). */
function centred(ctx: CanvasRenderingContext2D, a: CursorAnnotation, w: number, h: number): void {
  const box = CURSOR_DESIGNS[a.design].box;
  const k = a.size / 24;
  const fx = a.effect !== 'none' ? 0.6 : 1;
  renderCursor(ctx, { ...a, x: w / 2 - (box.x + box.w / 2) * k * fx, y: h / 2 - (box.y + box.h / 2) * k * fx });
}

/** One-click looks (design, click mark, effect and colours together). */
export function CursorLooksGrid({ onPick, isActive }: {
  onPick: (patch: Partial<CursorAnnotation>, id: string) => void;
  /** Whether a look is the one in use now (it is highlighted). */
  isActive?: (patch: Partial<CursorAnnotation>) => boolean;
}) {
  return (
    <div className={styles.grid} role="listbox" aria-label="Cursor quick looks">
      {CURSOR_LOOKS.map((l) => (
        <button key={l.id} type="button" role="option" data-card aria-selected={Boolean(isActive?.(l.patch))} aria-label={l.label} title={l.label}
          className={isActive?.(l.patch) ? styles.on : undefined} onClick={() => onPick(l.patch, l.id)}>
          <Thumb draw={(ctx) => centred(ctx, base({ size: 20, ...l.patch }), 40, 40)} />
        </button>
      ))}
    </div>
  );
}

/** Cursor designs by group (classic, themed, shape, recording, gesture, resize, action, creative). */
export function CursorDesignGrid({ value, onPick }: { value: CursorDesign; onPick: (d: CursorDesign) => void }) {
  const [group, setGroup] = useState<CursorGroup>(() => cursorGroupOf(value));
  return (
    <div className={styles.picker}>
      <div className={styles.tabs} role="tablist" aria-label="Cursor design groups">
        {CURSOR_GROUPS.map((g) => (
          <button key={g.id} type="button" role="tab" aria-selected={group === g.id} className={group === g.id ? styles.tabOn : undefined} onClick={() => setGroup(g.id)}>{g.label}</button>
        ))}
      </div>
      <div className={styles.grid} role="radiogroup" aria-label="Cursor design">
        {CURSOR_DESIGN_IDS.filter((d) => cursorGroupOf(d) === group).map((d) => (
          <button key={d} type="button" role="radio" data-card aria-checked={value === d} aria-label={CURSOR_DESIGNS[d].label} title={CURSOR_DESIGNS[d].label}
            className={value === d ? styles.on : undefined} onClick={() => onPick(d)}>
            <Thumb draw={(ctx) => centred(ctx, base({ design: d, color: CURSOR_DESIGNS[d].fill, outline: CURSOR_DESIGNS[d].outline }), 40, 40)} />
          </button>
        ))}
      </div>
    </div>
  );
}

/** Cursor motion (animated looks) shown as pictures with their names. */
export function CursorMotionGrid({ value, color, onPick, label = 'Cursor motion' }: { value: CursorTrail; color: string; onPick: (t: CursorTrail) => void; label?: string }) {
  return (
    <div className={styles.effects} role="radiogroup" aria-label={label}>
      {CURSOR_TRAILS.map((m) => (
        <button key={m.value} type="button" role="radio" data-card aria-checked={value === m.value} aria-label={m.label} title={m.label}
          className={value === m.value ? styles.on : undefined} onClick={() => onPick(m.value)}>
          <Thumb width={56} height={44} draw={(ctx) => centred(ctx, base({ size: 18, trail: m.value, effectColor: color }), 56, 44)} />
          <span>{m.label}</span>
        </button>
      ))}
    </div>
  );
}

/**
 * The cursor's click animation, playing over and over (click it to replay from the start).
 * Shows what recordings and videos play: the effect, the press, the motion and the click mark.
 */
export function CursorAnimPreview({ cursor, durationMs, width = 240, height = 120, label = 'Animated cursor preview', className }: {
  cursor: Omit<CursorAnnotation, 'x' | 'y'>; durationMs: number; width?: number; height?: number; label?: string; className?: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const started = useRef(0);
  useEffect(() => {
    const c = ref.current;
    const ctx = c?.getContext('2d');
    if (!c || !ctx) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = width * dpr;
    c.height = height * dpr;
    // Fit the whole animation in the box (big effects are shown smaller).
    const probe = { ...cursor, x: 0, y: 0 } as CursorAnnotation;
    const b = cursorBounds(probe);
    const k = Math.min(1.4, (width - 16) / Math.max(1, b.w * 1.15), (height - 16) / Math.max(1, b.h * 1.15));
    // Centre the whole drawing (cursor, effect, mark), not just the hot spot.
    const ox = -(b.x + b.w / 2);
    const oy = -(b.y + b.h / 2);
    const cycle = Math.max(200, durationMs) + 450;
    const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    let raf = 0;
    started.current = performance.now();
    const frame = (now: number) => {
      const t = still ? 0.4 : Math.min(1, ((now - started.current) % cycle) / Math.max(200, durationMs));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      ctx.translate(width / 2, height / 2);
      ctx.scale(k, k);
      ctx.translate(ox, oy);
      try {
        renderCursorFrame(ctx, probe, t, false);
      } catch {
        /* best effort */
      }
      if (!still) raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [cursor, durationMs, width, height]);
  return <canvas ref={ref} className={className} style={{ width, height, maxWidth: '100%', cursor: 'pointer' }} role="img" aria-label={label}
    onClick={() => { started.current = performance.now(); }} />;
}

/** Effects shown as pictures with their names. */
export function CursorEffectGrid({ value, color, onPick, effects = CURSOR_EFFECTS, label = 'Cursor effect' }: {
  value: CursorEffect; color: string; onPick: (e: CursorEffect) => void; effects?: typeof CURSOR_EFFECTS; label?: string;
}) {
  return (
    <div className={styles.effects} role="radiogroup" aria-label={label}>
      {effects.map((e) => (
        <button key={e.value} type="button" role="radio" data-card aria-checked={value === e.value} aria-label={e.label} title={e.description}
          className={value === e.value ? styles.on : undefined} onClick={() => onPick(e.value)}>
          <Thumb width={56} height={44} draw={(ctx) => centred(ctx, base({ size: 18, effect: e.value, effectColor: color, effectSize: 1 }), 56, 44)} />
          <span>{e.label}</span>
        </button>
      ))}
    </div>
  );
}
