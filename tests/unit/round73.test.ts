import { describe, expect, it } from 'vitest';
import { loadSettings, updateSettings } from '@/settings/settings-service';

describe('settings saved quickly one after another', () => {
  it('keeps every change', async () => {
    await Promise.all([
      updateSettings({ recording: { cursorEffects: { clickEffect: 'burst' } } }),
      updateSettings({ recording: { cursorEffects: { clickCursor: true } } }),
      updateSettings({ recording: { highlightKeys: true } }),
    ]);
    const s = await loadSettings();
    expect(s.recording.cursorEffects.clickEffect).toBe('burst');
    expect(s.recording.cursorEffects.clickCursor).toBe(true);
    expect(s.recording.highlightKeys).toBe(true);
  });
});

describe('older saved settings', () => {
  it('keep their click effect', async () => {
    const { normalizeSettings } = await import('@/settings/settings-service');
    const s = normalizeSettings({ version: 9, recording: { cursorEffects: { style: 'pulse' } } });
    expect(s.recording.cursorEffects.clickEffect).toBe('pulse');
  });
});
