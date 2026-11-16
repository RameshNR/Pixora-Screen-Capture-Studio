import type { RecordingState } from '@/shared/types';
import { elapsedMs } from '@/recording/services/recording-state';

export async function setBadge(text: string, color = '#4F8DF7'): Promise<void> {
  await chrome.action.setBadgeBackgroundColor({ color }).catch(() => undefined);
  await chrome.action.setBadgeTextColor?.({ color: '#FFFFFF' }).catch(() => undefined);
  await chrome.action.setBadgeText({ text }).catch(() => undefined);
}

export async function clearBadge(): Promise<void> {
  await chrome.action.setBadgeText({ text: '' }).catch(() => undefined);
  await chrome.action.setTitle({ title: '' }).catch(() => undefined);
}

/**
 * Recording time for the toolbar badge, which fits about four characters:
 * "0:07", "12:45", then "1h05" after an hour.
 */
export function formatBadgeTime(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h${String(m).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function longTime(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

let ticker: ReturnType<typeof setInterval> | null = null;
let current: RecordingState | null = null;

function stopTicker(): void {
  if (ticker) clearInterval(ticker);
  ticker = null;
}

async function paintTime(state: RecordingState): Promise<void> {
  const ms = elapsedMs(state);
  const paused = state.status === 'paused';
  await setBadge(formatBadgeTime(ms), paused ? '#E0A100' : '#EF5350');
  await chrome.action.setTitle({ title: `${paused ? 'Recording paused' : 'Recording'} — ${longTime(ms)}` }).catch(() => undefined);
}

/**
 * Shows the elapsed recording time on the toolbar icon, updated every second while recording.
 * (Each badge update is an extension API call, which also keeps the service worker awake.)
 */
export async function badgeForRecording(state: RecordingState): Promise<void> {
  current = state;
  switch (state.status) {
    case 'recording':
      if (!ticker) ticker = setInterval(() => current && void paintTime(current), 1000);
      return paintTime(state);
    case 'paused':
      stopTicker();
      return paintTime(state);
    case 'countdown':
    case 'preparing':
    case 'selecting':
      stopTicker();
      return setBadge('…', '#4F8DF7');
    case 'stopping':
      stopTicker();
      return setBadge('SAVE', '#4F8DF7');
    default:
      stopTicker();
      return clearBadge();
  }
}

export async function notify(title: string, message: string, id?: string): Promise<void> {
  try {
    await chrome.notifications.create(id ?? '', {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon-128.png'),
      title,
      message,
      priority: 1,
    });
  } catch {
    /* notifications may be disabled at OS level */
  }
}
