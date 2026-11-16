import { isBackgroundMessage, type BackgroundMessage, type MessageResponse } from '@/shared/messaging/messages';
import { fail, ok } from '@/shared/messaging/client';
import { logger } from '@/shared/utils/logger';
import { cancelAreaScreenshot, completeAreaScreenshot, takeScreenshot } from '@/screenshot/services/capture-service';
import { findScrollAreas, highlightScrollArea, requestFullPageStop } from '@/screenshot/services/full-page-capture';
import {
  getPending, getRecordingState, onAreaCancelled, onAreaSelected, onHostEvent, onHostFinished, resizeControlBar,
  sendCommand, startRecording,
} from './recording-manager';
import { syncScheduleAlarm } from './scheduler';
import {
  armFlow, cancelFlow, captureFlow, finishFlow, startArmedFlow, getFlowState, onFlowEvent, onFlowHover, onPageImageAdded, pauseFlow, setFlowBarMinimized, startFlow, undoLastCapture, onFlowActivity } from './flow-manager';
import { addMarker, annotate, applyEffect, onRegionSelected, openTeleprompter, resetLiveTools, resumeAfterRegion, startRegionSelect, updateMarker } from './live-tools';

/**
 * Routes validated messages to the right controller. Messages from other extensions or web pages are
 * rejected (sender.id check + structural validation in isBackgroundMessage).
 */
export function registerMessageHandler(): void {
  chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
    if (sender.id !== chrome.runtime.id) return false;
    if (!isBackgroundMessage(message)) return false;
    handle(message, sender)
      .then((data) => sendResponse(ok(data ?? null)))
      .catch((err: unknown) => {
        logger.warn(`message ${message.type} failed`, err);
        sendResponse(fail(err) satisfies MessageResponse);
      });
    return true; // async response
  });
}

function fromContentScript(sender: chrome.runtime.MessageSender): boolean {
  return Boolean(sender.tab && sender.url && !sender.url.startsWith(chrome.runtime.getURL('')));
}

async function handle(msg: BackgroundMessage, sender: chrome.runtime.MessageSender): Promise<unknown> {
  switch (msg.type) {
    case 'screenshot/capture':
      return takeScreenshot(msg.mode, msg.tabId, { delaySeconds: msg.delaySeconds, ocr: msg.ocr, scrollAreas: msg.scrollAreas });
    case 'screenshot/scroll-areas':
      return findScrollAreas(msg.tabId);
    case 'screenshot/stop-full':
      // Only Pixora's own progress window (not a web page) can stop it.
      if (!fromContentScript(sender)) requestFullPageStop();
      return null;
    case 'screenshot/highlight-area':
      return highlightScrollArea(msg.tabId, msg.index, msg.show);
    case 'screenshot/area-result':
      return completeAreaScreenshot(msg.rect, msg.viewport);
    case 'screenshot/area-cancel':
      return cancelAreaScreenshot();
    case 'recording/start':
      resetLiveTools();
      return startRecording(msg.config, msg.tabId);
    case 'recording/save-file':
      return chrome.downloads.download({ url: msg.url, filename: msg.filename, conflictAction: 'uniquify', saveAs: false });
    case 'recording/marker':
      return addMarker(msg.name, msg.description);
    case 'recording/marker-update':
      return updateMarker(msg.id, { name: msg.name, description: msg.description, remove: msg.remove });
    case 'recording/effect':
      return applyEffect(msg.effect);
    case 'recording/annotate':
      // Only the page overlay (a content script) picks the page to draw on; extension pages such as
      // the control bar window are tabs too and must never become the drawing target.
      return annotate(msg.action, fromContentScript(sender) ? sender.tab?.id : undefined);
    case 'recording/region-select':
      return startRegionSelect(msg.purpose);
    case 'recording/region-cancelled':
      return resumeAfterRegion();
    case 'recording/region-selected':
      return onRegionSelected(msg.purpose, msg.rect, msg.page);
    case 'teleprompter/open':
      return openTeleprompter();
    case 'flow/start':
      return startFlow({ tabId: msg.tabId, config: msg.config, limited: msg.limited });
    case 'flow/arm':
      return armFlow(msg.tabId, msg.config);
    case 'flow/start-armed':
      return startArmedFlow();
    case 'flow/event':
      // Only page overlays report interactions.
      return fromContentScript(sender) ? onFlowEvent(sender.tab?.id, msg.event, sender.tab?.windowId) : null;
    case 'flow/activity':
      if (fromContentScript(sender)) onFlowActivity(sender.tab?.id);
      return null;
    case 'flow/hover':
      return fromContentScript(sender) ? onFlowHover(sender.tab?.id, msg.selector) : null;
    case 'flow/command':
      if (msg.command === 'pause' || msg.command === 'resume') return pauseFlow(msg.command === 'pause');
      if (msg.command === 'finish') return finishFlow();
      return cancelFlow();
    case 'flow/get-state':
      return getFlowState();
    case 'flow/capture':
      return captureFlow(msg.mode);
    case 'flow/undo':
      return undoLastCapture();
    case 'flow/minimize':
      return setFlowBarMinimized(msg.minimized);
    case 'flow/page-image':
      return onPageImageAdded(msg.item);
    case 'recording/area-selected':
      return onAreaSelected(msg.rect);
    case 'recording/area-cancel':
      return onAreaCancelled();
    case 'recording/command':
      return sendCommand(msg.command);
    case 'recording/get-state':
      return getRecordingState();
    case 'recording/get-pending':
      return getPending(msg.sessionId);
    case 'recording/host-event':
      return onHostEvent(msg.sessionId, msg.event);
    case 'recording/host-finished':
      return onHostFinished(msg.sessionId, msg.captureId, msg.error);
    case 'controlbar/resize':
      return resizeControlBar(msg.minimized, msg.expanded ?? false);
    case 'history/open':
      return chrome.tabs.create({ url: chrome.runtime.getURL(`options.html#history`), index: sender.tab ? sender.tab.index + 1 : undefined });
    case 'schedule/update':
      return syncScheduleAlarm();
    default:
      return null;
  }
}
