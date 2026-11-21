import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  AlertTriangle, ArrowUpRight, Camera, CameraOff, ChevronDown, ChevronUp, Circle, Eraser, Eye, EyeOff, Flag, Focus, Highlighter, Maximize2, Mic, MicOff, Minimize2,
  Minus, MousePointer2, Pause, Pen, Play, Redo2, ScrollText, Square, SquareDashed, Trash2, Type, Undo2, ZoomIn,
} from 'lucide-react';
import type { AnnotateAction, AnnotateTool, RecordingCommand } from '@/shared/messaging/messages';
import type { CameraStyle, LiveEffect } from '@/shared/types';
import { errorInfoOf, onBroadcast, sendToBackground } from '@/shared/messaging/client';
import { IconButton } from '@/shared/components/Button';
import { RadioGroup, Slider, ToggleSwitch } from '@/shared/components/FormControls';
import { useNow, useRecordingState } from '@/shared/hooks/useRecordingState';
import { elapsedMs, remainingMs } from '../services/recording-state';
import { formatDuration, formatMediaTime } from '@/shared/utils/format';
import styles from './controlbar.module.css';
import { formatKeys } from '@/shared/utils/keys';

function send(command: RecordingCommand) {
  void sendToBackground({ target: 'background', type: 'recording/command', command });
}
function effect(e: LiveEffect) {
  void sendToBackground({ target: 'background', type: 'recording/effect', effect: e }).catch(() => undefined);
}

type Panel = 'markers' | 'camera' | 'focus' | 'draw' | 'audio';
const COLORS = ['#E05252', '#F59E0B', '#FFD84D', '#24A36A', '#4F8DF7', '#7C5CF6', '#202938', '#FFFFFF'];

interface Levels {
  mic: number | null;
  system: number | null;
  micMuted: boolean;
  micSilentMs: number;
}

/**
 * Floating control bar, shown in its own small window. A separate window is never part of a tab
 * recording, so the controls don't appear in the video (for full-screen desktop capture Chrome
 * cannot exclude any window).
 */
export function ControlBarApp() {
  const state = useRecordingState();
  const [minimized, setMinimized] = useState(false);
  const [panel, setPanel] = useState<Panel | null>(null);
  const [levels, setLevels] = useState<Levels>({ mic: null, system: null, micMuted: false, micSilentMs: 0 });
  const [error, setError] = useState<string | null>(null);
  const now = useNow(state.status === 'recording', 250);
  const paused = state.status === 'paused';
  const tabMode = state.mode === 'tab' || state.mode === 'area';

  useEffect(() => {
    document.title = paused ? 'Paused · Pixora' : `${formatDuration(elapsedMs(state, now))} · Recording`;
  }, [state, now, paused]);

  useEffect(() => onBroadcast((msg) => {
    if (msg.type === 'recording/levels') setLevels({ mic: msg.mic, system: msg.system, micMuted: msg.micMuted, micSilentMs: msg.micSilentMs });
  }), []);

  const resize = (min: boolean, open: Panel | null) => {
    void sendToBackground({ target: 'background', type: 'controlbar/resize', minimized: min, expanded: open !== null });
  };
  const openPanel = (p: Panel) => {
    const next = p;
    setPanel(next);
    resize(minimized, next);
  };

  const run = (p: Promise<unknown>) => {
    setError(null);
    p.catch((err: unknown) => setError(errorInfoOf(err).message));
  };
  const addMarker = () => run(sendToBackground({ target: 'background', type: 'recording/marker' }));
  const annotate = (action: AnnotateAction) => run(sendToBackground({ target: 'background', type: 'recording/annotate', action }));
  const regionSelect = (purpose: 'highlight' | 'zoom') => run(sendToBackground({ target: 'background', type: 'recording/region-select', purpose }));

  // Keyboard shortcuts while the bar has focus.
  const stateRef = useRef(state);
  stateRef.current = state;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, textarea')) return;
      const k = e.key.toLowerCase();
      const fx = stateRef.current.effects;
      if (e.key === ' ') { e.preventDefault(); send('toggle-pause'); }
      else if (e.key === 'Escape') send('stop');
      else if (k === 'm') addMarker();
      else if (k === 'd') annotate({ kind: fx.annotating ? 'stop' : 'start' });
      else if (k === 'z') effect({ kind: 'zoom', level: fx.zoom > 1 ? 1 : 2, center: null });
      else if (k === 's') effect({ kind: 'spotlight', on: !fx.spotlight });
      else if (k === 't') void sendToBackground({ target: 'background', type: 'teleprompter/open' });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (state.status === 'idle' || state.status === 'error') {
    return <div className={styles.bar}><span className={styles.info}>Recording finished.</span></div>;
  }

  const remaining = remainingMs(state, now);
  const fx = state.effects;
  const audioWarning = !state.micAvailable && levels.mic === null
    ? null
    : levels.micMuted && state.micOn
      ? 'Microphone is muted by the system or disconnected'
      : levels.micSilentMs > 4000
        ? 'No sound from the microphone — check the device or its volume'
        : null;
  const toggleMin = () => {
    setMinimized(!minimized);
    if (!minimized) setPanel(null);
    resize(!minimized, minimized ? panel : null);
  };

  return (
    <div className={styles.wrap}>
      {panel && !minimized && (
        <div className={styles.panel} role="region" aria-label="Recording tools">
          <div className={styles.tabs} role="tablist" aria-label="Tool panels">
            <PanelButton panel={panel} id="markers" label={`Markers (${state.markers.length})`} onClick={openPanel} />
            <PanelButton panel={panel} id="focus" label="Zoom & focus" onClick={openPanel} />
            {state.cameraAvailable && <PanelButton panel={panel} id="camera" label="Camera" onClick={openPanel} />}
            <PanelButton panel={panel} id="draw" label="Draw" onClick={openPanel} />
            <PanelButton panel={panel} id="audio" label="Audio" onClick={openPanel} />
          </div>
          {panel === 'markers' && <MarkersPanel now={now} onAdd={addMarker} />}
          {panel === 'camera' && <CameraPanel style={fx.camera} available={state.cameraAvailable} />}
          {panel === 'focus' && <FocusPanel tabMode={tabMode} onRegion={regionSelect} />}
          {panel === 'draw' && <DrawPanel annotating={fx.annotating} annotate={annotate} />}
          {panel === 'audio' && <AudioPanel levels={levels} micOn={state.micOn} micAvailable={state.micAvailable} systemExpected={Boolean(state.actual && !state.actual.hasSystemAudio)} warning={audioWarning} />}
          {error && <div className={styles.error} role="alert">{error}</div>}
        </div>
      )}
      <div className={styles.bar} role="toolbar" aria-label="Recording controls">
        <span className={styles.time} aria-live="off">
          <span className={`${styles.dot} ${paused ? styles.dotPaused : ''}`} />
          {state.status === 'countdown' ? 'Starting…' : state.status === 'stopping' ? 'Saving…' : formatDuration(elapsedMs(state, now))}
        </span>
        <IconButton tone="dark" label={paused ? 'Resume' : 'Pause'} shortcut="Space" icon={paused ? <Play size={17} /> : <Pause size={17} />} onClick={() => send(paused ? 'resume' : 'pause')} disabled={state.status !== 'recording' && !paused} />
        <button type="button" className={styles.stop} onClick={() => send('stop')} disabled={state.status === 'stopping'}>
          <Square size={12} fill="currentColor" /> {minimized ? '' : 'Stop'}
        </button>
        <IconButton tone="dark" label="Discard recording (stop and delete it)" icon={<Trash2 size={16} />} onClick={() => send('cancel')} disabled={state.status === 'stopping'} />
        {!minimized && (
          <>
            <span className={styles.sep} />
            <span className={styles.micGroup}>
              <IconButton tone="dark" label={state.micOn ? 'Mute microphone' : 'Unmute microphone'} icon={state.micOn ? <Mic size={17} /> : <MicOff size={17} />} active={state.micOn} disabled={!state.micAvailable} onClick={() => send('toggle-mic')} />
              {state.micAvailable && <span className={styles.vu} aria-label="Microphone level"><span style={{ height: `${Math.round((levels.mic ?? 0) * 100)}%` }} /></span>}
            </span>
            <IconButton tone="dark" label={state.cameraOn ? 'Hide camera' : 'Show camera'} icon={state.cameraOn ? <Camera size={17} /> : <CameraOff size={17} />} active={state.cameraOn} disabled={!state.cameraAvailable} onClick={() => send('toggle-camera')} />
            <IconButton tone="dark" label="Add marker" shortcut="M" icon={<Flag size={17} />} onClick={addMarker} disabled={state.status !== 'recording' && !paused} />
            <IconButton tone="dark" label={fx.zoom > 1 ? 'Zoom out' : 'Zoom in (follows the cursor in tab recordings)'} shortcut="Z" icon={<ZoomIn size={17} />} active={fx.zoom > 1} onClick={() => effect({ kind: 'zoom', level: fx.zoom > 1 ? 1 : 2, center: null })} />
            <IconButton tone="dark" label={fx.spotlight ? 'Spotlight off' : 'Spotlight on'} shortcut="S" icon={<Focus size={17} />} active={fx.spotlight} onClick={() => effect({ kind: 'spotlight', on: !fx.spotlight })} />
            <IconButton tone="dark" label={fx.annotating ? 'Stop drawing' : 'Draw on screen'} shortcut="D" icon={<Pen size={17} />} active={fx.annotating} onClick={() => { annotate({ kind: fx.annotating ? 'stop' : 'start' }); if (!fx.annotating) { setPanel('draw'); resize(false, 'draw'); } }} />
            <IconButton tone="dark" label="Teleprompter" shortcut="T" icon={<ScrollText size={17} />} active={fx.teleprompter} onClick={() => void sendToBackground({ target: 'background', type: 'teleprompter/open' })} />
            {audioWarning && <span className={styles.warnIcon} title={audioWarning} aria-label={audioWarning}><AlertTriangle size={16} /></span>}
            <span className={styles.sep} />
            <button
              type="button"
              className={`${styles.tab} ${panel ? styles.tabOn : ''}`}
              aria-expanded={panel !== null}
              onClick={() => { const next = panel ? null : 'markers'; setPanel(next); resize(minimized, next); }}
            >
              Tools {state.markers.length > 0 ? `· ${state.markers.length}` : ''} {panel ? <ChevronDown size={12} /> : <ChevronUp size={12} />}
            </button>
            {remaining !== null && <span className={styles.info}>{formatDuration(remaining)} left</span>}
          </>
        )}
        <IconButton tone="dark" label={minimized ? 'Expand toolbar' : 'Minimize toolbar'} icon={minimized ? <Maximize2 size={16} /> : <Minimize2 size={16} />} onClick={toggleMin} />
      </div>
    </div>
  );
}

function PanelButton({ panel, id, label, onClick }: { panel: Panel | null; id: Panel; label: string; onClick: (p: Panel) => void }) {
  return (
    <button type="button" role="tab" aria-selected={panel === id} className={`${styles.tab} ${panel === id ? styles.tabOn : ''}`} onClick={() => onClick(id)}>
      {label}
    </button>
  );
}

function Section({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <div className={styles.section}>
      <div className={styles.sectionHead}>
        {title}
        {action}
      </div>
      {children}
    </div>
  );
}

/* -------------------------------- markers -------------------------------- */
function MarkersPanel({ now, onAdd }: { now: number; onAdd: () => void }) {
  const state = useRecordingState();
  return (
    <Section
      title="Chapters & markers"
      action={<button type="button" className={styles.smallBtn} onClick={onAdd}><Flag size={13} /> Add at {formatMediaTime(elapsedMs(state, now) / 1000)}</button>}
    >
      {state.markers.length === 0 ? (
        <p className={styles.hint}>{formatKeys('Press M here, Alt+Shift+M in the recorded page, or your “Add marker” shortcut. Markers become chapters on the result page.')}</p>
      ) : (
        <ul className={styles.markerList}>
          {state.markers.map((m) => (
            <li key={m.id}>
              <span className={styles.markerTime}>{formatMediaTime(m.timeMs / 1000)}</span>
              <input
                className={styles.input}
                defaultValue={m.name}
                aria-label={`Marker name at ${formatMediaTime(m.timeMs / 1000)}`}
                onBlur={(e) => e.target.value !== m.name && void sendToBackground({ target: 'background', type: 'recording/marker-update', id: m.id, name: e.target.value })}
                onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
              />
              <input
                className={styles.input}
                defaultValue={m.description ?? ''}
                placeholder="Description (optional)"
                aria-label="Marker description"
                onBlur={(e) => e.target.value !== (m.description ?? '') && void sendToBackground({ target: 'background', type: 'recording/marker-update', id: m.id, description: e.target.value })}
              />
              <IconButton tone="dark" size="sm" label="Delete marker" icon={<Trash2 size={14} />} onClick={() => void sendToBackground({ target: 'background', type: 'recording/marker-update', id: m.id, remove: true })} />
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

/* --------------------------------- camera -------------------------------- */
const GRID: Array<[number, number]> = [[0.12, 0.15], [0.5, 0.15], [0.88, 0.15], [0.12, 0.5], [0.5, 0.5], [0.88, 0.5], [0.12, 0.85], [0.5, 0.85], [0.88, 0.85]];

function CameraPanel({ style, available }: { style: CameraStyle | null; available: boolean }) {
  if (!available || !style) return <p className={styles.hint}>The camera overlay is off for this recording.</p>;
  const set = (patch: Partial<CameraStyle>) => effect({ kind: 'camera', patch });
  return (
    <div className={styles.cols}>
      <Section title="Position">
        <div className={styles.grid9} role="radiogroup" aria-label="Camera position">
          {GRID.map(([x, y]) => {
            const on = Math.abs(style.x - x) < 0.05 && Math.abs(style.y - y) < 0.05;
            return <button key={`${x}${y}`} type="button" role="radio" aria-checked={on} aria-label={`Camera position ${x},${y}`} className={on ? styles.cellOn : styles.cell} onClick={() => set({ x, y })} />;
          })}
        </div>
        <Slider tone="dark" label="Left ↔ right" min={0} max={1} step={0.01} value={style.x} format={(v) => `${Math.round(v * 100)}%`} onChange={(x) => set({ x })} />
        <Slider tone="dark" label="Top ↕ bottom" min={0} max={1} step={0.01} value={style.y} format={(v) => `${Math.round(v * 100)}%`} onChange={(y) => set({ y })} />
      </Section>
      <Section title="Look">
        <RadioGroup tone="dark" size="sm" label="Camera shape" value={style.shape} onChange={(shape) => set({ shape })} options={[{ value: 'circle', label: 'Circle' }, { value: 'rounded', label: 'Rounded' }, { value: 'square', label: 'Square' }]} />
        <Slider tone="dark" label="Size" min={8} max={50} value={style.sizePct} format={(v) => `${v}%`} onChange={(sizePct) => set({ sizePct })} />
        <Slider tone="dark" label="Opacity" min={0.2} max={1} step={0.05} value={style.opacity} format={(v) => `${Math.round(v * 100)}%`} onChange={(opacity) => set({ opacity })} />
        <Slider tone="dark" label="Border" min={0} max={16} value={style.borderWidth} format={(v) => `${v}px`} onChange={(borderWidth) => set({ borderWidth })} />
        <div className={styles.swatches}>
          {COLORS.map((c) => <button key={c} type="button" aria-label={`Border ${c}`} className={styles.swatch} style={{ background: c, outline: style.borderColor === c ? '2px solid #4F8DF7' : undefined }} onClick={() => set({ borderColor: c })} />)}
        </div>
        <label className={styles.inline}>Mirror <ToggleSwitch size="sm" label="Mirror camera" checked={style.mirror} onChange={(mirror) => set({ mirror })} /></label>
      </Section>
    </div>
  );
}

/* ------------------------------ zoom & focus ----------------------------- */
function FocusPanel({ tabMode, onRegion }: { tabMode: boolean; onRegion: (p: 'highlight' | 'zoom') => void }) {
  const state = useRecordingState();
  const fx = state.effects;
  return (
    <div className={styles.cols}>
      <Section title="Zoom">
        <RadioGroup
          tone="dark"
          size="sm"
          label="Zoom level"
          value={[1, 1.5, 2, 3].includes(fx.zoom) ? fx.zoom : -1}
          onChange={(level) => level > 0 && effect({ kind: 'zoom', level, center: null })}
          options={[{ value: 1, label: '1×' }, { value: 1.5, label: '1.5×' }, { value: 2, label: '2×' }, { value: 3, label: '3×' }, ...(![1, 1.5, 2, 3].includes(fx.zoom) ? [{ value: -1, label: `${fx.zoom}×` }] : [])]}
        />
        <button type="button" className={styles.smallBtn} onClick={() => onRegion('zoom')}><ZoomIn size={13} /> Zoom to a region…</button>
        <p className={styles.hint}>{tabMode ? 'Zoom follows your cursor. Auto zoom on click is set in recording settings.' : 'Desktop recordings zoom on the centre or a region you pick on the preview.'}</p>
      </Section>
      <Section title="Focus">
        <label className={styles.inline}>Cursor spotlight <ToggleSwitch size="sm" label="Cursor spotlight" checked={fx.spotlight} onChange={(on) => effect({ kind: 'spotlight', on })} /></label>
        <button type="button" className={styles.smallBtn} onClick={() => onRegion('highlight')}><SquareDashed size={13} /> Highlight a region…</button>
        {fx.highlight && <button type="button" className={styles.smallBtn} onClick={() => effect({ kind: 'highlight', rect: null })}><Eye size={13} /> Clear highlight</button>}
        <p className={styles.hint}>{tabMode ? 'The spotlight follows your cursor; the rest of the video is dimmed.' : 'Without cursor tracking the spotlight stays centred.'}</p>
      </Section>
    </div>
  );
}

/* ---------------------------------- draw --------------------------------- */
const TOOLS: Array<{ tool: AnnotateTool; label: string; icon: ReactNode }> = [
  { tool: 'pen', label: 'Pen (P)', icon: <Pen size={15} /> },
  { tool: 'arrow', label: 'Arrow (A)', icon: <ArrowUpRight size={15} /> },
  { tool: 'line', label: 'Line (L)', icon: <Minus size={15} /> },
  { tool: 'rect', label: 'Rectangle (R)', icon: <Square size={15} /> },
  { tool: 'circle', label: 'Circle (O)', icon: <Circle size={15} /> },
  { tool: 'text', label: 'Text (T)', icon: <Type size={15} /> },
  { tool: 'eraser', label: 'Eraser (E)', icon: <Eraser size={15} /> },
];

function DrawPanel({ annotating, annotate }: { annotating: boolean; annotate: (a: AnnotateAction) => void }) {
  const [tool, setTool] = useState<AnnotateTool>('pen');
  const [color, setColor] = useState('#E05252');
  const [width, setWidth] = useState(5);
  const [opacity, setOpacity] = useState(1);
  const [fontSize, setFontSize] = useState(28);
  const [visible, setVisible] = useState(true);
  const style = (patch: { color?: string; width?: number; opacity?: number; fontSize?: number }) => annotate({ kind: 'style', ...patch });
  return (
    <div className={styles.cols}>
      <Section
        title="Draw on screen"
        action={
          <button type="button" className={styles.smallBtn} onClick={() => annotate({ kind: annotating ? 'interact' : 'start', ...(annotating ? { on: true } : {}) } as AnnotateAction)}>
            {annotating ? <><MousePointer2 size={13} /> Use the page</> : <><Highlighter size={13} /> Start drawing</>}
          </button>
        }
      >
        <div className={styles.tools} role="radiogroup" aria-label="Drawing tool">
          {TOOLS.map((t) => (
            <IconButton key={t.tool} tone="dark" size="sm" label={t.label} icon={t.icon} active={tool === t.tool} onClick={() => { setTool(t.tool); annotate({ kind: 'tool', tool: t.tool }); }} />
          ))}
        </div>
        <div className={styles.tools}>
          <IconButton tone="dark" size="sm" label="Undo (Ctrl+Z)" icon={<Undo2 size={15} />} onClick={() => annotate({ kind: 'undo' })} />
          <IconButton tone="dark" size="sm" label="Redo (Ctrl+Y)" icon={<Redo2 size={15} />} onClick={() => annotate({ kind: 'redo' })} />
          <IconButton tone="dark" size="sm" label="Clear all (Delete)" icon={<Trash2 size={15} />} onClick={() => annotate({ kind: 'clear' })} />
          <IconButton tone="dark" size="sm" label={visible ? 'Hide drawings (H)' : 'Show drawings (H)'} icon={visible ? <EyeOff size={15} /> : <Eye size={15} />} onClick={() => { setVisible(!visible); annotate({ kind: 'visible', visible: !visible }); }} />
        </div>
        <p className={styles.hint}>{formatKeys('Draws on the page you are recording. Esc lets clicks through to the page; Alt+Shift+D switches drawing back on.')}</p>
      </Section>
      <Section title="Style">
        <div className={styles.swatches}>
          {COLORS.map((c) => <button key={c} type="button" aria-label={`Colour ${c}`} className={styles.swatch} style={{ background: c, outline: color === c ? '2px solid #4F8DF7' : undefined }} onClick={() => { setColor(c); style({ color: c }); }} />)}
        </div>
        <Slider tone="dark" label="Thickness" min={1} max={30} value={width} format={(v) => `${v}px`} onChange={(v) => { setWidth(v); style({ width: v }); }} />
        <Slider tone="dark" label="Drawing opacity" min={0.1} max={1} step={0.05} value={opacity} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => { setOpacity(v); style({ opacity: v }); }} />
        <Slider tone="dark" label="Font size" min={12} max={96} value={fontSize} format={(v) => `${v}px`} onChange={(v) => { setFontSize(v); style({ fontSize: v }); }} />
      </Section>
    </div>
  );
}

/* ---------------------------------- audio -------------------------------- */
function Meter({ label, value }: { label: string; value: number | null }) {
  return (
    <div className={styles.meterRow}>
      <span>{label}</span>
      <span className={styles.meter} role="meter" aria-label={`${label} level`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round((value ?? 0) * 100)}>
        <span style={{ width: `${Math.round((value ?? 0) * 100)}%` }} />
      </span>
    </div>
  );
}

function AudioPanel({ levels, micOn, micAvailable, systemExpected, warning }: { levels: Levels; micOn: boolean; micAvailable: boolean; systemExpected: boolean; warning: string | null }) {
  return (
    <Section title="Audio monitoring">
      {micAvailable ? <Meter label={micOn ? 'Microphone' : 'Microphone (muted)'} value={micOn ? levels.mic : 0} /> : <p className={styles.hint}>No microphone in this recording.</p>}
      {levels.system !== null ? <Meter label="System / tab audio" value={levels.system} /> : <p className={styles.hint}>{systemExpected ? 'System / tab audio is not being captured: it is turned off, was not shared in Chrome’s picker, or this source can’t provide it.' : 'System audio is off for this recording.'}</p>}
      {warning && <div className={styles.error} role="alert">{warning}</div>}
    </Section>
  );
}
