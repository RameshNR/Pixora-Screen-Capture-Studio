import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getCapture, listCaptures, clearAllCaptures } from '@/history/history-service';
import { updateSettings } from '@/settings/settings-service';

// Canvas / captureVisibleTab are browser-only; the capture primitives are covered by e2e tests.
const fakeCanvas = (w: number, h: number) => ({
  width: w,
  height: h,
  convertToBlob: async () => new Blob(['png-bytes'], { type: 'image/png' }),
});

vi.mock('@/screenshot/services/visible-capture', () => ({
  captureVisible: vi.fn(async () => ({ canvas: fakeCanvas(1280, 720), title: 'Example', url: 'https://example.com/', notes: [] })),
  captureVisibleTabRaw: vi.fn(),
  getPageInfo: vi.fn(),
}));
vi.mock('@/screenshot/services/full-page-capture', () => ({
  captureFullPage: vi.fn(async (_tab: unknown, _o: unknown, _s: unknown, onProgress: (p: number) => void) => {
    onProgress(0.5);
    onProgress(1);
    return { canvas: fakeCanvas(1280, 9000), title: 'Long', url: 'https://example.com/long', notes: ['note'] };
  }),
}));
vi.mock('@/screenshot/services/area-capture', () => ({
  captureArea: vi.fn(async () => ({ canvas: fakeCanvas(300, 200), title: 'Area', url: 'https://example.com/', notes: [] })),
}));
vi.mock('@/recording/services/thumbnail', () => ({ generateImageThumbnail: vi.fn(async () => 'data:image/jpeg;base64,AA'), generateVideoThumbnail: vi.fn() }));

describe('screenshot pipeline (service worker side)', () => {
  beforeEach(async () => {
    await clearAllCaptures();
  });

  it('captures the visible part, stores it and opens the editor', async () => {
    const { takeScreenshot } = await import('@/screenshot/services/capture-service');
    await takeScreenshot('visible', 1);
    const [record] = await listCaptures();
    expect(record).toMatchObject({ kind: 'screenshot', width: 1280, height: 720, mimeType: 'image/png', sourceUrl: 'https://example.com/' });
    expect(record!.name).toMatch(/^Pixora Screenshot .*\.png$/);
    // The editor opens at once ("Preparing…") and becomes the editor with the image when it is stored.
    expect(chrome.tabs.create).toHaveBeenCalledWith(expect.objectContaining({ url: expect.stringContaining('editor.html?preparing=1') }));
    expect(chrome.tabs.update).toHaveBeenCalledWith(900, expect.objectContaining({ url: expect.stringContaining(`editor.html?id=${record!.id}`) }));
  });

  it('runs full-page capture with progress and keeps capture notes', async () => {
    const { takeScreenshot } = await import('@/screenshot/services/capture-service');
    await takeScreenshot('full', 1);
    const [record] = await listCaptures();
    expect(record!.height).toBe(9000);
    expect(record!.notes).toEqual(['note']);
    expect(chrome.action.setBadgeText).toHaveBeenCalledWith({ text: '50%' });
    expect(chrome.action.setBadgeText).toHaveBeenLastCalledWith({ text: '' });
  });

  it('requests OCR through the editor URL', async () => {
    const { takeScreenshot } = await import('@/screenshot/services/capture-service');
    await updateSettings({ screenshot: { autoOpenEditor: false } });
    await takeScreenshot('visible', 1, { ocr: true });
    const [record] = await listCaptures();
    expect((await getCapture(record!.id))?.ocrRequested).toBe(true);
    expect(chrome.tabs.update).toHaveBeenCalledWith(900, expect.objectContaining({ url: expect.stringContaining('ocr=1') }));
  });

  it('auto-saves via the offscreen document when the editor is disabled', async () => {
    chrome.runtime.sendMessage = vi.fn(async (msg: { type: string }) =>
      msg.type === 'offscreen/object-url' ? { ok: true, data: 'blob:chrome-extension://x/1' } : { ok: true, data: null },
    ) as unknown as typeof chrome.runtime.sendMessage;
    chrome.runtime.getContexts = vi.fn(async () => [{}]) as unknown as typeof chrome.runtime.getContexts;
    const { takeScreenshot } = await import('@/screenshot/services/capture-service');
    await updateSettings({ screenshot: { autoOpenEditor: false, autoSave: true, format: 'jpeg' } });
    await takeScreenshot('visible', 1);
    expect(chrome.downloads.download).toHaveBeenCalledWith(expect.objectContaining({ url: 'blob:chrome-extension://x/1', filename: expect.stringMatching(/^Pixora\/Pixora Screenshot .*\.jpg$/) }));
    expect(chrome.notifications.create).toHaveBeenCalled();
  });

  it('starts an area selection in the page and completes it from the overlay result', async () => {
    const { takeScreenshot, completeAreaScreenshot } = await import('@/screenshot/services/capture-service');
    await takeScreenshot('area', 1);
    expect(chrome.scripting.executeScript).toHaveBeenCalledWith({ target: { tabId: 1 }, files: ['content/overlay.js'] });
    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(1, expect.objectContaining({ type: 'overlay/select', mode: 'area-screenshot' }));
    await completeAreaScreenshot({ x: 0, y: 0, width: 150, height: 100 }, { width: 1280, height: 720 });
    const [record] = await listCaptures();
    expect(record).toMatchObject({ width: 300, height: 200, sourceTitle: 'Area' });
    // A second result without a pending selection is rejected.
    await expect(completeAreaScreenshot({ x: 0, y: 0, width: 1, height: 1 }, { width: 1, height: 1 })).rejects.toMatchObject({ code: 'cancelled' });
  });

  it('reports restricted pages clearly', async () => {
    chrome.scripting.executeScript = vi.fn(async () => {
      throw new Error('Cannot access a chrome:// URL');
    }) as unknown as typeof chrome.scripting.executeScript;
    const { takeScreenshot } = await import('@/screenshot/services/capture-service');
    await expect(takeScreenshot('area', 1)).rejects.toMatchObject({ code: 'restricted-page' });
  });
});
