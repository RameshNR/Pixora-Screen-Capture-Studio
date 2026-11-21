import { afterEach, describe, expect, it, vi } from 'vitest';
import { describeKeys, formatKeys, keyOf, setMacForTests } from '@/shared/utils/keys';
import { COUNT_COLOR, countdownOnBadge } from '@/background/badge';
import { MENU_ITEMS, MENU_ROOT, isMenuAction, runMenuAction, setupContextMenu } from '@/background/context-menu';
import manifest from '../../public/manifest.json';

afterEach(() => setMacForTests(null));

describe('Mac keyboard shortcuts', () => {
  it('shows shortcuts the Mac way on a Mac', () => {
    expect(formatKeys('Ctrl+Z', true)).toBe('⌘Z');
    expect(formatKeys('Ctrl+Z / Ctrl+Y', true)).toBe('⌘Z / ⇧⌘Z');
    expect(formatKeys('Ctrl+Shift+C', true)).toBe('⇧⌘C');
    expect(formatKeys('Alt+Shift+V', true)).toBe('⌥⇧V');
    expect(formatKeys('Ctrl++ / Ctrl+−', true)).toBe('⌘+ / ⌘−');
    expect(formatKeys('Ctrl+] / Ctrl+[', true)).toBe('⌘] / ⌘[');
    expect(formatKeys('Ctrl + click', true)).toBe('⌘ + click');
    expect(formatKeys('Ctrl + Shift + click', true)).toBe('⇧⌘ + click');
    expect(formatKeys('Undo (Ctrl+Z)', true)).toBe('Undo (⌘Z)');
    expect(formatKeys('Press M here, Alt+Shift+M in the page', true)).toBe('Press M here, ⌥⇧M in the page');
  });

  it('keeps text without shortcuts, and everything on other systems', () => {
    expect(formatKeys('Alternatively, control the page', true)).toBe('Alternatively, control the page');
    expect(formatKeys('Ctrl+Z / Ctrl+Y', false)).toBe('Ctrl+Z / Ctrl+Y');
    setMacForTests(false);
    expect(formatKeys('Alt+Shift+V')).toBe('Alt+Shift+V');
    setMacForTests(true);
    expect(formatKeys('Alt+Shift+V')).toBe('⌥⇧V');
  });

  it('reads Option + letter by its key (Option+Shift+D types Î on a Mac)', () => {
    expect(keyOf({ key: 'Î', code: 'KeyD', altKey: true })).toBe('d');
    expect(keyOf({ key: 'z', code: 'KeyZ', altKey: false })).toBe('z');
  });

  it('writes recorded key combinations for each system', () => {
    const e = { key: 'z', code: 'KeyZ', ctrlKey: false, metaKey: true, altKey: false, shiftKey: true };
    expect(describeKeys(e, true)).toBe('⇧⌘Z');
    expect(describeKeys({ ...e, metaKey: false, ctrlKey: true }, false)).toBe('Ctrl + Shift + Z');
    expect(describeKeys({ key: '∂', code: 'KeyD', ctrlKey: false, metaKey: false, altKey: true, shiftKey: false }, true)).toBe('⌥D');
    expect(describeKeys({ key: 'Enter', code: 'Enter', ctrlKey: false, metaKey: true, altKey: false, shiftKey: false }, true)).toBe('⌘↩');
  });
});

describe('Right-click menu', () => {
  it('needs only the contextMenus permission (no warning, no new host access)', () => {
    expect(manifest.permissions).toContain('contextMenus');
    expect((manifest as Record<string, unknown>).host_permissions).toBeUndefined();
  });

  it('adds Pixora with captures, recordings and pages under it, on web pages only', async () => {
    await setupContextMenu();
    const calls = (chrome.contextMenus.create as unknown as { mock: { calls: Array<[chrome.contextMenus.CreateProperties]> } }).mock.calls.map((c) => c[0]);
    expect(calls[0]).toMatchObject({ id: MENU_ROOT, title: 'Pixora – Screen Capture Studio' });
    expect(calls[0]!.documentUrlPatterns).toEqual(['http://*/*', 'https://*/*', 'file:///*']);
    const titles = calls.slice(1).filter((c) => c.type !== 'separator').map((c) => c.title);
    for (const t of ['Capture visible part', 'Capture full page', 'Capture selected area', 'Record this tab', 'Record screen or app window…', 'Settings']) expect(titles).toContain(t);
    expect(calls.slice(1).every((c) => c.parentId === MENU_ROOT)).toBe(true);
    expect(calls.length).toBe(MENU_ITEMS.length + 1);
  });

  it('knows its own items only', () => {
    expect(isMenuAction('capture-visible')).toBe(true);
    expect(isMenuAction('sep-1')).toBe(false);
    expect(isMenuAction('something-else')).toBe(false);
  });

  it('opens Pixora pages next to the page', async () => {
    const tab = { id: 5, index: 3 } as chrome.tabs.Tab;
    await runMenuAction('open-editor', tab);
    await runMenuAction('capture-desktop', tab);
    const urls = (chrome.tabs.create as unknown as { mock: { calls: Array<[{ url: string; index?: number }]> } }).mock.calls.map((c) => c[0]);
    expect(urls[0]).toMatchObject({ url: 'chrome-extension://test-extension-id/editor.html?import=1', index: 4, openerTabId: 5 });
    expect(urls[1]!.url).toBe('chrome-extension://test-extension-id/recorder.html?intent=screenshot');
  });

  it('Settings opens General; Recent captures its own page; a right-clicked picture goes to the editor', async () => {
    const tab = { id: 5, index: 3 } as chrome.tabs.Tab;
    await runMenuAction('open-settings', tab);
    await runMenuAction('open-history', tab);
    await runMenuAction('edit-image', tab, { srcUrl: 'https://example.com/a b.png' });
    await runMenuAction('edit-image', tab, { srcUrl: 'blob:https://example.com/123' });
    const urls = (chrome.tabs.create as unknown as { mock: { calls: Array<[{ url: string }]> } }).mock.calls.map((c) => c[0].url.replace('chrome-extension://test-extension-id/', ''));
    expect(urls).toEqual(['options.html#general', 'options.html#history', 'editor.html?import=1&url=https%3A%2F%2Fexample.com%2Fa%20b.png', 'editor.html?import=1']);
  });

  it('shows "Annotate this image" only on pictures', async () => {
    await setupContextMenu();
    const calls = (chrome.contextMenus.create as unknown as { mock: { calls: Array<[chrome.contextMenus.CreateProperties]> } }).mock.calls.map((c) => c[0]);
    expect(calls.find((c) => c.id === 'edit-image')).toMatchObject({ title: 'Annotate this image', contexts: ['image'] });
    expect(calls.find((c) => c.id === 'capture-visible')!.contexts).toEqual(['all']);
  });
});

describe('Countdowns on the toolbar icon', () => {
  it('count the seconds in the recording red, then clear', async () => {
    vi.useFakeTimers();
    const done = countdownOnBadge(3);
    await vi.advanceTimersByTimeAsync(3100);
    expect(await done).toBe('done');
    vi.useRealTimers();
    const colors = (chrome.action.setBadgeBackgroundColor as unknown as { mock: { calls: Array<[{ color: string }]> } }).mock.calls.map((c) => c[0].color);
    expect(new Set(colors)).toEqual(new Set([COUNT_COLOR]));
    expect(COUNT_COLOR).toBe('#EF5350');
    const texts = (chrome.action.setBadgeText as unknown as { mock: { calls: Array<[{ text: string }]> } }).mock.calls.map((c) => c[0].text);
    expect(texts).toEqual(['3', '2', '1', '']);
  });

  it('stop when cancelled', async () => {
    let stop = false;
    vi.useFakeTimers();
    const done = countdownOnBadge(5, () => stop);
    await vi.advanceTimersByTimeAsync(1100);
    stop = true;
    await vi.advanceTimersByTimeAsync(1100);
    expect(await done).toBe('cancel');
    vi.useRealTimers();
  });
});
