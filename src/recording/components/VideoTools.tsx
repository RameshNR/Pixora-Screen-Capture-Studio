import { useEffect, useRef, useState } from 'react';
import {
  ChevronLeft, ChevronRight, ClipboardCopy, Film, Download, EyeOff, Flag, Pause, Play, PlayCircle, Plus, ScanSearch, Scissors, SkipBack, SkipForward, Trash2,
} from 'lucide-react';
import type { Marker, RelativeRect, VideoRedaction } from '@/shared/types';
import { Button, IconButton } from '@/shared/components/Button';
import { ColorSwatches, RadioGroup, Slider, TextField } from '@/shared/components/FormControls';
import { SensitiveDialog } from '@/shared/components/SensitiveDialog';
import { formatMediaTime } from '@/shared/utils/format';
import { createId } from '@/shared/utils/misc';
import { chapterRange, chaptersText, chaptersVtt } from '../services/chapters';
import { activeRedactions } from '../services/redaction';
import type { SensitiveMatch } from '@/screenshot/services/sensitive-detect';
import type { TrimRange, VideoPlayerHandle } from './VideoPlayer';
import { RegionPicker } from './RegionPicker';
import styles from './VideoTools.module.css';
import { formatKeys } from '@/shared/utils/keys';

/** "m:ss.mmm" with millisecond precision. */
export function formatPrecise(seconds: number): string {
  const t = Math.max(0, seconds);
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(3).padStart(6, '0')}`;
}

/** Parses "1:02.5", "62.5" or "00:01:02.500" into seconds (null when invalid). */
export function parseTime(text: string): number | null {
  const parts = text.trim().split(':').map((p) => p.trim());
  if (!parts.length || parts.some((p) => p === '' || Number.isNaN(Number(p)))) return null;
  const nums = parts.map(Number);
  if (nums.some((n) => n < 0)) return null;
  return nums.reduce((acc, n) => acc * 60 + n, 0);
}

/* --------------------------------- filmstrip -------------------------------- */
function useFilmstrip(src: string, duration: number, count = 12): string[] {
  const [frames, setFrames] = useState<string[]>([]);
  useEffect(() => {
    if (!duration) return;
    let alive = true;
    const video = document.createElement('video');
    video.muted = true;
    video.preload = 'auto';
    video.src = src;
    const canvas = document.createElement('canvas');
    canvas.width = 160;
    canvas.height = 90;
    const ctx = canvas.getContext('2d')!;
    const out: string[] = [];
    const grab = async () => {
      await new Promise<void>((r) => (video.readyState >= 1 ? r() : video.addEventListener('loadedmetadata', () => r(), { once: true })));
      for (let i = 0; i < count && alive; i++) {
        const t = ((i + 0.5) / count) * duration;
        await new Promise<void>((r) => {
          const done = () => r();
          video.addEventListener('seeked', done, { once: true });
          setTimeout(done, 1500);
          video.currentTime = t;
        });
        const scale = Math.min(canvas.width / (video.videoWidth || 160), canvas.height / (video.videoHeight || 90));
        const w = (video.videoWidth || 160) * scale;
        const h = (video.videoHeight || 90) * scale;
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(video, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
        out.push(canvas.toDataURL('image/jpeg', 0.6));
        if (alive) setFrames([...out]);
      }
    };
    void grab().catch(() => undefined);
    return () => {
      alive = false;
      video.removeAttribute('src');
      video.load();
    };
  }, [src, duration, count]);
  return frames;
}

/* -------------------------------- trim editor ------------------------------- */
interface TrimProps {
  src: string;
  duration: number;
  trim: TrimRange | null;
  onTrim: (range: TrimRange | null) => void;
  time: number;
  playing: boolean;
  player: React.RefObject<VideoPlayerHandle | null>;
  markers: Marker[];
  onExport: () => void;
  /** Annotation tracks under the ruler (Advanced Video Editor). */
  tracks?: React.ReactNode;
}

/** Visual trimming: filmstrip timeline, draggable start / end, precise times, preview and export. */
export function TrimEditor({ src, duration, trim, onTrim, time, playing, player, markers, onExport, tracks }: TrimProps) {
  const frames = useFilmstrip(src, duration);
  const stripRef = useRef<HTMLDivElement>(null);
  const range = trim ?? { start: 0, end: duration };
  const pct = (t: number) => `${duration ? (t / duration) * 100 : 0}%`;
  const posToTime = (clientX: number) => {
    const r = stripRef.current?.getBoundingClientRect();
    if (!r || !duration) return 0;
    return Math.max(0, Math.min(1, (clientX - r.left) / r.width)) * duration;
  };
  const MIN = 0.1;
  const setStart = (t: number) => onTrim({ start: Math.max(0, Math.min(t, range.end - MIN)), end: range.end });
  const setEnd = (t: number) => onTrim({ start: range.start, end: Math.min(duration, Math.max(t, range.start + MIN)) });

  const drag = (kind: 'start' | 'end' | 'seek') => (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const apply = (x: number) => {
      const t = posToTime(x);
      if (kind === 'start') { setStart(t); player.current?.seek(t); }
      else if (kind === 'end') { setEnd(t); player.current?.seek(t); }
      else player.current?.seek(t);
    };
    apply(e.clientX);
    const move = (ev: PointerEvent) => apply(ev.clientX);
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  return (
    <section className={styles.trim} aria-label="Trim">
      <h2 className={styles.trimTitle}><Film size={16} /> Timeline</h2>
      <div className={styles.stripWrap}>
      <span className={styles.handleLabel} style={{ left: `clamp(30px, ${pct(range.start)}, calc(100% - 30px))` }}>{formatPrecise(range.start)}</span>
      <span className={styles.handleLabel} style={{ left: `clamp(30px, ${pct(range.end)}, calc(100% - 30px))`, opacity: Math.abs(range.end - range.start) < duration * 0.12 ? 0 : 1 }}>{formatPrecise(range.end)}</span>
      <div className={styles.strip} ref={stripRef} onPointerDown={drag('seek')} role="slider" aria-label="Timeline" aria-valuemin={0} aria-valuemax={Math.round(duration)} aria-valuenow={Math.round(time)} tabIndex={0}>
        <div className={styles.frames}>
          {Array.from({ length: 12 }, (_, i) => (frames[i] ? <img key={i} src={frames[i]} alt="" draggable={false} /> : <span key={i} className={styles.framePh} />))}
        </div>
        <div className={styles.dim} style={{ left: 0, width: pct(range.start) }} />
        <div className={styles.dim} style={{ left: pct(range.end), right: 0 }} />
        <div className={styles.sel} style={{ left: pct(range.start), width: `calc(${pct(range.end)} - ${pct(range.start)})` }} />
        {markers.map((m) => <span key={m.id} className={styles.mark} style={{ left: pct(m.timeMs / 1000) }} title={m.name} />)}
        <div className={styles.handle} style={{ left: pct(range.start) }} onPointerDown={drag('start')} role="slider" aria-label="Trim start" aria-valuenow={Math.round(range.start * 10) / 10} tabIndex={0}
          onKeyDown={(e) => { if (e.key === 'ArrowLeft') setStart(range.start - 0.1); if (e.key === 'ArrowRight') setStart(range.start + 0.1); }} />
        <div className={`${styles.handle} ${styles.handleEnd}`} style={{ left: pct(range.end) }} onPointerDown={drag('end')} role="slider" aria-label="Trim end" aria-valuenow={Math.round(range.end * 10) / 10} tabIndex={0}
          onKeyDown={(e) => { if (e.key === 'ArrowLeft') setEnd(range.end - 0.1); if (e.key === 'ArrowRight') setEnd(range.end + 0.1); }} />
        <div className={styles.head} style={{ left: pct(time) }} />
      </div>
      <div className={styles.ruler} aria-hidden>
        {rulerTicks(duration).map((t) => (
          <span key={t} style={{ left: pct(t) }}>{formatTick(t)}</span>
        ))}
      </div>
      </div>
      {tracks}

      {/* Groups that wrap as a whole on narrow screens (never splitting the play buttons). */}
      <div className={styles.trimRow}>
        <div className={styles.trimGroup}>
          <span className={styles.trimLabel}><Scissors size={15} /> Trim range</span>
          <TimeField label="Start" value={range.start} onChange={setStart} onNow={() => setStart(time)} />
          <TimeField label="End" value={range.end} onChange={setEnd} onNow={() => setEnd(time)} />
          <div className={styles.selected} aria-label="Selected duration">
            <span>Selected</span>
            <strong>{formatPrecise(range.end - range.start)}</strong>
          </div>
        </div>
        <div className={styles.trimGroup}>
          <div className={styles.trimTransport} role="group" aria-label="Playback">
            <IconButton label="Back 1 s" icon={<SkipBack size={16} />} onClick={() => player.current?.seek(time - 1)} />
            <IconButton label={playing ? 'Pause' : 'Play'} icon={playing ? <Pause size={16} /> : <Play size={16} />} onClick={() => player.current?.toggle()} />
            <IconButton label="Forward 1 s" icon={<SkipForward size={16} />} onClick={() => player.current?.seek(time + 1)} />
          </div>
          <Button size="sm" icon={<PlayCircle size={15} />} disabled={!trim} onClick={() => player.current?.previewRange()}>
            Preview selection
          </Button>
          <Button size="sm" variant="ghost" disabled={!trim} onClick={() => onTrim(null)}>
            Reset
          </Button>
          <Button size="sm" variant="primary" icon={<Scissors size={15} />} disabled={!trim} onClick={onExport}>
            Export trimmed
          </Button>
        </div>
      </div>
      <p className={styles.hint}>Drag the yellow handles at both ends of the timeline (or type exact times) to choose the part to keep. The original recording is never changed; turn on “Frame-accurate cut” when exporting for cuts between key frames.</p>
    </section>
  );
}

/** Ruler ticks: a round step giving about ten labels across the timeline. */
export function rulerTicks(duration: number): number[] {
  if (!(duration > 0)) return [];
  const steps = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600];
  const step = steps.find((s) => duration / s <= 12) ?? 3600;
  const out: number[] = [];
  for (let t = 0; t <= duration + 1e-6; t += step) out.push(Math.round(t * 1000) / 1000);
  return out;
}

function formatTick(t: number): string {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${(Number.isInteger(s) ? String(s) : s.toFixed(1)).padStart(2, '0')}`;
}

function TimeField({ label, value, onChange, onNow }: { label: string; value: number; onChange: (t: number) => void; onNow: () => void }) {
  const [text, setText] = useState(formatPrecise(value));
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    if (!editing) setText(formatPrecise(value));
  }, [value, editing]);
  const commit = () => {
    const t = parseTime(text);
    if (t !== null) onChange(t);
    setEditing(false);
  };
  return (
    <div className={styles.timeField}>
      <span>{label}</span>
      <IconButton size="sm" label={`${label} −0.1 s`} icon={<ChevronLeft size={14} />} onClick={() => onChange(value - 0.1)} />
      <input
        className={styles.timeInput}
        value={editing ? text : formatPrecise(value)}
        aria-label={`${label} time`}
        onFocus={() => setEditing(true)}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      />
      <IconButton size="sm" label={`${label} +0.1 s`} icon={<ChevronRight size={14} />} onClick={() => onChange(value + 0.1)} />
      <Button size="sm" variant="ghost" onClick={onNow}>
        Set to playhead
      </Button>
    </div>
  );
}

/* ---------------------------------- chapters --------------------------------- */
interface ChaptersProps {
  markers: Marker[];
  onChange: (markers: Marker[]) => void;
  time: number;
  duration: number;
  onSeek: (t: number) => void;
  onExportRange: (range: TrimRange) => void;
  fileBase: string;
  onDownload: (blob: Blob, name: string) => void;
  onCopied: () => void;
}

export function ChaptersPanel({ markers, onChange, time, duration, onSeek, onExportRange, fileBase, onDownload, onCopied }: ChaptersProps) {
  const sorted = [...markers].sort((a, b) => a.timeMs - b.timeMs);
  const currentIdx = sorted.reduce((acc, m, i) => (m.timeMs / 1000 <= time + 0.05 ? i : acc), -1);
  const update = (id: string, patch: Partial<Marker>) => onChange(markers.map((m) => (m.id === id ? { ...m, ...patch } : m)));
  const add = () => onChange([...markers, { id: createId('m_'), timeMs: Math.round(time * 1000), name: `Chapter ${markers.length + 1}` }]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, textarea')) return;
      if (e.key.toLowerCase() === 'm' && !e.ctrlKey && !e.metaKey) { e.preventDefault(); add(); }
      if (e.key === 'PageDown' || (e.shiftKey && e.key === 'ArrowRight')) { const n = sorted[currentIdx + 1]; if (n) { e.preventDefault(); onSeek(n.timeMs / 1000); } }
      if (e.key === 'PageUp' || (e.shiftKey && e.key === 'ArrowLeft')) { const p = sorted[Math.max(0, currentIdx - (time - (sorted[currentIdx]?.timeMs ?? 0) / 1000 > 1 ? 0 : 1))]; if (p) { e.preventDefault(); onSeek(p.timeMs / 1000); } }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <div className={styles.panel}>
      <div className={styles.panelHead}>
        <Button size="sm" icon={<Plus size={15} />} onClick={add}>
          Add at {formatMediaTime(time)}
        </Button>
        <IconButton size="sm" label="Previous chapter (Page Up)" icon={<ChevronLeft size={16} />} disabled={currentIdx <= 0 && !(sorted[0] && time > sorted[0].timeMs / 1000 + 1)} onClick={() => { const p = sorted[Math.max(0, currentIdx - 1)]; if (p) onSeek(p.timeMs / 1000); }} />
        <IconButton size="sm" label="Next chapter (Page Down)" icon={<ChevronRight size={16} />} disabled={currentIdx >= sorted.length - 1} onClick={() => { const n = sorted[currentIdx + 1]; if (n) onSeek(n.timeMs / 1000); }} />
      </div>
      {sorted.length === 0 ? (
        <p className={styles.hint}>{formatKeys('No chapters yet. Add markers while recording (M in the control bar, Alt+Shift+M in the page) or here with M. They appear on the timeline.')}</p>
      ) : (
        <ol className={styles.chapters} aria-label="Chapters">
          {sorted.map((m, i) => (
            <li key={m.id} className={i === currentIdx ? styles.chapterOn : undefined}>
              <button type="button" className={styles.chapterTime} onClick={() => onSeek(m.timeMs / 1000)} aria-label={`Go to ${m.name}`}>
                <Flag size={12} /> {formatMediaTime(m.timeMs / 1000)}
              </button>
              <TextField value={m.name} aria-label="Chapter name" onChange={(e) => update(m.id, { name: e.target.value })} />
              <textarea className={styles.desc} value={m.description ?? ''} placeholder="Description (optional)" aria-label="Chapter description" rows={1} onChange={(e) => update(m.id, { description: e.target.value })} />
              <div className={styles.chapterActions}>
                <Button size="sm" variant="ghost" onClick={() => update(m.id, { timeMs: Math.round(time * 1000) })}>Move to playhead</Button>
                <Button size="sm" variant="ghost" icon={<Scissors size={13} />} onClick={() => onExportRange(chapterRange(markers, m, duration))}>Export chapter</Button>
                <IconButton size="sm" tone="danger" label="Delete chapter" icon={<Trash2 size={14} />} onClick={() => onChange(markers.filter((x) => x.id !== m.id))} />
              </div>
            </li>
          ))}
        </ol>
      )}
      {sorted.length > 0 && (
        <div className={styles.panelFoot}>
          <Button size="sm" icon={<Download size={14} />} onClick={() => onDownload(new Blob([chaptersVtt(sorted, duration)], { type: 'text/vtt' }), `${fileBase} chapters.vtt`)}>
            Chapters (.vtt)
          </Button>
          <Button size="sm" icon={<ClipboardCopy size={14} />} onClick={() => void navigator.clipboard.writeText(chaptersText(sorted)).then(onCopied)}>
            Copy chapter list
          </Button>
        </div>
      )}
      <p className={styles.hint}>Exports keep chapters in the file description (MP4 / WebM metadata, “00:00 Title” format). The .vtt file works with most web players.</p>
    </div>
  );
}

/* ---------------------------------- privacy --------------------------------- */
interface PrivacyProps {
  regions: VideoRedaction[];
  onChange: (regions: VideoRedaction[]) => void;
  time: number;
  duration: number;
  player: React.RefObject<VideoPlayerHandle | null>;
}

export function PrivacyPanel({ regions, onChange, time, duration, player }: PrivacyProps) {
  const [picking, setPicking] = useState(false);
  const [scan, setScan] = useState<{ open: boolean; matches: SensitiveMatch[] | null; progress: number; error: string | null; size: { w: number; h: number }; hidden?: number }>({ open: false, matches: null, progress: 0, error: null, size: { w: 1, h: 1 } });
  const update = (id: string, patch: Partial<VideoRedaction>) => onChange(regions.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const add = (rect: RelativeRect, kind: VideoRedaction['kind'] = 'blur') =>
    ({ id: createId('r_'), rect, kind, strength: kind === 'pixelate' ? 0.03 : 0.02, color: '#000000', start: null, end: null } satisfies VideoRedaction);

  async function findText() {
    const v = player.current?.element();
    if (!v || !v.videoWidth || v.readyState < 2) {
      setScan({ open: true, matches: null, progress: 0, error: 'The video frame is not ready yet. Play or seek the video a moment, then try again.', size: { w: 1, h: 1 } });
      return;
    }
    player.current?.pause();
    const canvas = new OffscreenCanvas(v.videoWidth, v.videoHeight);
    canvas.getContext('2d')!.drawImage(v, 0, 0);
    setScan({ open: true, matches: null, progress: 0, error: null, size: { w: v.videoWidth, h: v.videoHeight } });
    try {
      const { detectSensitive, excludeHidden } = await import('@/screenshot/services/sensitive-detect');
      const found = await detectSensitive(await canvas.convertToBlob({ type: 'image/png' }), (p) => setScan((s) => ({ ...s, progress: p })));
      // Regions active at this time already hide their text: do not list it again.
      const t = v.currentTime;
      const W = v.videoWidth;
      const H = v.videoHeight;
      const covers = regions
        .filter((r) => (r.start === null || r.start <= t + 0.05) && (r.end === null || t <= r.end + 0.05))
        .map((r) => ({ x: r.rect.x * W, y: r.rect.y * H, w: r.rect.width * W, h: r.rect.height * H }));
      const { visible, hidden } = excludeHidden(found, covers);
      setScan((s) => ({ ...s, matches: visible, hidden }));
    } catch (err) {
      setScan((s) => ({ ...s, error: err instanceof Error ? err.message : 'Text could not be read.' }));
    }
  }

  return (
    <div className={styles.panel}>
      <div className={styles.panelHead}>
        <Button size="sm" icon={<Plus size={15} />} onClick={() => { player.current?.pause(); setPicking(true); }}>
          Add region
        </Button>
        <Button size="sm" icon={<ScanSearch size={15} />} onClick={() => void findText()}>
          Find sensitive text in this frame
        </Button>
      </div>
      {regions.length === 0 ? (
        <p className={styles.hint}>Hide passwords, email addresses, account numbers and other private details. Draw a region over the video; it is blurred, pixelated or masked in exports. Everything stays on this device.</p>
      ) : (
        <ol className={styles.chapters} aria-label="Privacy regions">
          {regions.map((r, i) => {
            const active = activeRedactions([r], time).length > 0;
            return (
              <li key={r.id} className={active ? styles.chapterOn : undefined}>
                <div className={styles.regionHead}>
                  <EyeOff size={14} /> Region {i + 1}
                  <IconButton size="sm" tone="danger" label={`Remove region ${i + 1}`} icon={<Trash2 size={14} />} onClick={() => onChange(regions.filter((x) => x.id !== r.id))} />
                </div>
                <RadioGroup label={`Region ${i + 1} style`} size="sm" value={r.kind} onChange={(kind) => update(r.id, { kind })} options={[{ value: 'blur', label: 'Blur' }, { value: 'pixelate', label: 'Pixelate' }, { value: 'mask', label: 'Mask' }]} />
                {r.kind === 'mask' ? (
                  <ColorSwatches label={`Region ${i + 1} colour`} alpha={false} colors={['#000000', '#FFFFFF', '#202938', '#E05252', '#4F8DF7']} value={r.color} onChange={(color) => update(r.id, { color })} />
                ) : (
                  <Slider label={r.kind === 'blur' ? 'Blur strength' : 'Pixel size'} min={0.005} max={0.08} step={0.005} value={r.strength} format={(v) => `${Math.round(v * 1000) / 10}%`} onChange={(strength) => update(r.id, { strength })} />
                )}
                <RadioGroup
                  label={`Region ${i + 1} timing`}
                  size="sm"
                  value={r.start === null && r.end === null ? 'all' : 'range'}
                  onChange={(v) => update(r.id, v === 'all' ? { start: null, end: null } : { start: time, end: Math.min(duration, time + 5) })}
                  options={[{ value: 'all', label: 'Whole video' }, { value: 'range', label: 'Part of it' }]}
                />
                {(r.start !== null || r.end !== null) && (
                  <div className={styles.rangeRow}>
                    <span>{formatPrecise(r.start ?? 0)} → {formatPrecise(r.end ?? duration)}</span>
                    <Button size="sm" variant="ghost" onClick={() => update(r.id, { start: Math.min(time, r.end ?? duration) })}>Start here</Button>
                    <Button size="sm" variant="ghost" onClick={() => update(r.id, { end: Math.max(time, r.start ?? 0) })}>End here</Button>
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      )}
      <p className={styles.hint}>Exports burn these regions into the video (re-encoded). The original recording is not changed.</p>
      {picking && (
        <RegionPicker
          video={player.current?.element() ?? null}
          title="Drag over the private area"
          confirmLabel="Hide this area"
          onCancel={() => setPicking(false)}
          onConfirm={(rect) => {
            onChange([...regions, add(rect)]);
            setPicking(false);
          }}
        />
      )}
      <SensitiveDialog
        open={scan.open}
        matches={scan.matches}
        progress={scan.progress}
        error={scan.error}
        alreadyHidden={scan.hidden}
        onClose={() => setScan((s) => ({ ...s, open: false }))}
        onApply={(selected, kind) => {
          const pad = 4;
          const { w, h } = scan.size;
          onChange([
            ...regions,
            ...selected.map((m) => add({ x: Math.max(0, (m.box.x - pad) / w), y: Math.max(0, (m.box.y - pad) / h), width: Math.min(1, (m.box.w + pad * 2) / w), height: Math.min(1, (m.box.h + pad * 2) / h) }, kind)),
          ]);
          setScan((s) => ({ ...s, open: false }));
        }}
      />
    </div>
  );
}

/** Live preview of privacy regions over the player (blur / pixelate approximated with CSS). */
export function RedactionPreview({ regions, time }: { regions: VideoRedaction[]; time: number }) {
  return (
    <>
      {activeRedactions(regions, time).map((r) => (
        <div
          key={r.id}
          className={styles.preview}
          style={{
            left: `${r.rect.x * 100}%`,
            top: `${r.rect.y * 100}%`,
            width: `${r.rect.width * 100}%`,
            height: `${r.rect.height * 100}%`,
            ...(r.kind === 'mask' ? { background: r.color } : { backdropFilter: `blur(${r.kind === 'blur' ? 10 : 5}px)` }),
          }}
          data-kind={r.kind}
        />
      ))}
    </>
  );
}
