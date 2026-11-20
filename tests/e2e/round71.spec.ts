import { expect, tabIdFor, test } from './fixtures';

test("a click in the page is drawn with the image editor's effect, size and colour", async ({ context, extPage, baseUrl }) => {
  const page = await context.newPage();
  await page.setViewportSize({ width: 900, height: 600 });
  await page.goto(`${baseUrl}/short`);
  await page.bringToFront();
  const tabId = await tabIdFor(extPage, `${baseUrl}/*`);
  await extPage.evaluate(async (tabId) => {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content/overlay.js'] });
    await chrome.tabs.sendMessage(tabId, {
      target: 'content', type: 'overlay/effects', clicks: true, keys: false, track: false,
      cursor: { cursor: false, cursorSize: 36, cursorColor: '#FFD84D', style: 'ring', clickEffect: 'pulse', leftColor: '#FF0000', rightColor: '#0000FF', radius: 80, opacity: 1, durationMs: 6000, clickCursor: true, clickDesign: 'hand' },
    });
  }, tabId);
  await page.mouse.move(450, 300);
  await page.waitForTimeout(300);
  await page.mouse.click(450, 300);
  // Red pixels well away from the click point: the effect is large (80 px), as set.
  const red = async () => extPage.evaluate(async (b64) => {
    const bmp = await createImageBitmap(new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], { type: 'image/png' }));
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(bmp, 0, 0);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let far = 0;
    for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
      const i = (y * c.width + x) * 4;
      if (d[i]! - d[i + 1]! > 40 && d[i]! - d[i + 2]! > 40 && Math.hypot(x - 200, y - 200) > 40) far++;
    }
    return far;
  }, (await page.screenshot({ clip: { x: 250, y: 100, width: 400, height: 400 } })).toString('base64'));
  await expect.poll(red, { timeout: 3500, intervals: [200] }).toBeGreaterThan(200);
});
