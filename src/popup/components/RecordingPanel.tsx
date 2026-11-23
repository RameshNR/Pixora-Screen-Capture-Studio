import { useState } from 'react';
import { AppWindow, ChevronRight, FileVideo, Monitor, ScrollText, SquareDashed, SquareUserRound, Workflow, X } from 'lucide-react';
import { RadioGroup } from '@/shared/components/FormControls';

import type { RecordingMode, RecordingSettings, RecordingState, Settings } from '@/shared/types';
import { errorInfoOf, sendToBackground } from '@/shared/messaging/client';
import { PrimaryButton } from '@/shared/components/Button';
import { useToast } from '@/shared/components/Toast';
import { buildRecordingConfig, modeUsesTabCapture } from '@/recording/services/config';
import { isBusy } from '@/recording/services/recording-state';
import type { ActiveTabInfo } from '../hooks/useActiveTab';
import { openPermissionPage, useMediaDevices } from '../hooks/useMediaDevices';
import { ActionRow, FeatureRow, RecordingModeCard } from './CaptureModeCard';
import { FlowRecordingOptions, requestFlowAccess } from './FlowSetup';
import { CameraControl, CameraSettingsPage, ControlBarToggle, MicControl, MicSettingsPage, SystemSoundToggle } from './AudioControls';
import { RecordingToolbar } from './RecordingToolbar';
import { ActiveRecording, command } from './ActiveRecording';
import styles from '../styles/popup.module.css';

interface Props {
  settings: Settings;
  updateRec: (patch: Partial<RecordingSettings>) => void;
  updateFlow: (patch: Partial<Settings['flow']>) => void;
  activeTab: ActiveTabInfo;
  state: RecordingState;
  onMore: () => void;
}

const MODES: Array<{ mode: RecordingMode; label: string; icon: JSX.Element; hint: string }> = [
  { mode: 'desktop', label: 'Desktop', icon: <Monitor size={26} strokeWidth={1.7} />, hint: 'Entire screen, an app window or another tab' },
  { mode: 'camera', label: 'Camera Only', icon: <SquareUserRound size={26} strokeWidth={1.7} />, hint: 'Record yourself with the webcam' },
  { mode: 'tab', label: 'This Tab', icon: <AppWindow size={26} strokeWidth={1.7} />, hint: 'Record this browser tab with its audio' },
  { mode: 'area', label: 'Custom Area', icon: <SquareDashed size={26} strokeWidth={1.7} />, hint: 'Record a selected region of this tab or of a screen' },
];

export function RecordingPanel({ settings, updateRec, updateFlow, activeTab, state, onMore }: Props) {
  const [flowOptions, setFlowOptions] = useState(false);
  const [devicePage, setDevicePage] = useState<'camera' | 'mic' | null>(null);
  const toast = useToast();
  const devices = useMediaDevices();
  const [starting, setStarting] = useState(false);
  const rec = settings.recording;
  const busy = isBusy(state);
  const tabBlocked = modeUsesTabCapture(rec.mode, rec.areaSource) && !activeTab.capturable;

  async function start() {
    const needCamera = rec.mode === 'camera' || rec.cameraEnabled;
    const missing: Array<'camera' | 'microphone'> = [];
    if (needCamera && devices.cameraPermission !== 'granted') missing.push('camera');
    if (rec.micEnabled && devices.micPermission !== 'granted') missing.push('microphone');
    if (missing.length) return openPermissionPage(missing);

    setStarting(true);
    try {
      const config = buildRecordingConfig(rec, {}, { experimental: settings.advanced.experimental, flow: settings.flow.withRecording ? settings.flow : undefined });
      const started = sendToBackground({ target: 'background', type: 'recording/start', config, tabId: activeTab.tab?.id ?? null });
      // Flow Capture follows every page only with all-sites access: ask in this click (no await
      // before it). Resolves at once when granted before; declining keeps it to the first page.
      // Click highlights (and keys, cursor) follow you to the next page and other tabs only with
      // access to those pages; same request as Flow Capture (declining keeps them on the first page).
      if (config.flow || config.highlightClicks || config.highlightKeys || config.cursorEffects.cursor || config.cursorEffects.pointer) void requestFlowAccess();
      await started;
      // Tab modes: close the popup so the page (and the area selector) is usable.
      if (modeUsesTabCapture(rec.mode, rec.areaSource)) window.close();
    } catch (err) {
      toast.error(errorInfoOf(err));
    } finally {
      setStarting(false);
    }
  }

  const flowOn = rec.mode === 'camera' ? settings.flow.withRecording && settings.flow.inCameraMode : settings.flow.withRecording;
  if (devicePage === 'camera') return <CameraSettingsPage rec={rec} update={updateRec} devices={devices} locked={rec.mode === 'camera'} onBack={() => setDevicePage(null)} />;
  if (devicePage === 'mic') return <MicSettingsPage rec={rec} update={updateRec} devices={devices} onBack={() => setDevicePage(null)} />;
  if (flowOptions) return <FlowRecordingOptions settings={settings} camera={rec.mode === 'camera'} onBack={() => setFlowOptions(false)} updateFlow={updateFlow} />;

  return (
    <>
      {/* While recording, its live status comes first (above the source choices). */}
      {busy && <ActiveRecording state={state} />}
      <div className={styles.cards2} role="radiogroup" aria-label="Recording source">
        {MODES.map((m) => (
          <RecordingModeCard
            key={m.mode}
            icon={m.icon}
            label={m.label}
            hint={m.hint}
            selected={rec.mode === m.mode}
            disabled={busy}
            onSelect={() => updateRec({ mode: m.mode })}
          />
        ))}
      </div>

      {rec.mode === 'area' && (
        <div className={styles.areaSource}>
          <span>Area of</span>
          <RadioGroup
            label="Custom area source"
            size="sm"
            value={rec.areaSource}
            onChange={(areaSource) => updateRec({ areaSource })}
            options={[
              { value: 'tab', label: 'This tab' },
              { value: 'screen', label: 'A screen / window' },
            ]}
          />
        </div>
      )}

      <div className={styles.deviceRow}>
        <CameraControl rec={rec} update={updateRec} devices={devices} locked={rec.mode === 'camera'} onOpenSettings={() => setDevicePage('camera')} />
        <MicControl rec={rec} update={updateRec} devices={devices} onOpenSettings={() => setDevicePage('mic')} />
        <SystemSoundToggle rec={rec} update={updateRec} />
        <ControlBarToggle rec={rec} update={updateRec} />
      </div>
      {rec.mode === 'desktop' && (
        <div className={styles.tip}>
          Recording a whole screen? Chrome shows a “sharing your screen” bar — click <b>Hide</b> on it during the countdown so it isn’t recorded.
          {rec.systemAudio ? <> Keep <b>Share system audio</b> ticked in Chrome’s dialog for sound.</> : null}
        </div>
      )}

      <RecordingToolbar rec={rec} update={updateRec} onMore={onMore} />

      {/* Same as the Screenshot tab: the Flow Capture button opens its settings screen. */}
      <FeatureRow
        icon={<Workflow size={18} />}
        label="Flow Capture"
        description={flowOn ? `On · ${settings.flow.autoSteps ? 'step screenshots while you record' : 'steps listed, no screenshots'}` : rec.mode === 'camera' ? 'Off · track browser steps during Camera Only' : 'Off · step-by-step screenshots while you record'}
        badge={flowOn ? 'On' : 'New'}
        onClick={() => setFlowOptions(true)}
      />

      {state.status === 'error' && state.error && (
        <div className={styles.errorBox} role="alert">
          <div style={{ flex: 1 }}>
            <strong>{state.error.title}</strong>
            {state.error.message} {state.error.recovery}
          </div>
          <button type="button" aria-label="Dismiss" style={{ border: 0, background: 'none', color: 'inherit' }} onClick={() => command('cancel')}>
            <X size={16} />
          </button>
        </div>
      )}

      {tabBlocked && !busy && (
        <div className={styles.warn}>Chrome doesn’t allow recording this page as a tab. Choose Desktop to record it.</div>
      )}

      {!busy && (
        <>
          <PrimaryButton size="lg" block className={styles.startBtn} loading={starting} disabled={tabBlocked} onClick={() => void start()} icon={<span className={styles.startDot} />}>
            Start Recording
          </PrimaryButton>
          <ActionRow
            icon={<ScrollText size={17} />}
            label="Teleprompter"
            onClick={() => {
              void sendToBackground({ target: 'background', type: 'teleprompter/open' });
              window.close();
            }}
            trailing={<ChevronRight size={15} />}
          />
          <ActionRow
            icon={<FileVideo size={17} />}
            label="Edit a Video File"
            onClick={() => {
              void chrome.tabs.create({ url: chrome.runtime.getURL('video.html?import=1') });
              window.close();
            }}
            trailing={<ChevronRight size={15} />}
          />
        </>
      )}
    </>
  );
}
