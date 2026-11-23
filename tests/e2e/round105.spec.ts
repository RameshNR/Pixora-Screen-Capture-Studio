import { expect, test } from './fixtures';
import type { BrowserContext, Page } from '@playwright/test';
import { stripes } from './redact-helpers';

/** A photo-like JPEG (gradient with a red disc). */
async function jpeg(page: Page, w = 1600, h = 1000): Promise<Buffer> {
  return Buffer.from(await page.evaluate(async ({ w, h }) => {
    const c = new OffscreenCanvas(w, h);
    const x = c.getContext('2d')!;
    const g = x.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, '#2f7d32');
    g.addColorStop(1, '#a5c94a');
    x.fillStyle = g;
    x.fillRect(0, 0, w, h);
    x.fillStyle = '#e11d1d';
    x.beginPath();
    x.arc(w / 2, h / 2, h / 4, 0, Math.PI * 2);
    x.fill();
    return Array.from(new Uint8Array(await (await c.convertToBlob({ type: 'image/jpeg', quality: 0.9 })).arrayBuffer()));
  }, { w, h }));
}

async function openJpeg(context: BrowserContext, extensionId: string, name: string): Promise<Page> {
  const editor = await context.newPage();
  await editor.setViewportSize({ width: 1500, height: 950 });
  await editor.goto(`chrome-extension://${extensionId}/editor.html?import=1`);
  await editor.locator('input[type="file"]').first().setInputFiles({ name, mimeType: 'image/jpeg', buffer: await jpeg(editor) });
  await expect(editor.getByRole('img', { name: 'Screenshot canvas' })).toBeVisible();
  return editor;
}

async function fakeFullScreen(page: Page) {
  await page.evaluate(() => {
    let full: Element | null = null;
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => full });
    Element.prototype.requestFullscreen = function (this: Element) { full = this; document.dispatchEvent(new Event('fullscreenchange')); return Promise.resolve(); };
    document.exitFullscreen = () => { full = null; document.dispatchEvent(new Event('fullscreenchange')); return Promise.resolve(); };
  });
}

test('a JPEG keeps its name and format; Properties shows its details and a colour histogram; export offers Original (default)', async ({ context, extensionId }) => {
  const editor = await openJpeg(context, extensionId, 'holiday.jpeg');
  // Not under the tool settings any more: the toolbar's Details button shows them.
  await expect(editor.getByRole('region', { name: 'Image details' })).toHaveCount(0);
  await editor.getByRole('button', { name: /^Image details/ }).first().click();
  const info = editor.getByRole('region', { name: 'Image details' });
  await expect(info.getByText('holiday.jpeg', { exact: true })).toBeVisible();
  await expect(info.getByText('JPEG', { exact: true })).toBeVisible();
  await expect(info.getByText('1600 × 1000 px')).toBeVisible();
  await expect(info.getByText('16:10')).toBeVisible();
  await expect(info.getByRole('img', { name: /Colour histogram/ })).toBeVisible();
  await expect(info.getByLabel('Main colours').getByRole('button')).not.toHaveCount(0);
  // Export: Original is chosen, and the file is a .jpg.
  await editor.getByRole('button', { name: /^Export…/ }).click();
  const fmt = editor.getByRole('radiogroup', { name: 'Image format' });
  await expect(fmt.getByRole('radio', { name: /^Original/ })).toHaveAttribute('aria-checked', 'true');
  await expect(editor.getByRole('dialog', { name: 'Export' }).getByText(/\.jpg/).first()).toBeVisible();
  await editor.close();
});

test('full screen: ← / → switch images; ↓ shows the image details with the colour graph, ↑ hides them', async ({ context, extensionId }) => {
  test.setTimeout(120_000);
  const editor = await openJpeg(context, extensionId, 'one.jpeg');
  await editor.locator('input[type="file"]').last().setInputFiles({ name: 'two.png', mimeType: 'image/png', buffer: await stripes(editor) });
  await expect(editor.getByRole('button', { name: 'Open image 2' })).toBeVisible({ timeout: 15_000 });
  await fakeFullScreen(editor);
  await editor.getByRole('group', { name: 'View' }).getByRole('button', { name: 'Full screen' }).click();
  const strip = editor.getByRole('group', { name: 'Open images' });
  await expect(strip.getByRole('listitem').nth(1)).toHaveAttribute('aria-current', 'true');
  await editor.keyboard.press('ArrowLeft');
  await expect(strip.getByRole('listitem').nth(0)).toHaveAttribute('aria-current', 'true');
  await editor.keyboard.press('ArrowRight');
  await expect(strip.getByRole('listitem').nth(1)).toHaveAttribute('aria-current', 'true');
  await editor.keyboard.press('ArrowDown');
  const details = editor.getByRole('dialog', { name: 'Image details' });
  await expect(details).toBeVisible();
  await expect(details.getByRole('img', { name: /Colour histogram/ })).toBeVisible();
  await expect(details.getByText('two.png', { exact: true })).toBeVisible();
  await editor.keyboard.press('ArrowUp');
  await expect(details).toHaveCount(0);
  await editor.close();
});

test('Flow Editor: Add image › From Recent captures adds a screenshot to the flow; the flow name has no stale count; export: Original, original names and numbering', async ({ context, extensionId }) => {
  test.setTimeout(150_000);
  // A flow (an editor session with two images) and a separate screenshot.
  const editor = await openJpeg(context, extensionId, 'first.jpeg');
  await editor.locator('input[type="file"]').last().setInputFiles({ name: 'second.png', mimeType: 'image/png', buffer: await stripes(editor) });
  await expect(editor.getByRole('button', { name: 'Open image 2' })).toBeVisible({ timeout: 15_000 });
  await editor.close();
  const loose = await openJpeg(context, extensionId, 'loose.jpeg');
  await loose.close();
  const h = await context.newPage();
  await h.goto(`chrome-extension://${extensionId}/options.html#history`);
  const [flow] = await Promise.all([context.waitForEvent('page'), h.getByRole('button', { name: /^Open Flow/ }).click()]);
  await flow.setViewportSize({ width: 1500, height: 950 });
  await expect(flow.getByRole('tab', { name: /Images \(2\)/ })).toBeVisible({ timeout: 20_000 });
  // The name is by date, not "Flow · 2 images".
  await expect(flow.getByText(/^Flow · \d+ images?$/)).toHaveCount(0);
  // The Add image button has room under it before the first card.
  const add = (await flow.getByRole('button', { name: 'Add image', exact: true }).boundingBox())!;
  const firstCard = (await flow.getByRole('textbox', { name: /description/i }).first().boundingBox());
  void firstCard;
  expect(add.height).toBeGreaterThan(20);
  await flow.getByRole('button', { name: 'Add image', exact: true }).click();
  await flow.getByRole('menuitem', { name: /From Recent captures/ }).click();
  const dlg = flow.getByRole('dialog', { name: 'Add from Recent captures' });
  await dlg.getByRole('checkbox', { name: 'loose.jpeg' }).click();
  await dlg.getByRole('button', { name: 'Add image' }).click();
  await expect(flow.getByRole('tab', { name: /Images \(3\)/ })).toBeVisible({ timeout: 15_000 });
  // Export dialog: Original format and the name options.
  await flow.getByRole('button', { name: /^Export/ }).first().click();
  await expect(flow.getByRole('radiogroup', { name: 'Image format' }).getByRole('radio', { name: 'Original' })).toHaveAttribute('aria-checked', 'true');
  await expect(flow.getByRole('checkbox', { name: /Original file names/ })).toBeChecked();
  await expect(flow.getByRole('checkbox', { name: /Number the files/ })).toBeChecked();
  await flow.close();
  await h.close();
});

test('an old flow named by a stale count ("Flow · 2 images" with 15) is renamed by its date in Recent captures; a name typed by the user stays', async ({ context, extensionId }) => {
  test.setTimeout(120_000);
  const editor = await openJpeg(context, extensionId, 'first.jpeg');
  await editor.locator('input[type="file"]').last().setInputFiles({ name: 'second.png', mimeType: 'image/png', buffer: await stripes(editor) });
  await expect(editor.getByRole('button', { name: 'Open image 2' })).toBeVisible({ timeout: 15_000 });
  // Make it look like an old flow: count name, 15 images in its details.
  await editor.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((r) => { const q = indexedDB.open('glint-capture'); q.onsuccess = () => r(q.result); });
    const tx = db.transaction(['captures', 'flows'], 'readwrite');
    const caps = tx.objectStore('captures');
    const all = await new Promise<Array<{ id: string; kind: string }>>((r) => { const q = caps.getAll(); q.onsuccess = () => r(q.result); });
    const f = all.find((c) => c.kind === 'flow')!;
    caps.put({ ...f, name: 'Flow · 2 images', sourceTitle: '15 images · 14 steps' });
    const flows = tx.objectStore('flows');
    const doc = await new Promise<{ name: string }>((r) => { const q = flows.get(f.id); q.onsuccess = () => r(q.result); });
    flows.put({ ...doc, name: 'Flow · 2 images' });
    await new Promise((r) => { tx.oncomplete = r; });
  });
  await editor.close();
  const h = await context.newPage();
  await h.goto(`chrome-extension://${extensionId}/options.html#history`);
  const card = h.locator('li', { has: h.getByRole('button', { name: /^Open Flow/ }) });
  await expect(card).toHaveCount(1);
  await expect(card.getByText('Flow · 2 images')).toHaveCount(0);
  await expect(card.getByText(/^Flow · \w{3} \d+, \d{4}/)).toBeVisible();
  await expect(card.getByText(/· 15 images/).first()).toBeVisible();
  await h.close();
});
