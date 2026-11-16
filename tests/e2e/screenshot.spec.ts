import { expect, readCaptures, send, tabIdFor, test, waitForPage, whiteRowsInLatestCapture } from './fixtures';

test.describe('screenshots', () => {
  test('captures the visible part and opens the editor', async ({ context, extPage, baseUrl }) => {
    const page = await context.newPage();
    await page.goto(`${baseUrl}/short`);
    await page.bringToFront();
    const tabId = await tabIdFor(extPage, `${baseUrl}/*`);

    const editorPromise = waitForPage(context, (u) => u.includes('/editor.html?id='));
    await send(extPage, { target: 'background', type: 'screenshot/capture', mode: 'visible', tabId });
    const editor = await editorPromise;

    await expect(editor.getByRole('img', { name: 'Screenshot canvas' })).toBeVisible();
    const [shot] = await readCaptures(extPage);
    expect(shot).toMatchObject({ kind: 'screenshot', mimeType: 'image/png', sourceUrl: `${baseUrl}/short` });
    expect(shot!.width).toBeGreaterThanOrEqual(1200);
    expect(shot!.height).toBeGreaterThanOrEqual(700);
  });

  test('captures a full page by scrolling and stitching, then restores the scroll position', async ({ context, extPage, baseUrl }) => {
    const page = await context.newPage();
    await page.goto(`${baseUrl}/long`);
    await page.evaluate(() => window.scrollTo(0, 333));
    await page.bringToFront();
    const tabId = await tabIdFor(extPage, `${baseUrl}/long`);

    await send(extPage, { target: 'background', type: 'screenshot/capture', mode: 'full', tabId });
    const [shot] = await readCaptures(extPage);
    const pageHeight = await page.evaluate(() => document.documentElement.scrollHeight);
    const dpr = await page.evaluate(() => window.devicePixelRatio);
    expect(shot!.height).toBe(Math.round(pageHeight * dpr)); // 60px header + 8 × 500px sections
    expect(await page.evaluate(() => window.scrollY)).toBe(333);
    // Fixed/sticky elements and the capture stylesheet are cleaned up.
    expect(await page.evaluate(() => document.querySelector('style[data-glint-capture]'))).toBeNull();
    expect(await page.evaluate(() => getComputedStyle(document.querySelector('header')!).visibility)).toBe('visible');
  });

  test('full page has no seams when a header turns fixed only after scrolling', async ({ context, extPage, baseUrl }) => {
    const page = await context.newPage();
    await page.goto(`${baseUrl}/sticky-js`);
    await page.bringToFront();
    const tabId = await tabIdFor(extPage, `${baseUrl}/sticky-js`);
    await send(extPage, { target: 'background', type: 'screenshot/capture', mode: 'full', tabId });
    const { rows, height } = await whiteRowsInLatestCapture(extPage);
    expect(height).toBeGreaterThan(3000);
    expect(rows).toBe(0); // the white fixed bar must not be stamped onto later frames
  });

  test('captures a selected area with the in-page selector', async ({ context, extPage, baseUrl }) => {
    const page = await context.newPage();
    await page.goto(`${baseUrl}/short`);
    await page.bringToFront();
    const tabId = await tabIdFor(extPage, `${baseUrl}/*`);
    await send(extPage, { target: 'background', type: 'screenshot/capture', mode: 'area', tabId });
    await expect.poll(() => page.evaluate(() => Boolean(document.querySelector('[data-glint-overlay]')))).toBe(true);

    await page.mouse.move(100, 100);
    await page.mouse.down();
    await page.mouse.move(400, 300, { steps: 8 });
    await page.mouse.up();
    const editorPromise = waitForPage(context, (u) => u.includes('/editor.html?id='));
    await page.keyboard.press('Enter');
    await editorPromise;

    const [shot] = await readCaptures(extPage);
    const dpr = await page.evaluate(() => window.devicePixelRatio);
    expect(shot!.width).toBe(Math.round(300 * dpr));
    expect(shot!.height).toBe(Math.round(200 * dpr));
    expect(await page.evaluate(() => document.querySelector('[data-glint-overlay]'))).toBeNull();
  });

  test('cancelling the area selector removes it without capturing', async ({ context, extPage, baseUrl }) => {
    const page = await context.newPage();
    await page.goto(`${baseUrl}/short`);
    await page.bringToFront();
    const tabId = await tabIdFor(extPage, `${baseUrl}/*`);
    const before = (await readCaptures(extPage)).length;
    await send(extPage, { target: 'background', type: 'screenshot/capture', mode: 'area', tabId });
    await expect.poll(() => page.evaluate(() => Boolean(document.querySelector('[data-glint-overlay]')))).toBe(true);
    await page.keyboard.press('Escape');
    await expect.poll(() => page.evaluate(() => Boolean(document.querySelector('[data-glint-overlay]')))).toBe(false);
    expect((await readCaptures(extPage)).length).toBe(before);
  });

  test('delayed capture waits before capturing', async ({ context, extPage, baseUrl }) => {
    const page = await context.newPage();
    await page.goto(`${baseUrl}/short`);
    await page.bringToFront();
    const tabId = await tabIdFor(extPage, `${baseUrl}/*`);
    const started = Date.now();
    await send(extPage, { target: 'background', type: 'screenshot/capture', mode: 'visible', tabId, delaySeconds: 3 });
    expect(Date.now() - started).toBeGreaterThanOrEqual(2900);
    expect((await readCaptures(extPage)).length).toBe(1);
  });
});
