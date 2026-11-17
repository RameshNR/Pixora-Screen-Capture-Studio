import { beforeEach, describe, expect, it, vi } from 'vitest';
import { downloadBlob } from '@/shared/utils/download';

type Ev = { addListener: (l: (...a: unknown[]) => void) => void; removeListener: (l: (...a: unknown[]) => void) => void; emit: (...a: unknown[]) => void };
const dl = () => chrome.downloads as unknown as { download: ReturnType<typeof vi.fn>; search: ReturnType<typeof vi.fn>; onChanged: Ev; onErased: Ev };
const tick = () => new Promise((r) => setTimeout(r, 0));

describe('"Ask where to save": success only after the file is really saved', () => {
  beforeEach(() => {
    dl().download.mockImplementation(async () => 5);
    dl().search.mockImplementation(async () => [{ id: 5, state: 'in_progress' }]); // Save-as dialog open
    globalThis.URL.createObjectURL = vi.fn(() => 'blob:x');
    globalThis.URL.revokeObjectURL = vi.fn();
  });

  it('waits while the Save-as dialog is open, then resolves once saved', async () => {
    let settled = false;
    const p = downloadBlob(new Blob(['x']), 'a.png', { saveAs: true }).then((id) => { settled = true; return id; });
    await tick();
    await tick();
    expect(settled).toBe(false); // no "Downloaded" while the user is still choosing
    dl().onChanged.emit({ id: 5, state: { current: 'complete' } });
    expect(await p).toBe(5);
  });

  it('closing the dialog is a quiet cancel (no success message)', async () => {
    const p = downloadBlob(new Blob(['x']), 'b.png', { saveAs: true });
    await tick();
    dl().onChanged.emit({ id: 5, state: { current: 'interrupted' }, error: { current: 'USER_CANCELED' } });
    await expect(p).rejects.toMatchObject({ code: 'cancelled' });
  });

  it('a real failure is reported, a removed item counts as cancelled', async () => {
    const p = downloadBlob(new Blob(['x']), 'c.png', { saveAs: true });
    await tick();
    dl().onChanged.emit({ id: 5, state: { current: 'interrupted' }, error: { current: 'FILE_NO_SPACE' } });
    await expect(p).rejects.toMatchObject({ code: 'export-failed' });
    const q = downloadBlob(new Blob(['x']), 'd.png', { saveAs: true });
    await tick();
    dl().onErased.emit(5);
    await expect(q).rejects.toMatchObject({ code: 'cancelled' });
  });

  it('without asking, it returns at once as before', async () => {
    expect(await downloadBlob(new Blob(['x']), 'e.png')).toBe(5);
  });
});
