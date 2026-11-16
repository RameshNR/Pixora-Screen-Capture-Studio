import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '@/shared/constants/defaults';
import { buildRecordingConfig } from '@/recording/services/config';
import type { ActualRecordingInfo, RecordingConfig, RecordingState } from '@/shared/types';
import { appendChunk, saveSessionMeta } from '@/recording/services/chunk-store';
import { getCapture } from '@/history/history-service';

type Manager = typeof import('@/background/recording-manager');

const actual: ActualRecordingInfo = { width: 1920, height: 1080, fps: 30, mimeType: 'video/webm;codecs=vp9,opus', sourceWidth: 1920, sourceHeight: 1080, videoBitrate: 8e6, hasMicrophone: false, hasSystemAudio: true };

let sent: Array<Record<string, unknown>>;
let offscreenAlive: boolean;

async function freshManager(): Promise<Manager> {
  vi.resetModules();
  return import('@/background/recording-manager');
}

function cfg(mode: RecordingConfig['mode'], extra: Partial<RecordingConfig> = {}): RecordingConfig {
  return { ...buildRecordingConfig(DEFAULT_SETTINGS.recording, { mode }), countdownSeconds: 0, ...extra };
}

beforeEach(() => {
  sent = [];
  offscreenAlive = false;
  chrome.runtime.sendMessage = vi.fn(async (msg: Record<string, unknown>) => {
    sent.push(msg);
    return { ok: true, data: null };
  }) as unknown as typeof chrome.runtime.sendMessage;
  chrome.runtime.getContexts = vi.fn(async () => (offscreenAlive ? [{}] : [])) as unknown as typeof chrome.runtime.getContexts;
  chrome.offscreen.createDocument = vi.fn(async () => {
    offscreenAlive = true;
  }) as unknown as typeof chrome.offscreen.createDocument;
});

const hostMessages = (type: string) => sent.filter((m) => m.target === 'host' && m.type === type);

describe('recording manager (service worker)', () => {
  it('runs a full tab recording through the offscreen host', async () => {
    const m = await freshManager();
    // The control window is opt-in (Settings); this test switches it on to check it opens and closes.
    const state = await m.startRecording(cfg('tab', { controlBar: true }), 5);
    expect(state.status).toBe('preparing');
    expect(state.host).toBe('offscreen');
    expect(chrome.tabCapture.getMediaStreamId).toHaveBeenCalledWith({ targetTabId: 5 });
    expect(chrome.offscreen.createDocument).toHaveBeenCalledOnce();
    const start = hostMessages('host/start')[0]!;
    expect(start).toMatchObject({ streamId: 'stream-id-123', area: null, tabId: 5, sourceUrl: 'https://example.com/' });

    const sessionId = state.sessionId!;
    await m.onHostEvent(sessionId, { type: 'STARTED', at: Date.now(), actual, micAvailable: false, cameraAvailable: false, warnings: [] });
    let s = await m.getRecordingState();
    expect(s.status).toBe('recording');
    expect(chrome.windows.create).toHaveBeenCalledWith(expect.objectContaining({ type: 'popup', url: expect.stringContaining('controlbar.html') }));
    expect(chrome.action.setBadgeText).toHaveBeenLastCalledWith({ text: expect.stringMatching(/^\d+:\d\d$/) });

    // A second recording cannot start while one is running.
    await expect(m.startRecording(cfg('tab'), 5)).rejects.toMatchObject({ code: 'already-recording' });

    // Commands are routed to the host.
    await m.sendCommand('pause');
    expect(hostMessages('host/command').at(-1)).toMatchObject({ command: 'pause', sessionId });
    await m.onHostEvent(sessionId, { type: 'PAUSED', at: Date.now() });
    expect((await m.getRecordingState()).status).toBe('paused');

    // Events from another session are ignored.
    await m.onHostEvent('someone-else', { type: 'RESUMED', at: Date.now() });
    expect((await m.getRecordingState()).status).toBe('paused');

    await m.onHostFinished(sessionId, 'v_123');
    s = await m.getRecordingState();
    expect(s.status).toBe('idle');
    expect(chrome.tabs.create).toHaveBeenCalledWith(expect.objectContaining({ url: expect.stringContaining('video.html?id=v_123') }));
    expect(chrome.windows.remove).toHaveBeenCalledWith(77);
    expect(chrome.offscreen.closeDocument).toHaveBeenCalled();
  });

  it('persists state across service-worker restarts', async () => {
    const m1 = await freshManager();
    const { sessionId } = await m1.startRecording(cfg('tab'), 5);
    await m1.onHostEvent(sessionId!, { type: 'STARTED', at: Date.now(), actual, micAvailable: false, cameraAvailable: false, warnings: [] });
    const m2 = await freshManager(); // simulates the worker being suspended and restarted
    const s: RecordingState = await m2.getRecordingState();
    expect(s.status).toBe('recording');
    expect(s.sessionId).toBe(sessionId);
  });

  it('opens a recorder tab for desktop recordings and reuses it for the result', async () => {
    const m = await freshManager();
    const state = await m.startRecording(cfg('desktop'), 5);
    expect(chrome.tabs.create).toHaveBeenCalledWith(expect.objectContaining({ url: expect.stringContaining(`recorder.html?session=${state.sessionId}`) }));
    expect(state.host).toBe('recorder-tab');
    expect(state.hostTabId).toBe(900);
    const pending = await m.getPending(state.sessionId!);
    expect(pending.config.mode).toBe('desktop');
    await m.onHostFinished(state.sessionId!, 'v_9');
    expect(chrome.tabs.update).toHaveBeenCalledWith(900, expect.objectContaining({ url: expect.stringContaining('video.html?id=v_9') }));
  });

  it('asks the page for an area before recording a custom region', async () => {
    const m = await freshManager();
    const state = await m.startRecording(cfg('area'), 5);
    expect(state.status).toBe('selecting');
    expect(chrome.scripting.executeScript).toHaveBeenCalledWith({ target: { tabId: 5 }, files: ['content/overlay.js'] });
    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(5, expect.objectContaining({ type: 'overlay/select', mode: 'area-record' }));
    expect(chrome.tabCapture.getMediaStreamId).not.toHaveBeenCalled();
    const area = { x: 0.1, y: 0.2, width: 0.5, height: 0.4 };
    await m.onAreaSelected(area);
    expect(hostMessages('host/start')[0]).toMatchObject({ area });
  });

  it('cancelling the area selection resets the session', async () => {
    const m = await freshManager();
    await m.startRecording(cfg('area'), 5);
    await m.onAreaCancelled();
    expect((await m.getRecordingState()).status).toBe('idle');
  });

  it('reports permission problems as errors and lets the user dismiss them', async () => {
    chrome.tabCapture.getMediaStreamId = vi.fn(async () => {
      throw new Error('Extension has not been invoked for the current page');
    }) as unknown as typeof chrome.tabCapture.getMediaStreamId;
    const m = await freshManager();
    await expect(m.startRecording(cfg('tab'), 5)).rejects.toBeTruthy();
    const s = await m.getRecordingState();
    expect(s.status).toBe('error');
    expect(s.error?.code).toBe('restricted-page');
    expect(chrome.notifications.create).toHaveBeenCalled();
    await m.sendCommand('cancel');
    expect((await m.getRecordingState()).status).toBe('idle');
  });

  it('recovers the recording when the recorder tab is closed mid-recording', async () => {
    const m = await freshManager();
    const config = cfg('camera');
    const state = await m.startRecording(config, null);
    const sessionId = state.sessionId!;
    await m.onHostEvent(sessionId, { type: 'STARTED', at: Date.now() - 4000, actual, micAvailable: false, cameraAvailable: false, warnings: [] });
    await saveSessionMeta({ sessionId, mode: 'camera', mimeType: 'video/webm', startedAt: Date.now(), activeMs: 4000, width: 1280, height: 720, fps: 30, config, notes: [], hasMicrophone: false, hasSystemAudio: false });
    await appendChunk(sessionId, 0, new Blob(['chunk-0']));
    await appendChunk(sessionId, 1, new Blob(['chunk-1']));

    await m.onTabRemoved(state.hostTabId!);

    expect((await m.getRecordingState()).status).toBe('idle');
    const openCall = vi.mocked(chrome.tabs.create).mock.calls.map((c) => (c[0] as { url: string }).url).find((u) => u.includes('video.html?id='));
    expect(openCall).toBeTruthy();
    const id = decodeURIComponent(openCall!.split('id=')[1]!.split('&')[0]!);
    const saved = await getCapture(id);
    expect(saved?.kind).toBe('video');
    expect(saved?.notes?.join(' ')).toMatch(/Recovered/);
  });
});
