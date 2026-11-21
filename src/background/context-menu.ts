import { loadSettings } from '@/settings/settings-service';
import { buildRecordingConfig } from '@/recording/services/config';
import { isBusy } from '@/recording/services/recording-state';
import { takeScreenshot } from '@/screenshot/services/capture-service';
import { logger } from '@/shared/utils/logger';
import { toAppError } from '@/shared/utils/errors';
import { getRecordingState, startRecording } from './recording-manager';
import { notify } from './badge';

/*
 * Right-click menu on web pages: "Pixora – Screen Capture Studio" with captures, recordings and
 * shortcuts to Pixora's pages. A menu click grants activeTab for that page, like the toolbar icon.
 */
export const MENU_ROOT = 'pixora';

export type MenuAction =
  | 'capture-visible'
  | 'capture-full'
  | 'capture-area'
  | 'capture-delay'
  | 'capture-ocr'
  | 'capture-desktop'
  | 'record-tab'
  | 'record-area'
  | 'record-desktop'
  | 'record-camera'
  | 'open-editor'
  | 'edit-image'
  | 'open-collage'
  | 'open-history'
  | 'open-settings';

interface MenuEntry {
  id: MenuAction | `sep-${number}`;
  title?: string;
  separator?: true;
  /** Only on these (default: everywhere on the page). */
  contexts?: ['image'];
}

export const MENU_ITEMS: MenuEntry[] = [
  // Right-click on a picture: open it in the image editor (its address is filled in; one click downloads it).
  { id: 'edit-image', title: 'Annotate this image', contexts: ['image'] },
  { id: 'sep-0', separator: true, contexts: ['image'] },
  { id: 'capture-visible', title: 'Capture visible part' },
  { id: 'capture-full', title: 'Capture full page' },
  { id: 'capture-area', title: 'Capture selected area' },
  { id: 'capture-delay', title: 'Capture visible part after delay' },
  { id: 'capture-ocr', title: 'Capture and extract text' },
  { id: 'capture-desktop', title: 'Capture screen or app window…' },
  { id: 'sep-1', separator: true },
  { id: 'record-tab', title: 'Record this tab' },
  { id: 'record-area', title: 'Record an area of this tab' },
  { id: 'record-desktop', title: 'Record screen or app window…' },
  { id: 'record-camera', title: 'Record camera only' },
  { id: 'sep-2', separator: true },
  { id: 'open-editor', title: 'Annotate a local or clipboard image' },
  { id: 'open-collage', title: 'Create a collage' },
  { id: 'open-history', title: 'Recent captures' },
  { id: 'open-settings', title: 'Settings' },
];

/** Pages where the menu shows: web pages and local files (Chrome never shows it on its own pages). */
const PAGES = ['http://*/*', 'https://*/*', 'file:///*'];

/** (Re)creates the menu. Called on install / update and at browser start. */
export async function setupContextMenu(): Promise<void> {
  if (!chrome.contextMenus) return;
  await chrome.contextMenus.removeAll().catch(() => undefined);
  const create = (props: chrome.contextMenus.CreateProperties) =>
    new Promise<void>((resolve) => chrome.contextMenus.create(props, () => { void chrome.runtime.lastError; resolve(); }));
  await create({ id: MENU_ROOT, title: 'Pixora – Screen Capture Studio', contexts: ['all'], documentUrlPatterns: PAGES });
  for (const item of MENU_ITEMS) {
    await create(
      item.separator
        ? { id: item.id, parentId: MENU_ROOT, type: 'separator', contexts: item.contexts ?? ['all'], documentUrlPatterns: PAGES }
        : { id: item.id, parentId: MENU_ROOT, title: item.title ?? '', contexts: item.contexts ?? ['all'], documentUrlPatterns: PAGES },
    );
  }
}

const open = (path: string, tab?: chrome.tabs.Tab) =>
  chrome.tabs.create({ url: chrome.runtime.getURL(path), ...(tab ? { index: tab.index + 1, openerTabId: tab.id } : {}) });

/** True when the recording would need the camera or microphone and Chrome has not allowed it yet. */
async function missingMedia(kinds: Array<'camera' | 'microphone'>): Promise<Array<'camera' | 'microphone'>> {
  const missing: Array<'camera' | 'microphone'> = [];
  for (const k of kinds) {
    try {
      const p = await navigator.permissions.query({ name: k as PermissionName });
      if (p.state !== 'granted') missing.push(k);
    } catch {
      /* Unknown: let the recorder ask. */
    }
  }
  return missing;
}

async function record(mode: 'tab' | 'area' | 'desktop' | 'camera', tab?: chrome.tabs.Tab): Promise<void> {
  if (isBusy(await getRecordingState())) {
    await notify('Already recording', 'Stop the current recording first (Pixora icon in the toolbar).');
    return;
  }
  const settings = await loadSettings();
  const rec = { ...settings.recording, mode, ...(mode === 'area' ? { areaSource: 'tab' as const } : {}) };
  const kinds: Array<'camera' | 'microphone'> = [];
  if (mode === 'camera' || rec.cameraEnabled) kinds.push('camera');
  if (rec.micEnabled) kinds.push('microphone');
  const missing = await missingMedia(kinds);
  if (missing.length) {
    await open(`permissions.html?request=${missing.join(',')}`);
    return;
  }
  const config = buildRecordingConfig(rec, { mode }, { experimental: settings.advanced.experimental, flow: settings.flow.withRecording ? settings.flow : undefined });
  await startRecording(config, tab?.id ?? null);
}

export async function runMenuAction(action: MenuAction, tab?: chrome.tabs.Tab, info?: Pick<chrome.contextMenus.OnClickData, 'srcUrl'>): Promise<void> {
  const tabId = tab?.id;
  try {
    switch (action) {
      case 'capture-visible':
      case 'capture-full':
      case 'capture-area':
        if (tabId !== undefined) await takeScreenshot(action.slice('capture-'.length) as 'visible' | 'full' | 'area', tabId);
        return;
      case 'capture-delay': {
        if (tabId === undefined) return;
        const s = (await loadSettings()).screenshot.delaySeconds;
        await takeScreenshot('visible', tabId, { delaySeconds: s > 0 ? s : 3 });
        return;
      }
      case 'capture-ocr':
        if (tabId !== undefined) await takeScreenshot('visible', tabId, { ocr: true });
        return;
      case 'capture-desktop':
        await open('recorder.html?intent=screenshot', tab);
        return;
      case 'record-tab':
        return record('tab', tab);
      case 'record-area':
        return record('area', tab);
      case 'record-desktop':
        return record('desktop', tab);
      case 'record-camera':
        return record('camera', tab);
      case 'open-editor':
        await open('editor.html?import=1', tab);
        return;
      case 'edit-image': {
        const src = info?.srcUrl ?? '';
        await open(/^(https?:|data:image\/)/i.test(src) && src.length < 1_500_000 ? `editor.html?import=1&url=${encodeURIComponent(src)}` : 'editor.html?import=1', tab);
        return;
      }
      case 'open-collage':
        await open('editor.html?collage=1', tab);
        return;
      case 'open-history':
        await open('options.html#history', tab);
        return;
      case 'open-settings':
        // Settings opens on General (Recent captures has its own item).
        await open('options.html#general', tab);
        return;
    }
  } catch (err) {
    logger.warn(`menu ${action} failed`, err);
    const info = toAppError(err, action.startsWith('record') ? 'screen' : 'capture');
    if (info.code !== 'cancelled') await notify(info.title, [info.message, info.recovery].filter(Boolean).join(' '));
  }
}

export function isMenuAction(id: string | number): id is MenuAction {
  return MENU_ITEMS.some((m) => m.id === id && !m.separator);
}
