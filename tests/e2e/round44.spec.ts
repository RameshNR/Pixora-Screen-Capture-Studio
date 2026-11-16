import type { Page } from '@playwright/test';
import { expect, readCaptures, send, tabIdFor, test } from './fixtures';

/** Rows of the newest screenshot that contain blue (header / its arrow) or red (bottom widget) pixels. */
async function colourRows(extPage: Page): Promise<{ width: number; height: number; blue: number[]; red: number[] }> {
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
    const blue: number[] = [];
    const red: number[] = [];
    for (let y = 0; y < bmp.height; y++) {
      let b = false;
      let r = false;
      for (let x = 0; x < bmp.width; x += 3) {
        const i = (y * bmp.width + x) * 4;
        const R = data[i]!, G = data[i + 1]!, B = data[i + 2]!;
        if (B > 200 && R < 60 && G < 60) b = true;
        if (R > 200 && G < 60 && B < 60) r = true;
      }
      if (b) blue.push(y);
      if (r) red.push(y);
    }
    return { width: bmp.width, height: bmp.height, blue, red };
  });
}

async function capture(extPage: Page, baseUrl: string): Promise<void> {
  const tabId = await tabIdFor(extPage, `${baseUrl}/*`);
  const before = (await readCaptures(extPage)).length;
  await send(extPage, { target: 'background', type: 'screenshot/capture', mode: 'full', tabId, scrollAreas: [] });
  await expect.poll(async () => (await readCaptures(extPage)).length, { timeout: 60_000 }).toBe(before + 1);
}

/** Ways bottom-right dev toolbars (like XRebel) are built; each must appear once, at the very bottom. */
const WIDGETS: Array<{ name: string; css: string; html: string; shadow?: boolean }> = [
  {
    name: 'full-height transparent strip, box at its bottom',
    css: `#strip { position: fixed; top: 0; right: 0; bottom: 0; width: 80px; z-index: 3; pointer-events: none; }
      #widget { position: absolute; right: 0; bottom: 0; width: 80px; height: 60px; background: rgb(255, 0, 0); }`,
    html: '<div id="strip"><div id="widget"></div></div>',
  },
  {
    name: 'zero-size fixed wrapper, box drawn at the bottom',
    css: `#wrap { position: fixed; top: 0; right: 0; width: 0; height: 0; z-index: 3; }
      #widget { position: absolute; right: 0; top: calc(100vh - 60px); width: 80px; height: 60px; background: rgb(255, 0, 0); }`,
    html: '<div id="wrap"><div id="widget"></div></div>',
  },
  {
    name: 'box inside shadow DOM',
    css: '',
    html: '<xr-toolbar id="host"></xr-toolbar>',
    shadow: true,
  },
];

for (const wdg of WIDGETS) {
  test(`full page: box under a fixed header — header once at the top, arrow not repeated, bottom widget once at the bottom (${wdg.name})`, async ({ context, extPage, baseUrl }) => {
    test.setTimeout(120_000);
    const page = await context.newPage();
    await page.setViewportSize({ width: 900, height: 500 });
    await page.goto(`${baseUrl}/long`);
    await page.evaluate((w) => {
      document.head.insertAdjacentHTML('beforeend', `<style>
        html, body { margin: 0; height: 100%; overflow: hidden; }
        #hdr { position: absolute; top: 0; left: 0; right: 0; height: 100px; background: rgb(0, 0, 255); z-index: 2; }
        /* The "current page" arrow under the menu hangs over the scrolling box. */
        #hdr::after { content: ''; position: absolute; left: 300px; top: 100px; border: 14px solid transparent; border-top-color: rgb(0, 0, 255); }
        #main { position: absolute; top: 100px; bottom: 0; left: 0; right: 0; overflow: auto; background: rgb(220, 240, 220); }
        #content { height: 3000px; }
        ${w.css}
      </style>`);
      document.body.innerHTML = `<div id="hdr"></div><div id="main"><div id="content"></div></div>${w.html}`;
      if (w.shadow) {
        const root = document.getElementById('host')!.attachShadow({ mode: 'open' });
        root.innerHTML = '<div style="position:fixed;right:0;bottom:0;width:80px;height:60px;background:rgb(255,0,0);z-index:3"></div>';
      }
    }, wdg);
    await page.bringToFront();
    await capture(extPage, baseUrl);
    const shot = await colourRows(extPage);
    const dpr = await page.evaluate(() => devicePixelRatio);
    // The header strip is included (the box alone used to be captured) …
    expect(shot.blue[0]).toBe(0);
    expect(shot.height).toBeGreaterThanOrEqual(Math.round((100 + 3000) * dpr) - 4);
    // … only at the top (header + its arrow), never repeated further down.
    expect(Math.max(...shot.blue)).toBeLessThan((100 + 14 + 4) * dpr);
    // The bottom widget appears once, at the very bottom (not on the first screen as well).
    expect(shot.red.length).toBeGreaterThan(0);
    expect(Math.min(...shot.red)).toBeGreaterThan(shot.height - (60 + 4) * dpr);
    // The page is restored.
    expect(await page.evaluate(() => document.querySelectorAll('[data-glint-hide]').length)).toBe(0);
  });
}

test('full page: normal page — fixed header only at the top, fixed bottom widget only at the bottom', async ({ context, extPage, baseUrl }) => {
  test.setTimeout(120_000);
  const page = await context.newPage();
  await page.setViewportSize({ width: 900, height: 500 });
  await page.goto(`${baseUrl}/long`);
  await page.evaluate(() => {
    document.head.insertAdjacentHTML('beforeend', `<style>
      body { margin: 0; background: rgb(220, 240, 220); }
      #hdr { position: fixed; top: 0; left: 0; right: 0; height: 60px; background: rgb(0, 0, 255); }
      #content { height: 3000px; padding-top: 60px; }
      #widget { position: fixed; right: 0; bottom: 0; width: 80px; height: 60px; background: rgb(255, 0, 0); }
    </style>`);
    document.body.innerHTML = '<div id="hdr"></div><div id="content"></div><div id="widget"></div>';
  });
  await page.bringToFront();
  await capture(extPage, baseUrl);
  const shot = await colourRows(extPage);
  const dpr = await page.evaluate(() => devicePixelRatio);
  expect(shot.blue[0]).toBe(0);
  expect(Math.max(...shot.blue)).toBeLessThan((60 + 4) * dpr);
  expect(shot.red.length).toBeGreaterThan(0);
  expect(Math.min(...shot.red)).toBeGreaterThan(shot.height - (60 + 4) * dpr);
});
