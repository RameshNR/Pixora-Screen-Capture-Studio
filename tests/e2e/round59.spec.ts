import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, type BrowserContext, type Page } from '@playwright/test';
import { expect, send, tabIdFor, test, waitForPage } from './fixtures';

/** A short real WebM made by Playwright's own (headless) page recording. */
async function makeVideo(): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), 'pixora-video-'));
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 640, height: 360 }, recordVideo: { dir, size: { width: 640, height: 360 } } });
  const page = await ctx.newPage();
  await page.setContent('<body style="margin:0;background:#e5e7eb"></body>');
  await page.waitForTimeout(2500);
  const video = page.video()!;
  await ctx.close();
  const path = await video.path();
  const b64 = readFileSync(path).toString('base64');
  await browser.close();
  rmSync(dir, { recursive: true, force: true });
  return b64;
}

/** Red box in video pixels of the 640 × 360 source, shown for the whole video. */
const RED = { x: 320, y: 180, w: 160, h: 90 };

async function openVideo(context: BrowserContext, extPage: Page, extensionId: string): Promise<Page> {
  const b64 = await makeVideo();
  const hist = await context.newPage();
  await hist.goto(`chrome-extension://${extensionId}/options.html#history`);
  await expect.poll(() => hist.evaluate(async () => (await indexedDB.databases()).some((d) => d.name === 'glint-capture'))).toBe(true);
  await hist.close();
  await extPage.evaluate(
    ({ b64, RED }) =>
      new Promise<void>((resolve, reject) => {
        const blob = new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], { type: 'video/webm' });
        const req = indexedDB.open('glint-capture');
        req.onsuccess = () => {
          const tx = req.result.transaction(['captures', 'blobs'], 'readwrite');
          tx.objectStore('captures').put({
            id: 'v_59', kind: 'video', name: 'Sized.webm', mimeType: 'video/webm', size: blob.size, width: 640, height: 360, createdAt: Date.now(), updatedAt: Date.now(), durationMs: 2500,
            overlays: [{ id: 'ov_red', annotation: { id: 'a_red', type: 'mask', ...RED, opacity: 1, color: '#ff0000' }, start: 0, end: 60, animIn: 'none', animOut: 'none', effect: 'none' }],
          });
          tx.objectStore('blobs').put(blob, 'v_59');
          tx.oncomplete = () => { req.result.close(); resolve(); };
          tx.onerror = () => reject(tx.error);
        };
      }),
    { b64, RED },
  );
  const page = await context.newPage();
  await page.setViewportSize({ width: 1500, height: 950 });
  await page.goto(`chrome-extension://${extensionId}/video.html?id=v_59`);
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeVisible();
  return page;
}

test('a lower export resolution keeps annotations the same size relative to the video; the bar never shows 100% early', async ({ context, extPage, extensionId }) => {
  test.setTimeout(180_000);
  const page = await openVideo(context, extPage, extensionId);
  await page.getByRole('button', { name: 'Export / Convert' }).click();
  const dialog = page.getByRole('dialog', { name: 'Export recording' });
  await dialog.getByRole('radio', { name: 'WebM' }).click();
  await dialog.getByRole('button', { name: /^Resolution/ }).click();
  await page.getByRole('menuitemradio', { name: '240p' }).click();

  // Every value the bar shows while exporting.
  await page.evaluate(() => {
    const seen: number[] = [];
    (window as unknown as { barValues: number[] }).barValues = seen;
    new MutationObserver(() => {
      const v = document.querySelector('[role="dialog"] [role="progressbar"]')?.getAttribute('aria-valuenow');
      if (v) seen.push(Number(v));
    }).observe(document.body, { subtree: true, childList: true, attributes: true });
  });
  const dl = page.waitForEvent('download', { timeout: 120_000 });
  await dialog.getByRole('button', { name: 'Export & download' }).click();
  const file = await dl;
  const bytes = readFileSync((await file.path())!).toString('base64');
  await expect(dialog).toBeHidden({ timeout: 20_000 });
  const values = await page.evaluate(() => (window as unknown as { barValues: number[] }).barValues);
  expect(values.length).toBeGreaterThan(0);
  expect(Math.max(...values)).toBeLessThanOrEqual(96);
  expect([...values].sort((a, b) => a - b)).toEqual(values);

  // Measure the red box in the exported frames.
  const box = await page.evaluate(async (b64) => {
    const blob = new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], { type: 'video/webm' });
    const v = document.createElement('video');
    v.muted = true;
    v.src = URL.createObjectURL(blob);
    await new Promise((r) => { v.onloadeddata = r; });
    v.currentTime = 0.5;
    await new Promise((r) => { v.onseeked = r; });
    const c = new OffscreenCanvas(v.videoWidth, v.videoHeight);
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(v, 0, 0);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let l = c.width; let r = 0; let t = c.height; let b = 0;
    for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
      const i = (y * c.width + x) * 4;
      if (d[i]! > 170 && d[i + 1]! < 90 && d[i + 2]! < 90) { l = Math.min(l, x); r = Math.max(r, x); t = Math.min(t, y); b = Math.max(b, y); }
    }
    return { W: c.width, H: c.height, l, r, t, b };
  }, bytes);
  expect(box.H).toBe(240);
  const near = (value: number, expected: number) => expect(Math.abs(value - expected)).toBeLessThan(0.03);
  near(box.l / box.W, RED.x / 640);
  near((box.r + 1) / box.W, (RED.x + RED.w) / 640);
  near(box.t / box.H, RED.y / 360);
  near((box.b + 1) / box.H, (RED.y + RED.h) / 360);
});

test('video header: undo, redo, keyboard and the History window', async ({ context, extPage, extensionId }) => {
  test.setTimeout(120_000);
  const page = await openVideo(context, extPage, extensionId);
  const undo = page.getByRole('button', { name: 'Undo', exact: true });
  const redo = page.getByRole('button', { name: 'Redo', exact: true });
  const track = page.getByRole('slider', { name: 'Mask time' });
  await expect(track).toBeVisible();
  await expect(undo).toBeDisabled();
  await expect(redo).toBeDisabled();

  await page.getByRole('button', { name: 'Delete Mask' }).click();
  await expect(track).toHaveCount(0);
  await expect(undo).toBeEnabled();
  await undo.click();
  await expect(track).toBeVisible();
  await expect(redo).toBeEnabled();
  await redo.click();
  await expect(track).toHaveCount(0);

  await page.locator('body').click({ position: { x: 4, y: 4 } });
  await page.keyboard.press('Control+z');
  await expect(track).toBeVisible();
  await page.keyboard.press('Control+y');
  await expect(track).toHaveCount(0);

  await page.getByRole('button', { name: 'History', exact: true }).click();
  const win = page.getByRole('dialog', { name: 'Edit history' });
  await expect(win.getByRole('button', { name: /Opened video/ })).toBeVisible();
  await expect(win.getByRole('button', { name: /Delete Mask/ })).toHaveAttribute('aria-current', 'step');
  await win.getByRole('button', { name: /Opened video/ }).click();
  await expect(track).toBeVisible();
  await expect(win).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(win).toBeHidden();
});

test('size control: hold + to keep growing, click the number to type a size', async ({ context, extPage, baseUrl }) => {
  const page = await context.newPage();
  await page.goto(`${baseUrl}/short`);
  await page.bringToFront();
  const tabId = await tabIdFor(extPage, `${baseUrl}/*`);
  const editorP = waitForPage(context, (u) => u.includes('/editor.html?id='));
  await send(extPage, { target: 'background', type: 'screenshot/capture', mode: 'visible', tabId });
  const editor = await editorP;
  const canvas = editor.getByRole('img', { name: 'Screenshot canvas' });
  await expect(canvas).toBeVisible();
  await editor.keyboard.press('k');
  const c = (await canvas.boundingBox())!;
  await editor.mouse.click(c.x + c.width / 2, c.y + c.height / 2);
  await editor.keyboard.type('Hello');
  await editor.keyboard.press('Escape');

  const sizeButton = editor.getByRole('button', { name: /^Font size \d+/ });
  await expect(sizeButton).toBeVisible();
  const read = async () => Number(await sizeButton.innerText());
  const before = await read();

  const plus = (await editor.getByRole('button', { name: 'Bigger text' }).boundingBox())!;
  await editor.mouse.move(plus.x + plus.width / 2, plus.y + plus.height / 2);
  await editor.mouse.down();
  await editor.waitForTimeout(1300);
  await editor.mouse.up();
  const held = await read();
  expect(held).toBeGreaterThanOrEqual(before + 8);
  await editor.waitForTimeout(400);
  expect(await read()).toBe(held);

  await sizeButton.click();
  const input = editor.getByRole('textbox', { name: 'Font size' });
  await expect(input).toBeFocused();
  await input.fill('72');
  await input.press('Enter');
  await expect(editor.getByRole('button', { name: /^Font size 72/ })).toBeVisible();
});
