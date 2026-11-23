import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Aperture, Blend, Brush, Check, Circle, CircleDashed, Contrast, Droplet, Droplets, Eraser, Grip, ImagePlus, Mountain, MousePointerClick, RotateCcw, ScanSearch, Sparkle, Sparkles, Sun, Thermometer, Triangle, Undo2, X } from 'lucide-react';
import { Button, IconButton } from '@/shared/components/Button';
import { ColorSwatches, RadioGroup, Slider, ToggleSwitch } from '@/shared/components/FormControls';
import { Spinner } from '@/shared/components/Progress';
import { IMAGE_ACCEPT } from '@/shared/utils/image-types';
import { ADJUSTMENTS, ADJUST_MIN, EFFECTS, LABELS, NO_FILTERS, PRESETS, isActive, renderFiltered, type Adjustment, type Effect, type ImageFilters } from '../tools/filters';
import { PALETTE, type ToolStyles } from '../types';
import { Group, Section } from './PropertiesPanel';
import styles from './editor.module.css';

/* --------------------------------- Filters ---------------------------------- */

type Src = (CanvasImageSource & { width: number; height: number }) | null;

/** Small preview of the picture with some filters (a look, or an effect). */
function Thumb({ source, filters }: { source: Src; filters: ImageFilters }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const key = JSON.stringify(filters);
  useEffect(() => {
    const c = ref.current;
    if (!c || !source) return;
    const k = Math.min(1, 160 / Math.max(source.width, source.height));
    const w = Math.max(1, Math.round(source.width * k));
    const h = Math.max(1, Math.round(source.height * k));
    c.width = 160;
    c.height = 110;
    const out = renderFiltered(source, w, h, filters);
    const ctx = c.getContext('2d')!;
    const s = Math.max(c.width / w, c.height / h);
    ctx.drawImage(out, (c.width - w * s) / 2, (c.height - h * s) / 2, w * s, h * s);
  }, [source, key]); // eslint-disable-line react-hooks/exhaustive-deps
  return <canvas ref={ref} className={styles.filterThumb} aria-hidden />;
}

/**
 * One setting: icon, name, slider and its value (type a number too). Changes are sent at most once
 * a frame while dragging (big pictures are re-filtered for each one).
 */
function FilterRow({ icon, label, value, min, max, unit = '', track, onChange }: {
  icon: ReactNode; label: string; value: number; min: number; max: number; unit?: string;
  /** A coloured track (Temperature: blue → orange, Tint: green → magenta). */
  track?: string;
  onChange: (v: number) => void;
}) {
  const [draft, setDraft] = useState<number | null>(null);
  const frame = useRef<number | null>(null);
  const shown = draft ?? value;
  const send = (v: number) => {
    setDraft(v);
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => { frame.current = null; onChange(v); });
  };
  useEffect(() => { if (draft !== null && draft === value) setDraft(null); }, [value, draft]);
  const pctPos = ((shown - min) / (max - min)) * 100;
  const signed = min < 0;
  const text = `${signed && shown > 0 ? '+' : ''}${Math.round(shown)}${unit}`;
  return (
    <div className={styles.fRow}>
      <div className={styles.fRowTop}>
        <span className={styles.fRowIcon} aria-hidden>{icon}</span>
        <span className={styles.fRowLabel} onDoubleClick={() => onChange(0)} title="Double-click to reset">{label}</span>
      </div>
      <div className={styles.fRowCtl}>
      <input
        type="range" className={styles.fRange} aria-label={label} min={min} max={max} step={1} value={shown}
        style={{ ['--fill' as string]: `${pctPos}%`, ...(track ? { ['--track' as string]: track } : {}) }}
        onChange={(e) => send(Number(e.target.value))}
        onPointerUp={() => setDraft(null)}
        onDoubleClick={() => onChange(0)}
      />
      <input
        className={styles.fValue} aria-label={`${label} value`} inputMode="numeric" value={text}
        onFocus={(e) => e.target.select()}
        onChange={(e) => {
          const n = Number(e.target.value.replace(/[^\d.-]/g, ''));
          if (Number.isFinite(n)) onChange(Math.max(min, Math.min(max, Math.round(n))));
        }}
      />
      <IconButton tone="dark" size="sm" label={`Reset ${label.toLowerCase()}`} icon={<RotateCcw size={12} />} onClick={() => onChange(0)} disabled={shown === 0} tooltipSide="left" />
      </div>
    </div>
  );
}

const ADJUST_ICONS: Record<Adjustment, ReactNode> = {
  brightness: <Sun size={16} />, contrast: <Contrast size={16} />, saturation: <Droplet size={16} />, exposure: <Aperture size={16} />,
  temperature: <Thermometer size={16} />, tint: <Droplets size={16} />, highlights: <Triangle size={16} />,
  shadows: <Triangle size={16} style={{ transform: 'rotate(180deg)' }} />, sharpness: <Mountain size={16} />, noise: <Grip size={16} />,
};
const EFFECT_ICONS: Record<Effect, ReactNode> = {
  blur: <CircleDashed size={16} />, vignette: <Circle size={16} />, grain: <Grip size={16} />, glow: <Sparkle size={16} />, sharpen: <Mountain size={16} />, fade: <Blend size={16} />,
};
const TRACKS: Partial<Record<Adjustment, string>> = {
  temperature: 'linear-gradient(90deg, #3b82f6, #e5e7eb 50%, #f59e0b)',
  tint: 'linear-gradient(90deg, #22c55e, #e5e7eb 50%, #d946ef)',
};

/** One-click effects (Effects tab): each sets its own sliders; None takes all effects off. */
const EFFECT_LOOKS: Array<{ id: string; label: string; set: Partial<Record<Effect, number>> }> = [
  { id: 'none', label: 'None', set: {} },
  { id: 'blur', label: 'Blur', set: { blur: 40 } },
  { id: 'bokeh', label: 'Bokeh', set: { blur: 45, glow: 45 } },
  { id: 'vignette', label: 'Vignette', set: { vignette: 50 } },
  { id: 'glow', label: 'Glow', set: { glow: 40 } },
  { id: 'grain', label: 'Grain', set: { grain: 35 } },
  { id: 'fade', label: 'Fade', set: { fade: 35 } },
  { id: 'sharpen', label: 'Sharpen', set: { sharpen: 50 } },
];

type FilterTab = 'presets' | 'adjust' | 'effects';

export function FiltersPanel({ filters, onChange, source }: {
  filters: ImageFilters | null;
  onChange: (f: ImageFilters | null, label: string, key: string) => void;
  /** The picture (for the previews). */
  source: Src;
}) {
  const [tab, setTab] = useState<FilterTab>('presets');
  const f = filters ?? NO_FILTERS;
  const set = (patch: Partial<ImageFilters>, label: string, key: string) => {
    const next = { ...f, ...patch };
    onChange(next.preset !== 'original' || isActive(next) ? next : null, label, key);
  };
  const adjust = (k: Adjustment, v: number) => set({ adjust: { ...f.adjust, [k]: v } }, `Filter: ${LABELS[k].toLowerCase()}`, `filters:${k}`);
  const effect = (k: Effect, v: number) => set({ effects: { ...f.effects, [k]: v } }, `Filter: ${LABELS[k].toLowerCase()}`, `filters:${k}`);
  const effectsOn = EFFECTS.filter((k) => (f.effects[k] ?? 0) > 0);
  return (
    <section className={styles.section} aria-label="Filters">
      <div className={styles.fHead}>
        <span className={styles.fHeadIcon} aria-hidden><Blend size={22} /></span>
        <div>
          <div className={styles.fTitle}>Filters</div>
          <div className={styles.fSub}>Apply filters and adjust image settings.</div>
        </div>
      </div>
      <div className={styles.fTabs} role="tablist" aria-label="Filter settings">
        {(['presets', 'adjust', 'effects'] as const).map((t) => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} className={`${styles.fTab} ${tab === t ? styles.fTabOn : ''}`} onClick={() => setTab(t)}>
            {t === 'presets' ? 'Presets' : t === 'adjust' ? 'Adjust' : 'Effects'}
          </button>
        ))}
      </div>

      {tab === 'presets' && (
        <div role="tabpanel" aria-label="Presets">
          <div className={styles.fGrid} role="radiogroup" aria-label="Filter preset">
            {PRESETS.map((p) => (
              <button key={p} type="button" role="radio" aria-checked={f.preset === p} aria-label={LABELS[p]} className={`${styles.fCard} ${f.preset === p ? styles.fCardOn : ''}`}
                onClick={() => set({ preset: p, intensity: p === f.preset ? f.intensity : 100 }, `Filter: ${LABELS[p]}`, 'filters:preset')}>
                <Thumb source={source} filters={{ ...NO_FILTERS, preset: p }} />
                {f.preset === p && p !== 'original' && <span className={styles.fCheck} aria-hidden><Check size={12} /></span>}
                <span className={styles.fCardLabel}>{LABELS[p]}</span>
              </button>
            ))}
          </div>
          <div className={styles.fIntensity}>
            <FilterRow icon={<Sparkles size={16} />} label="Filter intensity" unit="%" value={f.preset === 'original' ? 100 : f.intensity} min={0} max={100}
              onChange={(intensity) => f.preset !== 'original' && set({ intensity }, 'Filter intensity', 'filters:intensity')} />
          </div>
          <div className={styles.fNote}>
            <Sparkles size={18} aria-hidden />
            <div><strong>Quick looks</strong><span>One click to restyle the picture. The original is never changed: switch, adjust or undo any time.</span></div>
          </div>
        </div>
      )}

      {tab === 'adjust' && (
        <div role="tabpanel" aria-label="Adjust">
          {ADJUSTMENTS.map((k) => (
            <FilterRow key={k} icon={ADJUST_ICONS[k]} label={LABELS[k]} value={f.adjust[k] ?? 0} min={ADJUST_MIN[k]} max={100} track={TRACKS[k]} onChange={(v) => adjust(k, v)} />
          ))}
          <div className={styles.fFoot}>
            <Button size="sm" variant="secondary" icon={<RotateCcw size={14} />} disabled={!ADJUSTMENTS.some((k) => (f.adjust[k] ?? 0) !== 0)}
              onClick={() => set({ adjust: {} }, 'Reset adjustments', 'filters:reset-adjust')}>Reset adjustments</Button>
          </div>
        </div>
      )}

      {tab === 'effects' && (
        <div role="tabpanel" aria-label="Effects">
          <div className={styles.fGrid} role="radiogroup" aria-label="Effect">
            {EFFECT_LOOKS.map((e) => {
              const keys = Object.keys(e.set) as Effect[];
              const on = e.id === 'none' ? effectsOn.length === 0 : keys.every((k) => (f.effects[k] ?? 0) > 0) && effectsOn.length === keys.length;
              return (
                <button key={e.id} type="button" role="radio" aria-checked={on} aria-label={e.label} className={`${styles.fCard} ${on ? styles.fCardOn : ''}`}
                  onClick={() => set({ effects: e.id === 'none' ? {} : { ...e.set } }, `Effect: ${e.label}`, 'filters:effect-look')}>
                  <Thumb source={source} filters={{ ...NO_FILTERS, effects: e.set }} />
                  <span className={styles.fCardLabel}>{e.label}</span>
                </button>
              );
            })}
          </div>
          {EFFECTS.map((k) => (
            <FilterRow key={k} icon={EFFECT_ICONS[k]} label={LABELS[k]} unit={k === 'blur' ? 'px' : '%'} value={f.effects[k] ?? 0} min={0} max={100} onChange={(v) => effect(k, v)} />
          ))}
          <div className={styles.fFoot}>
            <Button size="sm" variant="secondary" icon={<RotateCcw size={14} />} disabled={effectsOn.length === 0}
              onClick={() => set({ effects: {} }, 'Reset effects', 'filters:reset-effects')}>Reset effects</Button>
          </div>
        </div>
      )}
      <div className={styles.fFoot}>
        <Button size="sm" variant="ghost" icon={<RotateCcw size={14} />} disabled={!filters} onClick={() => onChange(null, 'Reset filters', 'filters:reset')}>Reset all filters</Button>
      </div>
    </section>
  );
}

/* ------------------------------- Erase switch -------------------------------- */

/** The four erase / remove tools share one toolbar button; this picks between them. */
export const ERASE_TOOLS = ['eraser', 'eraseImage', 'removeObject', 'removeBg'] as const;
export type EraseTool = (typeof ERASE_TOOLS)[number];
export const isEraseTool = (t: string): t is EraseTool => (ERASE_TOOLS as readonly string[]).includes(t);

export function EraseSwitch({ tool, onTool }: { tool: EraseTool; onTool: (t: EraseTool) => void }) {
  return (
    <section className={styles.section} aria-label="Erase and remove">
      <div className={styles.sectionTitle}>Erase & remove</div>
      <div className={styles.eraseSwitch} role="radiogroup" aria-label="What to erase">
        {([
          ['eraser', 'Annotation', 'Removes drawings, text and shapes (E)'],
          ['eraseImage', 'Image', 'Erases the picture itself: white, see-through or filled with background (I)'],
          ['removeObject', 'Object', 'Removes things and rebuilds the background behind them (Q)'],
          ['removeBg', 'Background', 'Keeps the subject, removes or replaces the background (J)'],
        ] as const).map(([id, label, title]) => (
          <button key={id} type="button" role="radio" aria-checked={tool === id} title={title}
            className={`${styles.eraseOption} ${tool === id ? styles.eraseOptionOn : ''}`} onClick={() => onTool(id)}>
            {label}
          </button>
        ))}
      </div>
    </section>
  );
}

/* ------------------------------ Remove object ------------------------------- */

export function RemoveObjectPanel({ style, onStyle, hasMask, canUndoMask, onUndoMask, onClear, onRemove, busy, status }: {
  style: ToolStyles['removeObject'];
  onStyle: (patch: Partial<ToolStyles['removeObject']>) => void;
  hasMask: boolean;
  canUndoMask: boolean;
  onUndoMask: () => void;
  onClear: () => void;
  onRemove: () => void;
  busy: boolean;
  /** What the AI is doing (finding an object…). */
  status: string | null;
}) {
  return (
    <Section title="Remove object">
      <Group title="Select what to remove" icon={<MousePointerClick size={15} />}>
        <RadioGroup<ToolStyles['removeObject']['mode']> label="Select by" tone="dark" size="sm" value={style.mode} onChange={(mode) => onStyle({ mode })}
          options={[
            { value: 'ai', label: 'AI click', title: 'Click an object: the AI finds its outline' },
            { value: 'brush', label: 'Brush', title: 'Paint over what to remove' },
            { value: 'box', label: 'Box', title: 'Drag a box around what to remove' },
            { value: 'erase', label: 'Unmark', title: 'Paint over a marked part to take it out of the selection' },
          ]} />
        <Slider tone="dark" label="Brush size" min={4} max={600} value={style.size} format={(x) => `${x}px`} onChange={(size) => onStyle({ size })} />
        <Slider tone="dark" label="Cover edges" min={0} max={24} value={style.grow} format={(x) => `${x}px`} onChange={(grow) => onStyle({ grow })} />
        <div className={styles.hint}>
          {style.mode === 'ai' ? 'Click each thing to remove: a person, a button, a badge, an arrow, a word or line of text… Click more to add them.' : style.mode === 'brush' ? 'Paint over everything to remove. Press [ and ] to change the size.' : style.mode === 'box' ? 'Drag a box around each thing to remove.' : 'Paint over marked parts that should stay: they are taken out of the selection.'}
          {' '}Ctrl+drag paints a straight line (Shift: at 45° steps). Ctrl+Z undoes the last selection step.
          {' '}The red shows what will go; the background is then rebuilt to match what’s around it.
        </div>
        {status && <div className={styles.aiStatus} role="status"><Spinner size={13} /> {status}</div>}
      </Group>
      <div className={styles.cropActions}>
        <Button size="sm" variant="primary" icon={<Eraser size={14} />} onClick={onRemove} disabled={!hasMask || busy} loading={busy}>Remove (Enter)</Button>
        <IconButton tone="dark" size="sm" label="Undo last selection" icon={<Undo2 size={15} />} onClick={onUndoMask} disabled={!canUndoMask || busy} />
        <IconButton tone="dark" size="sm" label="Clear selection (Esc)" icon={<X size={15} />} onClick={onClear} disabled={!hasMask || busy} />
      </div>
    </Section>
  );
}

/* ---------------------------- Remove background ----------------------------- */

export type BgBrush = 'pick' | 'restore' | 'remove';

export function RemoveBgPanel({ style, onStyle, brush, onBrush, status, found, graphic = false, onDetect, onApply, onCancel, image, onImage, busy }: {
  /** The picture is a graphic (screenshot, logo): exact edges, no refinement / feather. */
  graphic?: boolean;
  style: ToolStyles['removeBg'];
  onStyle: (patch: Partial<ToolStyles['removeBg']>) => void;
  brush: BgBrush;
  onBrush: (b: BgBrush) => void;
  /** What the AI is doing, or null. */
  status: string | null;
  /** What was found: a person, an object, or nothing yet. */
  found: 'person' | 'object' | 'none' | null;
  onDetect: () => void;
  onApply: () => void;
  onCancel: () => void;
  image: ImageBitmap | null;
  onImage: (file: File) => void;
  busy: boolean;
}) {
  const file = useRef<HTMLInputElement>(null);
  const row = (label: string, control: ReactNode) => (
    <div className={styles.fieldRow}><span className={styles.label}>{label}</span>{control}</div>
  );
  return (
    <Section title="Remove background">
      <Group title="Subject" icon={<ScanSearch size={15} />}>
        {status ? (
          <div className={styles.aiStatus} role="status"><Spinner size={13} /> {status}</div>
        ) : (
          <div className={styles.hint} role="status">
            {found === 'person' || found === 'object' ? 'Found the subject in the picture: check the edges, then Apply.' : found === 'none' ? 'No clear subject found: click the subject to pick it.' : ''}
          </div>
        )}
        <Button size="sm" variant="secondary" icon={<ScanSearch size={14} />} onClick={onDetect} disabled={busy || Boolean(status)}>Detect subject again</Button>
        {row('Brush', (
          <RadioGroup<BgBrush> label="Brush" tone="dark" size="sm" value={brush} onChange={onBrush}
            options={[
              { value: 'pick', label: 'Pick', title: 'Click the subject (Shift+click adds another)' },
              { value: 'restore', label: 'Restore', title: 'Paint back parts of the subject that were removed' },
              { value: 'remove', label: 'Remove', title: 'Paint away background that was kept' },
            ]} />
        ))}
        {brush !== 'pick' && (
          <>
            <Slider tone="dark" label="Brush size" min={4} max={600} value={style.size} format={(x) => `${x}px`} onChange={(size) => onStyle({ size })} />
            <Slider tone="dark" label="Brush hardness" min={0} max={100} value={style.hardness} format={(x) => `${x}%`} onChange={(hardness) => onStyle({ hardness })} />
          </>
        )}
        <div className={styles.hint}>{brush === 'pick' ? 'Click the subject to keep (Shift+click to add another one).' : brush === 'restore' ? 'Paint over parts of the subject to bring them back. Ctrl+drag: a straight line.' : 'Paint over leftover background to remove it. Ctrl+drag: a straight line.'} Ctrl+Z undoes the last step.</div>
      </Group>
      <Group title="Background" icon={<ImagePlus size={15} />}>
        <RadioGroup<ToolStyles['removeBg']['fill']> label="New background" tone="dark" size="sm" value={style.fill} onChange={(fill) => { onStyle({ fill }); if (fill === 'image' && !image) file.current?.click(); }}
          options={[
            { value: 'transparent', label: 'None', title: 'Transparent (PNG)' },
            { value: 'white', label: 'White' },
            { value: 'color', label: 'Colour' },
            { value: 'image', label: 'Image' },
            { value: 'blur', label: 'Blur' },
          ]} />
        {style.fill === 'transparent' && <div className={styles.hint}>See-through: download as PNG to keep it (JPEG makes it white).</div>}
        {style.fill === 'color' && <ColorSwatches label="Background colour" colors={PALETTE} value={style.color} onChange={(color) => onStyle({ color })} alpha={false} />}
        {style.fill === 'image' && (
          <Button size="sm" variant="secondary" icon={<ImagePlus size={14} />} onClick={() => file.current?.click()}>{image ? 'Choose another picture' : 'Choose a picture'}</Button>
        )}
        {style.fill === 'blur' && <Slider tone="dark" label="Background blur" min={5} max={100} value={style.blur} format={(x) => `${x}`} onChange={(blur) => onStyle({ blur })} />}
        <input ref={file} type="file" accept={IMAGE_ACCEPT} hidden aria-label="Background picture" onChange={(e) => { const f = e.target.files?.[0]; if (f) onImage(f); e.target.value = ''; }} />
      </Group>
      <Group title="Edges" icon={<Brush size={15} />}>
        {graphic ? (
          <div className={styles.hint}>This picture has flat colours (a screenshot or graphic): its edges are kept exact and sharp, with no trace of the old background colour.</div>
        ) : (
          <>
            <Slider tone="dark" label="Edge refinement (hair, fine edges)" min={0} max={100} value={style.edge} format={(x) => `${x}%`} onChange={(edge) => onStyle({ edge })} />
            <Slider tone="dark" label="Feather" min={0} max={30} value={style.feather} format={(x) => `${x}px`} onChange={(feather) => onStyle({ feather })} />
          </>
        )}
        <Slider tone="dark" label="Shift edge" min={-12} max={12} value={style.shift} format={(x) => `${x > 0 ? '+' : ''}${x}px`} onChange={(shift) => onStyle({ shift })} />
      </Group>
      <div className={styles.cropActions}>
        <Button size="sm" variant="primary" icon={<Check size={14} />} onClick={onApply} disabled={busy || Boolean(status) || found === null} loading={busy}>Apply (Enter)</Button>
        <Button size="sm" variant="secondary" icon={<X size={14} />} onClick={onCancel} disabled={busy}>Cancel</Button>
      </div>
    </Section>
  );
}

/* ----------------------------- Smart eraser bits ---------------------------- */

/** Extra settings of Erase image when it fills with matching background. */
export function SmartEraseFields({ style, onChange }: { style: ToolStyles['eraseImage']; onChange: (patch: Partial<ToolStyles['eraseImage']>) => void }) {
  return (
    <>
      <Slider tone="dark" label="Brush hardness" min={0} max={100} value={style.hardness ?? 80} format={(x) => `${x}%`} onChange={(hardness) => onChange({ hardness })} />
      <Slider tone="dark" label="Feather" min={0} max={30} value={style.feather ?? 4} format={(x) => `${x}px`} onChange={(feather) => onChange({ feather })} />
      <Slider tone="dark" label="AI fill strength" min={10} max={100} value={style.strength ?? 100} format={(x) => `${x}%`} onChange={(strength) => onChange({ strength })} />
      <label className={styles.toggleRow}>
        <span>Preserve surrounding details</span>
        <ToggleSwitch size="sm" label="Preserve surrounding details" checked={style.preserve ?? true} onChange={(preserve) => onChange({ preserve })} />
      </label>
      <div className={styles.hint}>Paint over something to remove it: when you let go, that part is rebuilt from the picture around it (sand stays sand, a wall’s pattern carries on). Ctrl+drag paints a straight line (Shift: at 45° steps). Preserve surrounding details keeps the fill to exactly what you painted and uses only nearby texture.</div>
    </>
  );
}

