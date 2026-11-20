import { intervalLabel, SHOT_DELAY_OPTIONS } from '@/flow/components/FlowAutoOptions';
import { useEffect, useState } from 'react';
import {
  Activity, AppWindow, ArrowDownUp, AudioLines, AudioWaveform, Bell, Binary, Bug, CalendarClock, Camera, CircleDot, Clapperboard, Clipboard, Clock, Command, Cpu, Crosshair, Download, Eraser, ExternalLink, FileImage, FileText, FileVideo, Film, FlaskConical, Folder, FolderDown, FolderOpen, FolderSearch, FolderTree, Frame, Gauge, HardDrive, History, Hourglass, Image, Images, Keyboard, Languages, LayoutGrid, LayoutList, Maximize, Mic, Monitor, MonitorPlay, MousePointer2, MousePointerClick, MoveVertical, Paintbrush, Palette, PanelBottom, PanelLeft, PanelRight, PanelTop, PenTool, RotateCcw, Scaling, ScrollText, Settings2, ShieldCheck, SlidersHorizontal, Sparkles, SquareDashed, SquarePen, SunMoon, Timer, Trash2, Video, Volume2, Webcam, Workflow, Wrench, Zap,
} from 'lucide-react';
import { DEFAULT_SETTINGS } from '@/shared/constants/defaults';
import type { DeepPartial, Settings } from '@/shared/types';
import { SettingRow, SettingsPage, SettingsSection } from '@/shared/components/Settings';
import { Select } from '@/shared/components/Dropdown';
import { RadioGroup, Slider, TextField, ToggleSwitch } from '@/shared/components/FormControls';
import { Button } from '@/shared/components/Button';
import { ConfirmationDialog } from '@/shared/components/Modal';
import { ThemePicker } from './ThemePicker';
import { ClickHighlightFields } from '@/shared/components/ClickHighlightFields';
import { useToast } from '@/shared/components/Toast';
import { COUNTDOWN_OPTIONS, MAX_DURATION_OPTIONS, RESOLUTION_LABELS, SCREENSHOT_DELAY_OPTIONS } from '@/shared/constants/media';
import { buildFilename } from '@/shared/utils/filename';
import { formatBytes } from '@/shared/utils/format';
import { sendToBackground } from '@/shared/messaging/client';
import type { RecordingState } from '@/shared/types';
import { clearAllCaptures, clearTemporaryData, getStorageUsage, type StorageUsage } from '@/history/history-service';
import { listDevices, type MediaDeviceOption } from '@/recording/services/media-stream-service';
import { CaptureOnPicker } from '@/flow/components/CaptureOnPicker';
import { resetSettings } from '../settings-service';
import { repairDatabase, storageHealthy } from '@/shared/storage/idb';
import { canPickFolder, folderPermission, getSaveFolder, pickSaveFolder } from '@/shared/utils/save-folder';

type Update = (patch: DeepPartial<Settings>) => Promise<void>;

/** Clears leftovers from interrupted recordings, never the recording in progress. */
async function clearTemp(): Promise<void> {
  const state = await sendToBackground<RecordingState>({ target: 'background', type: 'recording/get-state' }).catch(() => null);
  await clearTemporaryData(state?.sessionId ?? null);
}
interface Props {
  settings: Settings;
  update: Update;
}

function FilenamePreview({ pattern, type }: { pattern: string; type: 'Screenshot' | 'Recording' }) {
  return (
    <span style={{ color: 'var(--c-text-secondary)', fontSize: 12 }}>
      Preview: {buildFilename(pattern, { type, title: 'Example page', url: 'https://example.com', extension: type === 'Screenshot' ? 'png' : 'webm' })}
    </span>
  );
}

/** "Reset to defaults" for one settings page (asks first; other pages are kept). */
function ResetPage({ section, title, update }: { section: 'general' | 'screenshot' | 'recording' | 'flow' | 'storage' | 'advanced'; title: string; update: Update }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" icon={<RotateCcw size={14} />} onClick={() => setOpen(true)}>Reset to defaults</Button>
      <ConfirmationDialog
        open={open}
        title={`Reset ${title} settings?`}
        message={section === 'storage'
          ? 'Storage settings return to their defaults (files are saved to Downloads again). Your captures are not deleted.'
          : `The ${title} settings on this page return to their defaults. Other settings and your captures are not changed.`}
        confirmLabel="Reset"
        onCancel={() => setOpen(false)}
        onConfirm={async () => {
          setOpen(false);
          await update({ [section]: structuredClone(DEFAULT_SETTINGS[section]) } as DeepPartial<Settings>);
          toast.success(`${title} settings reset`);
        }}
      />
    </>
  );
}

/* --------------------------------- General -------------------------------- */
export function GeneralSection({ settings, update }: Props) {
  const g = settings.general;
  return (
    <SettingsPage title="General" icon={<Settings2 size={26} />} actions={<ResetPage section="general" title="General" update={update} />} description="Appearance, the popup and file names for everything Pixora saves.">
      <SettingsSection title="Theme" icon={<Palette size={22} />} description="Colours for every Pixora window: the popup, editors, the video page, Flow Editor, settings and helper windows.">
      <SettingRow label="Theme" icon={<SunMoon size={18} />} hint="9 dark and 9 light themes. Changes apply to open windows straight away." stacked>
        <ThemePicker value={g.theme} onChange={(theme) => void update({ general: { theme } })} />
      </SettingRow>
      </SettingsSection>
      <SettingsSection title="Popup & language" icon={<AppWindow size={22} />}>
      <SettingRow label="Popup opens on" icon={<AppWindow size={18} />} hint="Which tab is shown when you click the toolbar icon.">
        <Select label="Popup opens on" value={g.defaultTab} onChange={(defaultTab) => void update({ general: { defaultTab } })} options={[{ value: 'last', label: 'Last used tab' }, { value: 'screenshot', label: 'Screenshot' }, { value: 'record', label: 'Record' }]} />
      </SettingRow>
      <SettingRow label="Language" icon={<Languages size={18} />} hint="More languages are planned.">
        <Select label="Language" value={g.language} onChange={(language) => void update({ general: { language } })} options={[{ value: 'auto', label: 'Browser default (English)' }, { value: 'en', label: 'English' }]} />
      </SettingRow>
      </SettingsSection>
      <SettingsSection title="File names" icon={<FileText size={22} />} description="Used for screenshots; recordings have their own under Recording.">
      <SettingRow label="Default file name" icon={<FileText size={18} />} hint={<FilenamePreview pattern={g.filenamePattern} type="Screenshot" />} stacked>
        <TextField value={g.filenamePattern} onChange={(e) => void update({ general: { filenamePattern: e.target.value } })} aria-label="Default file name pattern" />
        <span style={{ fontSize: 12, color: 'var(--c-text-secondary)' }}>Tokens: {'{type} {date} {time} {timestamp} {title} {host} {yyyy} {mm} {dd} {hh} {min} {ss}'}</span>
      </SettingRow>
      </SettingsSection>
      <SettingsSection title="Notifications" icon={<Bell size={22} />}>
      <SettingRow label="Notifications" icon={<Bell size={18} />} hint="System notifications for saved captures, errors and scheduled recordings.">
        <ToggleSwitch label="Notifications" checked={g.notifications} onChange={(notifications) => void update({ general: { notifications } })} />
      </SettingRow>
      </SettingsSection>
    </SettingsPage>
  );
}

/* -------------------------------- Screenshot ------------------------------- */
export function ScreenshotSection({ settings, update }: Props) {
  const s = settings.screenshot;
  const set = (patch: DeepPartial<Settings['screenshot']>) => void update({ screenshot: patch });
  return (
    <SettingsPage title="Screenshot" icon={<Camera size={26} />} actions={<ResetPage section="screenshot" title="Screenshot" update={update} />} description="How screenshots are taken, what happens after, and how they are saved.">
      <SettingsSection title="Capture" icon={<Crosshair size={22} />} description="Visible part, full page and selected area.">
      <SettingRow label="Default capture mode" icon={<Crosshair size={18} />} hint="Press Enter in the popup to capture with this mode.">
        <Select label="Default capture mode" value={s.defaultMode} onChange={(defaultMode) => set({ defaultMode })} options={[{ value: 'visible', label: 'Visible part' }, { value: 'full', label: 'Full page' }, { value: 'area', label: 'Selected area' }]} />
      </SettingRow>
      <SettingRow label="Capture delay" icon={<Clock size={18} />} hint="Default for “Visible Part after Delay”.">
        <Select label="Capture delay" value={s.delaySeconds} onChange={(delaySeconds) => set({ delaySeconds })} options={[...new Set([...SCREENSHOT_DELAY_OPTIONS, s.delaySeconds])].sort((a, b) => a - b).map((d) => ({ value: d, label: d === 0 ? 'No delay' : `${d} second${d === 1 ? '' : 's'}` }))} />
      </SettingRow>
      </SettingsSection>
      <SettingsSection title="After capturing" icon={<Zap size={22} />}>
      <SettingRow label="Open the editor after capturing" icon={<SquarePen size={18} />}>
        <ToggleSwitch label="Open editor" checked={s.autoOpenEditor} onChange={(autoOpenEditor) => set({ autoOpenEditor })} />
      </SettingRow>
      <SettingRow label="Save automatically" icon={<Download size={18} />} hint="Downloads every screenshot as soon as it is captured.">
        <ToggleSwitch label="Save automatically" checked={s.autoSave} onChange={(autoSave) => set({ autoSave })} />
      </SettingRow>
      <SettingRow label="Copy to clipboard" icon={<Clipboard size={18} />} hint="Copies the screenshot when the editor opens (Chrome only allows clipboard access from the focused editor page).">
        <ToggleSwitch label="Copy to clipboard" checked={s.copyToClipboard} disabled={!s.autoOpenEditor} onChange={(copyToClipboard) => set({ copyToClipboard })} />
      </SettingRow>
      </SettingsSection>
      <SettingsSection title="Image format & size" icon={<Image size={22} />}>
      <SettingRow label="Default image format" icon={<FileImage size={18} />} hint="Captures are kept lossless; the format is applied when you save.">
        <RadioGroup label="Image format" value={s.format} onChange={(format) => set({ format })} options={[{ value: 'png', label: 'PNG' }, { value: 'jpeg', label: 'JPEG' }, { value: 'webp', label: 'WebP' }]} />
      </SettingRow>
      {s.format !== 'png' && (
        <SettingRow label="Image quality" icon={<Gauge size={18} />} hint={`${s.format === 'jpeg' ? 'JPEG' : 'WebP'} is compressed: higher keeps more detail (PNG is always lossless).`}>
          <div style={{ width: 220 }}>
            <Slider hideLabel min={0.1} max={1} step={0.01} value={s.quality} format={(q) => `${Math.round(q * 100)}%`} label="Quality" onChange={(quality) => set({ quality })} />
          </div>
        </SettingRow>
      )}
      <SettingRow label="Image scaling" icon={<Scaling size={18} />} hint="Device pixels keep full HiDPI sharpness; CSS pixels produce smaller images on high-DPI screens.">
        <RadioGroup label="Image scaling" value={s.scale} onChange={(scale) => set({ scale })} options={[{ value: 'device', label: 'Device pixels' }, { value: 'css', label: 'CSS pixels' }]} />
      </SettingRow>
      </SettingsSection>
      <SettingsSection title="Full page" icon={<ScrollText size={22} />} description="Only for Full page screenshots.">
      <SettingRow label="Hide sticky headers & floating elements" icon={<LayoutGrid size={18} />} hint="Prevents fixed headers, chat bubbles and banners from repeating down the page.">
        <ToggleSwitch label="Hide fixed elements" checked={s.fullPage.hideFixedElements} onChange={(hideFixedElements) => set({ fullPage: { hideFixedElements } })} />
      </SettingRow>
      <SettingRow label="Load lazy content first" icon={<Images size={18} />} hint="Scrolls through the page once so lazy-loaded images appear.">
        <ToggleSwitch label="Preload lazy content" checked={s.fullPage.preloadLazyContent} onChange={(preloadLazyContent) => set({ fullPage: { preloadLazyContent } })} />
      </SettingRow>
      <SettingRow label="Scrollable panels" icon={<PanelLeft size={18} />} hint="Pages can have panels that scroll on their own (sidebars, chats, code views). Choose them before each capture, capture only the page, or include every panel.">
        <Select
          label="Scrollable panels"
          value={s.fullPage.scrollAreas}
          onChange={(scrollAreas) => set({ fullPage: { scrollAreas } })}
          options={[
            { value: 'ask', label: 'Ask which to include' },
            { value: 'page', label: 'Page scroll only' },
            { value: 'all', label: 'Include every panel' },
          ]}
        />
      </SettingRow>
      <SettingRow label="Hide scrollbars" icon={<PanelRight size={18} />} hint="The page is measured after they are hidden, so nothing is cut off at the right.">
        <ToggleSwitch label="Hide scrollbars" checked={s.fullPage.hideScrollbars} onChange={(hideScrollbars) => set({ fullPage: { hideScrollbars } })} />
      </SettingRow>
      <SettingRow label="Maximum height" icon={<MoveVertical size={18} />} hint="Very long pages are captured up to this height (you can stop earlier from the popup). Pages too tall for one image are saved as several full-resolution images.">
        <Select label="Maximum height" value={s.fullPage.maxHeight} onChange={(maxHeight) => set({ fullPage: { maxHeight } })} options={[...new Set([20000, 50000, 100000, 200000, 500000, s.fullPage.maxHeight])].sort((a, b) => a - b).map((h) => ({ value: h, label: `${h.toLocaleString()} px` }))} />
      </SettingRow>
      </SettingsSection>
      <SettingsSection title="Browser header & frames" icon={<PanelTop size={22} />} description="Added on top of / around new screenshots.">
      <SettingRow label="Include the real browser header" icon={<AppWindow size={18} />} hint="Your real tabs, address bar and bookmarks on top of visible and full-page screenshots. After each capture, choose this Chrome window in Chrome’s “Choose what to share” dialog.">
        <ToggleSwitch label="Include the real browser header (tabs, address bar, bookmarks)" checked={s.browserHeader} onChange={(browserHeader) => set({ browserHeader })} />
      </SettingRow>
      <SettingRow label="Drawn browser frame on every screenshot" icon={<Frame size={18} />} hint="Off by default. New screenshots open in the editor with an address bar and tab title (all capture modes).">
        <ToggleSwitch label="Drawn browser frame on every screenshot" checked={s.autoFrame.browser} onChange={(browser) => set({ autoFrame: { ...s.autoFrame, browser } })} />
      </SettingRow>
      <SettingRow label="Add background to every screenshot" icon={<Paintbrush size={18} />} hint="Off by default. Padding, background colour and rounded corners, from your last choices in the editor.">
        <ToggleSwitch label="Add background to every screenshot" checked={s.autoFrame.background} onChange={(background) => set({ autoFrame: { ...s.autoFrame, background } })} />
      </SettingRow>
      <SettingRow label="Add border to every screenshot" icon={<SquareDashed size={18} />} hint="Off by default. A border around the image (it comes with the background, as in the editor).">
        <ToggleSwitch label="Add border to every screenshot" checked={s.autoFrame.border} onChange={(border) => set({ autoFrame: { ...s.autoFrame, border } })} />
      </SettingRow>
      </SettingsSection>
      <SettingsSection title="Entire screen & app window" icon={<Monitor size={22} />} description="Only for “Entire Screen & App Window” screenshots.">
      <SettingRow label="Delay after picking" icon={<Timer size={18} />} hint="After you pick the screen or window, a countdown window shows the seconds left; it closes just before the picture.">
        <Select label="Delay after picking" value={Math.max(3, s.desktopDelaySeconds ?? 3)} onChange={(desktopDelaySeconds) => set({ desktopDelaySeconds })}
          options={[3, 5, 10, 15].map((n) => ({ value: n, label: `${n} seconds` }))} />
      </SettingRow>
      <SettingRow label="Leave out the taskbar" icon={<PanelBottom size={18} />} hint="“Entire Screen & App Window” screenshots of a whole screen leave out the taskbar / dock.">
        <ToggleSwitch label="Screen screenshots without taskbar" checked={s.excludeTaskbar} onChange={(excludeTaskbar) => set({ excludeTaskbar })} />
      </SettingRow>
      <SettingRow label="Mouse cursor" icon={<MousePointer2 size={18} />} hint="Chrome’s tab screenshot API never includes the mouse cursor. Use “Entire Screen & App Window” to capture it.">
        <span style={{ color: 'var(--c-text-secondary)', fontSize: 12 }}>Not available for tab screenshots</span>
      </SettingRow>
      </SettingsSection>
    </SettingsPage>
  );
}

/* --------------------------------- Recording ------------------------------- */
export function RecordingSection({ settings, update }: Props) {
  const r = settings.recording;
  const set = (patch: DeepPartial<Settings['recording']>) => void update({ recording: patch });
  const [mics, setMics] = useState<MediaDeviceOption[]>([]);
  const [cams, setCams] = useState<MediaDeviceOption[]>([]);
  useEffect(() => {
    void listDevices('audioinput').then(setMics).catch(() => undefined);
    void listDevices('videoinput').then(setCams).catch(() => undefined);
  }, []);
  return (
    <SettingsPage title="Recording" icon={<Video size={26} />} actions={<ResetPage section="recording" title="Recording" update={update} />} description="Video, audio and on-screen defaults for screen, tab and camera recordings.">
      <SettingsSection title="Video" icon={<Video size={22} />} description="4K needs a 4K source (display, window or tab) and is recorded at the real source pixels.">
      <SettingRow label="Default recording mode" icon={<MonitorPlay size={18} />}>
        <Select label="Recording mode" value={r.mode} onChange={(mode) => set({ mode })} options={[{ value: 'tab', label: 'This tab' }, { value: 'area', label: 'Custom area of this tab' }, { value: 'desktop', label: 'Desktop / window' }, { value: 'camera', label: 'Camera only' }]} />
      </SettingRow>
      <SettingRow label="Resolution" icon={<Maximize size={18} />}>
        <Select label="Resolution" value={r.resolution} onChange={(resolution) => set({ resolution })} options={(Object.keys(RESOLUTION_LABELS) as Array<keyof typeof RESOLUTION_LABELS>).map((k) => ({ value: k, label: RESOLUTION_LABELS[k] }))} />
      </SettingRow>
      <SettingRow label="Frame rate" icon={<Gauge size={18} />} hint="60 fps depends on the source and your hardware.">
        <RadioGroup label="Frame rate" value={r.fps} onChange={(fps) => set({ fps })} options={[15, 24, 30, 60].map((f) => ({ value: f as 15 | 24 | 30 | 60, label: `${f}` }))} />
      </SettingRow>
      <SettingRow label="Video format" icon={<FileVideo size={18} />} hint="MP4 is recorded natively when Chrome supports it, otherwise convert on the result page.">
        <RadioGroup label="Video format" value={r.container} onChange={(container) => set({ container })} options={[{ value: 'webm', label: 'WebM' }, { value: 'mp4', label: 'MP4' }]} />
      </SettingRow>
      <SettingRow label="Video bitrate" icon={<Activity size={18} />} hint="0 = automatic (≈ 7.5 Mbps at 1080p30, ≈ 30 Mbps at 4K30).">
        <TextField type="number" min={0} max={250000} value={r.videoBitrateKbps} suffix="kbps" style={{ width: 110 }} onChange={(e) => set({ videoBitrateKbps: Number(e.target.value) || 0 })} aria-label="Video bitrate" />
      </SettingRow>
      </SettingsSection>
      <SettingsSection title="Audio" icon={<Mic size={22} />}>
      <SettingRow label="Record microphone by default" icon={<Mic size={18} />}>
        <ToggleSwitch label="Microphone" checked={r.micEnabled} onChange={(micEnabled) => set({ micEnabled })} />
      </SettingRow>
      <SettingRow label="Default microphone" icon={<AudioLines size={18} />}>
        <Select label="Default microphone" value={r.micDeviceId} onChange={(micDeviceId) => set({ micDeviceId })} options={[{ value: 'default', label: 'System default' }, ...mics.filter((m) => m.deviceId !== 'default').map((m) => ({ value: m.deviceId, label: m.label }))]} />
      </SettingRow>
      <SettingRow label="Record system / tab audio" icon={<Volume2 size={18} />}>
        <ToggleSwitch label="System audio" checked={r.systemAudio} onChange={(systemAudio) => set({ systemAudio })} />
      </SettingRow>
      <SettingRow label="Noise suppression" icon={<AudioWaveform size={18} />} hint="Reduces background noise from the microphone.">
        <ToggleSwitch label="Noise suppression" checked={r.noiseSuppression} onChange={(noiseSuppression) => set({ noiseSuppression })} />
      </SettingRow>
      <SettingRow label="Echo cancellation" icon={<AudioLines size={18} />} hint="Removes speaker sound picked up by the microphone.">
        <ToggleSwitch label="Echo cancellation" checked={r.echoCancellation} onChange={(echoCancellation) => set({ echoCancellation })} />
      </SettingRow>
      <SettingRow label="Audio bitrate" icon={<Activity size={18} />}>
        <Select label="Audio bitrate" value={r.audioBitrateKbps} onChange={(audioBitrateKbps) => set({ audioBitrateKbps })} options={[64, 96, 128, 192, 256, 320].map((b) => ({ value: b, label: `${b} kbps` }))} />
      </SettingRow>
      </SettingsSection>
      <SettingsSection title="Camera" icon={<Webcam size={22} />}>
      <SettingRow label="Default camera" icon={<Webcam size={18} />}>
        <Select label="Default camera" value={r.cameraDeviceId} onChange={(cameraDeviceId) => set({ cameraDeviceId })} options={[{ value: 'default', label: 'System default' }, ...cams.map((c) => ({ value: c.deviceId, label: c.label }))]} />
      </SettingRow>
      </SettingsSection>
      <SettingsSection title="While recording" icon={<CircleDot size={22} />}>
      <SettingRow label="Countdown" icon={<Timer size={18} />}>
        <Select label="Countdown" value={r.countdownSeconds} onChange={(countdownSeconds) => set({ countdownSeconds })} options={[...new Set([...COUNTDOWN_OPTIONS, r.countdownSeconds])].sort((a, b) => a - b).map((s) => ({ value: s, label: s === 0 ? 'Off' : `${s} seconds` }))} />
      </SettingRow>
      <SettingRow label="Maximum duration" icon={<Hourglass size={18} />}>
        <Select label="Maximum duration" value={r.maxDurationMinutes} onChange={(maxDurationMinutes) => set({ maxDurationMinutes })} options={[...new Set([...MAX_DURATION_OPTIONS, r.maxDurationMinutes])].sort((a, b) => a - b).map((m) => ({ value: m, label: m === 0 ? 'No limit' : `${m} minutes` }))} />
      </SettingRow>
      <SettingRow label="Record screen without taskbar" icon={<PanelBottom size={18} />} hint="Desktop recordings of a whole screen are cropped to leave out the taskbar / dock.">
        <ToggleSwitch label="Record without taskbar" checked={r.excludeTaskbar} onChange={(excludeTaskbar) => set({ excludeTaskbar })} />
      </SettingRow>
      <SettingRow label="Show control bar" icon={<SlidersHorizontal size={18} />} hint="A small floating window with pause / stop. It is never part of tab recordings.">
        <ToggleSwitch label="Control bar" checked={r.controlBar} onChange={(controlBar) => set({ controlBar })} />
      </SettingRow>
      </SettingsSection>
      <SettingsSection title="Clicks, keys & cursor" icon={<MousePointerClick size={22} />} description="Shown in the recording.">
      <SettingRow label="Highlight mouse clicks" icon={<MousePointerClick size={18} />} hint="Shows an effect where you click — on every page and tab you visit while recording.">
        <ToggleSwitch label="Highlight clicks" checked={r.highlightClicks} onChange={(highlightClicks) => set({ highlightClicks })} />
      </SettingRow>
      {r.highlightClicks && (
        <div style={{ padding: '4px 20px 18px' }}>
          <ClickHighlightFields fx={r.cursorEffects} onChange={(patch) => set({ cursorEffects: { ...r.cursorEffects, ...patch } })} />
        </div>
      )}
      <SettingRow label="Show keyboard shortcuts" icon={<Keyboard size={18} />} hint="Shows key combinations (e.g. Ctrl + C) — never ordinary typing or passwords.">
        <ToggleSwitch label="Keyboard shortcuts" checked={r.highlightKeys} onChange={(highlightKeys) => set({ highlightKeys })} />
      </SettingRow>
      <SettingRow label="Mouse cursor" icon={<MousePointer2 size={18} />} hint="Desktop recordings always include the cursor. Chrome never draws it in tab recordings — enable click highlights instead.">
        <span style={{ color: 'var(--c-text-secondary)', fontSize: 12 }}>Controlled by Chrome</span>
      </SettingRow>
      </SettingsSection>
      <SettingsSection title="After recording" icon={<Clapperboard size={22} />}>
      <SettingRow label="Advanced Video Editor" icon={<Clapperboard size={18} />} hint="On the video page: draw on frames with the image editor's tools, timed overlays, animations and effects.">
        <ToggleSwitch label="Advanced Video Editor" checked={r.advancedVideoEditor} onChange={(advancedVideoEditor) => set({ advancedVideoEditor })} />
      </SettingRow>
      <SettingRow label="Recording file name" icon={<FileText size={18} />} hint={<FilenamePreview pattern={r.filenamePattern} type="Recording" />} stacked>
        <TextField value={r.filenamePattern} onChange={(e) => set({ filenamePattern: e.target.value })} aria-label="Recording file name pattern" />
      </SettingRow>
      <SettingRow label="Download recordings automatically" icon={<Download size={18} />}>
        <ToggleSwitch label="Auto-save recordings" checked={r.autoSave} onChange={(autoSave) => set({ autoSave })} />
      </SettingRow>
      </SettingsSection>
    </SettingsPage>
  );
}

/* ---------------------------------- Storage -------------------------------- */
export function FlowSection({ settings, update }: Props) {
  const f = settings.flow;
  const set = (patch: DeepPartial<Settings['flow']>) => void update({ flow: patch });
  return (
    <SettingsPage title="Flow Capture" icon={<Workflow size={26} />} actions={<ResetPage section="flow" title="Flow Capture" update={update} />} description="Step-by-step screenshot sessions across pages and sites. Start from the popup (Screenshot tab) or together with a recording.">
      <SettingsSection title="Capturing steps" icon={<Workflow size={22} />}>
      <SettingRow label="Default capture mode" icon={<Crosshair size={18} />}>
        <Select
          label="Default flow capture mode"
          value={f.mode}
          onChange={(mode) => set({ mode })}
          options={[
            { value: 'visible', label: 'Visible part' },
            { value: 'full', label: 'Full page' },
            { value: 'area', label: 'Selected area' },
            { value: 'screen', label: 'Full screen' },
            { value: 'window', label: 'Application window' },
          ]}
        />
      </SettingRow>
      <SettingRow label="Auto steps" icon={<Sparkles size={18} />} hint="Adds a screenshot automatically at clicks, form steps and page changes (typing is grouped into one step per field; repeats and unchanged screens are skipped).">
        <ToggleSwitch label="Auto steps" checked={f.autoSteps} onChange={(autoSteps) => set({ autoSteps })} />
      </SettingRow>
      <SettingRow label="Take screenshots on" icon={<Camera size={18} />} hint="Which interactions add an automatic screenshot (when Auto steps is on)." stacked>
        <CaptureOnPicker value={f.captureOn} onChange={(captureOn) => set({ captureOn })} showTitle={false} />
      </SettingRow>
      <SettingRow label="Auto screenshots" icon={<Images size={18} />} hint="Every step, or only when a new page opens.">
        <RadioGroup label="Auto screenshots" size="sm" value={f.screenshotWhen} onChange={(screenshotWhen) => set({ screenshotWhen })} options={[{ value: 'every-step', label: 'Every step' }, { value: 'page-change', label: 'New pages' }]} />
      </SettingRow>
      <SettingRow label="Click pictures" icon={<MousePointerClick size={18} />} hint="After click: the screen once the page reacted. On click: the moment you press the mouse button (or Enter / Space on a focused button). On hover: the button under the pointer just before you click it. For flows and recordings.">
        <RadioGroup label="Click pictures" size="sm" value={f.shotTiming} onChange={(shotTiming) => set({ shotTiming })} options={[{ value: 'after-click', label: 'After click' }, { value: 'on-click', label: 'On click' }, { value: 'on-hover', label: 'On hover' }]} />
      </SettingRow>
      </SettingsSection>
      <SettingsSection title="Scrolling & timing" icon={<ArrowDownUp size={22} />}>
      <SettingRow label="Scroll steps" icon={<ArrowDownUp size={18} />} hint="Record scrolling further than the minimum distance as a step.">
        <ToggleSwitch label="Scroll steps" checked={f.scroll} onChange={(scroll) => set({ scroll })} />
      </SettingRow>
      <SettingRow label="Minimum scroll distance" icon={<MoveVertical size={18} />}>
        <div style={{ width: 260 }}><Slider hideLabel label="Minimum scroll distance" min={100} max={2000} step={50} value={f.scrollThresholdPx} format={(v) => `${v}px`} onChange={(scrollThresholdPx) => set({ scrollThresholdPx })} /></div>
      </SettingRow>
      <SettingRow label="Minimum time between auto screenshots" icon={<Timer size={18} />}>
        <div style={{ width: 260 }}><Slider hideLabel label="Minimum time between auto screenshots" min={0} max={5000} step={50} value={f.minShotIntervalMs} format={intervalLabel} onChange={(minShotIntervalMs) => set({ minShotIntervalMs })} /></div>
      </SettingRow>
      <SettingRow label="Wait before each picture" icon={<Hourglass size={18} />} hint="Automatic waits until the page has reacted and finished loading. No delay pictures the screen at once. Used by flows and by Flow Capture during recordings.">
        <Select label="Wait before picture" value={f.shotDelayMs ?? -1} onChange={(shotDelayMs) => set({ shotDelayMs })} options={SHOT_DELAY_OPTIONS} />
      </SettingRow>
      </SettingsSection>
      <SettingsSection title="Privacy" icon={<ShieldCheck size={22} />}>
      <SettingRow label="Form values" icon={<ShieldCheck size={18} />} hint="Passwords, one-time codes, payment and account numbers are always masked. Ordinary values are kept only if you allow it.">
        <RadioGroup label="Flow form values" size="sm" value={f.values} onChange={(values) => set({ values })} options={[{ value: 'non-sensitive', label: 'Keep ordinary values' }, { value: 'never', label: 'Never keep values' }]} />
      </SettingRow>
      </SettingsSection>
      <SettingsSection title="With recordings" icon={<Film size={22} />}>
      <SettingRow label="With recordings" icon={<Video size={18} />} hint="Track the browser flow while recording a tab, area or desktop.">
        <ToggleSwitch label="Flow Capture with recordings" checked={f.withRecording} onChange={(withRecording) => set({ withRecording })} />
      </SettingRow>
      <SettingRow label="During Camera Only recordings" icon={<Webcam size={18} />} hint="Off unless you choose it: tracks the page you were on while recording your camera.">
        <ToggleSwitch label="Flow Capture during Camera Only" checked={f.inCameraMode} onChange={(inCameraMode) => set({ inCameraMode })} />
      </SettingRow>
      </SettingsSection>
      <SettingsSection title="Flow Editor" icon={<LayoutList size={22} />}>
      <SettingRow label="Ask before deleting images" icon={<Trash2 size={18} />} hint="In the Flow Editor. Turned off by “Don't ask me again” in the delete question.">
        <ToggleSwitch label="Ask before deleting flow images" checked={f.confirmDelete} onChange={(confirmDelete) => set({ confirmDelete })} />
      </SettingRow>
      </SettingsSection>
    </SettingsPage>
  );
}

export function StorageSection({ settings, update }: Props) {
  const toast = useToast();
  const s = settings.storage;
  const [usage, setUsage] = useState<StorageUsage | null>(null);
  const [confirmClearAll, setConfirmClearAll] = useState(false);
  const refresh = () => void getStorageUsage().then(setUsage);
  useEffect(refresh, []);
  const [folderAccess, setFolderAccess] = useState<PermissionState>('granted');
  const checkFolder = () => void getSaveFolder().then(async (h) => setFolderAccess(h ? await folderPermission(h, false) : 'denied'));
  useEffect(checkFolder, [s.folderName]);
  async function chooseFolder() {
    if (!canPickFolder()) return toast.error('Folders cannot be chosen here', 'Open Settings in a normal Chrome tab and try again.');
    try {
      const name = await pickSaveFolder();
      if (!name) return;
      await update({ storage: { location: 'folder', folderName: name } });
      setFolderAccess('granted');
      toast.success('Save folder chosen', `Files are now saved to “${name}”.`);
    } catch (err) {
      toast.error('Could not use that folder', String(err));
    }
  }
  async function allowFolder() {
    const h = await getSaveFolder();
    if (!h) return chooseFolder();
    setFolderAccess(await folderPermission(h, true));
  }

  return (
    <SettingsPage title="Storage" icon={<HardDrive size={26} />} actions={<ResetPage section="storage" title="Storage" update={update} />} description="Where files go and how long captures are kept. Everything stays on this device.">
      <SettingsSection title="Saving files" icon={<FolderDown size={22} />}>
      <SettingRow label="Save location" icon={<FolderOpen size={18} />} hint="Chrome’s Downloads folder, or any folder on this computer (outside Chrome too). Files from the editor, video page, Flow Editor and collage go there; captures saved automatically in the background use Downloads.">
        <RadioGroup label="Save location" size="sm" value={s.location === 'folder' && s.folderName ? 'folder' : 'downloads'}
          onChange={async (loc) => {
            if (loc === 'downloads') return void update({ storage: { location: 'downloads' } });
            if (s.folderName) return void update({ storage: { location: 'folder' } });
            await chooseFolder();
          }}
          options={[{ value: 'downloads', label: 'Downloads folder' }, { value: 'folder', label: 'A folder I choose' }]} />
      </SettingRow>
      {s.location === 'folder' && s.folderName && (
        <SettingRow label="Chosen folder" icon={<Folder size={18} />} hint={folderAccess === 'prompt' ? 'Chrome asks once for access after it restarts: click “Allow access”, or it is asked on your next save.' : folderAccess === 'denied' ? 'Access was refused: files go to Downloads until you allow it.' : 'Files are written straight into this folder.'}>
          <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
            <strong title={s.folderName}>📁 {s.folderName}</strong>
            {folderAccess !== 'granted' && <Button size="sm" variant="primary" onClick={() => void allowFolder()}>Allow access</Button>}
            <Button size="sm" onClick={() => void chooseFolder()}>Change…</Button>
          </span>
        </SettingRow>
      )}
      <SettingRow icon={<FolderTree size={18} />} label={s.location === 'folder' && s.folderName ? 'Sub-folder' : 'Download folder'} hint={s.location === 'folder' && s.folderName ? 'Optional sub-folder inside the chosen folder.' : 'A sub-folder of your Chrome downloads folder. Choose “A folder I choose” above to save anywhere else.'}>
        <TextField value={s.subfolder} placeholder="(folder root)" onChange={(e) => void update({ storage: { subfolder: e.target.value } })} aria-label="Download sub-folder" style={{ width: 220 }} />
      </SettingRow>
      <SettingRow label="Ask where to save each file" icon={<FolderSearch size={18} />}>
        <ToggleSwitch label="Ask where to save" checked={s.askWhereToSave} onChange={(askWhereToSave) => void update({ storage: { askWhereToSave } })} />
      </SettingRow>
      <SettingRow label="File name pattern" icon={<FileText size={18} />} hint="Edit in General (screenshots) and Recording (videos).">
        <span style={{ color: 'var(--c-text-secondary)', fontSize: 12 }}>{settings.general.filenamePattern}</span>
      </SettingRow>
      </SettingsSection>
      <SettingsSection title="Recent captures" icon={<History size={22} />}>
      <SettingRow label="Keep captures in Recent captures for" icon={<CalendarClock size={18} />}>
        <Select label="Retention" value={s.retentionDays} onChange={(retentionDays) => void update({ storage: { retentionDays } })} options={[{ value: 0, label: 'Forever' }, { value: 7, label: '7 days' }, { value: 30, label: '30 days' }, { value: 90, label: '90 days' }]} />
      </SettingRow>
      <SettingRow label="Storage used" icon={<HardDrive size={18} />} hint={usage ? `${usage.screenshots} screenshots · ${usage.videos} recordings` : 'Calculating…'}>
        <strong>{usage ? formatBytes(usage.bytes) : '—'}</strong>
        {usage?.quota ? <span style={{ color: 'var(--c-text-secondary)', fontSize: 12 }}>of {formatBytes(usage.quota)} available</span> : null}
      </SettingRow>
      <SettingRow label="Clear temporary files" icon={<Eraser size={18} />} hint="Removes leftovers from interrupted recordings.">
        <Button
          size="sm"
          onClick={async () => {
            await clearTemp();
            toast.success('Temporary files cleared');
            refresh();
          }}
        >
          Clear
        </Button>
      </SettingRow>
      <SettingRow label="Delete all captures" icon={<Trash2 size={18} />} hint="Removes every screenshot and recording from Recent captures. Downloaded files are not affected.">
        <Button size="sm" variant="danger" icon={<Trash2 size={14} />} onClick={() => setConfirmClearAll(true)}>
          Delete all
        </Button>
      </SettingRow>
      <ConfirmationDialog
        open={confirmClearAll}
        title="Delete all captures?"
        message="Every screenshot and recording stored in Pixora will be permanently deleted."
        confirmLabel="Delete all"
        danger
        onCancel={() => setConfirmClearAll(false)}
        onConfirm={async () => {
          setConfirmClearAll(false);
          await clearAllCaptures();
          toast.success('All captures deleted');
          refresh();
        }}
      />
      </SettingsSection>
    </SettingsPage>
  );
}

/* ----------------------------- Keyboard shortcuts --------------------------- */
export function ShortcutsSection() {
  const [commands, setCommands] = useState<chrome.commands.Command[]>([]);
  useEffect(() => {
    void chrome.commands.getAll().then(setCommands);
    const onFocus = () => void chrome.commands.getAll().then(setCommands);
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, []);
  return (
    <SettingsPage title="Keyboard shortcuts" icon={<Keyboard size={26} />}>
      <SettingsSection title="Shortcuts on any page" icon={<Keyboard size={22} />} description="Chrome manages them so they don’t clash with other extensions.">
      {commands.map((c) => (
        <SettingRow key={c.name} icon={<Command size={18} />} label={c.name === '_execute_action' ? 'Open Pixora' : c.description || c.name}>
          {c.shortcut ? <kbd style={{ padding: '3px 8px', borderRadius: 6, border: '1px solid var(--c-border-strong)', background: 'var(--c-bg-subtle)', fontFamily: 'var(--font-sans)', fontSize: 12 }}>{c.shortcut}</kbd> : <span style={{ color: 'var(--c-text-tertiary)', fontSize: 12 }}>Not set</span>}
        </SettingRow>
      ))}
      <SettingRow label="Change shortcuts" icon={<ExternalLink size={18} />} hint="Opens Chrome’s extension shortcut settings.">
        <Button size="sm" icon={<ExternalLink size={14} />} onClick={() => void chrome.tabs.create({ url: 'chrome://extensions/shortcuts' })}>
          Customize
        </Button>
      </SettingRow>
      </SettingsSection>
      <SettingsSection title="In the screenshot editor" icon={<PenTool size={22} />}>
      <SettingRow label="Editor shortcuts" icon={<PenTool size={18} />} stacked>
        <span style={{ color: 'var(--c-text-secondary)', fontSize: 12, lineHeight: 1.7 }}>
          Ctrl+Z undo · Ctrl+Y redo · Ctrl+C copy · Ctrl+S save · Delete remove selection · Esc cancel · V select · P pen · G highlighter · R rectangle · O ellipse · A arrow · L line · T text · B blur · X pixelate · N marker · E eraser · C crop · Space pan · Ctrl+scroll zoom
        </span>
      </SettingRow>
      </SettingsSection>
    </SettingsPage>
  );
}

/* --------------------------------- Advanced -------------------------------- */
export function AdvancedSection({ settings, update }: Props) {
  const toast = useToast();
  const a = settings.advanced;
  const [confirmReset, setConfirmReset] = useState(false);
  const [confirmRepair, setConfirmRepair] = useState(false);
  const [healthy, setHealthy] = useState<boolean | null>(null);
  const [repairing, setRepairing] = useState(false);
  useEffect(() => {
    void storageHealthy().then(setHealthy);
  }, []);
  return (
    <SettingsPage title="Advanced" icon={<SlidersHorizontal size={26} />} actions={<ResetPage section="advanced" title="Advanced" update={update} />} description="Pixora has no account, no analytics and never uploads your captures.">
      <SettingsSection title="Video encoding" icon={<Cpu size={22} />}>
      <SettingRow label="Hardware acceleration" icon={<Cpu size={18} />} hint="Used for video export and format conversion (WebCodecs).">
        <Select label="Hardware acceleration" value={a.hardwareAcceleration} onChange={(hardwareAcceleration) => void update({ advanced: { hardwareAcceleration } })} options={[{ value: 'auto', label: 'Automatic' }, { value: 'prefer-hardware', label: 'Prefer GPU' }, { value: 'prefer-software', label: 'Prefer CPU' }]} />
      </SettingRow>
      <SettingRow label="Codec preference" icon={<Binary size={18} />} hint="Also available under Recording › More.">
        <Select label="Codec preference" value={settings.recording.videoCodec} onChange={(videoCodec) => void update({ recording: { videoCodec } })} options={[{ value: 'auto', label: 'Automatic' }, { value: 'vp9', label: 'VP9' }, { value: 'vp8', label: 'VP8' }, { value: 'h264', label: 'H.264' }, { value: 'av1', label: 'AV1' }]} />
      </SettingRow>
      <SettingRow label="Experimental features" icon={<FlaskConical size={18} />} hint="Prefers the AV1 codec when the codec is automatic (smaller files, higher CPU use; falls back if unsupported).">
        <ToggleSwitch label="Experimental features" checked={a.experimental} onChange={(experimental) => void update({ advanced: { experimental } })} />
      </SettingRow>
      </SettingsSection>
      <SettingsSection title="Troubleshooting" icon={<Wrench size={22} />}>
      <SettingRow label="Debug logging" icon={<Bug size={18} />} hint="Writes detailed logs to the console of each extension page and shows technical error details.">
        <ToggleSwitch label="Debug logging" checked={a.debugLogging} onChange={(debugLogging) => void update({ advanced: { debugLogging } })} />
      </SettingRow>
      <SettingRow label="Reset all settings" icon={<RotateCcw size={18} />} hint="Restores defaults. Captures are not deleted.">
        <Button size="sm" icon={<RotateCcw size={14} />} onClick={() => setConfirmReset(true)}>
          Reset
        </Button>
      </SettingRow>
      <SettingRow
        label="Repair storage"
        hint={healthy === false
          ? 'Chrome cannot open Pixora’s storage on this computer (its files are locked or damaged), so captures cannot be saved. Repair rebuilds it empty; captures stored in Pixora are lost (files you downloaded are not affected). Close other Chrome windows first.'
          : 'Only needed if saving fails with “storage could not be opened”. Rebuilds Pixora’s storage empty (captures stored in Pixora are deleted).'}
      >
        <Button size="sm" variant={healthy === false ? 'primary' : 'secondary'} loading={repairing} onClick={() => setConfirmRepair(true)}>
          {healthy === false ? 'Repair storage now' : 'Repair storage'}
        </Button>
      </SettingRow>
      <SettingRow label="Clear cached data" icon={<Eraser size={18} />} hint="Clears temporary recording data and editor preferences.">
        <Button
          size="sm"
          onClick={async () => {
            await chrome.storage.local.remove(['glint.editor.toolStyles', 'glint.editor.toolStyles.v2', 'glint.editor.prefs']);
            await clearTemp();
            toast.success('Cached data cleared');
          }}
        >
          Clear cache
        </Button>
      </SettingRow>
      <ConfirmationDialog
        open={confirmRepair}
        title="Repair Pixora’s storage?"
        message="Pixora’s storage is deleted and created again, empty. Screenshots and recordings stored in Pixora are removed; files already in your Downloads folder are not affected."
        confirmLabel="Repair"
        danger
        onCancel={() => setConfirmRepair(false)}
        onConfirm={async () => {
          setConfirmRepair(false);
          setRepairing(true);
          try {
            await repairDatabase();
            setHealthy(true);
            toast.success('Storage repaired', 'Pixora can save captures again.');
          } catch (err) {
            toast.error('Repair did not finish', `${String(err)} — close all Chrome windows, open Chrome again, then try once more.`);
          } finally {
            setRepairing(false);
          }
        }}
      />
      <ConfirmationDialog
        open={confirmReset}
        title="Reset all settings?"
        message="All preferences return to their defaults."
        confirmLabel="Reset"
        onCancel={() => setConfirmReset(false)}
        onConfirm={async () => {
          setConfirmReset(false);
          await resetSettings();
          toast.success('Settings reset');
        }}
      />
      </SettingsSection>
    </SettingsPage>
  );
}
