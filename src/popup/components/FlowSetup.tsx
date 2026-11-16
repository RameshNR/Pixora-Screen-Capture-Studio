import { useEffect, useState, type ReactNode } from 'react';
import { AppWindow, ArrowLeft, Camera, Check, Crop, Monitor, PanelsTopLeft, ScrollText, ShieldCheck, Workflow } from 'lucide-react';
import type { FlowCaptureMode, FlowSettings, FlowState, Settings } from '@/shared/types';
import { errorInfoOf, onBroadcast, sendToBackground } from '@/shared/messaging/client';
import { Button, IconButton } from '@/shared/components/Button';
import { RadioGroup, ToggleSwitch } from '@/shared/components/FormControls';
import { useToast } from '@/shared/components/Toast';
import { FlowAutoOptions } from '@/flow/components/FlowAutoOptions';
import styles from '../styles/popup.module.css';

export const FLOW_MODE_OPTIONS: Array<{ value: FlowCaptureMode; label: string; short: string; description: string }> = [
  { value: 'visible', label: 'Visible Part', short: 'Visible', description: 'What you see in the tab' },
  { value: 'full', label: 'Full Page', short: 'Full page', description: 'The whole scrolling page' },
  { value: 'area', label: 'Selected Area', short: 'Area', description: 'Drag a region each time' },
  { value: 'screen', label: 'Full Screen', short: 'Screen', description: 'Chrome asks which screen to capture' },
  { value: 'window', label: 'Application Window', short: 'Window', description: 'Chrome asks which window to capture' },
];

const MODE_ICONS: Record<FlowCaptureMode, ReactNode> = {
  visible: <AppWindow size={17} />,
  full: <ScrollText size={17} />,
  area: <Crop size={17} />,
  screen: <Monitor size={17} />,
  window: <PanelsTopLeft size={17} />,
};

/**
 * Asks for access to all sites so the flow can follow you to other pages (optional host
 * permission; must be requested from a user click). Returns false when the user declines.
 */
export async function requestFlowAccess(): Promise<boolean> {
  try {
    // Called directly from the click (no await before it), so Chrome sees the user gesture.
    // Resolves true at once when access was granted before.
    return await chrome.permissions.request({ origins: ['<all_urls>'] });
  } catch {
    return false;
  }
}

export function useFlowSession(): FlowState | null {
  const [state, setState] = useState<FlowState | null>(null);
  useEffect(() => {
    void sendToBackground<FlowState>({ target: 'background', type: 'flow/get-state' }).then(setState).catch(() => undefined);
    return onBroadcast((m) => {
      if (m.type === 'flow/state') setState(m.state);
    });
  }, []);
  return state;
}

interface Props {
  settings: Settings;
  tabId: number | undefined;
  onBack: () => void;
  updateFlow: (patch: Partial<FlowSettings>) => void;
}

/**
 * The "Auto steps" and "Form values" cards: the same settings and layout for screenshot flows and
 * for Flow Capture during recordings (one shared set of settings).
 */
export function FlowOptionCards({ flow: f, updateFlow }: { flow: FlowSettings; updateFlow: (patch: Partial<FlowSettings>) => void }) {
  return (
    <>
      <section className={styles.setupCard} aria-label="Automatic steps">
        <div className={styles.setupRow}>
          <span className={styles.setupText}>
            <span className={styles.setupTitle}>Auto steps</span>
            <span className={styles.setupHint}>Also take screenshots at clicks, dropdowns, form fields and page changes</span>
          </span>
          <ToggleSwitch size="sm" label="Auto steps" checked={f.autoSteps} onChange={(autoSteps) => updateFlow({ autoSteps })} />
        </div>
        {f.autoSteps && (
          <div className={styles.setupMore}>
            <FlowAutoOptions flow={f} update={updateFlow} />
          </div>
        )}
      </section>

      <section className={styles.setupCard} aria-label="Privacy">
        <span className={styles.setupTitle}>Form values in the step list</span>
        <RadioGroup label="Form values" size="sm" value={f.values} onChange={(values) => updateFlow({ values })} options={[{ value: 'non-sensitive', label: 'Keep ordinary values' }, { value: 'never', label: 'Never keep values' }]} />
        <span className={styles.setupHint}>
          <ShieldCheck size={13} className={styles.inlineIcon} aria-hidden /> Passwords, one-time codes, card and account numbers are always masked. Everything stays on this computer.
        </span>
      </section>
    </>
  );
}

/** Flow Capture options for recordings: its own screen, laid out like the screenshot Flow Capture setup. */
export function FlowRecordingOptions({ settings, camera = false, onBack, updateFlow }: { settings: Settings; camera?: boolean; onBack: () => void; updateFlow: (patch: Partial<FlowSettings>) => void }) {
  const f = settings.flow;
  const on = camera ? f.withRecording && f.inCameraMode : f.withRecording;
  return (
    <div className={styles.flowSetup}>
      <div className={styles.panelHead}>
        <IconButton label="Back" icon={<ArrowLeft size={18} />} onClick={onBack} />
        Flow Capture
      </div>
      <p className={styles.flowIntro}>
        While you record, Pixora lists every step (clicks, form fields, page changes) and takes a screenshot of each, the same way as a screenshot Flow Capture. These settings are shared with it.
      </p>
      <section className={styles.setupCard} aria-label="Flow Capture with recordings">
        <div className={styles.setupRow}>
          <span className={styles.setupText}>
            <span className={styles.setupTitle}>{camera ? 'Flow Capture during Camera Only' : 'Flow Capture with recordings'}</span>
            <span className={styles.setupHint}>{camera ? 'Track the page you were on while recording your camera' : 'Track the browser flow while recording a tab, area or desktop'}</span>
          </span>
          <ToggleSwitch
            size="sm"
            label="Flow Capture with this recording"
            checked={on}
            onChange={(next) => {
              updateFlow(camera ? { withRecording: next || f.withRecording, inCameraMode: next } : { withRecording: next, autoSteps: next ? true : f.autoSteps });
              // Ask for all-sites access while turning it on (needs this click); declining keeps flows to the recorded site.
              if (next) void requestFlowAccess();
            }}
          />
        </div>
      </section>
      {on && <FlowOptionCards flow={f} updateFlow={updateFlow} />}
      <Button variant="primary" size="lg" icon={<Check size={17} />} onClick={onBack}>Done</Button>
    </div>
  );
}

/** Flow Capture setup: capture mode, automatic steps and privacy, then Start. */
export function FlowSetup({ settings, tabId, onBack, updateFlow }: Props) {
  const toast = useToast();
  const f = settings.flow;
  const [starting, setStarting] = useState(false);

  async function start() {
    if (tabId === undefined) return;
    setStarting(true);
    try {
      // Chrome's access prompt closes this popup: the background starts the flow as soon as access
      // is granted. If the popup survives (access granted before, or declined), it starts it here.
      const armed = sendToBackground({ target: 'background', type: 'flow/arm', tabId, config: { ...f, area: null } });
      const access = requestFlowAccess();
      await armed;
      await access;
      await sendToBackground({ target: 'background', type: 'flow/start-armed' });
      window.close();
    } catch (err) {
      toast.error(errorInfoOf(err));
    } finally {
      setStarting(false);
    }
  }

  return (
    <div className={styles.flowSetup}>
      <div className={styles.panelHead}>
        <IconButton label="Back" icon={<ArrowLeft size={18} />} onClick={onBack} />
        Flow Capture
      </div>
      <p className={styles.flowIntro}>
        Take a series of screenshots across pages and sites. A small toolbar stays open while you browse: press <strong>Capture</strong> for each step, then <strong>Finish</strong> to edit and export.
      </p>

      <section className={styles.setupCard} aria-label="Capture mode">
        <span className={styles.setupTitle}>Capture mode</span>
        <div className={styles.flowModes} role="radiogroup" aria-label="Flow capture mode">
          {FLOW_MODE_OPTIONS.map((m) => (
            <button key={m.value} type="button" role="radio" aria-checked={f.mode === m.value} aria-label={m.label} title={`${m.label} — ${m.description}`}
              className={f.mode === m.value ? styles.flowModeOn : styles.flowMode} onClick={() => updateFlow({ mode: m.value })}>
              {MODE_ICONS[m.value]}
              <span>{m.short}</span>
            </button>
          ))}
        </div>
        <span className={styles.setupHint}>{FLOW_MODE_OPTIONS.find((m) => m.value === f.mode)?.description}</span>
      </section>

      <FlowOptionCards flow={f} updateFlow={updateFlow} />

      <Button variant="primary" size="lg" icon={<Workflow size={17} />} loading={starting} disabled={tabId === undefined} onClick={() => void start()}>
        Start Flow Capture
      </Button>
      <p className={styles.setupFoot}>Chrome may ask to let Pixora read other sites, so the flow can follow you to other pages. If you decline, only this site is captured.</p>
    </div>
  );
}

/** Shown in the popup while a flow is running. */
export function FlowRunning({ state }: { state: FlowState }) {
  const toast = useToast();
  const send = (p: Promise<unknown>) => p.catch((err: unknown) => toast.error(errorInfoOf(err)));
  return (
    <div className={styles.flowRunning} role="status">
      <Workflow size={17} />
      <span style={{ flex: 1 }}>
        <strong>Flow Capture {state.status === 'paused' ? 'paused' : 'running'}</strong>
        <span className={styles.lineHint}>{state.items} image{state.items === 1 ? '' : 's'}{state.steps ? ` · ${state.steps} steps` : ''}</span>
      </span>
      <Button size="sm" icon={<Camera size={14} />} disabled={state.status !== 'recording'} onClick={() => { void send(sendToBackground({ target: 'background', type: 'flow/capture', mode: state.config?.mode ?? 'visible' })).then(() => window.close()); }}>
        Capture
      </Button>
      <Button size="sm" variant="primary" icon={<Check size={14} />} onClick={() => { void send(sendToBackground({ target: 'background', type: 'flow/command', command: 'finish' })).then(() => window.close()); }}>
        Finish
      </Button>
    </div>
  );
}
