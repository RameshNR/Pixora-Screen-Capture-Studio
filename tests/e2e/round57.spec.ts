import type { Page } from '@playwright/test';
import { expect, send, tabIdFor, test, waitForPage } from './fixtures';

/** A tall page (~1900 × 15 000 px): a full-page screenshot of about 28 megapixels. */
async function tallPage(page: Page) {
  await page.setViewportSize({ width: 1900, height: 1000 });
  await page.evaluate(() => {
    document.body.innerHTML = Array.from({ length: 28 }, (_, i) => `<div style="height:500px;background:hsl(${i * 37},60%,80%);font:40px sans-serif;padding:20px">Section ${i + 1} — ${'text '.repeat(80)}</div>`).join('');
  });
}

test('full page: the editor opens at once ("Preparing…"), then shows the image; exports show progress; untouched images download instantly', async ({ context, extPage, baseUrl }) => {
  test.setTimeout(240_000);
  const page = await context.newPage();
  await page.goto(`${baseUrl}/short`);
  await tallPage(page);
  await page.bringToFront();
  const tabId = await tabIdFor(extPage, `${baseUrl}/*`);
  const preparing = waitForPage(context, (u) => u.includes('/editor.html?preparing=1'), 180_000);
  void send(extPage, { target: 'background', type: 'screenshot/capture', mode: 'full', tabId });
  const editor = await preparing;
  // The same tab becomes the editor with the image.
  await expect(editor).toHaveURL(/editor\.html\?id=/, { timeout: 60_000 });
  await expect(editor.getByRole('img', { name: 'Screenshot canvas' })).toBeVisible({ timeout: 60_000 });
  expect(context.pages().filter((p) => p.url().includes('preparing=1'))).toHaveLength(0);

  // Untouched: the stored PNG is downloaded as it is (no re-encoding) — quick.
  let t = Date.now();
  const first = editor.waitForEvent('download', { timeout: 60_000 });
  await editor.getByRole('button', { name: /^Download/ }).first().click();
  await first;
  const untouchedMs = Date.now() - t;

  // Edited: re-encoded, with a "Preparing … png" progress toast while it runs.
  await editor.keyboard.press('r');
  const canvas = editor.getByRole('img', { name: 'Screenshot canvas' });
  const box = (await canvas.boundingBox())!;
  await editor.mouse.move(box.x + box.width / 2 - 15, box.y + box.height / 2 - 15);
  await editor.mouse.down();
  await editor.mouse.move(box.x + box.width / 2 + 15, box.y + box.height / 2 + 15, { steps: 5 });
  await editor.mouse.up();
  t = Date.now();
  const second = editor.waitForEvent('download', { timeout: 60_000 });
  await editor.getByRole('button', { name: /^Download/ }).first().click();
  await expect(editor.getByRole('status').filter({ hasText: /^Preparing .*\.png…/ })).toBeVisible({ timeout: 10_000 });
  await second;
  await expect(editor.getByRole('status').filter({ hasText: /^Preparing .*\.png…/ })).toHaveCount(0, { timeout: 10_000 });
  console.log(`download: untouched ${untouchedMs} ms, edited ${Date.now() - t} ms`);
});

test('collage: Ctrl + wheel zooms the collage (not the browser page); wheel over an image zooms that image', async ({ context, extPage, baseUrl }) => {
  test.setTimeout(120_000);
  const page = await context.newPage();
  await page.setViewportSize({ width: 1300, height: 800 });
  await page.goto(`${baseUrl}/short`);
  await page.bringToFront();
  const tabId = await tabIdFor(extPage, `${baseUrl}/*`);
  const ed = waitForPage(context, (u) => u.includes('/editor.html?id='));
  await send(extPage, { target: 'background', type: 'screenshot/capture', mode: 'visible', tabId });
  const editor = await ed;
  await editor.setViewportSize({ width: 1400, height: 900 });
  await editor.getByRole('button', { name: /^Collage/ }).first().click();
  const preview = editor.getByRole('img', { name: 'Collage preview' });
  await expect(preview).toBeVisible();
  await editor.evaluate(() => {
    (window as unknown as { blocked: number[] }).blocked = [];
    window.addEventListener('wheel', (e) => (window as unknown as { blocked: number[] }).blocked.push(e.defaultPrevented ? 1 : 0));
  });
  const level = editor.getByRole('textbox', { name: 'Collage zoom level' });
  const before = await level.inputValue();
  const b = (await preview.boundingBox())!;
  await editor.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await editor.keyboard.down('Control');
  await editor.mouse.wheel(0, -400);
  await editor.keyboard.up('Control');
  await expect.poll(() => level.inputValue()).not.toBe(before);
  // The browser never got the Ctrl + wheel (no page zoom).
  expect(await editor.evaluate(() => (window as unknown as { blocked: number[] }).blocked)).not.toContain(0);

  // Plain wheel over the image zooms the image in its cell (Zoom slider of the selected image).
  await editor.mouse.wheel(0, -300);
  const zoom = editor.getByRole('slider', { name: 'Zoom' });
  await expect.poll(async () => Number(await zoom.inputValue())).toBeGreaterThan(1);
  // Dragging the image keeps working after zooming (repositions it, no error).
  await editor.mouse.down();
  await editor.mouse.move(b.x + b.width / 2 - 80, b.y + b.height / 2 - 40, { steps: 6 });
  await editor.mouse.up();
  await expect(editor.getByRole('button', { name: 'Reset position' })).toBeEnabled();
});
