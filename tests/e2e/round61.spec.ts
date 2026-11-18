import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, type Page } from '@playwright/test';
import { expect, test } from './fixtures';

async function makeVideo(): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), 'pixora-video-'));
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, recordVideo: { dir, size: { width: 1280, height: 720 } } });
  const page = await ctx.newPage();
  await page.setContent('<body style="margin:0;background:#e5e7eb"></body>');
  await page.waitForTimeout(2000);
  const video = page.video()!;
  await ctx.close();
  const b64 = readFileSync(await video.path()).toString('base64');
  await browser.close();
  rmSync(dir, { recursive: true, force: true });
  return b64;
}

const BOX = { x: 200, y: 150, w: 400, h: 200 };
const FONT = 30;

/** The drawing as saved with the recording. */
const saved = (extPage: Page) => extPage.evaluate(() => new Promise<Record<string, unknown>>((resolve) => {
  const req = indexedDB.open('glint-capture');
  req.onsuccess = () => {
    const get = req.result.transaction('captures').objectStore('captures').get('v_61');
    get.onsuccess = () => { req.result.close(); resolve((get.result.overlays as Array<{ annotation: Record<string, unknown> }>)[0]!.annotation); };
  };
}));

test('on the video: Shift makes a callout square, and its text can be dragged anywhere', async ({ context, extPage, extensionId }) => {
  test.setTimeout(120_000);
  const b64 = await makeVideo();
  const hist = await context.newPage();
  await hist.goto(`chrome-extension://${extensionId}/options.html#history`);
  await expect.poll(() => hist.evaluate(async () => (await indexedDB.databases()).some((d) => d.name === 'glint-capture'))).toBe(true);
  await hist.close();
  await extPage.evaluate(({ b64, BOX, FONT }) => new Promise<void>((resolve, reject) => {
    const blob = new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], { type: 'video/webm' });
    const req = indexedDB.open('glint-capture');
    req.onsuccess = () => {
      const tx = req.result.transaction(['captures', 'blobs'], 'readwrite');
      tx.objectStore('captures').put({
        id: 'v_61', kind: 'video', name: 'Text.webm', mimeType: 'video/webm', size: blob.size, width: 1280, height: 720, createdAt: Date.now(), updatedAt: Date.now(), durationMs: 2000,
        overlays: [{ id: 'ov_c', start: 0, end: 60, animIn: 'none', animOut: 'none', effect: 'none', annotation: { id: 'a_c', type: 'callout', ...BOX, tailX: 900, tailY: 250, text: 'Move me', fill: '#ffffff', stroke: '#e05252', strokeWidth: 4, radius: 8, tail: 'leader', leaderEnd: 'arrow', design: 'bubble', color: '#111111', fontFamily: 'Inter', fontSize: FONT, bold: false, italic: false, align: 'left', opacity: 1 } }],
      });
      tx.objectStore('blobs').put(blob, 'v_61');
      tx.oncomplete = () => { req.result.close(); resolve(); };
      tx.onerror = () => reject(tx.error);
    };
  }), { b64, BOX, FONT });

  const page = await context.newPage();
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto(`chrome-extension://${extensionId}/video.html?id=v_61`);
  await page.getByRole('button', { name: /^Callout: Move me/ }).click();
  const canvas = page.getByRole('img', { name: 'Screenshot canvas' });
  await expect(canvas).toBeVisible();
  await page.waitForTimeout(800);

  // Video pixels to screen: the picture fills the player's overlay area.
  const video = (await page.locator('video').boundingBox())!;
  const scale = Math.min(video.width / 1280, video.height / 720);
  const left = video.x + (video.width - 1280 * scale) / 2;
  const top = video.y + (video.height - 720 * scale) / 2;
  const screen = (x: number, y: number) => ({ x: left + x * scale, y: top + y * scale });

  // The text's move handle, just before its first line.
  const pad = FONT * 0.6;
  const grip = screen(BOX.x + pad, BOX.y + pad + FONT * 0.65);
  await page.mouse.move(grip.x - 15, grip.y);
  await page.mouse.down();
  await page.mouse.move(grip.x + 40, grip.y + 30, { steps: 5 });
  await page.mouse.up();
  await expect.poll(async () => (await saved(extPage)).textOffset, { timeout: 8000 }).toBeTruthy();
  const moved = await saved(extPage);
  expect(moved.x).toBe(BOX.x);
  expect((moved.textOffset as { x: number }).x).toBeGreaterThan(40);

  // Shift + corner: equal sides, the top left corner stays.
  const corner = screen(BOX.x + BOX.w, BOX.y + BOX.h);
  await page.mouse.move(corner.x, corner.y);
  await page.keyboard.down('Shift');
  await page.mouse.down();
  await page.mouse.move(corner.x + 30, corner.y + 10, { steps: 5 });
  await page.mouse.up();
  await page.keyboard.up('Shift');
  await expect.poll(async () => { const a = await saved(extPage); return a.w === a.h; }, { timeout: 8000 }).toBe(true);
  const square = await saved(extPage);
  expect(square.x).toBe(BOX.x);
  expect(square.y).toBe(BOX.y);
  expect(square.w as number).toBeGreaterThan(BOX.w);
});
