import type { RecordingState } from '@/shared/types';
import { elapsedMs } from '@/recording/services/recording-state';

export async function setBadge(text: string, color = '#4F8DF7'): Promise<void> {
  await chrome.action.setBadgeBackgroundColor({ color }).catch(() => undefined);
  await chrome.action.setBadgeTextColor?.({ color: '#FFFFFF' }).catch(() => undefined);
  await chrome.action.setBadgeText({ text }).catch(() => undefined);
}

/** Countdowns (delayed and screen / window screenshots, recordings) count on the toolbar icon in the recording red. */
export const COUNT_COLOR = '#EF5350';

/**
 * Counts the seconds down on the toolbar icon (like a delayed Visible Part), then clears it.
 * Resolves 'cancel' as soon as `cancelled()` says so. (Each badge update is an extension API call,
 * which also keeps the service worker alive during the wait.)
 */
export async function countdownOnBadge(seconds: number, cancelled: () => boolean = () => false): Promise<'done' | 'cancel'> {
  for (let s = Math.round(seconds); s > 0; s--) {
    if (cancelled()) break;
    await setBadge(String(s), COUNT_COLOR);
    await chrome.action.setTitle({ title: `Pixora – capturing in ${s}…` }).catch(() => undefined);
    await new Promise((r) => setTimeout(r, 1000));
  }
  await clearBadge();
  return cancelled() ? 'cancel' : 'done';
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

let countTicker: ReturnType<typeof setInterval> | null = null;

function stopCountTicker(): void {
  if (countTicker) clearInterval(countTicker);
  countTicker = null;
}

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
  stopCountTicker();
  switch (state.status) {
    case 'recording':
      if (!ticker) ticker = setInterval(() => current && void paintTime(current), 1000);
      return paintTime(state);
    case 'paused':
      stopTicker();
      return paintTime(state);
    case 'countdown': {
      stopTicker();
      // The seconds left before the recording starts, in the recording red.
      const endsAt = state.countdownEndsAt;
      if (!endsAt) return setBadge('…', COUNT_COLOR);
      const paint = () => {
        const left = Math.ceil((endsAt - Date.now()) / 1000);
        if (current?.status !== 'countdown' || left <= 0) return stopCountTicker();
        void setBadge(String(left), COUNT_COLOR);
      };
      countTicker = setInterval(paint, 250);
      paint();
      return;
    }
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
