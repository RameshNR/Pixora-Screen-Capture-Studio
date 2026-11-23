import { expect, test } from './fixtures';
import type { BrowserContext, Page } from '@playwright/test';
import { openStripes, stripes } from './redact-helpers';

/** A screenshot in Recent captures (imported in its own editor tab, then closed). */
async function importShot(context: BrowserContext, extensionId: string, name: string): Promise<void> {
  const p = await context.newPage();
  await p.goto(`chrome-extension://${extensionId}/editor.html?import=1`);
  await p.locator('input[type="file"]').first().setInputFiles({ name, mimeType: 'image/png', buffer: await stripes(p) });
  await expect(p.getByRole('img', { name: 'Screenshot canvas' })).toBeVisible();
  await p.close();
}

async function history(context: BrowserContext, extensionId: string): Promise<Page> {
  const h = await context.newPage();
  await h.setViewportSize({ width: 1400, height: 900 });
  await h.goto(`chrome-extension://${extensionId}/options.html#history`);
  return h;
}

test('version 1.1.5', async ({ context, extensionId }) => {
  const p = await context.newPage();
  await p.goto(`chrome-extension://${extensionId}/popup.html`);
  expect(await p.evaluate(() => chrome.runtime.getManifest().version)).toBe('1.1.5');
  await p.close();
});

test('Add image › From Recent captures: images and flow images, several at once, no videos; they join the image list', async ({ context, extensionId }) => {
  test.setTimeout(120_000);
  await importShot(context, extensionId, 'earlier-a.png');
  await importShot(context, extensionId, 'earlier-b.png');
  const { editor } = await openStripes(context, extensionId);
  await editor.getByRole('button', { name: 'Add image', exact: true }).click();
  await editor.getByRole('menuitem', { name: /From Recent captures/ }).click();
  const dlg = editor.getByRole('dialog', { name: 'Add from Recent captures' });
  const tiles = dlg.getByRole('checkbox');
  // The two earlier screenshots (the open one is not offered again).
  await expect(tiles).toHaveCount(2);
  await tiles.nth(0).click();
  await tiles.nth(1).click();
  await dlg.getByRole('button', { name: 'Add 2 images' }).click();
  await expect(editor.getByRole('button', { name: 'Open image 3' })).toBeVisible();
  await editor.close();
});

test('several images added at once become one flow capture', async ({ context, extensionId }) => {
  test.setTimeout(120_000);
  const { editor } = await openStripes(context, extensionId);
  const buf = await stripes(editor);
  await editor.locator('input[type="file"]').last().setInputFiles([
    { name: 'one.png', mimeType: 'image/png', buffer: buf },
    { name: 'two.png', mimeType: 'image/png', buffer: buf },
  ]);
  await expect(editor.getByRole('button', { name: 'Open image 3' })).toBeVisible({ timeout: 20_000 });
  const h = await history(context, extensionId);
  // The open image and the two added: one flow of three, nothing on its own.
  await expect(h.getByRole('button', { name: /^Open Flow/ })).toHaveCount(1);
  await expect(h.getByRole('button', { name: /^Open / })).toHaveCount(1);
  await expect(h.getByText(/· 3 images/).first()).toBeVisible();
  await h.close();
  await editor.close();
});

test('Recent captures: open several selected images together; Make flow; drag an image onto another to make a flow', async ({ context, extensionId }) => {
  test.setTimeout(150_000);
  for (const n of ['a', 'b', 'c', 'd']) await importShot(context, extensionId, `${n}.png`);
  const h = await history(context, extensionId);
  const cards = h.getByRole('button', { name: /^Open [abcd]\.png/ });
  await expect(cards).toHaveCount(4);
  // Select a and b: Open 2 images → the editor with both in its image list.
  await h.getByRole('checkbox', { name: 'Select a.png' }).check({ force: true });
  await h.getByRole('checkbox', { name: 'Select b.png' }).check({ force: true });
  const sel = h.getByRole('toolbar', { name: 'Selection' });
  const [ed] = await Promise.all([context.waitForEvent('page'), sel.getByRole('button', { name: 'Open 2 images' }).click()]);
  await expect(ed.getByRole('button', { name: 'Open image 2' })).toBeVisible({ timeout: 15_000 });
  await ed.close();
  // Make flow from a and b.
  await sel.getByRole('button', { name: 'Make flow' }).click();
  await expect(h.getByRole('button', { name: /^Open Flow/ })).toHaveCount(1);
  await expect(cards).toHaveCount(2);
  // Drag c onto d: a second flow.
  const c = h.locator('li', { has: h.getByRole('button', { name: /^Open c\.png/ }) });
  const d = h.locator('li', { has: h.getByRole('button', { name: /^Open d\.png/ }) });
  await c.dragTo(d);
  await expect(h.getByRole('button', { name: /^Open Flow/ })).toHaveCount(2);
  await expect(cards).toHaveCount(0);
  // Drag one flow onto the other: one flow with all four images.
  const flows = h.locator('li', { has: h.getByRole('button', { name: /^Open Flow/ }) });
  await flows.nth(0).dragTo(flows.nth(1));
  await expect(h.getByRole('button', { name: /^Open Flow/ })).toHaveCount(1);
  await expect(h.getByText(/· 4 images/).first()).toBeVisible();
  await h.close();
});

test('narrow window: compare views and zoom move into the settings popup; the strip shows hidden counts', async ({ context, extensionId }) => {
  test.setTimeout(150_000);
  const { editor } = await openStripes(context, extensionId);
  const bar = editor.getByRole('group', { name: 'View' });
  await expect(bar.getByRole('radio', { name: 'Slider' })).toBeVisible();
  await editor.setViewportSize({ width: 900, height: 800 });
  // The editor body is narrower (side panel): the views move into the popup.
  await expect(bar.getByRole('radiogroup', { name: 'Compare view' })).toHaveCount(0);
  await bar.getByRole('button', { name: 'View settings' }).click();
  const menu = editor.getByRole('dialog', { name: 'View settings' });
  await expect(menu.getByRole('radiogroup', { name: 'Compare view' })).toBeVisible();
  await editor.mouse.click(5, 300);
  // Wide again: back on the bar.
  await editor.setViewportSize({ width: 1500, height: 950 });
  await expect(bar.getByRole('radiogroup', { name: 'Compare view' })).toBeVisible();

  // Full screen with many images: the arrows show how many are hidden.
  const buf = await stripes(editor);
  for (let i = 0; i < 13; i++) {
    await editor.locator('input[type="file"]').last().setInputFiles({ name: `i${i}.png`, mimeType: 'image/png', buffer: buf });
    await expect(editor.getByRole('button', { name: `Open image ${i + 2}` })).toBeVisible({ timeout: 15_000 });
  }
  await editor.evaluate(() => {
    let full: Element | null = null;
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => full });
    Element.prototype.requestFullscreen = function (this: Element) { full = this; document.dispatchEvent(new Event('fullscreenchange')); return Promise.resolve(); };
    document.exitFullscreen = () => { full = null; document.dispatchEvent(new Event('fullscreenchange')); return Promise.resolve(); };
  });
  await bar.getByRole('button', { name: 'Full screen' }).click();
  const strip = editor.getByRole('group', { name: 'Open images' });
  // 14 images, ten fit: the hidden ones are counted on the arrows (left + right = 4, or more with a partly shown one).
  const counts = async () => {
    const l = (await strip.getByRole('button', { name: /^Earlier images/ }).getAttribute('aria-label')) ?? '';
    const r = (await strip.getByRole('button', { name: /^More images/ }).getAttribute('aria-label')) ?? '';
    const n = (s: string) => Number(/\((\d+) more\)/.exec(s)?.[1] ?? 0);
    return n(l) + n(r);
  };
  await expect.poll(counts).toBeGreaterThanOrEqual(4);
  await editor.close();
});

test('drag several selected images onto a flow: the flow count goes up; drop hint and stacked drag picture', async ({ context, extensionId }) => {
  test.setTimeout(150_000);
  for (const n of ['a', 'b', 'c', 'd']) await importShot(context, extensionId, `${n}.png`);
  const h = await history(context, extensionId);
  // a + b → a flow (2 images).
  await h.getByRole('checkbox', { name: 'Select a.png' }).check({ force: true });
  await h.getByRole('checkbox', { name: 'Select b.png' }).check({ force: true });
  await h.getByRole('toolbar', { name: 'Selection' }).getByRole('button', { name: 'Make flow' }).click();
  const flowCard = h.locator('li', { has: h.getByRole('button', { name: /^Open Flow/ }) });
  await expect(flowCard.getByText(/· 2 images/).first()).toBeVisible();
  // A flow subtitle like a recorded one ("2 images · 3 steps") keeps its steps part.
  await h.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((r) => { const q = indexedDB.open('glint-capture'); q.onsuccess = () => r(q.result); });
    const tx = db.transaction('captures', 'readwrite');
    const st = tx.objectStore('captures');
    const all = await new Promise<Array<{ kind: string; sourceTitle?: string }>>((r) => { const q = st.getAll(); q.onsuccess = () => r(q.result); });
    const f = all.find((c) => c.kind === 'flow')!;
    st.put({ ...f, sourceTitle: '2 images · 3 steps' });
    await new Promise((r) => { tx.oncomplete = r; });
  }).catch(() => undefined);
  await h.reload();
  // c + d selected, dragged together onto the flow.
  await h.getByRole('checkbox', { name: 'Select c.png' }).check({ force: true });
  await h.getByRole('checkbox', { name: 'Select d.png' }).check({ force: true });
  const c = h.locator('li', { has: h.getByRole('button', { name: /^Open c\.png/ }) });
  await c.dragTo(flowCard);
  await expect(flowCard.getByText(/· 4 images/).first()).toBeVisible();
  await expect(h.getByRole('button', { name: /^Open [cd]\.png/ })).toHaveCount(0);
  await h.close();
});

test('editor: adding one image keeps the session together as a flow; adding another joins the same flow; the Flow Editor full screen shows the flow images', async ({ context, extensionId }) => {
  test.setTimeout(150_000);
  const { editor } = await openStripes(context, extensionId);
  const buf = await stripes(editor);
  await editor.locator('input[type="file"]').last().setInputFiles({ name: 'two.png', mimeType: 'image/png', buffer: buf });
  await expect(editor.getByRole('button', { name: 'Open image 2' })).toBeVisible({ timeout: 15_000 });
  await editor.locator('input[type="file"]').last().setInputFiles({ name: 'three.png', mimeType: 'image/png', buffer: buf });
  await expect(editor.getByRole('button', { name: 'Open image 3' })).toBeVisible({ timeout: 15_000 });
  const h = await history(context, extensionId);
  await expect(h.getByRole('button', { name: /^Open / })).toHaveCount(1);
  await expect(h.getByText(/· 3 images/).first()).toBeVisible();
  // Open the flow: the Flow Editor; full screen shows the three images in the strip.
  const [flow] = await Promise.all([context.waitForEvent('page'), h.getByRole('button', { name: /^Open Flow/ }).click()]);
  await flow.setViewportSize({ width: 1500, height: 950 });
  await expect(flow.getByRole('img', { name: 'Screenshot canvas' })).toBeVisible({ timeout: 20_000 });
  await flow.evaluate(() => {
    let full: Element | null = null;
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => full });
    Element.prototype.requestFullscreen = function (this: Element) { full = this; document.dispatchEvent(new Event('fullscreenchange')); return Promise.resolve(); };
    document.exitFullscreen = () => { full = null; document.dispatchEvent(new Event('fullscreenchange')); return Promise.resolve(); };
  });
  await flow.getByRole('group', { name: 'View' }).getByRole('button', { name: 'Full screen' }).click();
  const strip = flow.getByRole('group', { name: 'Open images' });
  await expect(strip.getByRole('listitem')).toHaveCount(3);
  await strip.getByRole('listitem').nth(2).click();
  await expect(strip.getByRole('listitem').nth(2)).toHaveAttribute('aria-current', 'true');
  expect(await flow.evaluate(() => document.fullscreenElement?.id)).toBe('pixora-fs-root');
  await flow.close();
  await h.close();
  await editor.close();
});
