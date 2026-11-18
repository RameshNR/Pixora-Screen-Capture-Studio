import { expect, readCaptures, tabIdFor, test } from './fixtures';

async function png(page: import('@playwright/test').Page, w: number, h: number, color: string): Promise<Buffer> {
  return Buffer.from(await page.evaluate(async ([w, h, color]) => {
    const c = new OffscreenCanvas(w as number, h as number);
    const x = c.getContext('2d')!;
    x.fillStyle = color as string;
    x.fillRect(0, 0, w as number, h as number);
    return Array.from(new Uint8Array(await (await c.convertToBlob({ type: 'image/png' })).arrayBuffer()));
  }, [w, h, color] as const));
}

/** A small picture as a data: address (a web address that needs no site permission in tests). */
async function dataUrl(page: import('@playwright/test').Page): Promise<string> {
  return page.evaluate(async () => {
    const c = new OffscreenCanvas(120, 80);
    const x = c.getContext('2d')!;
    x.fillStyle = '#10b981';
    x.fillRect(0, 0, 120, 80);
    const b = await c.convertToBlob({ type: 'image/png' });
    return new Promise<string>((r) => { const f = new FileReader(); f.onload = () => r(f.result as string); f.readAsDataURL(b); });
  });
}

test('add image from a web address (toolbar and panel), browser frame Home button, collage export settings', async ({ context, extensionId }) => {
  const editor = await context.newPage();
  await editor.setViewportSize({ width: 1500, height: 900 });
  await editor.goto(`chrome-extension://${extensionId}/editor.html?import=1`);
  await editor.locator('input[type="file"]').first().setInputFiles({ name: 'base.png', mimeType: 'image/png', buffer: await png(editor, 900, 600, '#dbeafe') });
  await expect(editor.getByRole('img', { name: 'Screenshot canvas' })).toBeVisible();
  const url = await dataUrl(editor);

  // ---- Toolbar: Insert image → From a web address places the picture on the image.
  await editor.getByRole('button', { name: 'Insert image' }).click();
  await expect(editor.getByRole('menuitem', { name: /Paste from clipboard/ })).toBeVisible();
  await editor.getByRole('menuitem', { name: /From a web address/ }).click();
  const dlg = editor.getByRole('dialog', { name: 'Picture from a web address' });
  await dlg.getByRole('textbox', { name: 'Picture address' }).fill('javascript:alert(1)');
  await dlg.getByRole('button', { name: 'Add picture' }).click();
  await expect(dlg.getByRole('alert')).toHaveText(/Only http and https/);
  await dlg.getByRole('textbox', { name: 'Picture address' }).fill(url);
  await dlg.getByRole('button', { name: 'Add picture' }).click();
  await expect(dlg).toHaveCount(0);
  await expect(editor.getByRole('tab', { name: /Layers\s*1/ })).toBeVisible();

  // ---- Left panel: Add image → From a web address adds a new image to the list.
  const rail = editor.getByRole('complementary', { name: 'Images' });
  await rail.getByRole('button', { name: 'Add image' }).click();
  await editor.getByRole('menuitem', { name: /From a web address/ }).click();
  await editor.getByRole('textbox', { name: 'Picture address' }).fill(url);
  await editor.getByRole('button', { name: 'Add picture' }).click();
  await expect(rail.getByText('Images (2)')).toBeVisible();
  await expect(editor.getByText('120 × 80 px')).toBeVisible();

  // ---- Browser frame: Home button on / off changes the picture.
  await editor.getByRole('button', { name: 'Border & browser frame' }).click();
  await editor.getByRole('tablist', { name: 'Frame settings' }).getByRole('tab', { name: 'Window', exact: true }).click();
  await editor.getByRole('switch', { name: 'Browser window' }).click();
  const canvas = editor.getByRole('img', { name: 'Screenshot canvas' });
  const shot = () => canvas.screenshot();
  const before = await shot();
  await editor.getByRole('switch', { name: 'Home button' }).click();
  await expect(editor.getByRole('switch', { name: 'Home button' })).toHaveAttribute('aria-checked', 'true');
  await expect.poll(async () => Buffer.compare(await shot(), before) !== 0).toBe(true);
  await editor.keyboard.press('Escape');

  // ---- Collage export: file type, quality and the expected file size.
  await rail.getByRole('button', { name: /^Collage/ }).click();
  await editor.getByRole('tablist', { name: 'Collage settings' }).getByRole('tab', { name: 'Canvas' }).click();
  const size = editor.getByText('Expected file size').locator('..').locator('strong');
  await expect(size).toHaveText(/\d+(\.\d)? (KB|MB|B)$/);
  const pngSize = await size.innerText();
  await editor.getByRole('radio', { name: 'JPEG' }).click();
  await expect(editor.getByRole('slider', { name: 'Quality' })).toBeVisible();
  await expect(editor.getByText(/Output: \d+ × \d+ px · JPEG 90%/)).toBeVisible();
  await expect.poll(async () => size.innerText()).not.toBe(pngSize);
  // The header's Export… popup shows the same options and downloads with them.
  await editor.getByRole('button', { name: 'Export…' }).last().click();
  const exp = editor.getByRole('dialog', { name: 'Export collage' });
  await expect(exp.getByRole('radio', { name: 'JPEG' })).toHaveAttribute('aria-checked', 'true');
  await expect(exp.getByText('Expected file size')).toBeVisible();
  const download = editor.waitForEvent('download');
  await exp.getByRole('button', { name: 'Download', exact: true }).click();
  expect((await download).suggestedFilename()).toMatch(/\.jpg$/);
  // Add images: the same three sources as the editor.
  await editor.getByRole('button', { name: 'Add images' }).click();
  await expect(editor.getByRole('menuitem', { name: /From a web address/ })).toBeVisible();
  await expect(editor.getByRole('menuitem', { name: /Paste from clipboard/ })).toBeVisible();
  await editor.keyboard.press('Escape');
});

test('full page: progress on the page with Stop opens what was captured so far', async ({ context, extPage, extensionId, baseUrl }) => {
  // A light theme: the check below looks for a dark panel in the picture (Pixora's own pages are
  // dark in the default Graphite Dark theme, and in this test the popup is an ordinary tab).
  await extPage.evaluate(async () => {
    const k = 'glint.settings';
    const cur = ((await chrome.storage.local.get(k))[k] ?? {}) as Record<string, Record<string, unknown>>;
    await chrome.storage.local.set({ [k]: { ...cur, general: { ...(cur.general ?? {}), theme: 'classic-blue' } } });
  });
  const page = await context.newPage();
  await page.setViewportSize({ width: 900, height: 400 });
  await page.goto(`${baseUrl}/long`);
  // A tall page (about 40 screens), so Stop is always pressed while the capture is still running.
  await page.evaluate(() => {
    document.body.innerHTML = Array.from({ length: 40 }, (_, i) => `<div style="height:400px;background:hsl(${i * 9},70%,85%);font:40px sans-serif">Section ${i + 1}</div>`).join('');
  });
  await page.bringToFront();
  const tabId = await tabIdFor(extPage, `${baseUrl}/*`);
  const before = (await readCaptures(extPage)).length;
  // Start without waiting for the answer (the capture runs until stopped).
  await extPage.evaluate((id) => { void chrome.runtime.sendMessage({ target: 'background', type: 'screenshot/capture', mode: 'full', tabId: id, scrollAreas: [] }); }, tabId);
  // Progress with Stop is in Pixora's popup — nothing is added to the page, no extra window.
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  const card = popup.getByRole('status', { name: 'Full-page capture' });
  await expect(card).toBeVisible({ timeout: 15_000 });
  expect(await page.locator('[data-glint-overlay]').count()).toBe(0);
  await card.getByRole('button', { name: /^Stop$/ }).click();
  await expect.poll(async () => (await readCaptures(extPage)).length, { timeout: 20_000 }).toBe(before + 1);
  const shots = await readCaptures(extPage);
  const latest = shots.sort((a, b) => Number(b.createdAt) - Number(a.createdAt))[0]!;
  const full = await page.evaluate(() => document.documentElement.scrollHeight * devicePixelRatio);
  expect(Number(latest.height)).toBeLessThan(full - 100);
  // The panel itself is never in the picture (dark panel colour on the right edge).
  const dark = await extPage.evaluate(async (id) => {
    const db: IDBDatabase = await new Promise((r) => { const q = indexedDB.open('glint-capture'); q.onsuccess = () => r(q.result); });
    const blob: Blob = await new Promise((r) => { const q = db.transaction('blobs').objectStore('blobs').get(id); q.onsuccess = () => r(q.result); });
    const bmp = await createImageBitmap(blob);
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    const x = c.getContext('2d')!;
    x.drawImage(bmp, 0, 0);
    const d = x.getImageData(bmp.width - 120, 0, 100, bmp.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i]! < 40 && d[i + 1]! < 45 && d[i + 2]! < 70) n++;
    return n;
  }, latest.id as string);
  expect(dark).toBe(0);
});
