import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from '@playwright/test';
import { expect, test } from './fixtures';

async function makeVideo(): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), 'pixora-video-'));
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, recordVideo: { dir, size: { width: 1280, height: 720 } } });
  const page = await ctx.newPage();
  await page.setContent('<body style="margin:0;background:#3b82a6"></body>');
  await page.waitForTimeout(1500);
  const video = page.video()!;
  await ctx.close();
  const b64 = readFileSync(await video.path()).toString('base64');
  await browser.close();
  rmSync(dir, { recursive: true, force: true });
  return b64;
}

test('the video can be made taller by dragging the bar under it; the height is remembered', async ({ context, extPage, extensionId }) => {
  test.setTimeout(120_000);
  const b64 = await makeVideo();
  const hist = await context.newPage();
  await hist.goto(`chrome-extension://${extensionId}/options.html#history`);
  await expect.poll(() => hist.evaluate(async () => (await indexedDB.databases()).some((d) => d.name === 'glint-capture'))).toBe(true);
  await hist.close();
  await extPage.evaluate((b64) => new Promise<void>((resolve, reject) => {
    const blob = new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], { type: 'video/webm' });
    const req = indexedDB.open('glint-capture');
    req.onsuccess = () => {
      const tx = req.result.transaction(['captures', 'blobs'], 'readwrite');
      tx.objectStore('captures').put({ id: 'v_72', kind: 'video', name: 'Tall.webm', mimeType: 'video/webm', size: blob.size, width: 1280, height: 720, createdAt: Date.now(), updatedAt: Date.now(), durationMs: 1500 });
      tx.objectStore('blobs').put(blob, 'v_72');
      tx.oncomplete = () => { req.result.close(); resolve(); };
      tx.onerror = () => reject(tx.error);
    };
  }), b64);

  // A small window (single-column layout): the video starts small.
  const page = await context.newPage();
  await page.setViewportSize({ width: 1000, height: 700 });
  await page.goto(`chrome-extension://${extensionId}/video.html?id=v_72`);
  const video = page.locator('video');
  await expect(video).toBeVisible();
  await page.waitForTimeout(800);
  const height = async () => (await video.boundingBox())!.height;
  const before = await height();

  const bar = page.getByRole('separator', { name: 'Video height' });
  const b = (await bar.boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2 + 180, { steps: 6 });
  await page.mouse.up();
  await expect.poll(height).toBeGreaterThan(before + 40);
  // It stops where the picture fills the player's width (no black bars above and below).
  const full = await video.evaluate((v: HTMLVideoElement) => (v.clientWidth * v.videoHeight) / v.videoWidth);
  expect(Math.abs((await height()) - full)).toBeLessThan(3);
  const tall = await height();

  // Remembered after reopening the page.
  await page.reload();
  await expect(video).toBeVisible();
  await expect.poll(height).toBeGreaterThan(tall - 2);

  // Keys, and double-click to fit the window again.
  await bar.focus();
  await page.keyboard.press('ArrowUp');
  await expect.poll(height).toBeLessThan(tall);
  await bar.dblclick();
  await expect.poll(height).toBeLessThan(before + 2);
});
