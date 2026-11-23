import { expect, test } from './fixtures';

async function png(page: import('@playwright/test').Page, w: number, h: number, color: string): Promise<Buffer> {
  return Buffer.from(await page.evaluate(async ([w, h, color]) => {
    const c = new OffscreenCanvas(w as number, h as number);
    const x = c.getContext('2d')!;
    x.fillStyle = color as string;
    x.fillRect(0, 0, w as number, h as number);
    return Array.from(new Uint8Array(await (await c.convertToBlob({ type: 'image/png' })).arrayBuffer()));
  }, [w, h, color] as const));
}

test('compare fits the screen with no scrollbars; image cards have the flow options', async ({ context, extensionId }) => {
  const editor = await context.newPage();
  await editor.setViewportSize({ width: 1400, height: 860 });
  await editor.goto(`chrome-extension://${extensionId}/editor.html?import=1`);
  await editor.locator('input[type="file"]').first().setInputFiles({ name: 'wide.png', mimeType: 'image/png', buffer: await png(editor, 3842, 1866, '#2255aa') });
  await expect(editor.getByRole('img', { name: 'Screenshot canvas' })).toBeVisible();

  // ---- Compare: full screen stays inside the window; at Fit the panes show no scrollbars.
  await editor.getByRole('button', { name: 'View original' }).first().click();
  const cmp = editor.getByRole('dialog', { name: 'Original screenshot' });
  await expect(cmp.getByRole('img', { name: 'Screenshot: Original' })).toBeVisible();
  await cmp.getByRole('button', { name: 'Full screen' }).click();
  await expect.poll(async () => {
    const b = (await cmp.boundingBox())!;
    return [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)];
  }).toEqual([0, 0, 1400, 860]);
  const noScroll = () => cmp.getByLabel('Zoomable image').evaluateAll((els) => els.every((el) => el.scrollWidth <= el.clientWidth + 1 && el.scrollHeight <= el.clientHeight + 1 && getComputedStyle(el).overflow === 'hidden'));
  await expect.poll(noScroll).toBe(true);
  // Zoomed in, it scrolls again.
  await cmp.getByRole('button', { name: '100%' }).click();
  await expect.poll(() => cmp.getByLabel('Zoomable image').first().evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
  await cmp.getByRole('button', { name: 'Exit full screen' }).click();
  const b = (await cmp.boundingBox())!;
  expect(b.x).toBeGreaterThan(0);
  expect(b.x + b.width).toBeLessThanOrEqual(1400);
  expect(b.y + b.height).toBeLessThanOrEqual(860);
  await cmp.getByRole('button', { name: 'Done' }).click();

  // ---- Image cards: name, details, move, duplicate (as in the Flow Editor).
  const rail = editor.getByRole('complementary', { name: 'Images' });
  // Drawing marks the image as edited straight away.
  await editor.keyboard.press('r');
  const cb = (await editor.getByRole('img', { name: 'Screenshot canvas' }).boundingBox())!;
  await editor.mouse.move(cb.x + cb.width / 2 - 80, cb.y + cb.height / 2 - 50);
  await editor.mouse.down();
  await editor.mouse.move(cb.x + cb.width / 2 + 80, cb.y + cb.height / 2 + 50, { steps: 5 });
  await editor.mouse.up();
  await expect(rail.getByText('edited')).toHaveCount(1);
  await editor.keyboard.press('Control+z');
  await expect(rail.getByText('edited')).toHaveCount(0);
  await editor.keyboard.press('Control+y');
  await expect(rail.getByText('edited')).toHaveCount(1);
  await expect(rail.getByText(/3842×1866/)).toBeVisible();
  const name = rail.getByRole('textbox', { name: 'Name of image 1' });
  await name.fill('Hotel results');
  await name.press('Enter');
  await expect(name).toHaveValue('Hotel results.png');
  await rail.getByRole('button', { name: 'Duplicate' }).click();
  await expect(rail.getByText('Images (2)')).toBeVisible();
  await expect(rail.getByRole('textbox', { name: 'Name of image 2' })).toHaveValue('Hotel results (copy).png');
  await expect(rail.getByRole('button', { name: 'Open image 2' })).toHaveAttribute('aria-current', 'true');
  await rail.getByRole('button', { name: 'Move up' }).nth(1).click();
  await expect(rail.getByRole('textbox', { name: 'Name of image 1' })).toHaveValue('Hotel results (copy).png');
  await expect(rail.getByRole('button', { name: 'Move down' }).first()).toBeEnabled();
});
