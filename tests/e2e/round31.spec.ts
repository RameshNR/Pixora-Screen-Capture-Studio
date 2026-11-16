import { readFileSync } from 'node:fs';
import { expect, send, tabIdFor, test } from './fixtures';

/** 300×300 PNG: red top third, green middle, blue bottom (no binary fixtures in the repo). */
async function makeBands(page: import('@playwright/test').Page): Promise<number[]> {
  return page.evaluate(async () => {
    const c = new OffscreenCanvas(300, 300);
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#ff0000';
    ctx.fillRect(0, 0, 300, 100);
    ctx.fillStyle = '#00ff00';
    ctx.fillRect(0, 100, 300, 100);
    ctx.fillStyle = '#0000ff';
    ctx.fillRect(0, 200, 300, 100);
    const blob = await c.convertToBlob({ type: 'image/png' });
    return Array.from(new Uint8Array(await blob.arrayBuffer()));
  });
}

test('cut out & join keeps top and bottom; export popup has format cards', async ({ context, extensionId }) => {
  const editor = await context.newPage();
  await editor.setViewportSize({ width: 1500, height: 900 });
  await editor.goto(`chrome-extension://${extensionId}/editor.html?import=1`);
  await editor.locator('input[type="file"]').setInputFiles({ name: 'bands.png', mimeType: 'image/png', buffer: Buffer.from(await makeBands(editor)) });
  await expect(editor.getByRole('img', { name: 'Screenshot canvas' })).toBeVisible();

  // Cut out & join works on the canvas itself: the scissors turns on the tool, the band is drawn on the image.
  await editor.getByRole('button', { name: 'Cut out & join' }).click();
  const panel = editor.getByRole('complementary', { name: 'Properties' });
  const from = panel.getByRole('spinbutton', { name: 'Remove from' });
  const to = panel.getByRole('spinbutton', { name: 'Remove to' });
  await expect(from).toHaveValue('120'); // starts at 40%–60% of the 300 px image
  await expect(to).toHaveValue('180');

  // Dragging across the image marks a new band (top to bottom of the drag).
  const box = (await editor.getByRole('img', { name: 'Screenshot canvas' }).boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await editor.mouse.move(cx, cy - 60);
  await editor.mouse.down();
  await editor.mouse.move(cx, cy - 10, { steps: 4 });
  await editor.mouse.move(cx, cy + 40, { steps: 4 });
  await editor.mouse.up();
  const dragged = [Number(await from.inputValue()), Number(await to.inputValue())];
  expect(dragged[1]! - dragged[0]!).toBeGreaterThan(10);
  expect(dragged).not.toEqual([120, 180]);

  // Exact values in the panel.
  await from.fill('100');
  await to.fill('200');
  await expect(panel.getByText(/Removes\s*100 px/)).toBeVisible();
  await expect(panel.getByText(/300 × 200/)).toBeVisible();
  await panel.getByRole('button', { name: 'Cut out & join' }).click();
  // The Cut settings stay open after applying, with a fresh band for the new 300 × 200 image.
  await expect(editor.getByText('300 × 200 px')).toBeVisible();
  await expect(from).toHaveValue('80');
  await expect(to).toHaveValue('120');
  await expect(editor.getByRole('button', { name: 'Cut out & join' }).first()).toHaveAttribute('aria-pressed', 'true');
  await expect(editor.getByText('300 × 200 px')).toBeVisible();

  // Export: the joined image is red on top, blue below, with no green left.
  await editor.getByRole('button', { name: 'Export…' }).click();
  const exp = editor.getByRole('dialog', { name: 'Export' });
  await expect(exp.getByRole('radiogroup', { name: 'Image format' }).getByRole('radio')).toHaveCount(3);
  await expect(exp.getByRole('radio', { name: 'PNG' })).toHaveAttribute('aria-checked', 'true');
  await expect(exp.getByText('300 × 200 px')).toBeVisible();
  const download = editor.waitForEvent('download');
  await exp.getByRole('button', { name: 'Download', exact: true }).click();
  const bytes = readFileSync((await (await download).path())!);
  const colours = await editor.evaluate(async (data) => {
    const bmp = await createImageBitmap(new Blob([new Uint8Array(data)], { type: 'image/png' }));
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    const ctx = c.getContext('2d')!;
    ctx.drawImage(bmp, 0, 0);
    const px = (y: number) => Array.from(ctx.getImageData(150, y, 1, 1).data.slice(0, 3));
    return { w: bmp.width, h: bmp.height, top: px(50), above: px(98), below: px(102), bottom: px(150) };
  }, Array.from(bytes));
  expect([colours.w, colours.h]).toEqual([300, 200]);
  expect(colours.top).toEqual([255, 0, 0]);
  expect(colours.above).toEqual([255, 0, 0]);
  expect(colours.below).toEqual([0, 0, 255]);
  expect(colours.bottom).toEqual([0, 0, 255]);

  // Undo brings the middle back.
  await editor.keyboard.press('Control+z');
  await expect(editor.getByText('300 × 300 px')).toBeVisible();
  await expect(from).toHaveValue('120'); // still cutting: the band follows the restored size
});

test('scroll areas: names without the count, outlines removed when the popup closes', async ({ context, extPage, baseUrl }) => {
  const html = readFileSync(new URL('./assets/travel-portal.html', import.meta.url), 'utf8');
  const page = await context.newPage();
  await page.goto(`${baseUrl}/short`);
  await page.setContent(html);
  await page.waitForTimeout(400);
  await page.bringToFront();
  const tabId = await tabIdFor(extPage, `${baseUrl}/*`);
  const report = await send<{ areas: Array<{ label: string; detail?: string }> }>(extPage, { target: 'background', type: 'screenshot/scroll-areas', tabId });
  expect(report.areas.map((a) => a.label)).toEqual(['CONTENT 1 - VACATION PACKAGE RESULTS', 'CONTENT 2 - FLIGHT RESULTS', expect.stringMatching(/^CONTENT 3 - [A-Z ]+$/)]);
  expect(report.areas[0]!.detail).toBe('25 packages');
  await expect.poll(() => page.evaluate(() => document.querySelectorAll('#glint-scroll-areas > div').length)).toBe(3);

  // The popup's chooser holds a port while it is open; closing it (port disconnect) clears the outlines.
  await extPage.evaluate((id) => {
    const w = window as unknown as { __areasPort?: chrome.runtime.Port };
    w.__areasPort = chrome.runtime.connect({ name: `pixora-scroll-areas:${id}` });
  }, tabId);
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => document.querySelectorAll('#glint-scroll-areas > div').length)).toBe(3);
  await extPage.evaluate(() => (window as unknown as { __areasPort?: chrome.runtime.Port }).__areasPort?.disconnect());
  await expect.poll(() => page.evaluate(() => document.getElementById('glint-scroll-areas'))).toBeNull();
});
