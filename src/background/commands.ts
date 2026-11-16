import { loadSettings } from '@/settings/settings-service';
import { buildRecordingConfig } from '@/recording/services/config';
import { isBusy } from '@/recording/services/recording-state';
import { logger } from '@/shared/utils/logger';
import { takeScreenshot } from '@/screenshot/services/capture-service';
import { getRecordingState, sendCommand, startRecording } from './recording-manager';
import { addMarker, annotate } from './live-tools';
import { captureFlow, getFlowState } from './flow-manager';

/** Keyboard shortcuts (chrome.commands). A shortcut press grants activeTab like a toolbar click. */
export async function handleCommand(command: string, tab?: chrome.tabs.Tab): Promise<void> {
  const activeTab = tab?.id !== undefined ? tab : (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0];
  try {
    switch (command) {
      case 'capture-visible':
        if (activeTab?.id !== undefined) await takeScreenshot('visible', activeTab.id);
        break;
      case 'capture-full':
        if (activeTab?.id !== undefined) await takeScreenshot('full', activeTab.id);
        break;
      case 'capture-area':
        if (activeTab?.id !== undefined) await takeScreenshot('area', activeTab.id);
        break;
      case 'start-recording': {
        const state = await getRecordingState();
        if (isBusy(state)) return;
        const settings = await loadSettings();
        const mode = settings.recording.mode === 'area' ? 'tab' : settings.recording.mode;
        await startRecording(buildRecordingConfig(settings.recording, { mode }, { experimental: settings.advanced.experimental }), activeTab?.id ?? null);
        break;
      }
      case 'pause-resume-recording':
        await sendCommand('toggle-pause');
        break;
      case 'stop-recording':
        await sendCommand('stop');
        break;
      case 'flow-capture': {
        const flow = await getFlowState();
        if (flow.status === 'recording') await captureFlow(flow.config?.mode ?? 'visible');
        break;
      }
      case 'add-marker':
        await addMarker();
        break;
      case 'toggle-annotation': {
        // A shortcut press grants activeTab for the current page, so drawing works on any page.
        const state = await getRecordingState();
        await annotate({ kind: state.effects.annotating ? 'stop' : 'start' }, activeTab?.id);
        break;
      }
      case 'open-editor':
        await chrome.tabs.create({ url: chrome.runtime.getURL('editor.html?import=1') });
        break;
      default:
        break;
    }
  } catch (err) {
    logger.warn(`command ${command} failed`, err);
  }
}
