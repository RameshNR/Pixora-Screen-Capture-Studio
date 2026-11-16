import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Minus, Pause, Play, Plus, RotateCcw, Save, Trash2, FilePlus2 } from 'lucide-react';
import type { TeleprompterLive } from '@/shared/types';
import { Button, IconButton } from '@/shared/components/Button';
import { ColorSwatches, RadioGroup, Slider, TextField, ToggleSwitch } from '@/shared/components/FormControls';
import { Select } from '@/shared/components/Dropdown';
import { sendToBackground } from '@/shared/messaging/client';
import { useRecordingState } from '@/shared/hooks/useRecordingState';
import { isBusy } from '@/recording/services/recording-state';
import { applyTheme } from '@/shared/hooks/useTheme';
import styles from './teleprompter.module.css';

const SCRIPTS_KEY = 'glint.teleprompter.scripts';
const STYLE_KEY = 'glint.teleprompter.style';

export interface Script {
  id: string;
  name: string;
  text: string;
  updatedAt: number;
}

export interface PrompterStyle {
  fontFamily: string;
  fontSize: number;
  color: string;
  background: string;
  backgroundOpacity: number;
  align: 'left' | 'center' | 'right';
  lineHeight: number;
  widthPct: number;
  speed: number;
  includeInRecording: boolean;
  position: 'top' | 'bottom';
  mirror: boolean;
}

export const DEFAULT_PROMPTER_STYLE: PrompterStyle = {
  fontFamily: 'Inter Variable, Inter, Segoe UI, sans-serif',
  fontSize: 40,
  color: '#FFFFFF',
  background: '#000000',
  backgroundOpacity: 0.85,
  align: 'center',
  lineHeight: 1.5,
  widthPct: 0.8,
  speed: 40,
  includeInRecording: false,
  position: 'bottom',
  mirror: false,
};

const FONTS = [
  { value: 'Inter Variable, Inter, Segoe UI, sans-serif', label: 'Inter' },
  { value: 'Arial, sans-serif', label: 'Arial' },
  { value: 'Georgia, serif', label: 'Georgia' },
  { value: '"Times New Roman", serif', label: 'Times New Roman' },
  { value: 'Verdana, sans-serif', label: 'Verdana' },
  { value: '"Courier New", monospace', label: 'Courier New' },
];

const SAMPLE = 'Welcome! Paste or type your script here.\n\nPress Play (or Space) to start scrolling. Use ↑ / ↓ to change the speed, R to restart and Esc to come back to editing.';

function newId(): string {
  return `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/** Scroll position (px) for the current play state. */
export function scrollAt(base: number, since: number, playing: boolean, speed: number, now: number): number {
  return base + (playing ? (speed * Math.max(0, now - since)) / 1000 : 0);
}

/**
 * Teleprompter window: write, paste and save scripts, then read them while recording. The window
 * is separate, so it never shows in tab recordings; it can optionally be drawn into the video.
 */
export function TeleprompterApp() {
  useEffect(() => applyTheme('dark'), []);
  const [scripts, setScripts] = useState<Script[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [style, setStyle] = useState<PrompterStyle>(DEFAULT_PROMPTER_STYLE);
  const [mode, setMode] = useState<'edit' | 'prompt'>('edit');
  const [playing, setPlaying] = useState(false);
  const [base, setBase] = useState(0);
  const [since, setSince] = useState(Date.now());
  const [loaded, setLoaded] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const recording = useRecordingState();
  const live = isBusy(recording);

  useEffect(() => {
    void chrome.storage.local.get([SCRIPTS_KEY, STYLE_KEY]).then((r) => {
      const list = (r[SCRIPTS_KEY] as Script[] | undefined) ?? [];
      const initial = list.length ? list : [{ id: newId(), name: 'My script', text: SAMPLE, updatedAt: Date.now() }];
      setScripts(initial);
      setCurrentId(initial[0]!.id);
      setStyle({ ...DEFAULT_PROMPTER_STYLE, ...((r[STYLE_KEY] as Partial<PrompterStyle> | undefined) ?? {}) });
      setLoaded(true);
    });
  }, []);

  useEffect(() => {
    if (loaded) void chrome.storage.local.set({ [SCRIPTS_KEY]: scripts });
  }, [scripts, loaded]);
  useEffect(() => {
    if (loaded) void chrome.storage.local.set({ [STYLE_KEY]: style });
  }, [style, loaded]);

  const current = scripts.find((s) => s.id === currentId) ?? null;
  const setText = (text: string) => setScripts((list) => list.map((s) => (s.id === currentId ? { ...s, text, updatedAt: Date.now() } : s)));
  const set = (patch: Partial<PrompterStyle>) => setStyle((s) => ({ ...s, ...patch }));

  /* ------------------------------- playback ------------------------------- */
  const offsetNow = useCallback(() => scrollAt(base, since, playing, style.speed, Date.now()), [base, since, playing, style.speed]);
  const play = () => { setSince(Date.now()); setPlaying(true); setMode('prompt'); };
  const pause = () => { setBase(offsetNow()); setSince(Date.now()); setPlaying(false); };
  const restart = () => { setBase(0); setSince(Date.now()); if (scrollRef.current) scrollRef.current.scrollTop = 0; };
  const changeSpeed = (delta: number) => {
    setBase(offsetNow());
    setSince(Date.now());
    set({ speed: Math.max(5, Math.min(300, style.speed + delta)) });
  };

  useEffect(() => {
    if (mode !== 'prompt') return;
    let raf = 0;
    const loop = () => {
      const el = scrollRef.current;
      if (el) {
        const y = offsetNow();
        el.scrollTop = y;
        // Stop at the end of the script.
        if (playing && y > el.scrollHeight - el.clientHeight + 4) pause();
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, offsetNow, playing]);

  /* ------------------------ include in the recording ----------------------- */
  const liveState = useMemo<TeleprompterLive | null>(() => {
    if (!style.includeInRecording || !current) return null;
    return {
      text: current.text, fontFamily: style.fontFamily, fontSize: style.fontSize, color: style.color, background: style.background,
      backgroundOpacity: style.backgroundOpacity, align: style.align, lineHeight: style.lineHeight, widthPct: style.widthPct, position: style.position,
      speed: style.speed, offset: base, since, playing: playing && mode === 'prompt',
    };
  }, [style, current, base, since, playing, mode]);

  const sentNull = useRef(true);
  useEffect(() => {
    if (!live) return;
    if (!liveState && sentNull.current) return;
    sentNull.current = !liveState;
    const t = setTimeout(() => {
      void sendToBackground({ target: 'background', type: 'recording/effect', effect: { kind: 'teleprompter', state: liveState } }).catch(() => undefined);
    }, 120);
    return () => clearTimeout(t);
  }, [liveState, live]);

  /* -------------------------------- keyboard ------------------------------- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (mode !== 'prompt') return;
      if ((e.target as HTMLElement).closest('input, textarea')) return;
      if (e.key === ' ') { e.preventDefault(); if (playing) pause(); else play(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); changeSpeed(5); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); changeSpeed(-5); }
      else if (e.key.toLowerCase() === 'r') restart();
      else if (e.key === 'Escape') { pause(); setMode('edit'); }
      else if (e.key === '+' || e.key === '=') set({ fontSize: Math.min(160, style.fontSize + 4) });
      else if (e.key === '-') set({ fontSize: Math.max(14, style.fontSize - 4) });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (!loaded) return null;

  if (mode === 'prompt') {
    return (
      <div className={styles.prompter} style={{ background: hexAlpha(style.background, style.backgroundOpacity) }}>
        <div
          ref={scrollRef}
          className={styles.scroller}
          onWheel={(e) => { if (!playing) { setBase(Math.max(0, base + e.deltaY)); setSince(Date.now()); } }}
        >
          <div className={styles.guide} aria-hidden />
          <div
            className={styles.script}
            style={{
              fontFamily: style.fontFamily, fontSize: style.fontSize, color: style.color, textAlign: style.align, lineHeight: style.lineHeight,
              width: `${style.widthPct * 100}%`, transform: style.mirror ? 'scaleX(-1)' : undefined,
            }}
          >
            {current?.text}
          </div>
        </div>
        <div className={styles.controls} role="toolbar" aria-label="Teleprompter controls">
          <IconButton tone="dark" label="Back to editing (Esc)" icon={<ArrowLeft size={17} />} onClick={() => { pause(); setMode('edit'); }} />
          <IconButton tone="dark" label={playing ? 'Pause (Space)' : 'Play (Space)'} icon={playing ? <Pause size={17} /> : <Play size={17} />} onClick={() => (playing ? pause() : play())} />
          <IconButton tone="dark" label="Restart (R)" icon={<RotateCcw size={16} />} onClick={restart} />
          <IconButton tone="dark" label="Slower (↓)" icon={<Minus size={16} />} onClick={() => changeSpeed(-5)} />
          <span className={styles.speed} aria-label="Speed">{style.speed} px/s</span>
          <IconButton tone="dark" label="Faster (↑)" icon={<Plus size={16} />} onClick={() => changeSpeed(5)} />
          <span className={styles.flex} />
          {live && style.includeInRecording && <span className={styles.liveTag}>In recording</span>}
        </div>
      </div>
    );
  }

  return (
    <div className={styles.editor}>
      <aside className={styles.list} aria-label="Scripts">
        <div className={styles.listHead}>
          Scripts
          <IconButton
            tone="dark"
            size="sm"
            label="New script"
            icon={<FilePlus2 size={15} />}
            onClick={() => {
              const s = { id: newId(), name: `Script ${scripts.length + 1}`, text: '', updatedAt: Date.now() };
              setScripts([s, ...scripts]);
              setCurrentId(s.id);
            }}
          />
        </div>
        {scripts.map((s) => (
          <button key={s.id} type="button" className={`${styles.item} ${s.id === currentId ? styles.itemOn : ''}`} onClick={() => setCurrentId(s.id)}>
            {s.name || 'Untitled'}
          </button>
        ))}
      </aside>
      <main className={styles.main}>
        {current && (
          <>
            <div className={styles.row}>
              <TextField tone="dark" value={current.name} aria-label="Script name" onChange={(e) => setScripts((list) => list.map((s) => (s.id === current.id ? { ...s, name: e.target.value } : s)))} />
              <IconButton
                tone="danger"
                size="sm"
                label="Delete script"
                icon={<Trash2 size={15} />}
                disabled={scripts.length < 2}
                onClick={() => {
                  const rest = scripts.filter((s) => s.id !== current.id);
                  setScripts(rest);
                  setCurrentId(rest[0]?.id ?? null);
                }}
              />
            </div>
            <textarea className={styles.text} value={current.text} onChange={(e) => setText(e.target.value)} aria-label="Script text" placeholder="Type or paste your script…" />
            <div className={styles.saved}><Save size={13} /> Saved automatically</div>
          </>
        )}
        <details className={styles.settings} open>
          <summary>Appearance & playback</summary>
          <div className={styles.grid}>
            <div>
              <span className={styles.label}>Font</span>
              <Select label="Teleprompter font" variant="dark" value={style.fontFamily} minWidth={180} onChange={(fontFamily) => set({ fontFamily })} options={FONTS} />
            </div>
            <Slider tone="dark" label="Font size" min={14} max={160} value={style.fontSize} format={(v) => `${v}px`} onChange={(fontSize) => set({ fontSize })} />
            <Slider tone="dark" label="Scroll speed" min={5} max={300} value={style.speed} format={(v) => `${v} px/s`} onChange={(speed) => set({ speed })} />
            <Slider tone="dark" label="Line spacing" min={1} max={2.5} step={0.05} value={style.lineHeight} format={(v) => v.toFixed(2)} onChange={(lineHeight) => set({ lineHeight })} />
            <Slider tone="dark" label="Text width" min={0.3} max={1} step={0.05} value={style.widthPct} format={(v) => `${Math.round(v * 100)}%`} onChange={(widthPct) => set({ widthPct })} />
            <Slider tone="dark" label="Background opacity" min={0} max={1} step={0.05} value={style.backgroundOpacity} format={(v) => `${Math.round(v * 100)}%`} onChange={(backgroundOpacity) => set({ backgroundOpacity })} />
            <div>
              <span className={styles.label}>Alignment</span>
              <RadioGroup tone="dark" size="sm" label="Teleprompter alignment" value={style.align} onChange={(align) => set({ align })} options={[{ value: 'left', label: 'Left' }, { value: 'center', label: 'Centre' }, { value: 'right', label: 'Right' }]} />
            </div>
            <div>
              <span className={styles.label}>Text colour</span>
              <ColorSwatches label="Teleprompter text colour" alpha={false} colors={['#FFFFFF', '#FFD84D', '#9BE7FF', '#B6F5C8', '#202938']} value={style.color} onChange={(color) => set({ color })} />
            </div>
            <div>
              <span className={styles.label}>Background</span>
              <ColorSwatches label="Teleprompter background" alpha={false} colors={['#000000', '#1F232B', '#0B2545', '#FFFFFF']} value={style.background} onChange={(background) => set({ background })} />
            </div>
            <label className={styles.toggle}>Mirror text (for glass prompters) <ToggleSwitch size="sm" label="Mirror text" checked={style.mirror} onChange={(mirror) => set({ mirror })} /></label>
            <label className={styles.toggle}>
              Show in the recording
              <ToggleSwitch size="sm" label="Show teleprompter in the recording" checked={style.includeInRecording} onChange={(includeInRecording) => set({ includeInRecording })} />
            </label>
            {style.includeInRecording && (
              <div>
                <span className={styles.label}>Caption position in the video</span>
                <RadioGroup tone="dark" size="sm" label="Caption position" value={style.position} onChange={(position) => set({ position })} options={[{ value: 'top', label: 'Top' }, { value: 'bottom', label: 'Bottom' }]} />
              </div>
            )}
          </div>
          <p className={styles.hint}>
            This window is never part of a tab recording. Turn on “Show in the recording” to add the scrolling text as a caption in the video. Move and resize this window anywhere — near your camera works best.
          </p>
        </details>
        <div className={styles.footer}>
          <Button variant="primary" icon={<Play size={16} />} onClick={play} disabled={!current?.text.trim()}>
            Start prompter
          </Button>
        </div>
      </main>
    </div>
  );
}

function hexAlpha(hex: string, alpha: number): string {
  const m = /^#([0-9a-f]{6})/i.exec(hex);
  if (!m) return hex;
  return `#${m[1]}${Math.round(Math.max(0, Math.min(1, alpha)) * 255).toString(16).padStart(2, '0')}`;
}
