import { useEffect, useRef, type ReactNode } from 'react';
import { MousePointer2, MousePointerClick, Palette, Radar, Settings2, SlidersHorizontal, Sparkles } from 'lucide-react';
import type { CursorEffects } from '@/shared/types';
import type { CursorDesign, CursorEffect, CursorTrail } from '@/editor/types';
import { CURSOR_DESIGNS, CURSOR_EFFECTS } from '@/editor/tools/cursor';
import { CursorDesignGrid, CursorEffectGrid, CursorLooksGrid, CursorMotionGrid } from '@/editor/components/CursorPickers';
import { clickCoversPage, clickEffectOf, clickReach, drawClickFrame, isLookActive, lookToClickFx, playClick, type ClickButton } from './click-draw';
import { ColorSwatches, Slider, ToggleSwitch } from './FormControls';
import styles from './ClickHighlightFields.module.css';

const COLOURS = ['#4F8DF7', '#E05252', '#FFD84D', '#24A36A', '#7C5CF6', '#F59E0B', '#FFFFFF', '#202938'];
/** Every effect of the image editor's cursor (Spotlight dims the page around the click). */
export const CLICK_EFFECTS = CURSOR_EFFECTS.filter((e) => e.value !== 'none');
/** With the cursor shown, a click can also be just the cursor (and its motion and click mark). */
const CLICK_EFFECTS_WITH_CURSOR = CURSOR_EFFECTS;

/** The preview always has this size; effects too big for it are drawn as big as fits (the cursor keeps its own size). */
const PREVIEW_W = 420;
const PREVIEW_H = 190;
const PREVIEW_MAX_R = Math.floor((PREVIEW_H / 2 - 8) / 1.4);

/** Left and right click playing over and over, exactly as recorded (cursor at its real size). */
function Preview({ fx }: { fx: CursorEffects }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const shown = { ...fx, radius: Math.min(fx.radius, PREVIEW_MAX_R) };
  const width = PREVIEW_W;
  const height = PREVIEW_H;
  const cell = width / 2;
  useEffect(() => {
    const c = ref.current;
    const ctx = c?.getContext('2d');
    if (!c || !ctx) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = width * dpr;
    c.height = height * dpr;
    const duration = Math.max(200, fx.durationMs);
    const cycle = duration * 2 + 500;
    const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const start = performance.now();
    let raf = 0;
    const frame = (now: number) => {
      const time = (now - start) % cycle;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      ctx.globalAlpha = shown.opacity;
      // Left click first, the right click half a cycle later.
      for (const [i, button] of (['left', 'right'] as ClickButton[]).entries()) {
        const t = still ? 0.4 : Math.min(1, Math.max(0, time - i * (duration * 0.6 + 250)) / duration);
        // Between clicks the cursor rests where it is (the preview never goes blank).
        const resting = !still && (t >= 1 || time < i * (duration * 0.6 + 250));
        ctx.save();
        if (clickCoversPage(shown)) {
          ctx.beginPath();
          ctx.rect(i * cell, 0, cell, height);
          ctx.clip();
        }
        if (resting) drawClickFrame(ctx, shown, cell / 2 + i * cell, height / 2, button, 1, false);
        else drawClickFrame(ctx, shown, cell / 2 + i * cell, height / 2, button, t);
        ctx.restore();
      }
      if (!still) raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  });
  return <canvas ref={ref} className={styles.preview} style={{ width: '100%', maxWidth: width, aspectRatio: `${width} / ${height}` }} role="img" aria-label="Click effect preview (left and right click)" />;
}

/** Click the bar to play the effect where you click: drawn and animated exactly as in a recording. */
function TryIt({ fx }: { fx: CursorEffects }) {
  const play = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0 && e.button !== 2) return;
    const card = e.currentTarget.closest(`.${styles.previewCard}`) as HTMLElement | null;
    if (!card) return;
    const at = card.getBoundingClientRect();
    const c = document.createElement('canvas');
    c.className = styles.burst ?? '';
    const x = e.clientX - at.left;
    const y = e.clientY - at.top;
    const button: ClickButton = e.button === 2 ? 'right' : e.detail === 2 ? 'double' : 'left';
    if (clickCoversPage(fx)) {
      // Spotlight: the light falls on the click inside the card.
      c.style.left = '0px';
      c.style.top = '0px';
      card.appendChild(c);
      playClick(c, fx, x, y, at.width, at.height, button);
      return;
    }
    const reach = clickReach(fx);
    c.style.left = `${x - reach}px`;
    c.style.top = `${y - reach}px`;
    card.appendChild(c);
    playClick(c, fx, reach, reach, reach * 2, reach * 2, button);
  };
  return (
    <button type="button" className={styles.tryIt} aria-label="Try the click effect: click here with the left or right mouse button"
      onPointerDown={play} onContextMenu={(e) => e.preventDefault()}>
      <MousePointerClick size={16} aria-hidden /> Try it: click here (left or right button)
    </button>
  );
}

function Card({ title, icon, children, className }: { title?: string; icon?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`${styles.card} ${className ?? ''}`} aria-label={title}>
      {title && <h4 className={styles.cardTitle}>{icon}{title}</h4>}
      {children}
    </section>
  );
}

function Colour({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={styles.colour}>
      <span>{label}</span>
      {children}
    </div>
  );
}

/**
 * Look of the click highlight in recordings — the same options as the image editor's Cursor tool:
 * quick looks, effect, size, opacity and animation, colours, cursor design, size, motion and click mark.
 */
export function ClickHighlightFields({ fx, onChange, tone = 'light' }: { fx: CursorEffects; onChange: (patch: Partial<CursorEffects>) => void; tone?: 'light' | 'dark' }) {
  const effect = clickEffectOf(fx);
  const design = (fx.clickDesign ?? fx.pointerDesign ?? 'arrow') as CursorDesign;
  const cursorOn = Boolean(fx.clickCursor);
  return (
    <div className={styles.host}>
    <div className={styles.studio}>
      <Card className={`${styles.previewCard} ${styles.aPreview}`}>
        <span className={styles.badge}>Preview</span>
        <Preview fx={fx} />
        <TryIt fx={fx} />
      </Card>

      <Card title="Click effect" icon={<Radar size={17} />} className={styles.aEffect}>
        <CursorEffectGrid label="Click effect" value={effect} color={fx.leftColor} effects={cursorOn ? CLICK_EFFECTS_WITH_CURSOR : CLICK_EFFECTS}
          onPick={(clickEffect: CursorEffect) => onChange({ clickEffect })} />
      </Card>

      <Card title="Quick looks" icon={<Sparkles size={17} />} className={styles.aLooks}>
        <CursorLooksGrid isActive={(look) => isLookActive(fx, look)} onPick={(look) => onChange(lookToClickFx(look))} />
      </Card>

      <div className={`${styles.stack} ${styles.aSettings}`}>
        <Card title="Effect settings" icon={<SlidersHorizontal size={17} />}>
          <Slider tone={tone} label="Effect size" min={10} max={200} value={fx.radius} format={(v) => `${v}px`} onChange={(radius) => onChange({ radius })} />
          <Slider tone={tone} label="Effect opacity" min={0.1} max={1} step={0.05} value={fx.opacity} format={(v) => `${Math.round(v * 100)}%`} onChange={(opacity) => onChange({ opacity })} />
          <Slider tone={tone} label="Animation duration" min={200} max={3000} step={50} value={fx.durationMs} format={(v) => `${(v / 1000).toFixed(2)} s`} onChange={(durationMs) => onChange({ durationMs })} />
        </Card>
        <Card title="Click colours" icon={<Palette size={17} />}>
          <Colour label="Left click colour">
            <ColorSwatches label="Left click colour" colors={COLOURS} value={fx.leftColor} onChange={(leftColor) => onChange({ leftColor })} alpha={false} />
          </Colour>
          <Colour label="Right click colour">
            <ColorSwatches label="Right click colour" colors={COLOURS} value={fx.rightColor} onChange={(rightColor) => onChange({ rightColor })} alpha={false} />
          </Colour>
        </Card>
      </div>

      <Card title="Cursor design" icon={<MousePointer2 size={17} />} className={`${styles.aDesign} ${cursorOn ? '' : styles.dim}`}>
        {!cursorOn && <p className={styles.note}>Picking a design turns on “Show the cursor with each click”.</p>}
        <CursorDesignGrid value={design}
          onPick={(d) => onChange({ clickCursor: true, clickDesign: d, clickCursorColor: CURSOR_DESIGNS[d].fill, clickCursorOutline: CURSOR_DESIGNS[d].outline })} />
        <span className={styles.subTitle}>Motion</span>
        <CursorMotionGrid label="Cursor motion" value={fx.clickTrail ?? 'none'} color={fx.leftColor}
          onPick={(clickTrail: CursorTrail) => onChange({ clickTrail, ...(clickTrail !== 'none' ? { clickCursor: true } : {}) })} />
      </Card>

      <Card title="Other options" icon={<Settings2 size={17} />} className={styles.aOptions}>
        <label className={styles.row}>
          <span>Show the cursor with each click</span>
          <ToggleSwitch size="sm" label="Show the cursor with each click" checked={cursorOn}
            onChange={(clickCursor) => onChange({ clickCursor, ...(!clickCursor && effect === 'none' ? { clickEffect: 'ring' as const } : {}) })} />
        </label>
        <label className={`${styles.row} ${cursorOn ? '' : styles.dim}`}>
          <span>Show the mouse button (left, right, double click)</span>
          <ToggleSwitch size="sm" label="Show the mouse button" checked={fx.clickMark !== false} disabled={!cursorOn} onChange={(clickMark) => onChange({ clickMark })} />
        </label>
        <div className={cursorOn ? undefined : styles.dim}>
          <Slider tone={tone} label="Cursor size" min={16} max={96} value={fx.clickCursorSize ?? 28} format={(v) => `${v}px`} onChange={(clickCursorSize) => onChange({ clickCursorSize })} />
        </div>
        <Colour label="Cursor colour">
          <ColorSwatches label="Click cursor colour" colors={['#FFFFFF', '#202938', ...COLOURS.filter((c) => c !== '#FFFFFF' && c !== '#202938')]}
            value={fx.clickCursorColor ?? '#FFFFFF'} onChange={(clickCursorColor) => onChange({ clickCursorColor, clickCursor: true })} alpha={false} />
        </Colour>
        <Colour label="Outline colour">
          <ColorSwatches label="Click cursor outline colour" colors={['#111827', '#FFFFFF', ...COLOURS.filter((c) => c !== '#FFFFFF' && c !== '#202938')]}
            value={fx.clickCursorOutline ?? '#111827'} onChange={(clickCursorOutline) => onChange({ clickCursorOutline, clickCursor: true })} alpha={false} />
        </Colour>
      </Card>
    </div>
    </div>
  );
}
