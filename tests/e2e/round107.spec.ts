import { expect, test } from './fixtures';
import type { Page } from '@playwright/test';
import { openStripes, stripes } from './redact-helpers';

async function fakeFullScreen(page: Page) {
  await page.evaluate(() => {
    let full: Element | null = null;
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => full });
    Element.prototype.requestFullscreen = function (this: Element) { full = this; document.dispatchEvent(new Event('fullscreenchange')); return Promise.resolve(); };
    document.exitFullscreen = () => { full = null; document.dispatchEvent(new Event('fullscreenchange')); return Promise.resolve(); };
  });
}

test('the picture sits in the middle of the space above the bar (same gap above and below)', async ({ context, extensionId }) => {
  const { editor } = await openStripes(context, extensionId);
  const top = await editor.evaluate(() => {
    const c = document.querySelector('canvas[aria-label="Screenshot canvas"]') as HTMLCanvasElement;
    const x = c.getContext('2d')!;
    const k = c.width / c.clientWidth;
    const col = x.getImageData(Math.floor(c.width / 2), 0, 1, c.height).data;
    let first = -1;
    let last = -1;
    for (let y = 0; y < c.height; y++) { const r = col[y * 4]!, b = col[y * 4 + 2]!; const stripe = (r < 80 && b > 160) || (r > 240 && col[y * 4 + 1]! > 240 && b > 240); if (stripe) { if (first < 0) first = y; last = y; } }
    return { first: first / k, last: last / k, top: c.getBoundingClientRect().top };
  });
  const bar = (await editor.getByRole('group', { name: 'View' }).boundingBox())!;
  const above = top.first;
  const below = bar.y - (top.top + top.last);
  expect(Math.abs(above - below)).toBeLessThan(24);
  await editor.close();
});

test('full screen: ↓ shows and hides the details (animated); docked they are a card with even gaps; with few images switching never shows arrows', async ({ context, extensionId }) => {
  test.setTimeout(120_000);
  const { editor } = await openStripes(context, extensionId);
  await editor.locator('input[type="file"]').last().setInputFiles({ name: 'two.png', mimeType: 'image/png', buffer: await stripes(editor) });
  await expect(editor.getByRole('button', { name: 'Open image 2' })).toBeVisible({ timeout: 15_000 });
  await fakeFullScreen(editor);
  const bar = editor.getByRole('group', { name: 'View' });
  await bar.getByRole('button', { name: 'Full screen' }).click();
  const details = editor.getByRole('dialog', { name: 'Image details' });
  await editor.keyboard.press('ArrowDown');
  await expect(details).toBeVisible();
  await editor.keyboard.press('ArrowDown');
  await expect(details).toHaveCount(0);
  // Docked: a card 16 px from the top, right and bottom.
  await bar.getByRole('button', { name: 'View settings' }).click();
  await editor.getByRole('dialog', { name: 'View settings' }).getByRole('switch', { name: 'Details as a popup' }).click();
  await editor.mouse.click(700, 300);
  await editor.keyboard.press('ArrowDown');
  await expect(details).toBeVisible();
  await editor.waitForTimeout(400);
  const d = (await details.boundingBox())!;
  const vp = editor.viewportSize()!;
  expect(Math.round(d.y)).toBe(16);
  expect(Math.round(vp.width - (d.x + d.width))).toBe(16);
  expect(Math.round(vp.height - (d.y + d.height))).toBe(16);
  await editor.keyboard.press('ArrowUp');
  await expect(details).toHaveCount(0);
  // Two images: no arrows, before, during or after switching.
  await editor.evaluate(() => {
    const w = window as unknown as { arrows: number };
    w.arrows = 0;
    const check = () => { if (document.querySelector('[aria-label^="Earlier images"], [aria-label^="More images"]')) w.arrows++; requestAnimationFrame(check); };
    requestAnimationFrame(check);
  });
  for (const k of ['ArrowLeft', 'ArrowRight', 'ArrowLeft']) { await editor.keyboard.press(k); await editor.waitForTimeout(300); }
  expect(await editor.evaluate(() => (window as unknown as { arrows: number }).arrows)).toBe(0);
  await editor.close();
});

test('an edit downloaded and then undone: nothing to compare any more', async ({ context, extensionId }) => {
  const { editor, cx, cy } = await openStripes(context, extensionId);
  await editor.keyboard.press('p');
  await editor.mouse.move(cx - 80, cy);
  await editor.mouse.down();
  await editor.mouse.move(cx + 80, cy + 30, { steps: 6 });
  await editor.mouse.up();
  const ba = editor.getByRole('group', { name: 'View' }).getByRole('switch', { name: 'Before / After', exact: true });
  await expect(ba).toBeEnabled();
  // Download (saves the edit to Recent captures), then undo it.
  await editor.getByRole('button', { name: /^Download/ }).first().click();
  await expect(editor.getByText(/Downloaded|Saved/).first()).toBeVisible({ timeout: 15_000 });
  await editor.keyboard.press('Control+z');
  await expect(ba).toBeDisabled();
  await editor.close();
});
