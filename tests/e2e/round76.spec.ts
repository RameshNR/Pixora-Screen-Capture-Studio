import { expect, tabIdFor, test } from './fixtures';

const FX = { cursor: false, cursorSize: 36, cursorColor: '#FFD84D', style: 'ring', clickEffect: 'pulse', leftColor: '#FF0000', rightColor: '#0000FF', radius: 60, opacity: 1, durationMs: 4000, clickCursor: false };

/** Red pixels in a screenshot area (the click effect). */
async function redIn(extPage: import('@playwright/test').Page, page: import('@playwright/test').Page, clip: { x: number; y: number; width: number; height: number }): Promise<number> {
  return extPage.evaluate(async (b64) => {
    const bmp = await createImageBitmap(new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], { type: 'image/png' }));
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(bmp, 0, 0);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i]! - d[i + 1]! > 40 && d[i]! - d[i + 2]! > 40) n++;
    return n;
  }, (await page.screenshot({ clip })).toString('base64'));
}

test('clicks always show: inside frames, after the page removes the layer, and on a busy page', async ({ context, extPage, baseUrl }) => {
  test.setTimeout(90_000);
  const page = await context.newPage();
  await page.setViewportSize({ width: 900, height: 700 });
  await page.goto(`${baseUrl}/short`);
  await page.evaluate((src) => {
    const f = document.createElement('iframe');
    f.src = src;
    f.style.cssText = 'position:fixed;left:450px;top:350px;width:400px;height:300px;border:0;background:#fff';
    document.body.appendChild(f);
    return new Promise((r) => f.addEventListener('load', r));
  }, `${baseUrl}/short`);
  await page.bringToFront();
  const tabId = await tabIdFor(extPage, `${baseUrl}/*`);
  await extPage.evaluate(async ({ tabId, cursor }) => {
    await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files: ['content/overlay.js'] });
    await chrome.tabs.sendMessage(tabId, { target: 'content', type: 'overlay/effects', clicks: true, keys: false, track: false, cursor });
  }, { tabId, cursor: FX });

  // 1. Inside the embedded frame.
  await page.mouse.click(650, 500);
  await expect.poll(() => redIn(extPage, page, { x: 550, y: 400, width: 200, height: 200 }), { timeout: 3000, intervals: [100] }).toBeGreaterThan(100);

  // 2. The page threw our layer away (a framework re-rendering <html>).
  await page.evaluate(() => document.querySelector('[data-glint-overlay]')?.remove());
  await page.mouse.click(150, 150);
  await expect.poll(() => redIn(extPage, page, { x: 50, y: 50, width: 200, height: 200 }), { timeout: 3000, intervals: [100] }).toBeGreaterThan(100);

  // 3. A busy page: the click blocks the page for half a second, the effect still plays afterwards.
  // (Without a recording running, the page drops its effects after a moment: switch them on again.)
  await page.waitForTimeout(4500);
  await extPage.evaluate(async ({ tabId, cursor }) => {
    await chrome.tabs.sendMessage(tabId, { target: 'content', type: 'overlay/effects', clicks: true, keys: false, track: false, cursor });
  }, { tabId, cursor: FX });
  await page.evaluate(() => document.addEventListener('pointerdown', () => { const end = performance.now() + 500; while (performance.now() < end) { /* busy */ } }));
  await page.mouse.click(300, 400);
  await page.waitForTimeout(700);
  await expect.poll(() => redIn(extPage, page, { x: 200, y: 300, width: 200, height: 200 }), { timeout: 3000, intervals: [100] }).toBeGreaterThan(100);
});
