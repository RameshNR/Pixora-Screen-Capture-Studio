import { expect, test } from './fixtures';
import type { Page } from '@playwright/test';
import { drag, eraseTool, openStripes, stripes } from './redact-helpers';

async function pixels(editor: Page, x: number, y: number, half: number): Promise<number[]> {
  const shot = await editor.screenshot({ clip: { x: x - half, y: y - half, width: half * 2, height: half * 2 } });
  return editor.evaluate(async (b64) => {
    const bmp = await createImageBitmap(new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], { type: 'image/png' }));
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    const x2 = c.getContext('2d')!;
    x2.drawImage(bmp, 0, 0);
    return Array.from(x2.getImageData(0, 0, c.width, c.height).data);
  }, shot.toString('base64'));
}
const blue = (d: number[]) => { let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i]! < 80 && d[i + 2]! > 160) n++; return n / (d.length / 4); };

test('settings popup: an icon for each setting; compare settings greyed out until something changed; the magnifier shows the picture enlarged', async ({ context, extensionId }) => {
  const { editor, cx, cy } = await openStripes(context, extensionId);
  const bar = editor.getByRole('group', { name: 'View' });
  await bar.getByRole('button', { name: 'View settings' }).click();
  const menu = editor.getByRole('dialog', { name: 'View settings' });
  for (const s of ['Show control bar', 'Before / After labels', 'Vertical split', 'Loupe (magnifier)']) {
    const row = menu.locator('label', { has: editor.getByRole('switch', { name: s }) });
    await expect(row.locator('svg')).toHaveCount(1);
  }
  // Nothing changed yet: the compare settings and views are greyed out; the loupe works anyway.
  await expect(menu.getByRole('switch', { name: 'Vertical split' })).toBeDisabled();
  await expect(menu.getByRole('switch', { name: 'Before / After labels' })).toBeDisabled();
  await expect(bar.getByRole('radio', { name: 'Slider' })).toBeDisabled();
  await menu.getByRole('switch', { name: 'Loupe (magnifier)' }).click();
  await editor.mouse.click(5, 300);
  // The loupe shows the stripes (2.5×: each stripe wider), not a blank circle.
  await editor.mouse.move(cx, cy);
  await editor.mouse.move(cx + 3, cy + 2);
  await expect.poll(async () => blue(await pixels(editor, cx + 3, cy + 2, 60))).toBeGreaterThan(0.25);
  const d = await pixels(editor, cx + 3, cy + 2, 60);
  // Count colour changes across the middle row: fewer than without magnifying (stripes 20 px wide at the shown zoom).
  const w = 120;
  let changes = 0;
  for (let x = 1; x < w; x++) {
    const i = (60 * w + x) * 4, j = (60 * w + x - 1) * 4;
    if ((d[i]! < 80) !== (d[j]! < 80)) changes++;
  }
  const k = Number((await editor.getByLabel('Zoom level').inputValue()).replace('%', '')) / 100;
  expect(changes).toBeLessThan(w / (20 * k));
  await editor.close();
});

test('comparing is view only (no drawing); the zoom size list sets the zoom', async ({ context, extensionId }) => {
  const { editor, cx, cy } = await openStripes(context, extensionId);
  const bar = editor.getByRole('group', { name: 'View' });
  // A change, then compare.
  await eraseTool(editor, 'Image');
  await editor.getByRole('radiogroup', { name: 'Erase to' }).getByRole('radio', { name: 'White', exact: true }).click();
  await drag(editor, cx - 100, cy, cx + 100, cy);
  await editor.getByRole('tab', { name: 'History' }).click();
  const steps = await editor.getByRole('tab', { name: 'History' }).textContent();
  await bar.getByRole('radio', { name: 'Slider' }).click();
  // A drag with the eraser while comparing does nothing to the picture.
  await drag(editor, cx - 100, cy + 100, cx + 100, cy + 100);
  await expect(editor.getByRole('tab', { name: 'History' })).toHaveText(steps!);
  // Zoom sizes.
  await bar.getByRole('button', { name: 'Zoom sizes' }).click();
  await editor.getByRole('listbox', { name: 'Zoom' }).getByRole('option', { name: '100%' }).click();
  await expect(bar.getByRole('textbox', { name: 'Zoom level' })).toHaveValue('100%');
  await editor.close();
});

test('full screen: the open images in a strip on top; switching keeps full screen', async ({ context, extensionId }) => {
  const { editor } = await openStripes(context, extensionId);
  // A second image (the image list's Add).
  const inputs = editor.locator('input[type="file"]');
  await inputs.last().setInputFiles({ name: 'second.png', mimeType: 'image/png', buffer: await stripes(editor) });
  await expect(editor.getByRole('button', { name: 'Open image 2' })).toBeVisible({ timeout: 15_000 });
  // Real full screen is refused in the test browser: stand in for it.
  await editor.evaluate(() => {
    let full: Element | null = null;
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => full });
    Element.prototype.requestFullscreen = function (this: Element) { full = this; document.dispatchEvent(new Event('fullscreenchange')); return Promise.resolve(); };
    document.exitFullscreen = () => { full = null; document.dispatchEvent(new Event('fullscreenchange')); return Promise.resolve(); };
  });
  await editor.getByRole('group', { name: 'View' }).getByRole('button', { name: 'Full screen' }).click();
  const strip = editor.getByRole('group', { name: 'Open images' });
  await expect(strip.getByRole('listitem')).toHaveCount(2);
  // Toolbar, side panel and image list are hidden.
  await expect(editor.getByRole('toolbar', { name: 'Editor tools' })).toHaveCount(0);
  await expect(editor.getByRole('complementary', { name: 'Properties' })).toHaveCount(0);
  const current = strip.locator('[aria-current="true"]');
  const first = await current.getAttribute('aria-label');
  await strip.getByRole('listitem').filter({ hasNot: editor.locator('[aria-current="true"]') }).first().click();
  await expect.poll(() => current.getAttribute('aria-label')).not.toBe(first);
  expect(await editor.evaluate(() => document.fullscreenElement?.id)).toBe('pixora-fs-root');
  await expect(editor.getByRole('group', { name: 'View' }).getByRole('button', { name: 'Exit full screen' })).toBeVisible();
  await editor.close();
});

test('full screen fills the screen with the picture; a zoomed picture can scroll clear of the bar; the settings popup closes when the bar is switched; switching back to an image is quick', async ({ context, extensionId }) => {
  test.setTimeout(120_000);
  const { editor } = await openStripes(context, extensionId);
  await editor.locator('input[type="file"]').last().setInputFiles({ name: 'second.png', mimeType: 'image/png', buffer: await stripes(editor) });
  await expect(editor.getByRole('button', { name: 'Open image 2' })).toBeVisible({ timeout: 15_000 });
  const bar = editor.getByRole('group', { name: 'View' });

  // Zoomed in and scrolled to the end: the picture's last row is above the bar, not under it.
  await bar.getByRole('button', { name: 'Zoom sizes' }).click();
  await editor.getByRole('listbox', { name: 'Zoom' }).getByRole('option', { name: '400%' }).click();
  const canvas = editor.getByRole('img', { name: 'Screenshot canvas' });
  await canvas.evaluate((el) => { const sc = el.closest('[class*="workspace"]') as HTMLElement; sc.scrollTop = sc.scrollHeight; });
  await editor.waitForTimeout(300);
  const barBox = (await bar.boundingBox())!;
  const pictureBottom = await canvas.evaluate((el) => {
    const sc = el.closest('[class*="workspace"]') as HTMLElement;
    // The picture ends where the scrollable content ends minus the bottom room.
    return sc.getBoundingClientRect().top + (sc.scrollHeight - sc.scrollTop) - 48 - 64;
  });
  expect(pictureBottom).toBeLessThanOrEqual(barBox.y + 1);
  await bar.getByRole('button', { name: 'Fit to screen' }).click();

  // Settings popup closes after switching the bar off / on.
  await bar.getByRole('button', { name: 'View settings' }).click();
  await editor.getByRole('dialog', { name: 'View settings' }).getByRole('switch', { name: 'Show control bar' }).click();
  await expect(editor.getByRole('dialog', { name: 'View settings' })).toHaveCount(0);
  await bar.getByRole('button', { name: 'View settings' }).click();
  await editor.getByRole('dialog', { name: 'View settings' }).getByRole('switch', { name: 'Show control bar' }).click();
  await expect(editor.getByRole('dialog', { name: 'View settings' })).toHaveCount(0);

  // Full screen (stood in for: the test browser refuses the real one): the picture area takes the whole window.
  await editor.evaluate(() => {
    let full: Element | null = null;
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => full });
    Element.prototype.requestFullscreen = function (this: Element) { full = this; document.dispatchEvent(new Event('fullscreenchange')); return Promise.resolve(); };
    document.exitFullscreen = () => { full = null; document.dispatchEvent(new Event('fullscreenchange')); return Promise.resolve(); };
  });
  await bar.getByRole('button', { name: 'Full screen' }).click();
  await expect.poll(async () => (await canvas.boundingBox())!.height).toBeGreaterThan(850);
  expect((await canvas.boundingBox())!.width).toBeGreaterThan(1400);

  // Switching: to the other image and back; back is quick (kept in memory).
  const strip = editor.getByRole('group', { name: 'Open images' });
  await strip.getByRole('listitem').nth(0).click();
  await expect(strip.getByRole('listitem').nth(0)).toHaveAttribute('aria-current', 'true');
  await expect(canvas).toBeVisible();
  const t = Date.now();
  await strip.getByRole('listitem').nth(1).click();
  await expect(strip.getByRole('listitem').nth(1)).toHaveAttribute('aria-current', 'true');
  await expect(canvas).toBeVisible();
  expect(Date.now() - t).toBeLessThan(1500);
  await editor.close();
});

test('full screen with several images: small thumbnails on the left, controls on the right in one row; arrows when they do not fit; one image: controls centred', async ({ context, extensionId }) => {
  test.setTimeout(150_000);
  const { editor } = await openStripes(context, extensionId);
  await editor.evaluate(() => {
    let full: Element | null = null;
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => full });
    Element.prototype.requestFullscreen = function (this: Element) { full = this; document.dispatchEvent(new Event('fullscreenchange')); return Promise.resolve(); };
    document.exitFullscreen = () => { full = null; document.dispatchEvent(new Event('fullscreenchange')); return Promise.resolve(); };
  });
  const bar = editor.getByRole('group', { name: 'View' });
  // One image: no strip, controls centred.
  await bar.getByRole('button', { name: 'Full screen' }).click();
  await expect(editor.getByRole('group', { name: 'Open images' })).toHaveCount(0);
  const vw = editor.viewportSize()!.width;
  const b1 = (await bar.boundingBox())!;
  expect(Math.abs(b1.x + b1.width / 2 - vw / 2)).toBeLessThan(30);
  await bar.getByRole('button', { name: 'Exit full screen' }).click();

  // Seven more images.
  const buf = await stripes(editor);
  for (let i = 0; i < 7; i++) {
    await editor.locator('input[type="file"]').last().setInputFiles({ name: `img${i}.png`, mimeType: 'image/png', buffer: buf });
    await expect(editor.getByRole('button', { name: `Open image ${i + 2}` })).toBeVisible({ timeout: 15_000 });
  }
  await editor.setViewportSize({ width: 1100, height: 750 });
  await bar.getByRole('button', { name: 'Full screen' }).click();
  const strip = editor.getByRole('group', { name: 'Open images' });
  await expect(strip).toBeVisible();
  const s = (await strip.boundingBox())!;
  const b = (await bar.boundingBox())!;
  // Same row, strip left of the controls, not overlapping; small thumbnails.
  expect(Math.abs((s.y + s.height / 2) - (b.y + b.height / 2))).toBeLessThan(12);
  expect(s.x + s.width).toBeLessThanOrEqual(b.x);
  expect(s.x).toBeLessThan(40);
  expect(b.x + b.width).toBeGreaterThan(1100 - 40);
  const thumb = (await strip.getByRole('listitem').first().boundingBox())!;
  expect(thumb.height).toBeLessThanOrEqual(40);
  // More images than fit: arrows; the right one scrolls.
  const earlier = strip.getByRole('button', { name: 'Earlier images' });
  const more = strip.getByRole('button', { name: 'More images' });
  await expect(more).toBeVisible();
  // Scroll to the far left, then the right arrow scrolls on.
  for (let i = 0; i < 12 && (await earlier.isEnabled()); i++) { await earlier.click(); await editor.waitForTimeout(400); }
  await expect(earlier).toBeDisabled();
  await expect(more).toBeEnabled();
  await more.click();
  await expect(earlier).toBeEnabled();
  await editor.close();
});

test('Copy image: the clipboard is written and the "Copied" note shows without waiting for the save', async ({ context, extensionId }) => {
  const { editor, cx, cy } = await openStripes(context, extensionId);
  // The test browser has no real clipboard: note what is written.
  await editor.evaluate(() => {
    (window as unknown as { wrote: number }).wrote = 0;
    navigator.clipboard.write = async () => { (window as unknown as { wrote: number }).wrote++; };
  });
  await editor.keyboard.press('r');
  await drag(editor, cx - 50, cy - 50, cx + 50, cy + 50);
  const t = Date.now();
  await editor.getByRole('button', { name: 'Copy', exact: true }).click();
  await expect(editor.getByText('Copied to clipboard')).toBeVisible();
  expect(Date.now() - t).toBeLessThan(3000);
  expect(await editor.evaluate(() => (window as unknown as { wrote: number }).wrote)).toBe(1);
  await editor.close();
});
