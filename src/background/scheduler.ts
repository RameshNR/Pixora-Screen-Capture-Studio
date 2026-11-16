import { loadSettings, updateSettings } from '@/settings/settings-service';
import { buildRecordingConfig } from '@/recording/services/config';
import { toAppError } from '@/shared/utils/errors';
import { notify } from './badge';
import { startRecording } from './recording-manager';

export const SCHEDULE_ALARM = 'glint-scheduled-recording';
export const RETENTION_ALARM = 'glint-retention';

/** Parses <input type="datetime-local"> values (local time). */
export function parseLocalDateTime(value: string): number | null {
  if (!value) return null;
  const t = new Date(value).getTime();
  return Number.isFinite(t) ? t : null;
}

export async function syncScheduleAlarm(): Promise<void> {
  const { schedule } = await loadSettings();
  await chrome.alarms.clear(SCHEDULE_ALARM);
  const start = parseLocalDateTime(schedule.startAt);
  if (schedule.enabled && start && start > Date.now()) {
    await chrome.alarms.create(SCHEDULE_ALARM, { when: start });
  }
}

/**
 * Starts the scheduled recording.
 *
 * Chrome restrictions (explained in the UI as well):
 *  - Camera Only: starts fully automatically.
 *  - Desktop: Chrome always requires the user to pick a screen/window, so the picker opens at the
 *    scheduled time and recording starts as soon as a source is chosen.
 *  - This Tab: tab capture requires the user to have invoked the extension on that tab. It works if
 *    the tab is the one the schedule was created from and has not navigated; otherwise the user gets
 *    a notification asking them to click the Pixora icon.
 */
export async function runScheduledRecording(): Promise<void> {
  const settings = await loadSettings();
  const { schedule } = settings;
  if (!schedule.enabled) return;
  await updateSettings({ schedule: { enabled: false } });

  const start = parseLocalDateTime(schedule.startAt) ?? Date.now();
  const end = parseLocalDateTime(schedule.endAt);
  const maxDurationMs = end && end > start ? end - Math.max(start, Date.now()) : settings.recording.maxDurationMinutes * 60_000;
  const mode = schedule.mode === 'area' ? 'tab' : schedule.mode;
  const config = { ...buildRecordingConfig(settings.recording, { mode, maxDurationMs }, { experimental: settings.advanced.experimental }), countdownSeconds: 3 };

  let tabId: number | null = null;
  if (mode === 'tab') {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    tabId = tab?.id ?? null;
  }
  try {
    await startRecording(config, tabId, true);
    if (mode === 'desktop') await notify('Scheduled recording', 'Choose what to share to start your scheduled recording.');
  } catch (err) {
    const info = toAppError(err);
    await notify(
      'Scheduled recording could not start',
      mode === 'tab'
        ? 'Chrome only allows tab recording after you click the Pixora icon on that tab. Open the popup and press Start Recording.'
        : `${info.title}. ${info.recovery ?? ''}`,
    );
  }
}
