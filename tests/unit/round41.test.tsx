import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { normalizeSettings } from '@/settings/settings-service';
import { DEFAULT_SETTINGS } from '@/shared/constants/defaults';
import { COUNTDOWN_CHANNEL, ProgressApp } from '@/progress/ProgressApp';
import { isBackgroundMessage } from '@/shared/messaging/messages';

describe('recording controls in the popup', () => {
  it('the separate control window is off for new and existing users (v6)', () => {
    expect(DEFAULT_SETTINGS.recording.controlBar).toBe(false);
    const old = normalizeSettings({ ...structuredClone(DEFAULT_SETTINGS), version: 5, recording: { ...DEFAULT_SETTINGS.recording, controlBar: true } });
    expect(old.recording.controlBar).toBe(false);
    expect(normalizeSettings({ ...structuredClone(DEFAULT_SETTINGS), recording: { ...DEFAULT_SETTINGS.recording, controlBar: true } }).recording.controlBar).toBe(true);
    expect(DEFAULT_SETTINGS.screenshot.desktopDelaySeconds).toBe(3);
  });

  it('new messages are validated', () => {
    expect(isBackgroundMessage({ target: 'background', type: 'screenshot/stop-full' })).toBe(true);
    expect(isBackgroundMessage({ target: 'background', type: 'recording/region-cancelled' })).toBe(true);
  });
});

describe('countdown window before an Entire Screen & App Window screenshot', () => {
  afterEach(() => vi.useRealTimers());
  it('shows the seconds left (at least 3) and says when to take the picture', async () => {
    vi.useFakeTimers();
    history.replaceState(null, '', '/progress.html?mode=countdown&s=1');
    const messages: unknown[] = [];
    const listen = new BroadcastChannel(COUNTDOWN_CHANNEL);
    listen.onmessage = (e) => messages.push(e.data);
    const close = vi.spyOn(window, 'close').mockImplementation(() => undefined);
    render(<ProgressApp />);
    expect(screen.getByRole('timer', { name: 'Screenshot in 3 seconds' })).toBeTruthy();
    await act(async () => { vi.advanceTimersByTime(1100); });
    expect(screen.getByRole('timer').textContent).toContain('2');
    await act(async () => { vi.advanceTimersByTime(2100); });
    vi.useRealTimers();
    await new Promise((r) => setTimeout(r, 50));
    expect(messages).toContainEqual({ type: 'done' });
    expect(close).toHaveBeenCalled();
    listen.close();
  });
});
