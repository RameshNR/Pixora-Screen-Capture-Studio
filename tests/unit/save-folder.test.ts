import { beforeEach, describe, expect, it, vi } from 'vitest';

const saveToFolder = vi.fn();
vi.mock('@/shared/utils/save-folder', async (orig) => ({ ...(await orig<typeof import('@/shared/utils/save-folder')>()), saveToFolder: (...a: unknown[]) => saveToFolder(...a) }));

const { downloadBlob, SAVED_TO_FOLDER } = await import('@/shared/utils/download');
const { freeName } = await import('@/shared/utils/save-folder');

const setLocation = (location: string) => chrome.storage.local.set({ 'glint.settings': { storage: { location } } });

describe('saving to a folder chosen on this computer', () => {
  beforeEach(() => {
    saveToFolder.mockReset();
    (chrome as unknown as { downloads: object }).downloads = { download: vi.fn(async () => 7), onChanged: { addListener: vi.fn(), removeListener: vi.fn() }, onErased: { addListener: vi.fn(), removeListener: vi.fn() }, search: vi.fn(async () => [{ id: 7, state: 'complete' }]) };
    globalThis.URL.createObjectURL = vi.fn(() => 'blob:x');
    globalThis.URL.revokeObjectURL = vi.fn();
  });

  it('writes into the chosen folder (with the sub-folder) instead of Downloads', async () => {
    await setLocation('folder');
    saveToFolder.mockResolvedValue('shot.png');
    expect(await downloadBlob(new Blob(['x']), 'shot.png', { subfolder: 'Pixora' })).toBe(SAVED_TO_FOLDER);
    expect(saveToFolder).toHaveBeenCalledWith(expect.any(Blob), 'shot.png', 'Pixora');
    expect(chrome.downloads.download).not.toHaveBeenCalled();
  });

  it('falls back to Downloads when access was not given or writing failed', async () => {
    await setLocation('folder');
    saveToFolder.mockResolvedValueOnce(null);
    expect(await downloadBlob(new Blob(['x']), 'a.png')).toBe(7);
    saveToFolder.mockRejectedValueOnce(new Error('disk'));
    expect(await downloadBlob(new Blob(['x']), 'b.png')).toBe(7);
  });

  it('uses Downloads (and the Save-as dialog) when chosen', async () => {
    await setLocation('downloads');
    expect(await downloadBlob(new Blob(['x']), 'c.png')).toBe(7);
    await setLocation('folder');
    expect(await downloadBlob(new Blob(['x']), 'd.png', { saveAs: true })).toBe(7);
    expect(saveToFolder).not.toHaveBeenCalled();
  });

  it('never overwrites a file already in the folder', async () => {
    const existing = new Set(['shot.png', 'shot (1).png']);
    const dir = { getFileHandle: async (n: string) => { if (!existing.has(n)) throw new DOMException('nope', 'NotFoundError'); return {}; } } as unknown as FileSystemDirectoryHandle;
    expect(await freeName(dir, 'shot.png')).toBe('shot (2).png');
    expect(await freeName(dir, 'new.png')).toBe('new.png');
  });
});
