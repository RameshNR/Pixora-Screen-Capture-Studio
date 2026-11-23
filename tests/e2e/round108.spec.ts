import { expect, test } from './fixtures';
import { drag, eraseTool, openStripes, stripes } from './redact-helpers';

test('picking a drawing tool while comparing turns Before / After off (the tool works)', async ({ context, extensionId }) => {
  const { editor, cx, cy } = await openStripes(context, extensionId);
  await eraseTool(editor, 'Image');
  await editor.getByRole('radiogroup', { name: 'Erase to' }).getByRole('radio', { name: 'White', exact: true }).click();
  await drag(editor, cx - 100, cy, cx + 100, cy);
  const bar = editor.getByRole('group', { name: 'View' });
  const ba = bar.getByRole('switch', { name: 'Before / After', exact: true });
  await ba.click();
  await expect(ba).toHaveAttribute('aria-checked', 'true');
  await editor.keyboard.press('p');
  await expect(ba).toHaveAttribute('aria-checked', 'false');
  // The original view goes away too.
  await bar.getByRole('button', { name: 'Show the original picture' }).click();
  await editor.keyboard.press('r');
  await expect(bar.getByRole('button', { name: 'Show the original picture' })).toHaveAttribute('aria-pressed', 'false');
  await editor.close();
});

test('adding a large picture shows a busy pill until it is ready; the current thumbnail has a gap inside its border', async ({ context, extensionId }) => {
  test.setTimeout(120_000);
  const { editor } = await openStripes(context, extensionId);
  const big = Buffer.from(await editor.evaluate(async () => {
    const c = new OffscreenCanvas(6000, 4000);
    const x = c.getContext('2d')!;
    for (let i = 0; i < 400; i++) { x.fillStyle = `hsl(${i * 7}, 70%, 50%)`; x.fillRect((i * 97) % 6000, (i * 53) % 4000, 300, 200); }
    return Array.from(new Uint8Array(await (await c.convertToBlob({ type: 'image/png' })).arrayBuffer()));
  }));
  const seen = editor.evaluate(() => new Promise<boolean>((resolve) => {
    const ob = new MutationObserver(() => { if (document.querySelector('[role="status"][aria-label^="Adding"]')) { ob.disconnect(); resolve(true); } });
    ob.observe(document.body, { childList: true, subtree: true });
    setTimeout(() => resolve(false), 20_000);
  }));
  await editor.locator('input[type="file"]').last().setInputFiles({ name: 'big.png', mimeType: 'image/png', buffer: big });
  expect(await seen).toBe(true);
  await expect(editor.getByRole('button', { name: 'Open image 2' })).toBeVisible({ timeout: 30_000 });
  await expect(editor.locator('[role="status"][aria-label^="Adding"]')).toHaveCount(0);
  // Full screen strip: the current thumbnail's picture sits inside its border with a gap.
  await editor.locator('input[type="file"]').last().setInputFiles({ name: 's.png', mimeType: 'image/png', buffer: await stripes(editor) });
  await expect(editor.getByRole('button', { name: 'Open image 3' })).toBeVisible({ timeout: 15_000 });
  await editor.evaluate(() => {
    let full: Element | null = null;
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => full });
    Element.prototype.requestFullscreen = function (this: Element) { full = this; document.dispatchEvent(new Event('fullscreenchange')); return Promise.resolve(); };
  });
  await editor.getByRole('group', { name: 'View' }).getByRole('button', { name: 'Full screen' }).click();
  const cur = editor.getByRole('group', { name: 'Open images' }).locator('[aria-current="true"]');
  const outer = (await cur.boundingBox())!;
  const img = (await cur.locator('img').boundingBox())!;
  expect(img.x - outer.x).toBeGreaterThanOrEqual(3.5);
  await editor.close();
});

test('switching images: each picture is fitted to the full area at once (the same zoom as Fit to screen)', async ({ context, extensionId }) => {
  test.setTimeout(120_000);
  const { editor } = await openStripes(context, extensionId);
  await editor.locator('input[type="file"]').last().setInputFiles({ name: 'two.png', mimeType: 'image/png', buffer: await stripes(editor) });
  await expect(editor.getByRole('button', { name: 'Open image 2' })).toBeVisible({ timeout: 15_000 });
  const bar = editor.getByRole('group', { name: 'View' });
  const zoom = bar.getByRole('textbox', { name: 'Zoom level' });
  for (const n of [1, 2]) {
    await editor.getByRole('button', { name: `Open image ${n}` }).click();
    await editor.waitForTimeout(400);
    const shown = await zoom.inputValue();
    await bar.getByRole('button', { name: 'Fit to screen' }).click();
    await expect(zoom).toHaveValue(shown);
  }
  // Scrolling works once fitted (no scrollbar is shown only while a picture is being fitted).
  const ws = editor.locator('canvas[aria-label="Screenshot canvas"]').locator('xpath=ancestor::*[contains(@class,"workspace")][1]');
  await expect.poll(() => ws.evaluate((el) => getComputedStyle(el).overflow)).not.toBe('hidden');
  await editor.close();
});
