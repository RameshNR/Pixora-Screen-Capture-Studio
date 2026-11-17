import type { BrowserContext, Page } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, readCaptures, send, tabIdFor, test } from './fixtures';

/** Image pixels per CSS pixel of the tab's screenshots (the screen's scaling; emulation doesn't change it). */
async function shotRatio(extPage: Page, tabId: number): Promise<{ ratio: number; height: number }> {
  return extPage.evaluate(async (id) => {
    const t = await chrome.tabs.get(id);
    const url = await chrome.tabs.captureVisibleTab(t.windowId, { format: 'png' });
    const b = await createImageBitmap(await (await fetch(url)).blob());
    return { ratio: b.width / t.width!, height: b.height };
  }, tabId);
}

const TITLE = 'PixoraHeaderTest';

// Chrome's "Choose what to share" dialog picks the window titled like this test page by itself.
// (Chrome needs the window's full name: "<page title> - Chromium".)
test.use({ headed: true, realViewport: true, chromeArgs: [`--auto-select-desktop-capture-source=${TITLE} - Chromium`] });

async function setHeader(extPage: Page, on: boolean): Promise<void> {
  await extPage.evaluate(async (v) => {
    const cur = ((await chrome.storage.local.get('glint.settings'))['glint.settings'] ?? {}) as { screenshot?: Record<string, unknown> };
    await chrome.storage.local.set({ 'glint.settings': { ...cur, screenshot: { ...(cur.screenshot ?? {}), browserHeader: v } } });
  }, on);
}

/** Newest screenshot: size, the first row of the page's red band, and the PNG. */
async function latestShot(extPage: Page): Promise<{ width: number; height: number; firstRed: number; aboveRed: number; png: string }> {
  return extPage.evaluate(async () => {
    const db: IDBDatabase = await new Promise((res, rej) => {
      const r = indexedDB.open('glint-capture');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    const get = <T,>(store: string, mode: 'getAll' | 'get', key?: string) =>
      new Promise<T>((res) => {
        const req = mode === 'getAll' ? db.transaction(store).objectStore(store).getAll() : db.transaction(store).objectStore(store).get(key!);
        req.onsuccess = () => res(req.result as T);
      });
    const caps = await get<Array<{ id: string; createdAt: number }>>('captures', 'getAll');
    const latest = caps.sort((a, b) => b.createdAt - a.createdAt)[0]!;
    const blob = await get<Blob>('blobs', 'get', latest.id);
    db.close();
    const bmp = await createImageBitmap(blob);
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    const ctx = c.getContext('2d')!;
    ctx.drawImage(bmp, 0, 0);
    const data = ctx.getImageData(0, 0, bmp.width, bmp.height).data;
    let firstRed = -1;
    for (let y = 0; y < bmp.height && firstRed < 0; y++) {
      let red = 0;
      let n = 0;
      for (let x = 0; x < bmp.width; x += 4) {
        const i = (y * bmp.width + x) * 4;
        n++;
        if (data[i]! > 200 && data[i + 1]! < 60 && data[i + 2]! < 60) red++;
      }
      if (red > n / 2) firstRed = y;
    }
    // Redness of the row just above the page: high when the header took some of the page's rows.
    let aboveRed = 0;
    if (firstRed > 1) {
      const y = firstRed - 2;
      let sum = 0;
      let n = 0;
      for (let x = 0; x < bmp.width; x += 4) {
        const i = (y * bmp.width + x) * 4;
        sum += data[i]! - (data[i + 1]! + data[i + 2]!) / 2;
        n++;
      }
      aboveRed = sum / n;
    }
    const png = await new Promise<string>((r) => {
      const f = new FileReader();
      f.onload = () => r(String(f.result));
      f.readAsDataURL(blob);
    });
    return { width: bmp.width, height: bmp.height, firstRed, aboveRed, png };
  });
}

async function openTestPage(context: BrowserContext, baseUrl: string, tall: boolean): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`${baseUrl}/long`);
  await page.evaluate(({ t, tall }) => {
    document.title = t;
    document.head.insertAdjacentHTML('beforeend', `<style>body{margin:0}#top{height:60px;background:rgb(255,0,0)}#rest{height:${tall ? 3000 : 200}px;background:linear-gradient(rgb(230,240,255),rgb(120,160,220))}</style>`);
    // Content like a real page (text, icons) below the red band, so the page's position is clear.
    const boxes = Array.from({ length: 40 }, (_, i) => `<i style="position:absolute;left:${i * 40 + 6}px;top:${70 + ((i * 37) % 150)}px;width:18px;height:${8 + (i % 5) * 4}px;background:hsl(${120 + i * 4},70%,${30 + (i % 3) * 15}%)"></i>`).join('');
    document.body.innerHTML = `<div id="top"></div><div id="rest"></div>${boxes}`;
  }, { t: TITLE, tall });
  await page.bringToFront();
  return page;
}

for (const mode of ['visible', 'full'] as const) {
  test(`browser header: ${mode} screenshot gets the real window header on top`, async ({ context, extPage, baseUrl }, info) => {
    test.setTimeout(180_000);
    const page = await openTestPage(context, baseUrl, mode === 'full');
    const tabId = await tabIdFor(extPage, `${baseUrl}/*`);
    const dpr = (await shotRatio(extPage, tabId)).ratio;
    const take = async () => {
      await page.bringToFront();
      await page.waitForTimeout(1100); // Chrome's screenshot rate limit
      const before = (await readCaptures(extPage)).length;
      await send(extPage, { target: 'background', type: 'screenshot/capture', mode, tabId, scrollAreas: [] });
      await expect.poll(async () => (await readCaptures(extPage)).length, { timeout: 60_000 }).toBe(before + 1);
      return latestShot(extPage);
    };
    // The same screenshot without, then with the header.
    await setHeader(extPage, false);
    const without = await take();
    await setHeader(extPage, true);
    const shot = await take();
    const png = Buffer.from(shot.png.split(',')[1]!, 'base64');
    await info.attach(`${mode}-with-header.png`, { body: png, contentType: 'image/png' });
    if (process.env.SHOT_DIR) writeFileSync(join(process.env.SHOT_DIR, `header-${mode}.png`), png);
    // The page's first row (red) now starts below a strip of browser UI …
    expect(without.firstRed).toBe(0);
    expect(shot.firstRed).toBeGreaterThan(30 * dpr);
    expect(shot.firstRed).toBeLessThan(250 * dpr);
    // … added on top: the image is exactly the header plus the same page (no page rows repeated).
    expect(shot.height).toBe(without.height + shot.firstRed);
    expect(shot.width).toBeGreaterThanOrEqual(without.width);
    // The header ends in the toolbar colour, not a shaded copy of the page's top.
    expect(shot.aboveRed).toBeLessThan(60);
    // The header window is gone.
    await expect.poll(() => context.pages().some((p) => p.url().includes('mode=header'))).toBe(false);
  });
}

test('browser header: closing the header window keeps the screenshot as it is', async ({ context, extPage, baseUrl }) => {
  test.setTimeout(120_000);
  await setHeader(extPage, true);
  const page = await openTestPage(context, baseUrl, false);
  const tabId = await tabIdFor(extPage, `${baseUrl}/*`);
  const plain = await shotRatio(extPage, tabId);
  await page.waitForTimeout(1100);
  const before = (await readCaptures(extPage)).length;
  // Close Pixora's header window as soon as it opens.
  await extPage.evaluate(() => {
    chrome.windows.onCreated.addListener((w) => {
      if (w.type === 'popup') void chrome.windows.remove(w.id!).catch(() => undefined);
    });
  });
  await send(extPage, { target: 'background', type: 'screenshot/capture', mode: 'visible', tabId });
  await expect.poll(async () => (await readCaptures(extPage)).length, { timeout: 60_000 }).toBe(before + 1);
  const shot = await latestShot(extPage);
  expect(shot.firstRed).toBe(0);
  expect(shot.height).toBe(plain.height);
});

test('browser header: the window was resized after the screenshot — it says so, and goes on once the size is back', async ({ context, extPage, baseUrl }) => {
  test.setTimeout(180_000);
  await setHeader(extPage, true);
  const page = await openTestPage(context, baseUrl, false);
  const tabId = await tabIdFor(extPage, `${baseUrl}/*`);
  await page.waitForTimeout(1100);
  const before = (await readCaptures(extPage)).length;
  // As soon as Pixora's header window opens, make the browser window smaller (like un-maximising it).
  const original = await extPage.evaluate(async (id) => {
    const t = await chrome.tabs.get(id);
    const w = await chrome.windows.get(t.windowId);
    if (w.state !== 'normal') await chrome.windows.update(t.windowId, { state: 'normal' });
    const n = await chrome.windows.get(t.windowId);
    chrome.windows.onCreated.addListener((c) => {
      if (c.type === 'popup') void chrome.windows.update(t.windowId, { width: n.width! - 300 });
    });
    return { windowId: t.windowId, width: n.width! };
  }, tabId);
  await send(extPage, { target: 'background', type: 'screenshot/capture', mode: 'visible', tabId });
  // The header window explains the size change …
  const helper = await expect.poll(() => context.pages().find((p) => p.url().includes('mode=header')), { timeout: 20_000 }).toBeTruthy().then(() => context.pages().find((p) => p.url().includes('mode=header'))!);
  await expect(helper.getByText('The browser window changed size after the screenshot.')).toBeVisible({ timeout: 20_000 });
  expect((await readCaptures(extPage)).length).toBe(before);
  // … and carries on by itself once the window is back to its size.
  await extPage.evaluate((o) => chrome.windows.update(o.windowId, { width: o.width }), original);
  await expect.poll(async () => (await readCaptures(extPage)).length, { timeout: 60_000 }).toBe(before + 1);
  const shot = await latestShot(extPage);
  expect(shot.firstRed).toBeGreaterThan(30);
});
