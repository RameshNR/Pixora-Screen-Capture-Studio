import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from '@playwright/test';
import { expect, test, waitForPage } from './fixtures';

/** A short real WebM made by Playwright's own (headless) page recording. */
async function makeVideo(): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), 'pixora-video-'));
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 640, height: 360 }, recordVideo: { dir, size: { width: 640, height: 360 } } });
  const page = await ctx.newPage();
  await page.setContent('<body style="margin:0;background:#3b82f6"><h1 id=t style="color:#fff;font:48px sans-serif;padding:40px">Step</h1></body>');
  for (let i = 1; i <= 6; i++) {
    await page.evaluate((i) => { document.body.style.background = `hsl(${i * 50},70%,45%)`; document.getElementById('t')!.textContent = `Step ${i}`; }, i);
    await page.waitForTimeout(400);
  }
  const video = page.video()!;
  await ctx.close();
  const path = await video.path();
  const b64 = readFileSync(path).toString('base64');
  await browser.close();
  rmSync(dir, { recursive: true, force: true });
  return b64;
}

test('video page: "Create flow" builds a flow from frames added by hand; frames survive tab switches; Flow name field', async ({ context, extPage, extensionId }) => {
  test.setTimeout(120_000);
  const b64 = await makeVideo();
  // Let Pixora create its database (Recent captures opens it).
  const hist = await context.newPage();
  await hist.goto(`chrome-extension://${extensionId}/options.html#history`);
  await expect.poll(() => hist.evaluate(async () => (await indexedDB.databases()).some((d) => d.name === 'glint-capture'))).toBe(true);
  await hist.close();
  await extPage.evaluate(
    (b64) =>
      new Promise<void>((resolve, reject) => {
        const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        const blob = new Blob([bytes], { type: 'video/webm' });
        const req = indexedDB.open('glint-capture');
        req.onsuccess = () => {
          const tx = req.result.transaction(['captures', 'blobs'], 'readwrite');
          tx.objectStore('captures').put({ id: 'v_flow', kind: 'video', name: 'Steps.webm', mimeType: 'video/webm', size: blob.size, width: 640, height: 360, createdAt: Date.now(), updatedAt: Date.now(), durationMs: 2400 });
          tx.objectStore('blobs').put(blob, 'v_flow');
          tx.oncomplete = () => { req.result.close(); resolve(); };
          tx.onerror = () => reject(tx.error);
        };
      }),
    b64,
  );
  const page = await context.newPage();
  await page.setViewportSize({ width: 1500, height: 950 });
  await page.goto(`chrome-extension://${extensionId}/video.html?id=v_flow`);

  // Nothing picked yet: the button explains what to do and opens the Frames tab.
  const create = page.getByRole('button', { name: /^Create flow/ });
  await expect(create).toBeEnabled();
  await create.click();
  await expect(page.getByText('Add the frames first')).toBeVisible();
  await expect(page.getByRole('tab', { name: /^Frames/ })).toHaveAttribute('aria-selected', 'true');

  // Add a frame; it is kept when switching to another tab and back.
  await page.getByRole('button', { name: /^Add this frame/ }).click();
  const frames = page.getByRole('list', { name: 'Frames for the flow' });
  await expect(frames.getByRole('listitem')).toHaveCount(1, { timeout: 15_000 });
  await page.getByRole('tab', { name: 'Details' }).click();
  await page.getByRole('tab', { name: /^Frames/ }).click();
  await expect(frames.getByRole('listitem')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Create flow (1)' })).toBeVisible();

  // Flow name: only the field takes focus, and it fills the row.
  const nameField = page.getByRole('textbox', { name: 'Flow name' });
  await page.getByText('Flow name', { exact: true }).click();
  await expect(nameField).not.toBeFocused();
  const row = await nameField.locator('xpath=..').boundingBox();
  const field = await nameField.boundingBox();
  expect(field!.width).toBeGreaterThan(row!.width * 0.6);
  await nameField.fill('My guide');

  // The header button creates the flow, opens the Flow Editor, and becomes "Open flow".
  const flowPage = waitForPage(context, (u) => u.includes('/flow.html?id='));
  await page.getByRole('button', { name: 'Create flow (1)' }).click();
  const flow = await flowPage;
  await expect(page.getByRole('button', { name: /^Open flow/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: /Flow steps/ })).toBeVisible();

  // The Flow Editor follows the theme too (Settings › General › Theme), light and dark.
  const pageBg = () => flow.evaluate(() => {
    const el = document.querySelector('[class*="editorPage"]');
    const m = el ? getComputedStyle(el).backgroundColor.match(/\d+/g)!.map(Number) : [0, 0, 0];
    return (m[0]! + m[1]! + m[2]!) / 3;
  });
  const setTheme = (theme: string) => extPage.evaluate(async (theme) => {
    const k = 'glint.settings';
    const cur = ((await chrome.storage.local.get(k))[k] ?? {}) as Record<string, Record<string, unknown>>;
    await chrome.storage.local.set({ [k]: { ...cur, general: { ...(cur.general ?? {}), theme } } });
  }, theme);
  await setTheme('light');
  await expect(flow.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect.poll(pageBg).toBeGreaterThan(190);
  await setTheme('dark');
  await expect(flow.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect.poll(pageBg).toBeLessThan(60);
});
