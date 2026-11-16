import { loadSettings, subscribeSettings } from '@/settings/settings-service';
import { applyRetention } from '@/history/history-service';
import { logger } from '@/shared/utils/logger';
import { handleCommand } from './commands';
import { registerMessageHandler } from './message-handler';
import { highlightScrollArea } from '@/screenshot/services/full-page-capture';
import { SCROLL_AREAS_PORT } from '@/shared/messaging/messages';
import { onTabRemoved, onWindowRemoved, verifyAfterRestart } from './recording-manager';
import { onFlowWindowRemoved, onPermissionsAdded, onTabActivated, onTabCreated, onTabUpdated, verifyFlowAfterRestart } from './flow-manager';
import { RETENTION_ALARM, SCHEDULE_ALARM, runScheduledRecording, syncScheduleAlarm } from './scheduler';

/*
 * MV3 service worker: lifecycle + message coordination only. It never touches DOM or MediaRecorder;
 * media work happens in the offscreen document or recorder tab. All listeners are registered
 * synchronously at top level so Chrome can wake the worker for them.
 */
registerMessageHandler();

chrome.commands.onCommand.addListener((command, tab) => {
  void handleCommand(command, tab);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void onTabRemoved(tabId);
});

chrome.windows.onRemoved.addListener((windowId) => {
  void onWindowRemoved(windowId);
  void onFlowWindowRemoved(windowId);
});

// Flow Capture follows the user across page loads and into tabs opened from followed tabs.
chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  void onTabUpdated(tabId, info, tab);
});

chrome.tabs.onCreated.addListener((tab) => {
  void onTabCreated(tab);
});

chrome.tabs.onActivated.addListener(({ tabId }) => {
  void onTabActivated(tabId);
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === SCHEDULE_ALARM) void runScheduledRecording();
  if (alarm.name === RETENTION_ALARM) {
    void loadSettings().then((s) => applyRetention(s.storage.retentionDays)).catch(() => undefined);
  }
});

chrome.notifications.onClicked.addListener((notificationId) => {
  if (notificationId.startsWith('capture:')) {
    const id = notificationId.slice('capture:'.length);
    void chrome.tabs.create({ url: chrome.runtime.getURL(`editor.html?id=${encodeURIComponent(id)}`) });
  }
  void chrome.notifications.clear(notificationId);
});

chrome.runtime.onInstalled.addListener((details) => {
  void chrome.alarms.create(RETENTION_ALARM, { periodInMinutes: 360 });
  void syncScheduleAlarm();
  if (details.reason === 'install') {
    void chrome.tabs.create({ url: chrome.runtime.getURL('options.html#welcome') });
  }
});

chrome.permissions.onAdded.addListener((perms) => {
  void onPermissionsAdded(perms).catch((err: unknown) => logger.warn('permission change handling failed', err));
});

chrome.runtime.onStartup.addListener(() => {
  void syncScheduleAlarm();
});

subscribeSettings(() => {
  void syncScheduleAlarm();
});

void loadSettings().catch(() => undefined);
void verifyAfterRestart().catch((err: unknown) => logger.error('restart verification failed', err));
void verifyFlowAfterRestart().catch((err: unknown) => logger.error('flow restart verification failed', err));

// The popup's scroll-area chooser keeps a port open while it shows the outlines on the page. When
// the popup closes (any way: Back, capture, click outside, Esc), the port disconnects and the
// outlines are removed.
chrome.runtime.onConnect.addListener((port) => {
  const m = /^(.+):(\d{1,12})$/.exec(port.name);
  // Only Pixora's own pages (not content scripts, which share the extension id but run on web pages).
  if (!m || m[1] !== SCROLL_AREAS_PORT || port.sender?.id !== chrome.runtime.id || !port.sender.url?.startsWith(chrome.runtime.getURL(''))) return;
  const tabId = Number(m[2]);
  port.onDisconnect.addListener(() => {
    void highlightScrollArea(tabId, null, false).catch(() => undefined);
  });
});
