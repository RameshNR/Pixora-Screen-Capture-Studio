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
  await page.waitForTimeout(2000);
  const video = page.video()!;
  await ctx.close();
  const b64 = readFileSync(await video.path()).toString('base64');
  await browser.close();
  rmSync(dir, { recursive: true, force: true });
  return b64;
}

interface Watch { frames: number; covered: number; nothingShown: number; layers: number; stop: boolean }

test('clicking an annotation tool on the video does not flicker', async ({ context, extPage, extensionId }) => {
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
      tx.objectStore('captures').put({
        id: 'v_62', kind: 'video', name: 'Flicker.webm', mimeType: 'video/webm', size: blob.size, width: 1280, height: 720, createdAt: Date.now(), updatedAt: Date.now(), durationMs: 2000,
        overlays: [{ id: 'ov_m', annotation: { id: 'a_m', type: 'mask', x: 100, y: 100, w: 300, h: 200, opacity: 1, color: '#ff0000' }, start: 0, end: 60, animIn: 'none', animOut: 'none', effect: 'none' }],
      });
      tx.objectStore('blobs').put(blob, 'v_62');
      tx.oncomplete = () => { req.result.close(); resolve(); };
      tx.onerror = () => reject(tx.error);
    };
  }), b64);

  const page = await context.newPage();
  await page.setViewportSize({ width: 1500, height: 950 });
  await page.goto(`chrome-extension://${extensionId}/video.html?id=v_62`);
  await expect(page.locator('canvas[class*="overlayCanvas"]')).toBeVisible();
  await page.waitForTimeout(800);

  // On every animation frame: is the page covered, and are the annotations on screen?
  await page.evaluate(() => {
    const w: Watch = { frames: 0, covered: 0, nothingShown: 0, layers: 0, stop: false };
    (window as unknown as { watch: Watch }).watch = w;
    const seen = new WeakSet<Element>();
    const shown = (el: Element | null) => !!el && getComputedStyle(el).visibility === 'visible';
    const tick = () => {
      if (w.stop) return;
      w.frames++;
      if (document.querySelector('[class*="drawLoading"]')) w.covered++;
      const layer = document.querySelector('[aria-label="Draw on the video"]');
      if (layer && !seen.has(layer)) { seen.add(layer); w.layers++; }
      if (!shown(document.querySelector('canvas[class*="overlayCanvas"]')) && !shown(layer)) w.nothingShown++;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });

  await page.getByRole('button', { name: 'Callout', exact: true }).click();
  const layer = page.getByRole('region', { name: 'Draw on the video' });
  await expect(layer).toBeVisible();
  await page.waitForTimeout(1500);
  await page.getByRole('button', { name: 'Shapes', exact: true }).click();
  await page.waitForTimeout(800);

  const w = await page.evaluate(() => {
    const watch = (window as unknown as { watch: Watch }).watch;
    watch.stop = true;
    return watch;
  });
  expect(w.frames).toBeGreaterThan(20);
  expect(w.covered).toBe(0);
  expect(w.nothingShown).toBe(0);
  expect(w.layers).toBe(1);
  await expect(page.locator('canvas[class*="overlayCanvas"]')).toBeHidden();
});
