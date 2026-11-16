import { describe, expect, it, vi } from 'vitest';
import { loadSettings, normalizeSettings, resetSettings, subscribeSettings, updateSettings } from '@/settings/settings-service';
import { DEFAULT_SETTINGS, SETTINGS_STORAGE_KEY } from '@/shared/constants/defaults';
import { buildRecordingConfig } from '@/recording/services/config';

describe('settings service', () => {
  it('returns defaults when nothing is stored', async () => {
    expect(await loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it('persists and merges partial updates', async () => {
    await updateSettings({ recording: { resolution: '2160p', fps: 60 } });
    await updateSettings({ screenshot: { format: 'webp' } });
    const s = await loadSettings();
    expect(s.recording.resolution).toBe('2160p');
    expect(s.recording.fps).toBe(60);
    expect(s.screenshot.format).toBe('webp');
    expect(s.recording.micEnabled).toBe(DEFAULT_SETTINGS.recording.micEnabled);
  });

  it('drops unknown keys, rejects wrong types and clamps ranges', () => {
    const s = normalizeSettings({
      bogus: true,
      screenshot: { quality: 5, delaySeconds: -3, format: 42 },
      recording: { fps: 45, micVolume: 9, storage: 'cloud' },
    });
    expect('bogus' in s).toBe(false);
    expect(s.screenshot.quality).toBe(1);
    expect(s.screenshot.delaySeconds).toBe(0);
    expect(s.screenshot.format).toBe('png');
    expect(s.recording.fps).toBe(30);
    expect(s.recording.micVolume).toBe(2);
    expect(s.recording.storage).toBe('local'); // cloud is UI-only for now
  });

  it('raises the old 92% image quality default to full quality (v4)', () => {
    expect(normalizeSettings({ version: 3, screenshot: { quality: 0.92 } }).screenshot.quality).toBe(1);
    expect(normalizeSettings({ version: 3, screenshot: { quality: 0.7 } }).screenshot.quality).toBe(0.7);
    expect(DEFAULT_SETTINGS.screenshot.quality).toBe(1);
  });

  it('migrates older stored settings forward', async () => {
    await chrome.storage.local.set({ [SETTINGS_STORAGE_KEY]: { general: { theme: 'dark' } } });
    const s = await loadSettings();
    expect(s.general.theme).toBe('dark');
    expect(s.storage).toEqual(DEFAULT_SETTINGS.storage);
  });

  it('notifies subscribers of changes', async () => {
    const listener = vi.fn();
    const off = subscribeSettings(listener);
    await updateSettings({ general: { theme: 'light' } });
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ general: expect.objectContaining({ theme: 'light' }) }));
    off();
  });

  it('resets to defaults', async () => {
    await updateSettings({ general: { theme: 'dark' } });
    await resetSettings();
    expect((await loadSettings()).general.theme).toBe('system');
  });
});

describe('recording configuration', () => {
  it('builds a session config from settings', () => {
    const cfg = buildRecordingConfig({ ...DEFAULT_SETTINGS.recording, maxDurationMinutes: 5, micEnabled: true });
    expect(cfg.maxDurationMs).toBe(300_000);
    expect(cfg.mic.enabled).toBe(true);
    expect(cfg.mode).toBe('desktop');
  });

  it('forces the camera on and system audio off for camera-only', () => {
    const cfg = buildRecordingConfig({ ...DEFAULT_SETTINGS.recording, cameraEnabled: false, systemAudio: true }, { mode: 'camera' });
    expect(cfg.camera.enabled).toBe(true);
    expect(cfg.systemAudio).toBe(false);
  });

  it('prefers AV1 only with experimental features and automatic codec', () => {
    expect(buildRecordingConfig(DEFAULT_SETTINGS.recording, {}, { experimental: true }).videoCodec).toBe('av1');
    expect(buildRecordingConfig({ ...DEFAULT_SETTINGS.recording, videoCodec: 'vp8' }, {}, { experimental: true }).videoCodec).toBe('vp8');
    expect(buildRecordingConfig(DEFAULT_SETTINGS.recording).videoCodec).toBe('auto');
  });
});
