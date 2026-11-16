import { lazy, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ArrowUpRight, Bookmark, Check, Crosshair, Droplet, Move, X, Eraser, Eye, EyeOff, Grid3x3, Highlighter, Image as ImageIcon, MessageSquareText, MousePointer2, MousePointerClick, Pen,
  Plus, RotateCcw, Shapes, ShieldCheck, Stamp, Sticker, Trash2, Type,
} from 'lucide-react';
import type { CaptureRecord, Settings } from '@/shared/types';
import type { Annotation, EditorDoc, Tool, Watermark } from '@/editor/types';
import type { HistoryState } from '@/editor/history/history';
import { ensureFonts } from '@/editor/fonts';
import { usedFonts } from '@/editor/render';
import { Button, IconButton } from '@/shared/components/Button';
import { Checkbox } from '@/shared/components/FormControls';
import { Spinner } from '@/shared/components/Progress';
import { createId } from '@/shared/utils/misc';
import {
  ANIM_IN_LABELS, ANIM_OUT_LABELS, BUILTIN_OVERLAY_DEFAULTS, EFFECT_LABELS, drawOverlays, effectsOf, insOf, needsFrame, outsOf, overlayName, shownAt, syncOverlays,
  type OverlayDefaults, type VideoOverlay,
} from '../services/video-overlays';
import { Dropdown } from '@/shared/components/Dropdown';
import { formatPrecise, parseTime } from './VideoTools';
import type { VideoPlayerHandle } from './VideoPlayer';
import styles from './VideoTools.module.css';

const Editor = lazy(() => import('@/editor/pages/EditorApp').then((m) => ({ default: m.Editor })));

/* ---------------------------------- defaults ---------------------------------- */
const DEFAULTS_KEY = 'pixora.video.overlayDefaults';
export function loadOverlayDefaults(): OverlayDefaults {
  try {
    return { ...BUILTIN_OVERLAY_DEFAULTS, ...(JSON.parse(localStorage.getItem(DEFAULTS_KEY) ?? '{}') as Partial<OverlayDefaults>) };
  } catch {
    return BUILTIN_OVERLAY_DEFAULTS;
  }
}
function saveOverlayDefaults(d: OverlayDefaults): void {
  try { localStorage.setItem(DEFAULTS_KEY, JSON.stringify(d)); } catch { /* private window */ }
}

/* ------------------------------ live preview ------------------------------ */
/** Draws the overlays on the player (follows playback frame by frame, animations included). */
export function OverlayPreview({ overlays, watermark, player, box }: {
  overlays: VideoOverlay[]; watermark: Watermark | null; player: { current: VideoPlayerHandle | null }; box: { width: number; height: number };
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    void ensureFonts(usedFonts({ annotations: overlays.map((o) => o.annotation) } as EditorDoc));
  }, [overlays]);
  useEffect(() => {
    let raf = 0;
    let busy = false;
    const draw = async () => {
      raf = requestAnimationFrame(() => void draw());
      const c = canvas.current;
      const v = player.current?.element();
      if (!c || !v || busy || !v.videoWidth) return;
      const dpr = window.devicePixelRatio || 1;
      const w = Math.round(box.width * dpr);
      const h = Math.round(box.height * dpr);
      if (c.width !== w) c.width = w;
      if (c.height !== h) c.height = h;
      const t = v.currentTime;
      busy = true;
      try {
        const base = needsFrame(overlays, t) ? await createImageBitmap(v).catch(() => null) : null;
        const ctx = c.getContext('2d')!;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, w, h);
        ctx.scale(w / v.videoWidth, h / v.videoHeight);
        drawOverlays(ctx, base, overlays, t, v.videoWidth, v.videoHeight, watermark);
        base?.close();
      } finally {
        busy = false;
      }
    };
    void draw();
    return () => cancelAnimationFrame(raf);
  }, [overlays, watermark, player, box.width, box.height]);
  if (!overlays.length && !watermark) return null;
  return <canvas ref={canvas} className={styles.overlayCanvas} style={{ width: box.width, height: box.height }} aria-hidden />;
}

/* --------------------------------- Annotate rail -------------------------------- */
export const RAIL_TOOLS: Array<{ tool: Tool; label: string; icon: ReactNode; isNew?: boolean }> = [
  { tool: 'select', label: 'Select', icon: <MousePointer2 size={17} /> },
  { tool: 'pen', label: 'Draw', icon: <Pen size={17} /> },
  { tool: 'text', label: 'Text', icon: <Type size={17} /> },
  { tool: 'rect', label: 'Shapes', icon: <Shapes size={17} /> },
  { tool: 'arrow', label: 'Arrows', icon: <ArrowUpRight size={17} /> },
  { tool: 'callout', label: 'Callout', icon: <MessageSquareText size={17} />, isNew: true },
  { tool: 'highlighter', label: 'Highlight', icon: <Highlighter size={17} /> },
  { tool: 'blur', label: 'Blur', icon: <Droplet size={17} /> },
  { tool: 'pixelate', label: 'Pixelate', icon: <Grid3x3 size={17} /> },
  { tool: 'mask', label: 'Mask', icon: <EyeOff size={17} /> },
  { tool: 'marker', label: 'Numbered', icon: <span className={styles.railNum}>1</span> },
  { tool: 'sticker', label: 'Stickers', icon: <Sticker size={17} /> },
  { tool: 'cursor', label: 'Cursor', icon: <MousePointerClick size={17} /> },
  { tool: 'eraser', label: 'Eraser', icon: <Eraser size={17} /> },
  { tool: 'watermark', label: 'Watermark', icon: <Stamp size={17} /> },
];

/** The image editor's tools, on the left of the video (picking one pauses the video to draw on it). */
export function AnnotateRail({ tool, active, onPick, privacy }: {
  tool: Tool | null; active: boolean; onPick: (t: Tool) => void;
  /** Privacy regions (blur / hide areas over time): opens its panel on the right. */
  privacy: { count: number; open: boolean; onOpen: () => void };
}) {
  const privacyLabel = `Privacy${privacy.count ? ` (${privacy.count})` : ''}`;
  return (
    <nav className={styles.rail} aria-label="Annotate">
      <h2 className={styles.railTitle}>Annotate</h2>
      {RAIL_TOOLS.map((t) => (
        <button key={t.tool} type="button" className={`${styles.railTool} ${active && tool === t.tool ? styles.railToolOn : ''}`} aria-pressed={active && tool === t.tool} aria-label={t.label} title={t.label} onClick={() => onPick(t.tool)}>
          {t.icon}
          <span>{t.label}</span>
          {t.isNew && <em className={styles.railNew}>New</em>}
        </button>
      ))}
      <div className={styles.railSep} role="separator" />
      <button type="button" className={`${styles.railTool} ${privacy.open ? styles.railToolOn : ''}`} aria-pressed={privacy.open} aria-label={privacyLabel} title="Privacy: blur or hide areas over time" onClick={privacy.onOpen}>
        <ShieldCheck size={16} />
        <span>Privacy</span>
        {privacy.count > 0 && <em className={styles.railCount}>{privacy.count}</em>}
      </button>
    </nav>
  );
}

/* --------------------------- drawing on the paused video --------------------------- */
interface InlineProps {
  frame: ImageBitmap;
  time: number;
  duration: number;
  overlays: VideoOverlay[];
  watermark: Watermark | null;
  settings: Settings;
  record: CaptureRecord;
  panelSlot: HTMLElement | null;
  requestedTool: { tool: Tool; n: number } | null;
  requestedSelect: { id: string; n: number } | null;
  onToolChange: (t: Tool) => void;
  onSelectionChange: (annotationId: string | null) => void;
  onChange: (overlays: VideoOverlay[], watermark: Watermark | null) => void;
}

/**
 * The image editor's canvas over the paused video frame: the drawings shown now can be edited, new
 * ones become overlays from this moment. Every change is applied to the video at once.
 */
export function InlineDraw({ frame, time, duration, overlays, watermark, settings, record, panelSlot, requestedTool, requestedSelect, onToolChange, onSelectionChange, onChange }: InlineProps) {
  const visible = useMemo(() => overlays.filter((o) => time >= o.start && time <= o.end), [time]); // eslint-disable-line react-hooks/exhaustive-deps
  const [initialDoc] = useState<EditorDoc>(() => ({ base: frame, width: frame.width, height: frame.height, annotations: visible.map((o) => shownAt(o, time)), watermark, frame: null }));
  const known = useRef<Set<string>>(new Set(visible.map((o) => o.annotation.id)));
  const params = useRef(new URLSearchParams());
  const latest = useRef({ overlays, watermark });
  latest.current = { overlays, watermark };
  const lastDoc = useRef<EditorDoc>(initialDoc);

  const onHistory = (h: HistoryState) => {
    const doc = h.present.doc;
    if (doc === lastDoc.current) return;
    lastDoc.current = doc;
    const r = syncOverlays(latest.current.overlays, doc.annotations, known.current, time, duration, loadOverlayDefaults(), () => createId('ov_'));
    known.current = r.known;
    onChange(r.overlays, doc.watermark ?? null);
  };

  return (
    <div className={styles.inlineDraw} role="region" aria-label="Draw on the video">
      <Suspense fallback={<div className={styles.drawLoading}><Spinner size={22} /></div>}>
        <Editor
          record={{ ...record, id: `video-frame-${record.id}`, kind: 'screenshot', name: `${record.name} frame.png`, mimeType: 'image/png', width: frame.width, height: frame.height }}
          initialDoc={initialDoc}
          settings={settings}
          params={params.current}
          embedded
          videoMode
          onHistory={onHistory}
          inline={{ panelSlot, requestedTool, requestedSelect, onToolChange, onSelectionChange }}
        />
      </Suspense>
    </div>
  );
}

/* --------------------------------- Apply to video -------------------------------- */
/** Several animations of one kind: chips (remove with ×) and “+ Add”. */
function AnimList<T extends string>({ title, values, labels, onChange }: { title: string; values: T[]; labels: Record<T, string>; onChange: (v: T[]) => void }) {
  const left = (Object.keys(labels) as T[]).filter((k) => k !== 'none' && !values.includes(k));
  return (
    <div className={styles.animList} role="group" aria-label={title}>
      <span className={styles.animTitle}>{title}</span>
      <div className={styles.chips}>
        {values.length === 0 && <span className={styles.chipNone}>None</span>}
        {values.map((v) => (
          <span key={v} className={styles.chip}>
            {labels[v]}
            <button type="button" aria-label={`Remove ${labels[v]}`} onClick={() => onChange(values.filter((x) => x !== v))}><X size={12} /></button>
          </span>
        ))}
        <Dropdown
          minWidth={240}
          ariaLabel={`Add to ${title}`}
          items={left.map((k) => ({ id: k, label: labels[k], onSelect: () => onChange([...values, k]) }))}
          trigger={({ toggle, open }) => (
            <button type="button" className={styles.chipAdd} aria-haspopup="menu" aria-expanded={open} aria-label={`Add to ${title}`} onClick={toggle} disabled={!left.length}>+ Add</button>
          )}
        />
      </div>
    </div>
  );
}

/** When the selected drawing shows, how it appears, moves and disappears. */
export function ApplyToVideo({ overlay, duration, time, onChange, onSeek, saved }: {
  overlay: VideoOverlay; duration: number; time: number; onChange: (o: VideoOverlay) => void; onSeek: (t: number) => void; saved: boolean;
}) {
  const whole = overlay.start <= 0.001 && overlay.end >= duration - 0.05;
  const [note, setNote] = useState<string | null>(null);
  const set = (patch: Partial<VideoOverlay>) => onChange({ ...overlay, ...patch });
  const ins = insOf(overlay);
  const outs = outsOf(overlay);
  const fx = effectsOf(overlay);
  const moves = [...(overlay.moves ?? [])].sort((a, b) => a.t - b.t);
  const dir = (dx: number, dy: number) => [dx ? `${Math.abs(dx)} px ${dx > 0 ? 'right' : 'left'}` : '', dy ? `${Math.abs(dy)} px ${dy > 0 ? 'down' : 'up'}` : ''].filter(Boolean).join(', ') || 'where drawn';
  return (
    <section className={styles.applyCard} aria-label="Apply to video">
      <div className={styles.applyHead}>
        <h3>Apply to video</h3>
        <span className={`${styles.savedBadge} ${saved ? '' : styles.savedBadgeBusy}`}>{saved ? <><Check size={13} /> Saved</> : 'Saving…'}</span>
      </div>
      <div className={styles.applyTimes}>
        <TimeBox label="Start time" value={overlay.start} onChange={(v) => set({ start: Math.max(0, Math.min(v, overlay.end - 0.1)) })} onNow={() => set({ start: Math.min(time, overlay.end - 0.1) })} />
        <TimeBox label="End time" value={overlay.end} onChange={(v) => set({ end: Math.min(duration || v, Math.max(v, overlay.start + 0.1)) })} onNow={() => set({ end: Math.max(time, overlay.start + 0.1) })} />
      </div>
      <Checkbox checked={whole} onChange={(v) => set(v ? { start: 0, end: duration } : { start: time, end: Math.min(duration, time + loadOverlayDefaults().seconds) })} label="Apply throughout video" />
      <AnimList title="Animations in" values={ins} labels={ANIM_IN_LABELS} onChange={(v) => set({ ins: v, animIn: v[0] ?? 'none' })} />
      <AnimList title="Animations out" values={outs} labels={ANIM_OUT_LABELS} onChange={(v) => set({ outs: v, animOut: v[0] ?? 'none' })} />
      <AnimList title="Effects while shown" values={fx} labels={EFFECT_LABELS} onChange={(v) => set({ effects: v, effect: v[0] ?? 'none' })} />
      <div className={styles.motionBox}>
        <Checkbox checked={Boolean(overlay.motion)} onChange={(v) => set({ motion: v })} label="Move over time"
          description="Go to a later moment and drag the drawing: it glides there from where it was." />
        {moves.length > 0 && (
          <ol className={styles.moveList} aria-label="Move points">
            {moves.map((k) => (
              <li key={k.t}>
                <Move size={13} />
                <span>at <strong>{formatPrecise(k.t)}</strong> · {dir(k.dx, k.dy)}</span>
                <IconButton size="sm" label={`Go to ${formatPrecise(k.t)}`} icon={<Crosshair size={13} />} onClick={() => onSeek(k.t)} />
                <IconButton size="sm" label={`Remove move at ${formatPrecise(k.t)}`} icon={<X size={13} />} onClick={() => set({ moves: (overlay.moves ?? []).filter((x) => x.t !== k.t) })} />
              </li>
            ))}
          </ol>
        )}
      </div>
      <div className={styles.applyActions}>
        <Button size="sm" icon={<Bookmark size={14} />} onClick={() => {
          saveOverlayDefaults({ seconds: Math.max(0.5, Math.round((overlay.end - overlay.start) * 10) / 10), animIn: ins[0] ?? 'none', animOut: outs[0] ?? 'none', effect: fx[0] ?? 'none', ins, outs, effects: fx });
          setNote('New drawings now use this length, these animations and effects.');
        }}>
          Save as default
        </Button>
        <Button size="sm" variant="primary" icon={<RotateCcw size={14} />} onClick={() => {
          const d = loadOverlayDefaults();
          set({ end: Math.min(duration || overlay.start + d.seconds, overlay.start + d.seconds), animIn: d.animIn, animOut: d.animOut, effect: d.effect, ins: d.ins ?? [d.animIn], outs: d.outs ?? [d.animOut], effects: d.effects ?? [d.effect], moves: [], motion: false });
          setNote('Length, animations, effects and moves reset to the defaults.');
        }}>
          Reset
        </Button>
      </div>
      {note && <p className={styles.hint} role="status">{note}</p>}
    </section>
  );
}

function TimeBox({ label, value, onChange, onNow }: { label: string; value: number; onChange: (v: number) => void; onNow: () => void }) {
  const [text, setText] = useState(formatPrecise(value));
  const [editing, setEditing] = useState(false);
  useEffect(() => { if (!editing) setText(formatPrecise(value)); }, [value, editing]);
  return (
    <label className={styles.timeBox}>
      <span>{label}</span>
      <input
        value={editing ? text : formatPrecise(value)}
        aria-label={label}
        onFocus={() => setEditing(true)}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => { const t = parseTime(text); if (t !== null) onChange(t); setEditing(false); }}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      />
      <button type="button" className={styles.nowBtn} onClick={onNow} title="Use the current playhead time">Now</button>
    </label>
  );
}

/* --------------------------------- timeline tracks -------------------------------- */
const TRACK_COLORS: Record<string, string> = {
  text: '#7c5cff', callout: '#f5b70a', arrow: '#ef4444', line: '#ef4444', rect: '#3b82f6', ellipse: '#3b82f6', highlighter: '#eab308', pen: '#22c55e',
  blur: '#64748b', pixelate: '#64748b', mask: '#475569', marker: '#ec4899', sticker: '#f97316', cursor: '#06b6d4', image: '#14b8a6',
};

/** One row per drawing: show / hide, its time as a bar (drag to move, drag the ends to change), delete. */
export function OverlayTracks({ overlays, duration, time, selectedId, onChange, onSelect, onAdd, onDelete }: {
  overlays: VideoOverlay[]; duration: number; time: number; selectedId: string | null;
  onChange: (next: VideoOverlay[]) => void; onSelect: (o: VideoOverlay) => void; onAdd: () => void;
  /** Removes a drawing (also from the drawing layer). */
  onDelete: (o: VideoOverlay) => void;
}) {
  /** Keys on a track: Delete removes it, ← / → move it (Shift: by 1 s), Enter shows its details. */
  const onKey = (o: VideoOverlay) => (e: React.KeyboardEvent) => {
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); e.stopPropagation(); onDelete(o); return; }
    if (e.key === 'Enter') { e.preventDefault(); onSelect(o); return; }
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    e.stopPropagation();
    const step = (e.shiftKey ? 1 : 0.1) * (e.key === 'ArrowLeft' ? -1 : 1);
    const len = o.end - o.start;
    const start = Math.max(0, Math.min(duration - len, o.start + step));
    onChange(overlays.map((x) => (x.id === o.id ? { ...x, start, end: start + len } : x)));
  };
  const pct = (t: number) => `${duration ? (t / duration) * 100 : 0}%`;
  /** The drawing being dragged: its start and end times show on both sides of the bar. */
  const [dragging, setDragging] = useState<string | null>(null);
  const drag = (o: VideoOverlay, part: 'move' | 'start' | 'end') => (e: React.PointerEvent<HTMLElement>) => {
    e.stopPropagation();
    e.preventDefault();
    setDragging(o.id);
    const track = (e.currentTarget.closest('[data-track]') as HTMLElement).getBoundingClientRect();
    const x0 = e.clientX;
    const { start, end } = o;
    const move = (ev: PointerEvent) => {
      const dt = ((ev.clientX - x0) / track.width) * duration;
      let s = start;
      let en = end;
      if (part === 'move') { const len = end - start; s = Math.max(0, Math.min(duration - len, start + dt)); en = s + len; }
      if (part === 'start') s = Math.max(0, Math.min(end - 0.1, start + dt));
      if (part === 'end') en = Math.min(duration, Math.max(start + 0.1, end + dt));
      onChange(overlays.map((x) => (x.id === o.id ? { ...x, start: s, end: en } : x)));
    };
    const up = () => { setDragging(null); window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  const sorted = [...overlays].sort((a, b) => a.start - b.start);
  return (
    <div className={styles.tracks} aria-label="Annotation tracks">
      {sorted.map((o) => {
        const name = overlayName(o.annotation);
        const hidden = Boolean(o.annotation.hidden);
        return (
          <div key={o.id} data-overlay-id={o.id} className={`${styles.trackRow} ${selectedId === o.annotation.id ? styles.trackRowOn : ''}`} onKeyDown={onKey(o)}>
            <IconButton size="sm" label={hidden ? `Show ${name}` : `Hide ${name}`} icon={hidden ? <EyeOff size={14} /> : <Eye size={14} />}
              onClick={() => onChange(overlays.map((x) => (x.id === o.id ? { ...x, annotation: { ...x.annotation, hidden: !hidden } as Annotation } : x)))} />
            <button type="button" className={styles.trackName} onClick={() => onSelect(o)} title={`${name} · ${formatPrecise(o.start)} – ${formatPrecise(o.end)}`}>
              <span className={styles.trackDot} style={{ background: TRACK_COLORS[o.annotation.type] ?? '#7c5cff' }}>{o.annotation.type === 'image' ? <ImageIcon size={11} /> : null}</span>
              {name}
            </button>
            <div className={styles.trackLane} data-track>
              <div className={`${styles.trackBar} ${hidden ? styles.trackBarHidden : ''}`} style={{ left: pct(o.start), width: `calc(${pct(o.end)} - ${pct(o.start)})`, background: TRACK_COLORS[o.annotation.type] ?? '#7c5cff' }}
                onPointerDown={drag(o, 'move')} onDoubleClick={() => onSelect(o)} role="slider" aria-label={`${name} time`} aria-valuetext={`${formatPrecise(o.start)} to ${formatPrecise(o.end)}`} tabIndex={0}>
                <span className={styles.trackGrip} onPointerDown={drag(o, 'start')} aria-hidden />
                <span className={`${styles.trackGrip} ${styles.trackGripEnd}`} onPointerDown={drag(o, 'end')} aria-hidden />
              </div>
              {(dragging === o.id || selectedId === o.annotation.id) && (
                <>
                  <span className={`${styles.trackTime} ${styles.trackTimeStart}`} style={{ left: pct(o.start) }} aria-live="polite">{formatPrecise(o.start)}</span>
                  <span className={`${styles.trackTime} ${styles.trackTimeEnd}`} style={{ left: pct(o.end) }} aria-live="polite">{formatPrecise(o.end)}</span>
                </>
              )}
              <div className={styles.trackHead} style={{ left: pct(time) }} aria-hidden />
            </div>
            <IconButton size="sm" label={`Delete ${name}`} icon={<Trash2 size={14} />} onClick={() => onDelete(o)} />
          </div>
        );
      })}
      <button type="button" className={styles.addAnnotation} onClick={onAdd}>
        <Plus size={15} /> Add annotation
      </button>
    </div>
  );
}
