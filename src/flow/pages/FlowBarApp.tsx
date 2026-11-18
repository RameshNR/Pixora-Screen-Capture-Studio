import { useEffect, useState } from 'react';
import { AppWindow, PictureInPicture2, Camera, Check, Crop, Maximize2, Minimize2, Monitor, Pause, Play, ScrollText, Undo2, X } from 'lucide-react';
import type { FlowCaptureMode, FlowState } from '@/shared/types';
import { errorInfoOf, onBroadcast, sendToBackground } from '@/shared/messaging/client';
import { Button, IconButton } from '@/shared/components/Button';
import { Spinner } from '@/shared/components/Progress';
import { formatDuration } from '@/shared/utils/format';
import styles from './flow.module.css';

export const FLOW_MODES: Array<{ mode: FlowCaptureMode; label: string; icon: JSX.Element }> = [
  { mode: 'visible', label: 'Visible part', icon: <AppWindow size={16} /> },
  { mode: 'full', label: 'Full page', icon: <ScrollText size={16} /> },
  { mode: 'area', label: 'Selected area', icon: <Crop size={16} /> },
  { mode: 'screen', label: 'Full screen', icon: <Monitor size={16} /> },
  { mode: 'window', label: 'Application window', icon: <PictureInPicture2 size={16} /> },
];

/** Live flow session state (broadcast by the service worker). */
export function useFlowState(): FlowState | null {
  const [state, setState] = useState<FlowState | null>(null);
  useEffect(() => {
    void sendToBackground<FlowState>({ target: 'background', type: 'flow/get-state' }).then(setState).catch(() => undefined);
    return onBroadcast((msg) => {
      if (msg.type === 'flow/state') setState(msg.state);
    });
  }, []);
  return state;
}

function useTick(on: boolean): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!on) return;
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, [on]);
  return now;
}

/**
 * Floating Flow Capture toolbar (its own small window: movable, never part of a tab screenshot).
 * Capture adds an image in the chosen mode; the session continues across pages and sites.
 */
export function FlowBarApp() {
  const state = useFlowState();
  const [mode, setMode] = useState<FlowCaptureMode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [flash, setFlash] = useState(false);
  const now = useTick(state?.status === 'recording');
  const current = mode ?? state?.config?.mode ?? 'visible';

  const run = (p: Promise<unknown>, after?: () => void) => {
    setError(null);
    p.then(() => after?.()).catch((err: unknown) => setError(errorInfoOf(err).message));
  };
  const capture = () =>
    run(sendToBackground({ target: 'background', type: 'flow/capture', mode: current }), () => {
      setFlash(true);
      setTimeout(() => setFlash(false), 350);
    });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, textarea')) return;
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); capture(); }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); run(sendToBackground({ target: 'background', type: 'flow/undo' })); }
      if (e.key.toLowerCase() === 'p') run(sendToBackground({ target: 'background', type: 'flow/command', command: state?.status === 'paused' ? 'resume' : 'pause' }));
      const n = Number(e.key);
      if (n >= 1 && n <= FLOW_MODES.length) setMode(FLOW_MODES[n - 1]!.mode);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  useEffect(() => {
    document.title = state && state.status !== 'idle' ? `Flow · ${state.items} image${state.items === 1 ? '' : 's'}` : 'Pixora Flow Capture';
  }, [state]);

  if (!state) return <div className={styles.bar}><Spinner size={18} /></div>;
  if (state.status === 'idle' || state.status === 'finishing') {
    return (
      <div className={styles.bar}>
        <span className={styles.barInfo}>{state.status === 'finishing' ? 'Saving the flow…' : 'Flow capture finished.'}</span>
        {state.status === 'idle' && <Button size="sm" onClick={() => window.close()}>Close</Button>}
      </div>
    );
  }

  const paused = state.status === 'paused';
  const elapsed = state.accumulatedMs + (state.status === 'recording' && state.resumedAt ? now - state.resumedAt : 0);
  const pauseBtn = (
    <IconButton tone="dark" size="sm" label={paused ? 'Resume (P)' : 'Pause (P)'} icon={paused ? <Play size={15} /> : <Pause size={15} />}
      onClick={() => run(sendToBackground({ target: 'background', type: 'flow/command', command: paused ? 'resume' : 'pause' }))} />
  );
  const captureBtn = (
    <Button size="sm" variant="primary" icon={state.busy ? <Spinner size={13} /> : <Camera size={15} />} disabled={paused || state.busy} onClick={capture} className={flash ? styles.flash : undefined}>
      Capture
    </Button>
  );

  if (state.minimized) {
    return (
      <div className={`${styles.bar} ${styles.barMini}`} role="toolbar" aria-label="Flow capture">
        <span className={`${styles.dot} ${paused ? styles.dotPaused : ''}`} />
        <span className={styles.count} aria-label="Images captured">{state.items}</span>
        {captureBtn}
        <IconButton tone="dark" size="sm" label="Expand" icon={<Maximize2 size={14} />} onClick={() => run(sendToBackground({ target: 'background', type: 'flow/minimize', minimized: false }))} />
      </div>
    );
  }

  return (
    <div className={styles.barWrap} role="toolbar" aria-label="Flow capture">
      <div className={styles.barRow}>
        <span className={`${styles.dot} ${paused ? styles.dotPaused : ''}`} />
        <strong className={styles.barTitle}>{paused ? 'Paused' : 'Flow capture'}</strong>
        <span className={styles.barInfo}>{formatDuration(elapsed)}</span>
        <span className={styles.barInfo} aria-label="Captured">{state.items} image{state.items === 1 ? '' : 's'}{state.steps ? ` · ${state.steps} step${state.steps === 1 ? '' : 's'}` : ''}</span>
        <span className={styles.flex} />
        <IconButton tone="dark" size="sm" label="Minimize" icon={<Minimize2 size={14} />} onClick={() => run(sendToBackground({ target: 'background', type: 'flow/minimize', minimized: true }))} />
      </div>
      <div className={styles.barRow}>
        <div className={styles.modes} role="radiogroup" aria-label="Capture mode">
          {FLOW_MODES.map((m, i) => (
            <button key={m.mode} type="button" role="radio" aria-checked={current === m.mode} title={`${m.label} (${i + 1})`} aria-label={m.label}
              className={current === m.mode ? styles.modeOn : styles.mode} onClick={() => setMode(m.mode)}>
              {m.icon}
            </button>
          ))}
        </div>
        {captureBtn}
        {pauseBtn}
        <IconButton tone="dark" size="sm" label="Undo last capture (Ctrl+Z)" icon={<Undo2 size={15} />} disabled={!state.items} onClick={() => run(sendToBackground({ target: 'background', type: 'flow/undo' }))} />
        <span className={styles.flex} />
        <IconButton tone="danger" size="sm" label="Cancel flow" icon={<X size={15} />}
          onClick={() => (state.items ? setConfirmCancel(true) : run(sendToBackground({ target: 'background', type: 'flow/command', command: 'cancel' }), () => window.close()))} />
        <Button size="sm" icon={<Check size={15} />} title={state.items ? 'Finish and open the Flow Editor' : 'Nothing captured yet — stop without saving'}
          onClick={() => run(sendToBackground({ target: 'background', type: 'flow/command', command: 'finish' }), state.items ? undefined : () => window.close())}>
          {state.items ? 'Finish' : 'Stop'}
        </Button>
      </div>
      <div className={styles.barStatus} aria-live="polite">
        {confirmCancel ? (
          <span className={styles.confirm} role="alertdialog" aria-label="Cancel this flow?">
            Delete all {state.items} image{state.items === 1 ? '' : 's'} of this flow?
            <Button size="sm" onClick={() => setConfirmCancel(false)}>Keep</Button>
            <Button size="sm" variant="danger" onClick={() => { setConfirmCancel(false); run(sendToBackground({ target: 'background', type: 'flow/command', command: 'cancel' }), () => window.close()); }}>Delete flow</Button>
          </span>
        ) : error ? <span className={styles.barError}>{error}</span> : state.limited ? 'Only this site can be captured (access to other sites was not granted).' : state.lastStep ?? `Mode: ${FLOW_MODES.find((m) => m.mode === current)?.label}. Browse anywhere and press Capture.`}
      </div>
    </div>
  );
}
