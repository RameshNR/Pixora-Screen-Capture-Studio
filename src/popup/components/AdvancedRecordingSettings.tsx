import { useMemo, type ReactNode } from 'react';
import { ArrowLeft, Keyboard } from 'lucide-react';
import type { RecordingSettings, ScheduleSettings, Settings } from '@/shared/types';
import { IconButton, Button } from '@/shared/components/Button';
import { Select } from '@/shared/components/Dropdown';
import { RadioGroup, Slider, TextField, ToggleSwitch } from '@/shared/components/FormControls';
import { COUNTDOWN_OPTIONS, MAX_DURATION_OPTIONS } from '@/shared/constants/media';
import { buildCandidates } from '@/recording/services/codec-service';
import styles from '../styles/popup.module.css';
import { ClickHighlightFields } from '@/shared/components/ClickHighlightFields';
import { MovingCursorFields } from '@/shared/components/MovingCursorFields';

interface Props {
  settings: Settings;
  updateRec: (patch: Partial<RecordingSettings>) => void;
  updateSchedule: (patch: Partial<ScheduleSettings>) => void;
  onBack: () => void;
}

function Line({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className={styles.line}>
      <span className={styles.lineLabel}>
        {label}
        {hint && <span className={styles.lineHint}>{hint}</span>}
      </span>
      {children}
    </div>
  );
}


/** Click ring / ripple / pulse style, colours, size, opacity and duration. */
function ClickEffectFields({ rec, updateRec }: { rec: RecordingSettings; updateRec: (patch: Partial<RecordingSettings>) => void }) {
  return <ClickHighlightFields fx={rec.cursorEffects} onChange={(patch) => updateRec({ cursorEffects: { ...rec.cursorEffects, ...patch } })} />;
}

function codecSupported(container: 'webm' | 'mp4', codec: 'vp9' | 'vp8' | 'av1' | 'h264'): boolean {
  if (typeof MediaRecorder === 'undefined') return false;
  return buildCandidates(container, codec, 'auto', false).some((c) => c.video === codec && MediaRecorder.isTypeSupported(c.mime));
}

export function AdvancedRecordingSettings({ settings, updateRec, updateSchedule, onBack }: Props) {
  const rec = settings.recording;
  const schedule = settings.schedule;
  const support = useMemo(
    () => ({
      vp9: codecSupported(rec.container, 'vp9'),
      vp8: codecSupported(rec.container, 'vp8'),
      av1: codecSupported(rec.container, 'av1'),
      h264: codecSupported(rec.container, 'h264'),
    }),
    [rec.container],
  );
  const customDuration = !MAX_DURATION_OPTIONS.includes(rec.maxDurationMinutes);
  const customCountdown = !COUNTDOWN_OPTIONS.includes(rec.countdownSeconds);

  return (
    <div>
      <div className={styles.panelHead}>
        <IconButton label="Back" icon={<ArrowLeft size={18} />} onClick={onBack} />
        Recording settings
      </div>
      <div className={styles.panelBody}>
        <div className={styles.group}>
          <div className={styles.groupTitle}>Video</div>
          <Line label="Frame rate" hint={(rec.resolution === '2160p' || rec.resolution === '4320p') && rec.fps === 60 ? `${rec.resolution === '4320p' ? '8K' : '4K'} at 60 fps depends on your hardware` : undefined}>
            <RadioGroup label="Frame rate" size="sm" value={rec.fps} onChange={(v) => updateRec({ fps: v })} options={[15, 24, 30, 60].map((f) => ({ value: f as 15 | 24 | 30 | 60, label: String(f) }))} />
          </Line>
          <Line label="Video codec">
            <Select
              label="Video codec"
              value={rec.videoCodec}
              minWidth={230}
              onChange={(v) => updateRec({ videoCodec: v })}
              options={[
                { value: 'auto', label: 'Auto (best available)' },
                { value: 'vp9', label: 'VP9', disabled: !support.vp9, description: support.vp9 ? 'Efficient, sharp text' : `Not available for ${rec.container.toUpperCase()}` },
                { value: 'vp8', label: 'VP8', disabled: !support.vp8, description: support.vp8 ? 'Fast, widely compatible' : `Not available for ${rec.container.toUpperCase()}` },
                { value: 'h264', label: 'H.264', disabled: !support.h264, description: support.h264 ? 'Best compatibility' : `Not available for ${rec.container.toUpperCase()}` },
                { value: 'av1', label: 'AV1', disabled: !support.av1, description: support.av1 ? 'Smallest files, CPU heavy' : 'Not available here' },
              ]}
            />
          </Line>
          <div>
            <div className={styles.line}>
              <span className={styles.lineLabel}>Video bitrate</span>
              <ToggleSwitch size="sm" label="Automatic video bitrate" checked={rec.videoBitrateKbps === 0} onChange={(auto) => updateRec({ videoBitrateKbps: auto ? 0 : 8000 })} />
            </div>
            <span className={styles.lineHint}>{rec.videoBitrateKbps === 0 ? 'Automatic — scales with resolution and frame rate' : ''}</span>
            {rec.videoBitrateKbps > 0 && (
              <Slider label="Mbps" min={1000} max={250000} step={500} value={rec.videoBitrateKbps} format={(v) => `${(v / 1000).toFixed(1)} Mbps`} onChange={(v) => updateRec({ videoBitrateKbps: v })} />
            )}
          </div>
        </div>

        <div className={styles.group}>
          <div className={styles.groupTitle}>Desktop</div>
          <Line label="Without taskbar" hint="Crop whole-screen recordings to leave out the taskbar / dock">
            <ToggleSwitch size="sm" label="Record without taskbar" checked={rec.excludeTaskbar} onChange={(v) => updateRec({ excludeTaskbar: v })} />
          </Line>
        </div>

        <div className={styles.group}>
          <div className={styles.groupTitle}>Audio</div>
          <Line label="Record system / tab audio" hint="Desktop: tick “Share audio” in Chrome’s picker">
            <ToggleSwitch size="sm" label="Record system audio" checked={rec.systemAudio} onChange={(v) => updateRec({ systemAudio: v })} />
          </Line>
          <Line label="Audio bitrate">
            <Select label="Audio bitrate" value={rec.audioBitrateKbps} minWidth={140} onChange={(v) => updateRec({ audioBitrateKbps: v })} options={[64, 96, 128, 192, 256, 320].map((b) => ({ value: b, label: `${b} kbps` }))} />
          </Line>
          <Line label="Audio codec">
            <Select
              label="Audio codec"
              value={rec.audioCodec}
              minWidth={200}
              onChange={(v) => updateRec({ audioCodec: v })}
              options={[
                { value: 'auto', label: 'Auto' },
                { value: 'opus', label: 'Opus' },
                { value: 'aac', label: 'AAC', disabled: rec.container !== 'mp4', description: rec.container !== 'mp4' ? 'MP4 only' : undefined },
              ]}
            />
          </Line>
        </div>

        <div className={styles.group}>
          <div className={styles.groupTitle}>Timing</div>
          <Line label="Countdown">
            <Select
              label="Countdown"
              value={customCountdown ? -1 : rec.countdownSeconds}
              minWidth={150}
              onChange={(v) => updateRec({ countdownSeconds: v === -1 ? 20 : v })}
              options={[...COUNTDOWN_OPTIONS.map((s) => ({ value: s, label: s === 0 ? 'Off' : `${s} seconds` })), { value: -1, label: customCountdown ? `Custom (${rec.countdownSeconds}s)` : 'Custom…' }]}
            />
          </Line>
          {customCountdown && (
            <TextField type="number" min={1} max={60} value={rec.countdownSeconds} suffix="seconds" aria-label="Custom countdown" onChange={(e) => updateRec({ countdownSeconds: Number(e.target.value) || 0 })} />
          )}
          <Line label="Maximum duration">
            <Select
              label="Maximum duration"
              value={customDuration ? -1 : rec.maxDurationMinutes}
              minWidth={150}
              onChange={(v) => updateRec({ maxDurationMinutes: v === -1 ? 45 : v })}
              options={[...MAX_DURATION_OPTIONS.map((m) => ({ value: m, label: m === 0 ? 'No limit' : `${m} minutes` })), { value: -1, label: customDuration ? `Custom (${rec.maxDurationMinutes} min)` : 'Custom…' }]}
            />
          </Line>
          {customDuration && (
            <TextField type="number" min={1} max={600} value={rec.maxDurationMinutes} suffix="minutes" aria-label="Custom maximum duration" onChange={(e) => updateRec({ maxDurationMinutes: Number(e.target.value) || 0 })} />
          )}
          <Line label="Scheduled recording" hint="Starts automatically at the chosen time">
            <ToggleSwitch size="sm" label="Scheduled recording" checked={schedule.enabled} onChange={(v) => updateSchedule({ enabled: v })} />
          </Line>
          {schedule.enabled && (
            <>
              <Line label="Start">
                <input className={styles.dateInput} type="datetime-local" value={schedule.startAt} onChange={(e) => updateSchedule({ startAt: e.target.value })} aria-label="Start time" />
              </Line>
              <Line label="End" hint="Optional — sets the duration">
                <input className={styles.dateInput} type="datetime-local" value={schedule.endAt} onChange={(e) => updateSchedule({ endAt: e.target.value })} aria-label="End time" />
              </Line>
              <Line label="Source">
                <Select
                  label="Scheduled source"
                  value={schedule.mode}
                  minWidth={240}
                  onChange={(v) => updateSchedule({ mode: v })}
                  options={[
                    { value: 'camera', label: 'Camera Only', description: 'Starts fully automatically' },
                    { value: 'desktop', label: 'Desktop', description: 'Chrome asks you to pick a screen at start time' },
                    { value: 'tab', label: 'This Tab', description: 'Only if the tab is still open and unchanged' },
                  ]}
                />
              </Line>
              <div className={styles.lineHint}>
                Chrome requires a user action before screen or tab capture, so Desktop and Tab schedules may need one click when they start. Chrome must be running at the scheduled time.
              </div>
            </>
          )}
        </div>

        <div className={styles.group}>
          <div className={styles.groupTitle}>Overlays</div>
          <Line label="Highlight mouse clicks" hint="Shows an effect where you click — on every page and tab you visit while recording">
            <ToggleSwitch size="sm" label="Highlight mouse clicks" checked={rec.highlightClicks} onChange={(v) => updateRec({ highlightClicks: v })} />
          </Line>
          {rec.highlightClicks && <ClickEffectFields rec={rec} updateRec={updateRec} />}
          <Line label="Mouse cursor between clicks" hint="Clicks are shown by Highlight mouse clicks; this follows the mouse between them">
            <span />
          </Line>
          <MovingCursorFields fx={rec.cursorEffects} onChange={(patch) => updateRec({ cursorEffects: { ...rec.cursorEffects, ...patch } })} />
          <Line label="Show keyboard shortcuts" hint="Only key combos, never typed text or passwords">
            <ToggleSwitch size="sm" label="Show keyboard shortcuts" checked={rec.highlightKeys} onChange={(v) => updateRec({ highlightKeys: v })} />
          </Line>
          <Line label="Camera overlay">
            <ToggleSwitch size="sm" label="Camera overlay" checked={rec.cameraEnabled} onChange={(v) => updateRec({ cameraEnabled: v })} />
          </Line>
          <Line label="Microphone">
            <ToggleSwitch size="sm" label="Microphone" checked={rec.micEnabled} onChange={(v) => updateRec({ micEnabled: v })} />
          </Line>
          <Line label="Control bar position">
            <Select
              label="Control bar position"
              value={rec.controlBarPosition}
              minWidth={170}
              onChange={(v) => updateRec({ controlBarPosition: v })}
              options={[
                { value: 'top-left', label: 'Top left' },
                { value: 'top-center', label: 'Top center' },
                { value: 'top-right', label: 'Top right' },
                { value: 'bottom-left', label: 'Bottom left' },
                { value: 'bottom-center', label: 'Bottom center' },
                { value: 'bottom-right', label: 'Bottom right' },
              ]}
            />
          </Line>
          <div className={styles.lineHint}>
            Mouse cursor: desktop recordings always include the cursor; Chrome never draws it in tab recordings — turn on click highlights to show interactions.
          </div>
        </div>

        <div className={styles.group}>
          <div className={styles.groupTitle}>Zoom & spotlight</div>
          <Line label="Auto zoom on click" hint="Tab recordings: zooms in where you click, then back out">
            <ToggleSwitch size="sm" label="Auto zoom on click" checked={rec.zoom.autoOnClick} onChange={(v) => updateRec({ zoom: { ...rec.zoom, autoOnClick: v } })} />
          </Line>
          <Slider label="Zoom level" min={1.25} max={4} step={0.25} value={rec.zoom.level} format={(v) => `${v}×`} onChange={(v) => updateRec({ zoom: { ...rec.zoom, level: v } })} />
          <Slider label="Transition" min={150} max={2000} step={50} value={rec.zoom.transitionMs} format={(v) => `${(v / 1000).toFixed(2)} s`} onChange={(v) => updateRec({ zoom: { ...rec.zoom, transitionMs: v } })} />
          <Slider label="Stay zoomed for" min={500} max={6000} step={100} value={rec.zoom.holdMs} format={(v) => `${(v / 1000).toFixed(1)} s`} onChange={(v) => updateRec({ zoom: { ...rec.zoom, holdMs: v } })} />
          <Line label="Easing">
            <Select
              label="Zoom easing"
              value={rec.zoom.easing}
              minWidth={150}
              onChange={(easing) => updateRec({ zoom: { ...rec.zoom, easing } })}
              options={[
                { value: 'ease-in-out', label: 'Smooth' },
                { value: 'ease-out', label: 'Ease out' },
                { value: 'linear', label: 'Linear' },
                { value: 'spring', label: 'Spring' },
              ]}
            />
          </Line>
          <Slider label="Spotlight radius" min={0.05} max={0.5} step={0.01} value={rec.spotlight.radius} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => updateRec({ spotlight: { ...rec.spotlight, radius: v } })} />
          <Slider label="Dim background" min={0.1} max={0.9} step={0.05} value={rec.spotlight.dim} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => updateRec({ spotlight: { ...rec.spotlight, dim: v } })} />
          <div className={styles.lineHint}>Turn zoom, spotlight and region highlight on or off from the control bar while recording. They are drawn into the video.</div>
        </div>

        <div className={styles.group}>
          <div className={styles.groupTitle}>Saving</div>
          <div>
            <span className={styles.fieldLabel}>File name</span>
            <TextField value={rec.filenamePattern} onChange={(e) => updateRec({ filenamePattern: e.target.value })} aria-label="Recording file name pattern" />
            <span className={styles.lineHint}>Tokens: {'{date} {time} {title} {host} {timestamp}'}</span>
          </div>
          <Line label="Download automatically" hint="Saves to your downloads when recording stops">
            <ToggleSwitch size="sm" label="Download automatically" checked={rec.autoSave} onChange={(v) => updateRec({ autoSave: v })} />
          </Line>
          <Button size="sm" icon={<Keyboard size={15} />} onClick={() => void chrome.tabs.create({ url: 'chrome://extensions/shortcuts' })}>
            Pause / resume / stop hotkeys…
          </Button>
        </div>
      </div>
    </div>
  );
}
