import { expect, test } from './fixtures';
import type { Page } from '@playwright/test';
import { drag, eraseTool, openStripes, stripes } from './redact-helpers';

async function fakeFullScreen(editor: Page) {
  await editor.evaluate(() => {
    let full: Element | null = null;
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => full });
    Element.prototype.requestFullscreen = function (this: Element) { full = this; document.dispatchEvent(new Event('fullscreenchange')); return Promise.resolve(); };
    document.exitFullscreen = () => { full = null; document.dispatchEvent(new Event('fullscreenchange')); return Promise.resolve(); };
  });
}

test('adding an image is quick; full screen strip: no empty space with two images; at most ten thumbnails, arrows for the rest', async ({ context, extensionId }) => {
  test.setTimeout(150_000);
  const { editor, cx, cy } = await openStripes(context, extensionId);
  // An edit on the first image (saved in the background while the new one opens).
  await editor.keyboard.press('r');
  await drag(editor, cx - 60, cy - 40, cx + 60, cy + 40);
  const buf = await stripes(editor);
  const t = Date.now();
  await editor.locator('input[type="file"]').last().setInputFiles({ name: 'second.png', mimeType: 'image/png', buffer: buf });
  await expect(editor.getByRole('button', { name: 'Open image 2' })).toBeVisible();
  await expect(editor.getByRole('img', { name: 'Screenshot canvas' })).toBeVisible();
  expect(Date.now() - t).toBeLessThan(2500);

  await fakeFullScreen(editor);
  const bar = editor.getByRole('group', { name: 'View' });
  await bar.getByRole('button', { name: 'Full screen' }).click();
  const strip = editor.getByRole('group', { name: 'Open images' });
  // Two images: the card is just as wide as the two thumbnails (no empty space), no arrows.
  const card = (await strip.boundingBox())!;
  const last = (await strip.getByRole('listitem').last().boundingBox())!;
  expect(card.x + card.width - (last.x + last.width)).toBeLessThan(12);
  await expect(strip.getByRole('button', { name: 'More images' })).toHaveCount(0);
  await bar.getByRole('button', { name: 'Exit full screen' }).click();

  // Twelve images: ten show, arrows for the rest.
  for (let i = 0; i < 10; i++) {
    await editor.locator('input[type="file"]').last().setInputFiles({ name: `img${i}.png`, mimeType: 'image/png', buffer: buf });
    await expect(editor.getByRole('button', { name: `Open image ${i + 3}` })).toBeVisible({ timeout: 15_000 });
  }
  await editor.setViewportSize({ width: 1800, height: 900 });
  await bar.getByRole('button', { name: 'Full screen' }).click();
  await expect(strip.getByRole('button', { name: 'Earlier images' })).toBeVisible();
  const row = strip.getByRole('list');
  const visible = await row.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return [...el.children].filter((c) => { const b = c.getBoundingClientRect(); return b.left >= r.left - 1 && b.right <= r.right + 1; }).length;
  });
  expect(visible).toBe(10);
  await editor.close();
});

test('Before / After is a button with an icon (on: highlighted)', async ({ context, extensionId }) => {
  const { editor, cx, cy } = await openStripes(context, extensionId);
  const bar = editor.getByRole('group', { name: 'View' });
  const ba = bar.getByRole('switch', { name: 'Before / After', exact: true });
  expect(await ba.evaluate((el) => el.tagName)).toBe('BUTTON');
  await expect(ba.locator('svg')).toHaveCount(1);
  await expect(ba).toBeDisabled();
  await eraseTool(editor, 'Image');
  await drag(editor, cx - 100, cy, cx + 100, cy);
  await ba.click();
  await expect(ba).toHaveAttribute('aria-checked', 'true');
  await expect(bar.getByRole('radio', { name: 'Slider' })).toHaveAttribute('aria-checked', 'true');
  await ba.click();
  await expect(ba).toHaveAttribute('aria-checked', 'false');
  await editor.close();
});
