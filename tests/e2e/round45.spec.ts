import type { Page } from '@playwright/test';
import { expect, readCaptures, send, tabIdFor, test } from './fixtures';

/** For the newest screenshot: its width, how many rows hold red, the smallest right edge of red, and the narrowest red row. */
async function rightmostRed(extPage: Page): Promise<{ width: number; right: number; rows: number; narrowest: number }> {
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
    let right = bmp.width;
    let narrowest = bmp.width;
    let rows = 0;
    for (let y = 0; y < bmp.height; y++) {
      let r = -1;
      let run = 0;
      for (let x = 0; x < bmp.width; x++) {
        const i = (y * bmp.width + x) * 4;
        if (data[i]! > 200 && data[i + 1]! < 60 && data[i + 2]! < 60) {
          r = x;
          run++;
        }
      }
      if (r >= 0) {
        rows++;
        right = Math.min(right, r);
        narrowest = Math.min(narrowest, run);
      }
    }
    // right: the least-far-right red edge over all red rows; narrowest: the fewest red pixels in a red row.
    return { width: bmp.width, right, rows, narrowest };
  });
}

async function capture(extPage: Page, baseUrl: string): Promise<void> {
  const tabId = await tabIdFor(extPage, `${baseUrl}/*`);
  const before = (await readCaptures(extPage)).length;
  await send(extPage, { target: 'background', type: 'screenshot/capture', mode: 'full', tabId, scrollAreas: [] });
  await expect.poll(async () => (await readCaptures(extPage)).length, { timeout: 60_000 }).toBe(before + 1);
}

// Like a booking app: the page itself doesn't scroll; boxes under the header do, each with its own
// scrollbar (sometimes one inside another, sometimes styled by the site).
const LAYOUTS: Array<{ name: string; css: string; html: string }> = [
  {
    name: 'one scrolling box',
    css: `#main { position: absolute; top: 80px; bottom: 0; left: 0; right: 0; overflow-y: scroll; background: rgb(220, 240, 220); }
      #content { height: 2000px; position: relative; }`,
    html: '<div id="main"><div id="content"><div class="btn"></div></div></div>',
  },
  {
    name: 'site-styled scrollbar',
    css: `#main { position: absolute; top: 80px; bottom: 0; left: 0; right: 0; overflow-y: scroll; background: rgb(220, 240, 220); scrollbar-width: auto; scrollbar-color: #888 #ddd; }
      #content { height: 2000px; position: relative; }`,
    html: '<div id="main"><div id="content"><div class="btn"></div></div></div>',
  },
  {
    name: 'scrolling box inside a scrolling box',
    css: `#outer { position: absolute; top: 80px; bottom: 0; left: 0; right: 0; overflow-y: scroll; background: rgb(250, 250, 250); }
      #bar { height: 40px; position: relative; }
      #main { height: calc(100vh - 80px - 30px); overflow-y: scroll; background: rgb(220, 240, 220); }
      #content { height: 2000px; position: relative; }`,
    html: '<div id="outer"><div id="bar"><div class="btn"></div></div><div id="main"><div id="content"><div class="btn"></div></div></div></div>',
  },
];

// Headless Chrome hides every scrollbar, which hides this bug; run in a real window.
test.use({ headed: true });

for (const lay of LAYOUTS) {
  test(`full page: inner scrolling box — no scrollbar gap at the right edge (${lay.name})`, async ({ context, extPage, baseUrl }) => {
    test.setTimeout(120_000);
    const page = await context.newPage();
    await page.setViewportSize({ width: 900, height: 500 });
    await page.goto(`${baseUrl}/long`);
    await page.evaluate((l) => {
      document.head.insertAdjacentHTML('beforeend', `<style>
        html, body { margin: 0; height: 100%; overflow: hidden; }
        #hdr { position: absolute; top: 0; left: 0; right: 0; height: 80px; background: rgb(240, 240, 240); }
        .btn { position: absolute; right: 0; top: 5px; width: 120px; height: 30px; background: rgb(255, 0, 0); }
        ${l.css}
      </style>`);
      document.body.innerHTML = `<div id="hdr"><div class="btn"></div></div>${l.html}`;
    }, lay);
    // The scroll box really has a scrollbar taking width (the condition for the bug).
    expect(await page.evaluate(() => { const m = document.getElementById('main')!; return m.offsetWidth - m.clientWidth; })).toBeGreaterThan(0);
    await page.bringToFront();
    await capture(extPage, baseUrl);
    const shot = await rightmostRed(extPage);
    const dpr = await page.evaluate(() => devicePixelRatio);
    // Every right-aligned button is whole (not cut off at the right) and reaches the image's right edge
    // (no blank scrollbar strip). Hiding scrollbars widens the page, so the width must be measured after.
    expect(shot.narrowest).toBeGreaterThanOrEqual(Math.floor(120 * dpr) - 2);
    const buttons = (lay.html.match(/class="btn"/g) || []).length + 1;
    expect(shot.rows).toBeGreaterThanOrEqual(Math.floor(buttons * 30 * dpr) - 4);
    expect(shot.width - 1 - shot.right).toBeLessThanOrEqual(2);
    expect(await page.evaluate(() => document.querySelector('style[data-glint-capture]'))).toBeNull();
  });
}

test('screenshot editor: the picture never goes blank while the window is resized', async ({ context, extensionId }) => {
  const editor = await context.newPage();
  await editor.setViewportSize({ width: 1500, height: 900 });
  await editor.goto(`chrome-extension://${extensionId}/editor.html?import=1`);
  const png = Buffer.from(await editor.evaluate(async () => { const c = new OffscreenCanvas(1600, 900); const x = c.getContext('2d')!; x.fillStyle = '#dde'; x.fillRect(0, 0, 1600, 900); return Array.from(new Uint8Array(await (await c.convertToBlob()).arrayBuffer())); }));
  await editor.locator('input[type="file"]').first().setInputFiles({ name: 'a.png', mimeType: 'image/png', buffer: png });
  await expect(editor.getByRole('img', { name: 'Screenshot canvas' })).toBeVisible();
  await editor.waitForTimeout(500);
  // Look at the middle of the canvas between every task (where the browser may paint): it must
  // always show the picture, never a cleared canvas.
  await editor.evaluate(() => {
    const w = window as unknown as { __blank: number; __samples: number };
    w.__blank = 0;
    w.__samples = 0;
    const canvas = document.querySelector('canvas')!;
    const ctx = canvas.getContext('2d')!;
    const ch = new MessageChannel();
    const end = Date.now() + 4000;
    ch.port1.onmessage = () => {
      const a = ctx.getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1).data[3]!;
      w.__samples++;
      if (a === 0) w.__blank++;
      if (Date.now() < end) ch.port2.postMessage(0);
    };
    ch.port2.postMessage(0);
  });
  for (const [width, height] of [[1300, 820], [1100, 760], [1400, 880], [1000, 700], [1250, 800]] as const) {
    await editor.setViewportSize({ width, height });
    await editor.waitForTimeout(300);
  }
  await editor.waitForTimeout(1000);
  const r = await editor.evaluate(() => {
    const w = window as unknown as { __blank: number; __samples: number };
    return { blank: w.__blank, samples: w.__samples };
  });
  expect(r.samples).toBeGreaterThan(50);
  expect(r.blank).toBe(0);
});
