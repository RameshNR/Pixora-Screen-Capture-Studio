import { DEFAULT_SETTINGS, SETTINGS_STORAGE_KEY } from '@/shared/constants/defaults';
import type { DeepPartial, Settings } from '@/shared/types';
import { mergeDeep } from '@/shared/utils/misc';
import { setDebugLogging } from '@/shared/utils/logger';

/**
 * Centralised, typed settings persisted in chrome.storage.local.
 * Unknown keys are dropped and missing keys fall back to defaults, so older stored settings are
 * migrated forward automatically.
 */
export function normalizeSettings(raw: unknown): Settings {
  const merged = mergeDeep(DEFAULT_SETTINGS, raw);
  const s = structuredClone(merged);
  // v2: recordings start on Desktop with Flow Capture (frames of each step) switched on.
  const from = raw && typeof raw === 'object' ? Number((raw as { version?: unknown }).version ?? 1) : DEFAULT_SETTINGS.version;
  if (from < 2) {
    s.recording.mode = 'desktop';
    s.flow.withRecording = true;
  }
  // v3: high-quality MP4 recordings at the screen's own resolution by default.
  if (from < 3) {
    if (s.recording.container === 'webm') s.recording.container = 'mp4';
    if (s.recording.resolution === '1080p') s.recording.resolution = 'original';
  }
  // v4: never compress below full quality unless the user picks a lower value themselves.
  if (from < 4 && s.screenshot.quality === 0.92) s.screenshot.quality = 1;
  // v5: Flow Capture with recordings is on by default, with a screenshot of each step.
  if (from < 5) {
    s.flow.withRecording = true;
    s.flow.autoSteps = true;
    // No minimum gap between step screenshots (the old 0.6 s default becomes 0).
    if (s.flow.minShotIntervalMs === 600) s.flow.minShotIntervalMs = 0;
    // Click pictures are taken at the moment of the click.
    if (s.flow.shotTiming === 'after-click') s.flow.shotTiming = 'on-click';
  }
  // v6: recordings are controlled from Pixora's popup; the separate control-bar window is opt-in
  // (it is a window on the screen, so desktop recordings showed it).
  if (from < 6) s.recording.controlBar = false;
  // v7: long pages are split into several full-resolution images, so the default limit is much higher.
  if (from < 7 && s.screenshot.fullPage.maxHeight === 30000) s.screenshot.fullPage.maxHeight = 100000;
  s.version = DEFAULT_SETTINGS.version;
  s.screenshot.quality = Math.min(1, Math.max(0.1, s.screenshot.quality));
  s.screenshot.delaySeconds = Math.min(300, Math.max(0, Math.round(s.screenshot.delaySeconds)));
  s.recording.micVolume = Math.min(2, Math.max(0, s.recording.micVolume));
  s.recording.countdownSeconds = Math.min(60, Math.max(0, Math.round(s.recording.countdownSeconds)));
  s.recording.maxDurationMinutes = Math.min(600, Math.max(0, Math.round(s.recording.maxDurationMinutes)));
  if (![15, 24, 30, 60].includes(s.recording.fps)) s.recording.fps = 30;
  s.recording.videoBitrateKbps = Math.min(250_000, Math.max(0, Math.round(s.recording.videoBitrateKbps)));
  s.recording.audioBitrateKbps = Math.min(512, Math.max(32, Math.round(s.recording.audioBitrateKbps)));
  // Cloud storage is UI-only in this release.
  s.recording.storage = 'local';
  s.screenshot.storage = 'local';
  return s;
}

export async function loadSettings(): Promise<Settings> {
  const stored = await chrome.storage.local.get(SETTINGS_STORAGE_KEY);
  const settings = normalizeSettings(stored[SETTINGS_STORAGE_KEY]);
  setDebugLogging(settings.advanced.debugLogging);
  return settings;
}

export async function saveSettings(settings: Settings): Promise<void> {
  await chrome.storage.local.set({ [SETTINGS_STORAGE_KEY]: normalizeSettings(settings) });
}

export async function updateSettings(patch: DeepPartial<Settings>): Promise<Settings> {
  const current = await loadSettings();
  const next = normalizeSettings(mergeDeep(current, patch));
  await chrome.storage.local.set({ [SETTINGS_STORAGE_KEY]: next });
  return next;
}

export async function resetSettings(): Promise<Settings> {
  await chrome.storage.local.set({ [SETTINGS_STORAGE_KEY]: DEFAULT_SETTINGS });
  return structuredClone(DEFAULT_SETTINGS);
}

export function subscribeSettings(listener: (settings: Settings) => void): () => void {
  const handler = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area !== 'local' || !(SETTINGS_STORAGE_KEY in changes)) return;
    const next = normalizeSettings(changes[SETTINGS_STORAGE_KEY]?.newValue);
    setDebugLogging(next.advanced.debugLogging);
    listener(next);
  };
  chrome.storage.onChanged.addListener(handler);
  return () => chrome.storage.onChanged.removeListener(handler);
}
