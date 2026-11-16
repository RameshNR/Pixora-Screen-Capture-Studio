import { useEffect, useRef, useState } from 'react';
import { Camera, CameraOff, ChevronDown, Mic, MicOff, PanelsTopLeft } from 'lucide-react';
import type { RecordingSettings } from '@/shared/types';
import { Tooltip } from '@/shared/components/Tooltip';
import { Select } from '@/shared/components/Dropdown';
import { Slider, ToggleSwitch, RadioGroup } from '@/shared/components/FormControls';
import { Button } from '@/shared/components/Button';
import { LevelMeter } from '@/recording/services/audio-service';
import { getCameraStream, getMicStream, stopStream } from '@/recording/services/media-stream-service';
import { openPermissionPage, type MediaDevicesState } from '../hooks/useMediaDevices';
import { AnchoredPopover } from './AnchoredPopover';
import styles from '../styles/popup.module.css';

type RecUpdate = (patch: Partial<RecordingSettings>) => void;

interface DeviceProps {
  rec: RecordingSettings;
  update: RecUpdate;
  devices: MediaDevicesState;
  locked?: boolean;
}

function SplitButton({
  on, onToggle, label, iconOn, iconOff, onMore, moreLabel, disabled,
}: {
  on: boolean; onToggle: () => void; label: string; iconOn: React.ReactNode; iconOff: React.ReactNode;
  onMore: (rect: DOMRect) => void; moreLabel: string; disabled?: boolean;
}) {
  return (
    <div className={styles.split}>
      <Tooltip content={`${label}: ${on ? 'on' : 'off'}`}>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-label={label}
          disabled={disabled}
          className={`${styles.splitMain} ${on ? styles.splitOn : ''}`}
          onClick={onToggle}
        >
          {on ? iconOn : iconOff}
        </button>
      </Tooltip>
      <Tooltip content={moreLabel}>
        <button type="button" aria-label={moreLabel} aria-haspopup="dialog" className={styles.splitMore} onClick={(e) => onMore(e.currentTarget.parentElement!.getBoundingClientRect())}>
          <ChevronDown size={14} />
        </button>
      </Tooltip>
    </div>
  );
}

/* --------------------------------- Camera -------------------------------- */
export function CameraControl({ rec, update, devices, locked }: DeviceProps) {
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const on = locked || rec.cameraEnabled;
  const granted = devices.cameraPermission === 'granted';

  const toggle = () => {
    if (locked) return;
    if (!rec.cameraEnabled && !granted) return openPermissionPage(['camera']);
    update({ cameraEnabled: !rec.cameraEnabled });
  };

  return (
    <>
      <SplitButton
        on={on}
        disabled={locked}
        onToggle={toggle}
        label={locked ? 'Camera (required for Camera Only)' : 'Camera'}
        iconOn={<Camera size={18} />}
        iconOff={<CameraOff size={18} />}
        moreLabel="Camera settings"
        onMore={setAnchor}
      />
      {anchor && (
        <AnchoredPopover anchor={anchor} onClose={() => setAnchor(null)} label="Camera settings">
          <div className={styles.popTitle}>
            Camera
            {!locked && <ToggleSwitch size="sm" checked={rec.cameraEnabled} onChange={() => toggle()} label="Camera overlay" />}
          </div>
          {!granted ? (
            <PermissionPrompt kind="camera" />
          ) : (
            <>
              <CameraPreview deviceId={rec.cameraDeviceId} rec={rec} />
              <div>
                <span className={styles.fieldLabel}>Device</span>
                <Select
                  label="Camera device"
                  value={rec.cameraDeviceId}
                  onChange={(v) => update({ cameraDeviceId: v })}
                  options={[{ value: 'default', label: 'System default' }, ...devices.cameras.map((d) => ({ value: d.deviceId, label: d.label }))]}
                />
              </div>
              <div>
                <span className={styles.fieldLabel}>Camera resolution</span>
                <RadioGroup label="Camera resolution" size="sm" value={rec.cameraResolution} onChange={(v) => update({ cameraResolution: v })} options={[{ value: '480p', label: '480p' }, { value: '720p', label: '720p' }, { value: '1080p', label: '1080p' }]} />
              </div>
              <CameraStyleFields rec={rec} update={update} />
            </>
          )}
        </AnchoredPopover>
      )}
    </>
  );
}

const GRID: Array<[number, number]> = [[0.12, 0.18], [0.5, 0.18], [0.88, 0.18], [0.12, 0.5], [0.5, 0.5], [0.88, 0.5], [0.12, 0.82], [0.5, 0.82], [0.88, 0.82]];
const BORDER_COLORS = ['#FFFFFF', '#202938', '#4F8DF7', '#E05252', '#FFD84D', '#24A36A'];

/** Webcam bubble shape, size, position, border, opacity and mirroring (also changeable while recording). */
function CameraStyleFields({ rec, update }: { rec: RecordingSettings; update: RecUpdate }) {
  const cs = rec.cameraStyle;
  const set = (patch: Partial<RecordingSettings['cameraStyle']>) => update({ cameraStyle: { ...cs, ...patch } });
  return (
    <>
      <div style={{ display: 'flex', gap: 12, alignItems: 'end' }}>
        <div style={{ flex: 1 }}>
          <span className={styles.fieldLabel}>Shape</span>
          <RadioGroup label="Shape" size="sm" value={rec.cameraShape} onChange={(v) => update({ cameraShape: v, cameraStyle: { ...cs, shape: v } })} options={[{ value: 'circle', label: 'Circle' }, { value: 'rounded', label: 'Rounded' }, { value: 'square', label: 'Square' }]} />
        </div>
        <div>
          <span className={styles.fieldLabel}>Position</span>
          <div className={styles.grid9} role="radiogroup" aria-label="Camera position">
            {GRID.map(([x, y]) => {
              const on = Math.abs(cs.x - x) < 0.05 && Math.abs(cs.y - y) < 0.05;
              return <button key={`${x}-${y}`} type="button" role="radio" aria-checked={on} aria-label={`Position ${Math.round(x * 100)}%, ${Math.round(y * 100)}%`} className={on ? styles.cellOn : styles.cell} onClick={() => set({ x, y })} />;
            })}
          </div>
        </div>
      </div>
      <Slider label="Size" min={8} max={50} value={cs.sizePct} format={(v) => `${v}%`} onChange={(sizePct) => set({ sizePct })} />
      <Slider label="Camera opacity" min={0.2} max={1} step={0.05} value={cs.opacity} format={(v) => `${Math.round(v * 100)}%`} onChange={(opacity) => set({ opacity })} />
      <Slider label="Border" min={0} max={16} value={cs.borderWidth} format={(v) => (v ? `${v}px` : 'None')} onChange={(borderWidth) => set({ borderWidth })} />
      {cs.borderWidth > 0 && (
        <div style={{ display: 'flex', gap: 6 }} role="radiogroup" aria-label="Border colour">
          {BORDER_COLORS.map((c) => (
            <button key={c} type="button" role="radio" aria-checked={cs.borderColor === c} aria-label={`Border ${c}`} onClick={() => set({ borderColor: c })}
              style={{ width: 20, height: 20, borderRadius: '50%', background: c, border: '1px solid var(--c-border-strong)', outline: cs.borderColor === c ? '2px solid var(--c-primary)' : undefined, outlineOffset: 2, cursor: 'pointer' }} />
          ))}
        </div>
      )}
      <div className={styles.inlineToggle}>
        Mirror (selfie view)
        <ToggleSwitch size="sm" checked={cs.mirror} onChange={(mirror) => set({ mirror })} label="Mirror camera" />
      </div>
      <span className={styles.lineHint}>The bubble can be moved, resized and restyled from the control bar while recording.</span>
    </>
  );
}

/** Live preview of the bubble as it will appear over the recording. */
function CameraPreview({ deviceId, rec }: { deviceId: string; rec: RecordingSettings }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let stream: MediaStream | null = null;
    let alive = true;
    getCameraStream({ enabled: true, deviceId, resolution: '480p', position: 'bottom-left', size: 'medium', shape: 'circle' })
      .then((s) => {
        if (!alive) return stopStream(s);
        stream = s;
        if (ref.current) ref.current.srcObject = s;
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Camera unavailable'));
    return () => {
      alive = false;
      stopStream(stream);
    };
  }, [deviceId]);
  if (error) return <div className={styles.warn}>Camera preview unavailable. {error}</div>;
  const cs = rec.cameraStyle;
  const shape = rec.cameraShape;
  const h = cs.sizePct;
  return (
    <div className={styles.camStage} aria-label="Camera preview">
      <div
        className={styles.camBubble}
        style={{
          left: `${cs.x * 100}%`, top: `${cs.y * 100}%`, height: `${h * (16 / 9)}%`, aspectRatio: shape === 'circle' ? '1' : '4 / 3',
          borderRadius: shape === 'circle' ? '50%' : shape === 'rounded' ? '14%' : 0, opacity: cs.opacity,
          border: cs.borderWidth ? `${Math.max(1, cs.borderWidth / 2)}px solid ${cs.borderColor}` : undefined,
        }}
      >
        <video ref={ref} autoPlay muted playsInline aria-label="Camera preview video" style={{ transform: cs.mirror ? 'scaleX(-1)' : undefined }} />
      </div>
    </div>
  );
}

/* ------------------------------- Microphone ------------------------------ */
export function MicControl({ rec, update, devices }: DeviceProps) {
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const granted = devices.micPermission === 'granted';
  const toggle = () => {
    if (!rec.micEnabled && !granted) return openPermissionPage(['microphone']);
    update({ micEnabled: !rec.micEnabled });
  };
  return (
    <>
      <SplitButton
        on={rec.micEnabled}
        onToggle={toggle}
        label="Microphone"
        iconOn={<Mic size={18} />}
        iconOff={<MicOff size={18} />}
        moreLabel="Microphone settings"
        onMore={setAnchor}
      />
      {anchor && (
        <AnchoredPopover anchor={anchor} onClose={() => setAnchor(null)} label="Microphone settings">
          <div className={styles.popTitle}>
            Microphone
            <ToggleSwitch size="sm" checked={rec.micEnabled} onChange={() => toggle()} label="Microphone" />
          </div>
          {!granted ? (
            <PermissionPrompt kind="microphone" />
          ) : (
            <>
              <div>
                <span className={styles.fieldLabel}>Device</span>
                <Select
                  label="Microphone device"
                  value={rec.micDeviceId}
                  onChange={(v) => update({ micDeviceId: v })}
                  options={[{ value: 'default', label: 'System default' }, ...devices.microphones.filter((d) => d.deviceId !== 'default').map((d) => ({ value: d.deviceId, label: d.label }))]}
                />
              </div>
              <MicLevel rec={rec} devices={devices} />
              <Slider label="Volume" min={0} max={2} step={0.05} value={rec.micVolume} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => update({ micVolume: v })} />
              <div className={styles.inlineToggle}>
                Noise suppression
                <ToggleSwitch size="sm" checked={rec.noiseSuppression} onChange={(v) => update({ noiseSuppression: v })} label="Noise suppression" />
              </div>
              <div className={styles.inlineToggle}>
                Echo cancellation
                <ToggleSwitch size="sm" checked={rec.echoCancellation} onChange={(v) => update({ echoCancellation: v })} label="Echo cancellation" />
              </div>
            </>
          )}
        </AnchoredPopover>
      )}
    </>
  );
}

/** Live input level with warnings (muted, disconnected, very quiet) and a record-and-play-back test. */
function MicLevel({ rec, devices }: { rec: RecordingSettings; devices: MediaDevicesState }) {
  const [level, setLevel] = useState(0);
  const [problem, setProblem] = useState<string | null>(null);
  const [quietMs, setQuietMs] = useState(0);
  const [testing, setTesting] = useState<'idle' | 'recording' | 'playing'>('idle');
  const streamRef = useRef<MediaStream | null>(null);
  useEffect(() => {
    let stream: MediaStream | null = null;
    let meter: LevelMeter | null = null;
    let raf = 0;
    let alive = true;
    let last = performance.now();
    let quiet = 0;
    setProblem(null);
    getMicStream({ enabled: true, deviceId: rec.micDeviceId, volume: 1, noiseSuppression: rec.noiseSuppression, echoCancellation: rec.echoCancellation })
      .then((s) => {
        if (!alive) return stopStream(s);
        stream = s;
        streamRef.current = s;
        const track = s.getAudioTracks()[0];
        track?.addEventListener('ended', () => setProblem('The microphone was disconnected.'));
        track?.addEventListener('mute', () => setProblem('The microphone is muted by the system or another app.'));
        track?.addEventListener('unmute', () => setProblem(null));
        meter = new LevelMeter(s);
        const loop = () => {
          const now = performance.now();
          const l = meter ? Math.min(1, meter.level() * rec.micVolume) : 0;
          quiet = l < 0.015 ? quiet + (now - last) : 0;
          last = now;
          setLevel(l);
          setQuietMs(quiet);
          raf = requestAnimationFrame(loop);
        };
        loop();
      })
      .catch((err: unknown) => setProblem(err instanceof Error && err.name === 'NotFoundError' ? 'No microphone found. Plug one in or pick another device.' : 'The microphone is unavailable (in use by another app or blocked).'));
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      void meter?.close();
      stopStream(stream);
      streamRef.current = null;
    };
  }, [rec.micDeviceId, rec.noiseSuppression, rec.echoCancellation, rec.micVolume]);

  const selectedMissing = rec.micDeviceId !== 'default' && devices.microphones.length > 0 && !devices.microphones.some((d) => d.deviceId === rec.micDeviceId);
  const warning = selectedMissing
    ? 'The selected microphone is not connected. “System default” will be used.'
    : problem ?? (rec.micVolume === 0 ? 'Volume is set to 0%.' : quietMs > 3000 ? 'Very low input — speak, or check the microphone and its volume.' : null);

  async function test() {
    const s = streamRef.current;
    if (!s) return;
    setTesting('recording');
    const rec2 = new MediaRecorder(s);
    const parts: Blob[] = [];
    rec2.ondataavailable = (e) => e.data.size && parts.push(e.data);
    rec2.start();
    await new Promise((r) => setTimeout(r, 3000));
    await new Promise<void>((resolve) => { rec2.onstop = () => resolve(); rec2.stop(); });
    setTesting('playing');
    const url = URL.createObjectURL(new Blob(parts, { type: rec2.mimeType }));
    const audio = new Audio(url);
    audio.onended = () => { URL.revokeObjectURL(url); setTesting('idle'); };
    await audio.play().catch(() => setTesting('idle'));
  }

  return (
    <div style={{ display: 'grid', gap: 6 }}>
      <span className={styles.fieldLabel}>Input level</span>
      <div className={styles.meter} role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(level * 100)} aria-label="Microphone level">
        <div className={styles.meterFill} style={{ width: `${level * 100}%` }} />
      </div>
      {warning ? <div className={styles.audioWarn} role="alert">{warning}</div> : level > 0.05 ? <span className={styles.audioOk}>Microphone is picking up sound.</span> : null}
      <Button size="sm" onClick={() => void test()} disabled={testing !== 'idle' || Boolean(problem)}>
        {testing === 'recording' ? 'Recording 3 seconds… speak now' : testing === 'playing' ? 'Playing back…' : 'Test microphone (record & play back)'}
      </Button>
    </div>
  );
}

function PermissionPrompt({ kind }: { kind: 'camera' | 'microphone' }) {
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <div className={styles.lineHint}>
        Pixora needs one-time access to your {kind}. Chrome shows the request on a separate page because extension popups can’t display it.
      </div>
      <Button variant="primary" size="sm" onClick={() => openPermissionPage([kind])}>
        Grant {kind} access
      </Button>
    </div>
  );
}

/* ------------------------------- Control bar ----------------------------- */
export function ControlBarToggle({ rec, update }: { rec: RecordingSettings; update: RecUpdate }) {
  return (
    <div className={styles.controlBarBox}>
      <PanelsTopLeft size={18} className={styles.controlBarIcon} aria-hidden />
      <span id="cb-label">Control Bar</span>
      <ToggleSwitch checked={rec.controlBar} onChange={(v) => update({ controlBar: v })} label="Show floating control bar while recording" />
    </div>
  );
}
