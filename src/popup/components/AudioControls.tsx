import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Camera, CameraOff, Check, ChevronDown, Mic, MicOff, PanelsTopLeft, Volume2, VolumeX } from 'lucide-react';
import type { CameraBackground, RecordingSettings } from '@/shared/types';
import { Tooltip } from '@/shared/components/Tooltip';
import { Select } from '@/shared/components/Dropdown';
import { ColorSwatches, Slider, ToggleSwitch, RadioGroup } from '@/shared/components/FormControls';
import { Button, IconButton } from '@/shared/components/Button';
import { LevelMeter } from '@/recording/services/audio-service';
import { getCameraStream, getMicStream, stopStream } from '@/recording/services/media-stream-service';
import { openPermissionPage, type MediaDevicesState } from '../hooks/useMediaDevices';
import { NO_BACKGROUND, processCameraTrack } from '@/recording/services/camera-background';
import { CAMERA_BG_IMAGE_KEY } from '@/shared/constants/camera';
import { cameraRect } from '@/recording/services/live-effects';
import styles from '../styles/popup.module.css';

type RecUpdate = (patch: Partial<RecordingSettings>) => void;

interface DeviceProps {
  rec: RecordingSettings;
  update: RecUpdate;
  devices: MediaDevicesState;
  locked?: boolean;
}

/** The camera / microphone settings open as a page of the popup (like Flow Capture), with Back and Done. */
type PageProps = DeviceProps & { onOpenSettings: () => void };
type SettingsPageProps = DeviceProps & { onBack: () => void };

function SplitButton({
  on, onToggle, label, iconOn, iconOff, onMore, moreLabel, disabled,
}: {
  on: boolean; onToggle: () => void; label: string; iconOn: React.ReactNode; iconOff: React.ReactNode;
  onMore: () => void; moreLabel: string; disabled?: boolean;
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
        <button type="button" aria-label={moreLabel} className={styles.splitMore} onClick={onMore}>
          <ChevronDown size={14} />
        </button>
      </Tooltip>
    </div>
  );
}

/* --------------------------------- Camera -------------------------------- */
function useCameraToggle({ rec, update, devices, locked }: DeviceProps) {
  const granted = devices.cameraPermission === 'granted';
  const toggle = () => {
    if (locked) return;
    if (!rec.cameraEnabled && !granted) return openPermissionPage(['camera']);
    update({ cameraEnabled: !rec.cameraEnabled });
  };
  return { on: Boolean(locked || rec.cameraEnabled), granted, toggle };
}

export function CameraControl(p: PageProps) {
  const { on, toggle } = useCameraToggle(p);
  return (
    <SplitButton
      on={on}
      disabled={p.locked}
      onToggle={toggle}
      label={p.locked ? 'Camera (required for Camera Only)' : 'Camera'}
      iconOn={<Camera size={18} />}
      iconOff={<CameraOff size={18} />}
      moreLabel="Camera settings"
      onMore={p.onOpenSettings}
    />
  );
}

/** Camera settings as a page of the popup: on / off, preview, device, resolution and the bubble's look. */
export function CameraSettingsPage(p: SettingsPageProps) {
  const { rec, update, devices, locked, onBack } = p;
  const { toggle } = useCameraToggle(p);
  return (
    <div className={styles.flowSetup}>
      <div className={styles.panelHead}>
        <IconButton label="Back" icon={<ArrowLeft size={18} />} onClick={onBack} />
        Camera
      </div>
      <section className={styles.setupCard} aria-label="Camera">
        <div className={styles.setupRow}>
          <span className={styles.setupText}>
            <span className={styles.setupTitle}>{locked ? 'Camera (Camera Only)' : 'Show my camera'}</span>
            <span className={styles.setupHint}>{locked ? 'Camera Only records your camera' : 'A camera bubble over the recording'}</span>
          </span>
          {!locked && <ToggleSwitch size="sm" checked={rec.cameraEnabled} onChange={() => toggle()} label="Camera overlay" />}
        </div>
      </section>
      <CameraFields rec={rec} update={update} devices={devices} />
      <Button variant="primary" size="lg" icon={<Check size={17} />} onClick={onBack}>Done</Button>
    </div>
  );
}

/** Camera preview, device, resolution and the bubble's look (popup page and Settings). */
export function CameraFields({ rec, update, devices }: DeviceProps) {
  if (devices.cameraPermission !== 'granted') return <PermissionPrompt kind="camera" />;
  return (
        <section className={styles.deviceCard} aria-label="Camera settings">
          <CameraPreview deviceId={rec.cameraDeviceId} rec={rec} update={update} />
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
          <CameraBackgroundFields rec={rec} update={update} />
          <CameraStyleFields rec={rec} update={update} />
        </section>
  );
}

/** Corners and edges: 0 / 1 put the bubble at that edge (with the recorder's small margin). */
const GRID: Array<[number, number]> = [[0, 0], [0.5, 0], [1, 0], [0, 0.5], [0.5, 0.5], [1, 0.5], [0, 1], [0.5, 1], [1, 1]];
const BORDER_COLORS = ['#FFFFFF', '#202938', '#4F8DF7', '#E05252', '#FFD84D', '#24A36A'];

/** Webcam bubble shape, size, position, border, opacity and mirroring (also changeable while recording). */
function CameraStyleFields({ rec, update }: { rec: RecordingSettings; update: RecUpdate }) {
  const cs = rec.cameraStyle;
  const set = (patch: Partial<RecordingSettings['cameraStyle']>) => update({ cameraStyle: { ...cs, ...patch } });
  return (
    <>
      <div className={styles.shapeRow}>
        <div>
          <span className={styles.fieldLabel}>Shape</span>
          <RadioGroup label="Shape" size="sm" value={rec.cameraShape} onChange={(v) => update({ cameraShape: v, cameraStyle: { ...cs, shape: v } })} options={[{ value: 'circle', label: 'Circle' }, { value: 'rounded', label: 'Rounded' }, { value: 'square', label: 'Square' }]} />
        </div>
        <div>
          <span className={styles.fieldLabel}>Position</span>
          <div className={styles.grid9} role="radiogroup" aria-label="Camera position">
            {GRID.map(([x, y]) => {
              const on = Math.abs(cs.x - x) < 0.08 && Math.abs(cs.y - y) < 0.08;
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
function CameraPreview({ deviceId, rec, update }: { deviceId: string; rec: RecordingSettings; update: RecUpdate }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const picture = useBackgroundPicture();
  const bg = useRef<CameraBackground & { image?: string }>(NO_BACKGROUND);
  bg.current = { ...(rec.cameraBackground ?? NO_BACKGROUND), image: picture ?? undefined };
  /** The camera is only turned on when asked (Start live test), never just by opening the page. */
  const [live, setLive] = useState(false);
  useEffect(() => {
    if (!live) return;
    let stream: MediaStream | null = null;
    let alive = true;
    getCameraStream({ enabled: true, deviceId, resolution: '480p', position: 'bottom-left', size: 'medium', shape: 'circle' })
      .then((raw) => {
        if (!alive) return stopStream(raw);
        const track = raw.getVideoTracks()[0];
        const s = track ? new MediaStream([processCameraTrack(track, () => bg.current)]) : raw;
        stream = s;
        if (ref.current) ref.current.srcObject = s;
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Camera unavailable'));
    return () => {
      alive = false;
      stopStream(stream);
    };
  }, [deviceId, live]);
  // The stage's size: the bubble is placed exactly as the recording places it (same size, same
  // margin from the edges).
  const stage = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, [error]);
  /** Where the bubble is while it is being dragged (saved when let go). */
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null);
  const grab = useRef<{ dx: number; dy: number } | null>(null);
  if (error) return <div className={styles.warn}>Camera preview unavailable. {error}</div>;
  const shape = rec.cameraShape;
  const cs = { ...rec.cameraStyle, shape, ...(drag ?? {}) };
  const aspect = rec.cameraResolution === '480p' ? 4 / 3 : 16 / 9;
  const r = size.w ? cameraRect(cs, size.w, size.h, aspect) : null;
  /** Bubble centre (as a share of the stage) for a pointer position, kept inside the frame. */
  const centreAt = (e: React.PointerEvent) => {
    const box = stage.current!.getBoundingClientRect();
    const g = grab.current ?? { dx: 0, dy: 0 };
    return {
      x: Math.round(Math.max(0, Math.min(1, (e.clientX - box.left - g.dx) / box.width)) * 1000) / 1000,
      y: Math.round(Math.max(0, Math.min(1, (e.clientY - box.top - g.dy) / box.height)) * 1000) / 1000,
    };
  };
  return (
    <div ref={stage} className={styles.camStage} aria-label="Camera preview">
      {(
        <div
          className={styles.camBubble}
          title="Drag to place the camera"
          onPointerDown={(e) => {
            if (!r) return;
            e.preventDefault();
            e.currentTarget.setPointerCapture(e.pointerId);
            const box = stage.current!.getBoundingClientRect();
            // Keep the spot that was grabbed under the pointer.
            grab.current = { dx: e.clientX - box.left - (r.x + r.width / 2), dy: e.clientY - box.top - (r.y + r.height / 2) };
            setDrag(centreAt(e));
          }}
          onPointerMove={(e) => { if (grab.current) setDrag(centreAt(e)); }}
          onPointerUp={(e) => {
            if (!grab.current) return;
            const at = centreAt(e);
            grab.current = null;
            setDrag(null);
            // Saved as the centre the recording uses (clamped to the frame like the preview).
            const p = cameraRect({ ...cs, ...at }, size.w, size.h, aspect);
            const m = Math.round(Math.min(size.w, size.h) * 0.02);
            update({ cameraStyle: { ...rec.cameraStyle, x: snapEdge(p.x, p.width, size.w, m), y: snapEdge(p.y, p.height, size.h, m) } });
          }}
          style={{
            left: r?.x ?? 0, top: r?.y ?? 0, width: r?.width ?? 0, height: r?.height ?? 0, visibility: r ? undefined : 'hidden',
            borderRadius: shape === 'circle' ? '50%' : shape === 'rounded' ? '14%' : 0, opacity: cs.opacity,
            border: cs.borderWidth ? `${Math.max(1, cs.borderWidth / 2)}px solid ${cs.borderColor}` : undefined,
            cursor: drag ? 'grabbing' : 'grab',
          }}
        >
          <video ref={ref} autoPlay muted playsInline aria-label="Camera preview video" style={{ transform: cs.mirror ? 'scaleX(-1)' : undefined, visibility: live ? undefined : 'hidden' }} />
          {!live && <span className={styles.camIdle} aria-hidden><CameraOff size={18} /></span>}
        </div>
      )}
      {live ? (
        <button type="button" className={styles.camStop} onClick={() => setLive(false)}>
          <CameraOff size={14} aria-hidden /> Stop test
        </button>
      ) : (
        <button type="button" className={styles.camStart} onClick={() => { setError(null); setLive(true); }}>
          <Camera size={16} aria-hidden /> Start live test
        </button>
      )}
    </div>
  );
}

/**
 * The position to save along one axis: a bubble against an edge is stored as 0 / 1 (so it stays
 * at that edge at any size); otherwise its centre as a share of the frame.
 */
function snapEdge(start: number, length: number, total: number, margin: number): number {
  if (start <= margin + 1) return 0;
  if (start + length >= total - margin - 1) return 1;
  return Math.round(((start + length / 2) / total) * 1000) / 1000;
}

/* ------------------------------- Microphone ------------------------------ */
function useMicToggle({ rec, update, devices }: DeviceProps) {
  const granted = devices.micPermission === 'granted';
  const toggle = () => {
    if (!rec.micEnabled && !granted) return openPermissionPage(['microphone']);
    update({ micEnabled: !rec.micEnabled });
  };
  return { granted, toggle };
}

export function MicControl(p: PageProps) {
  const { toggle } = useMicToggle(p);
  return (
    <SplitButton
      on={p.rec.micEnabled}
      onToggle={toggle}
      label="Microphone"
      iconOn={<Mic size={18} />}
      iconOff={<MicOff size={18} />}
      moreLabel="Microphone settings"
      onMore={p.onOpenSettings}
    />
  );
}

/** Microphone settings as a page of the popup: on / off, device, level and test, volume, clean-up. */
export function MicSettingsPage(p: SettingsPageProps) {
  const { rec, update, devices, onBack } = p;
  const { toggle } = useMicToggle(p);
  return (
    <div className={styles.flowSetup}>
      <div className={styles.panelHead}>
        <IconButton label="Back" icon={<ArrowLeft size={18} />} onClick={onBack} />
        Microphone
      </div>
      <section className={styles.setupCard} aria-label="Microphone">
        <div className={styles.setupRow}>
          <span className={styles.setupText}>
            <span className={styles.setupTitle}>Record my voice</span>
            <span className={styles.setupHint}>The microphone is recorded with the video</span>
          </span>
          <ToggleSwitch size="sm" checked={rec.micEnabled} onChange={() => toggle()} label="Microphone" />
        </div>
      </section>
      <MicFields rec={rec} update={update} devices={devices} />
      <Button variant="primary" size="lg" icon={<Check size={17} />} onClick={onBack}>Done</Button>
    </div>
  );
}

/** Microphone device, live level and test, volume and clean-up (popup page and Settings). */
export function MicFields({ rec, update, devices }: DeviceProps) {
  if (devices.micPermission !== 'granted') return <PermissionPrompt kind="microphone" />;
  return (
        <section className={styles.deviceCard} aria-label="Microphone settings">
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
        </section>
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
        Pixora needs one-time access to your {kind}. Chrome shows the request on a separate page.
      </div>
      <Button variant="primary" size="sm" onClick={() => openPermissionPage([kind])}>
        Grant {kind} access
      </Button>
    </div>
  );
}

/* ------------------------------- Control bar ----------------------------- */
/**
 * System sound (what the computer plays) in screen / window / tab recordings. For a screen, Chrome's
 * share dialog also shows "Share system audio", which must stay ticked.
 */
export function SystemSoundToggle({ rec, update }: { rec: RecordingSettings; update: RecUpdate }) {
  const camera = rec.mode === 'camera';
  const on = rec.systemAudio && !camera;
  const tip = camera
    ? 'System sound: not used for Camera Only recordings'
    : `System sound: ${on ? 'on' : 'off'}${on && rec.mode === 'desktop' ? ' — keep “Share system audio” ticked in Chrome’s share dialog' : ''}`;
  return (
    <div className={styles.split}>
      <Tooltip content={tip}>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-label="System sound"
          disabled={camera}
          className={`${styles.splitMain} ${on ? styles.splitOn : ''}`}
          onClick={() => update({ systemAudio: !rec.systemAudio })}
        >
          {on ? <Volume2 size={18} /> : <VolumeX size={18} />}
        </button>
      </Tooltip>
    </div>
  );
}

export function ControlBarToggle({ rec, update }: { rec: RecordingSettings; update: RecUpdate }) {
  return (
    <div className={styles.controlBarBox}>
      <PanelsTopLeft size={18} className={styles.controlBarIcon} aria-hidden />
      <span id="cb-label">Control Bar</span>
      <ToggleSwitch checked={rec.controlBar} onChange={(v) => update({ controlBar: v })} label="Show floating control bar while recording" />
    </div>
  );
}

/* --------------------------- camera background --------------------------- */

/** The custom background picture (its own storage key), kept up to date. */
function useBackgroundPicture(): string | null {
  const [pic, setPic] = useState<string | null>(null);
  useEffect(() => {
    void chrome.storage.local.get(CAMERA_BG_IMAGE_KEY).then((r) => setPic(typeof r[CAMERA_BG_IMAGE_KEY] === 'string' ? (r[CAMERA_BG_IMAGE_KEY] as string) : null)).catch(() => undefined);
    const onChange = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'local' && CAMERA_BG_IMAGE_KEY in changes) setPic((changes[CAMERA_BG_IMAGE_KEY]!.newValue as string | undefined) ?? null);
    };
    chrome.storage.onChanged.addListener(onChange);
    return () => chrome.storage.onChanged.removeListener(onChange);
  }, []);
  return pic;
}

/** A picture scaled to at most 1280 × 720 as a JPEG data URL (small enough to keep and to record with). */
async function toBackgroundPicture(source: Blob | OffscreenCanvas): Promise<string> {
  const bmp = source instanceof Blob ? await createImageBitmap(source) : null;
  const w0 = bmp ? bmp.width : (source as OffscreenCanvas).width;
  const h0 = bmp ? bmp.height : (source as OffscreenCanvas).height;
  const s = Math.min(1, 1280 / w0, 720 / h0);
  const c = new OffscreenCanvas(Math.round(w0 * s), Math.round(h0 * s));
  c.getContext('2d')!.drawImage(bmp ?? (source as OffscreenCanvas), 0, 0, c.width, c.height);
  bmp?.close();
  const blob = await c.convertToBlob({ type: 'image/jpeg', quality: 0.88 });
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

/** Ready-made backgrounds, drawn here (no image files to download). */
const PRESETS: Array<{ id: string; label: string; stops: string[]; glow?: string }> = [
  { id: 'lavender', label: 'Lavender', stops: ['#EDE9FE', '#C4B5FD', '#8B5CF6'], glow: 'rgba(255,255,255,0.55)' },
  { id: 'studio', label: 'Studio grey', stops: ['#F3F4F6', '#9CA3AF', '#374151'], glow: 'rgba(255,255,255,0.6)' },
  { id: 'ocean', label: 'Ocean', stops: ['#CFFAFE', '#38BDF8', '#1E3A8A'], glow: 'rgba(255,255,255,0.45)' },
  { id: 'sunset', label: 'Sunset', stops: ['#FEF3C7', '#FB923C', '#BE185D'], glow: 'rgba(255,255,255,0.45)' },
  { id: 'night', label: 'Night', stops: ['#1E1B4B', '#312E81', '#0F172A'], glow: 'rgba(129,140,248,0.35)' },
];

function presetCanvas(p: (typeof PRESETS)[number]): OffscreenCanvas {
  const c = new OffscreenCanvas(1280, 720);
  const x = c.getContext('2d')!;
  const g = x.createLinearGradient(0, 0, 1280, 720);
  p.stops.forEach((col, i) => g.addColorStop(i / (p.stops.length - 1), col));
  x.fillStyle = g;
  x.fillRect(0, 0, 1280, 720);
  if (p.glow) {
    const r = x.createRadialGradient(420, 260, 0, 420, 260, 620);
    r.addColorStop(0, p.glow);
    r.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = r;
    x.fillRect(0, 0, 1280, 720);
  }
  return c;
}

const BG_COLOURS = ['#E8E4F5', '#FFFFFF', '#F3F4F6', '#111827', '#00B140', '#2563EB', '#8B5CF6', '#F59E0B'];

/** Background: none, blur, remove, a colour or a picture (a ready-made one or the user's own). */
function CameraBackgroundFields({ rec, update }: { rec: RecordingSettings; update: RecUpdate }) {
  const bg = rec.cameraBackground ?? NO_BACKGROUND;
  const set = (patch: Partial<CameraBackground>) => update({ cameraBackground: { ...bg, ...patch } });
  const picture = useBackgroundPicture();
  const file = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const usePicture = async (source: Blob | OffscreenCanvas) => {
    setBusy(true);
    try {
      await chrome.storage.local.set({ [CAMERA_BG_IMAGE_KEY]: await toBackgroundPicture(source) });
      set({ mode: 'image' });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <span className={styles.fieldLabel}>Background</span>
      <RadioGroup<CameraBackground['mode']> label="Camera background" size="sm" value={bg.mode} onChange={(mode) => set({ mode })}
        options={[
          { value: 'none', label: 'None' },
          { value: 'blur', label: 'Blur' },
          { value: 'remove', label: 'Remove' },
          { value: 'color', label: 'Colour' },
          { value: 'image', label: 'Picture' },
        ]} />
      {bg.mode === 'blur' && (
        <Slider label="Background blur" min={4} max={30} value={bg.blur} format={(v) => `${v}px`} onChange={(blur) => set({ blur })} />
      )}
      {(bg.mode === 'color' || bg.mode === 'remove') && (
        <div style={{ display: 'grid', gap: 6 }}>
          <span className={styles.fieldLabel}>{bg.mode === 'remove' ? 'Colour in Camera Only recordings' : 'Background colour'}</span>
          <ColorSwatches label="Background colour" colors={BG_COLOURS} value={bg.color} onChange={(color) => set({ color })} alpha={false} />
        </div>
      )}
      {bg.mode === 'image' && (
        <div style={{ display: 'grid', gap: 8 }}>
          <div className={styles.bgPresets} role="group" aria-label="Background pictures">
            {PRESETS.map((p) => (
              <button key={p.id} type="button" aria-label={`Background: ${p.label}`} title={p.label} disabled={busy}
                style={{ background: `linear-gradient(135deg, ${p.stops.join(', ')})` }} onClick={() => void usePicture(presetCanvas(p))} />
            ))}
            <button type="button" className={styles.bgOwn} disabled={busy} onClick={() => file.current?.click()} aria-label="Choose your own background picture">
              Your picture…
            </button>
          </div>
          {picture && <img src={picture} alt="Current background picture" className={styles.bgCurrent} />}
          <input ref={file} type="file" accept="image/png,image/jpeg,image/webp" hidden aria-label="Background picture file"
            onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void usePicture(f); }} />
        </div>
      )}
      <span className={styles.lineHint}>
        {bg.mode === 'remove'
          ? 'Only you are shown in the camera bubble (the screen shows around you); Camera Only recordings get the colour above.'
          : bg.mode === 'none' ? 'Blur, remove or replace what is behind you. It runs on this computer; good light works best.' : 'Runs on this computer — the camera picture never leaves it. Good light works best.'}
      </span>
    </div>
  );
}

