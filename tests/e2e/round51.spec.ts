import type { Page } from '@playwright/test';
import { expect, send, tabIdFor, test, waitForPage } from './fixtures';

const setTheme = (extPage: Page, theme: 'light' | 'dark') =>
  extPage.evaluate(async (theme) => {
    const k = 'glint.settings';
    const cur = ((await chrome.storage.local.get(k))[k] ?? {}) as Record<string, Record<string, unknown>>;
    await chrome.storage.local.set({ [k]: { ...cur, general: { ...(cur.general ?? {}), theme } } });
  }, theme);

/** Lightness (0–255 average) of an element's background. */
const lightness = (p: Page, selector: string) =>
  p.locator(selector).first().evaluate((el) => {
    const m = getComputedStyle(el).backgroundColor.match(/\d+(\.\d+)?/g)!.map(Number);
    return (m[0]! + m[1]! + m[2]!) / 3;
  });

test('image editor and video page follow Settings › General › Theme (light and dark)', async ({ context, extPage, baseUrl, extensionId }) => {
  await setTheme(extPage, 'light');
  const page = await context.newPage();
  await page.goto(`${baseUrl}/short`);
  await page.bringToFront();
  const tabId = await tabIdFor(extPage, `${baseUrl}/*`);
  const editorP = waitForPage(context, (u) => u.includes('/editor.html?id='));
  await send(extPage, { target: 'background', type: 'screenshot/capture', mode: 'visible', tabId });
  const editor = await editorP;
  await expect(editor.getByRole('img', { name: 'Screenshot canvas' })).toBeVisible();
  await expect(editor.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect.poll(() => lightness(editor, '[role="toolbar"], header')).toBeGreaterThan(200);

  // A video record (contents don't matter for the page colours).
  await extPage.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const req = indexedDB.open('glint-capture');
        req.onsuccess = () => {
          const tx = req.result.transaction(['captures', 'blobs'], 'readwrite');
          tx.objectStore('captures').put({ id: 'v_theme', kind: 'video', name: 'Theme.webm', mimeType: 'video/webm', size: 1, width: 640, height: 360, createdAt: Date.now(), updatedAt: Date.now(), durationMs: 1000 });
          tx.objectStore('blobs').put(new Blob(['x'], { type: 'video/webm' }), 'v_theme');
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        };
      }),
  );
  const video = await context.newPage();
  await video.goto(`chrome-extension://${extensionId}/video.html?id=v_theme`);
  await expect(video.getByText('Recording details')).toBeVisible();
  await expect(video.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect.poll(() => lightness(video, 'aside')).toBeGreaterThan(200);
  // The text on the light panels is dark (readable).
  const textLight = await video.getByText('Recording details').evaluate((el) => {
    const m = getComputedStyle(el).color.match(/\d+/g)!.map(Number);
    return (m[0]! + m[1]! + m[2]!) / 3;
  });
  expect(textLight).toBeLessThan(90);

  // Dark theme: both go dark again.
  await setTheme(extPage, 'dark');
  await expect(editor.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect.poll(() => lightness(editor, '[role="toolbar"], header')).toBeLessThan(70);
  await expect(video.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect.poll(() => lightness(video, 'aside')).toBeLessThan(70);
});
