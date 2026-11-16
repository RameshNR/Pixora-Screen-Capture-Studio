import { readFileSync } from 'node:fs';
import { expect, readCaptures, send, tabIdFor, test } from './fixtures';

test('full page with three scroll areas: finds all of them (also off screen), expands every one, no outlines or seams', async ({ context, extPage, baseUrl }) => {
  const html = readFileSync(new URL('./assets/travel-portal.html', import.meta.url), 'utf8');
  const page = await context.newPage();
  await page.goto(`${baseUrl}/short`);
  await page.setContent(html);
  await page.waitForTimeout(500);
  await page.bringToFront();
  const tabId = await tabIdFor(extPage, `${baseUrl}/*`);
  const report = await send<{ areas: Array<{ index: number; label: string; screens: number }> }>(extPage, { target: 'background', type: 'screenshot/scroll-areas', tabId });
  console.log('areas', JSON.stringify(report.areas.map((a) => [a.index, a.label, a.screens])));
  expect(report.areas.map((a) => a.label)).toEqual([expect.stringMatching(/CONTENT 1/), expect.stringMatching(/CONTENT 2/), expect.stringMatching(/CONTENT 3/)]);
  const expected = await page.evaluate(() => {
    const lists = [...document.querySelectorAll('.scroll-list')] as HTMLElement[];
    const extra = lists.reduce((s, el) => s + el.scrollHeight - el.clientHeight, 0);
    return document.documentElement.scrollHeight + extra;
  });
  await send(extPage, { target: 'background', type: 'screenshot/capture', mode: 'full', tabId, scrollAreas: report.areas.map((a) => ({ index: a.index, screens: 0 })) });
  await expect.poll(async () => (await readCaptures(extPage)).length).toBeGreaterThan(0);
  const [shot] = await readCaptures(extPage);
  console.log('capture', shot!.width, shot!.height, 'expected about', expected);
  expect(Math.abs(Number(shot!.height) - expected)).toBeLessThan(40);
  // Rows that are a solid dark line across the page (seams), and leftover outline blue.
  const res = await extPage.evaluate(async (id) => {
    const db: IDBDatabase = await new Promise((r) => { const q = indexedDB.open('glint-capture'); q.onsuccess = () => r(q.result); });
    const blob: Blob = await new Promise((r) => { const q = db.transaction('blobs').objectStore('blobs').get(id); q.onsuccess = () => r(q.result); });
    const bmp = await createImageBitmap(blob);
    const c = new OffscreenCanvas(bmp.width, bmp.height); const x = c.getContext('2d')!; x.drawImage(bmp, 0, 0);
    const d = x.getImageData(0, 0, bmp.width, bmp.height).data;
    const seams: number[] = [];
    for (let y = 0; y < bmp.height; y++) {
      let dark = 0; let n = 0;
      for (let px = 40; px < bmp.width - 40; px += 9) { const i = (y * bmp.width + px) * 4; n++; if (d[i]! < 40 && d[i + 1]! < 40 && d[i + 2]! < 40) dark++; }
      if (dark / n > 0.9) seams.push(y);
    }
    // Table header rows (#a8d0f7) of Content 2 and 3: each must be in the image, once.
    const headerRows: number[] = [];
    for (let y = 0; y < bmp.height; y++) {
      let hit = 0; let n = 0;
      for (let px = 60; px < bmp.width - 60; px += 13) { const i = (y * bmp.width + px) * 4; n++; if (Math.abs(d[i]! - 168) < 8 && Math.abs(d[i + 1]! - 208) < 8 && Math.abs(d[i + 2]! - 247) < 8) hit++; }
      if (hit / n > 0.5) headerRows.push(y);
    }
    const headerBands = headerRows.filter((y, i) => i === 0 || y - headerRows[i - 1]! > 5).length;
    return { seams: seams.slice(0, 20), headerBands };
  }, shot!.id as string);
  console.log('dark full-width rows', JSON.stringify(res.seams));
  expect(res.seams).toEqual([]);
  console.log('table header bands', res.headerBands);
  expect(res.headerBands).toBe(2);
});
