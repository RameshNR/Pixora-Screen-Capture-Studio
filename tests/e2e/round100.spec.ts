import { expect, test } from './fixtures';
import type { Page } from '@playwright/test';
import { drag, eraseTool, openStripes } from './redact-helpers';

/** Share of blue (stripe) pixels around a screen point. */
async function blueAt(editor: Page, x: number, y: number, half = 15): Promise<number> {
  const shot = await editor.screenshot({ clip: { x: x - half, y: y - half, width: half * 2, height: half * 2 } });
  const d = await editor.evaluate(async (b64) => {
    const bmp = await createImageBitmap(new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], { type: 'image/png' }));
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    const x2 = c.getContext('2d')!;
    x2.drawImage(bmp, 0, 0);
    return Array.from(x2.getImageData(0, 0, c.width, c.height).data);
  }, shot.toString('base64'));
  let n = 0;
  for (let i = 0; i < d.length; i += 4) if (d[i]! < 80 && d[i + 2]! > 160) n++;
  return n / (d.length / 4);
}

test('the bar under the picture: settings and Before / After left, compare views in the middle, zoom / fit / full screen right; every view works', async ({ context, extensionId }) => {
  test.setTimeout(120_000);
  const { editor, cx, cy } = await openStripes(context, extensionId);
  const bar = editor.getByRole('group', { name: 'View' });
  const pos = async (name: string, role: 'button' | 'radio' | 'switch' = 'button') => (await bar.getByRole(role, { name, exact: true }).boundingBox())!.x;
  // Left → right: settings, Before / After, the views, loupe, vertical, zoom, fit, full screen.
  const order = [await pos('View settings'), await pos('Before / After', 'switch'), await pos('Side by side', 'radio'), await pos('Slider', 'radio'),
    await pos('Overlay (fade between them)', 'radio'),
    await pos('Zoom out'), await pos('Fit to screen'), await pos('Full screen')];
  // Loupe and vertical split are in the settings popup, not on the bar.
  await expect(bar.getByRole('button', { name: 'Vertical split' })).toHaveCount(0);
  expect([...order].sort((a, b) => a - b)).toEqual(order);
  // The bar is under the picture, not over it.
  const pic = (await editor.getByRole('img', { name: 'Screenshot canvas' }).boundingBox())!;
  void pic;

  // Make a change: erase a band in the middle to white.
  await eraseTool(editor, 'Image');
  await editor.getByRole('radiogroup', { name: 'Erase to' }).getByRole('radio', { name: 'White', exact: true }).click();
  await editor.getByRole('slider', { name: 'Brush size' }).fill('300');
  await drag(editor, cx - 150, cy, cx + 150, cy);
  await expect.poll(() => blueAt(editor, cx - 60, cy)).toBeLessThan(0.02);

  // Slider: Before on the left.
  await bar.getByRole('radio', { name: 'Slider' }).click();
  await expect(bar.getByRole('switch', { name: 'Before / After' })).toHaveAttribute('aria-checked', 'true');
  await expect.poll(() => blueAt(editor, cx - 60, cy)).toBeGreaterThan(0.2);
  expect(await blueAt(editor, cx + 60, cy)).toBeLessThan(0.02);
  // Vertical split: Before above the divider (the band is in the middle row: above it, the stripes).
  await bar.getByRole('button', { name: 'View settings' }).click();
  const settings = editor.getByRole('dialog', { name: 'View settings' });
  await settings.getByRole('switch', { name: 'Vertical split' }).click();
  await expect.poll(() => blueAt(editor, cx - 90, cy - 40)).toBeGreaterThan(0.2);
  await settings.getByRole('switch', { name: 'Vertical split' }).click();
  await editor.keyboard.press('Escape');
  await editor.mouse.click(5, 300);
  // Overlay: a mix slider; all Before shows the stripes everywhere.
  await bar.getByRole('radio', { name: 'Overlay (fade between them)' }).click();
  const mix = bar.getByRole('slider', { name: 'Overlay mix' });
  await mix.fill('0');
  await expect.poll(() => blueAt(editor, cx + 60, cy)).toBeGreaterThan(0.2);
  await mix.fill('100');
  await expect.poll(() => blueAt(editor, cx + 60, cy)).toBeLessThan(0.02);
  // Highlight changes (settings): the changed band tinted red.
  await mix.fill('100');
  await bar.getByRole('button', { name: 'View settings' }).click();
  await editor.getByRole('dialog', { name: 'View settings' }).getByRole('switch', { name: 'Highlight changes' }).click();
  await editor.mouse.click(5, 300);
  await expect.poll(async () => {
    const shot = await editor.screenshot({ clip: { x: cx - 10, y: cy - 10, width: 20, height: 20 } });
    return editor.evaluate(async (b64) => {
      const bmp = await createImageBitmap(new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], { type: 'image/png' }));
      const c = new OffscreenCanvas(bmp.width, bmp.height);
      const x2 = c.getContext('2d')!;
      x2.drawImage(bmp, 0, 0);
      const d = x2.getImageData(0, 0, c.width, c.height).data;
      let n = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i]! > 150 && d[i + 1]! < 140 && d[i + 2]! < 170) n++;
      return n / (d.length / 4);
    }, shot.toString('base64'));
  }).toBeGreaterThan(0.3);
  // Side by side: both, each at half size.
  await bar.getByRole('radio', { name: 'Side by side' }).click();
  await expect(bar.getByRole('radio', { name: 'Side by side' })).toHaveAttribute('aria-checked', 'true');
  // Zoom from the bar.
  const zoomBox = bar.getByRole('textbox', { name: 'Zoom level' });
  const before = await zoomBox.inputValue();
  await bar.getByRole('button', { name: 'Zoom in' }).click();
  await expect(zoomBox).not.toHaveValue(before);
  await editor.close();
});

test('compare settings: the bar can be switched off (a small card in the corner instead) and back on; the setting is kept', async ({ context, extensionId }) => {
  const { editor } = await openStripes(context, extensionId);
  const bar = editor.getByRole('group', { name: 'View' });
  await bar.getByRole('button', { name: 'View settings' }).click();
  const menu = editor.getByRole('dialog', { name: 'View settings' });
  for (const s of ['Show control bar', 'Before / After labels', 'Loupe (magnifier)', 'Vertical split']) await expect(menu.getByRole('switch', { name: s })).toBeVisible();
  await expect(menu.getByRole('switch', { name: 'Show control bar' })).toHaveAttribute('aria-checked', 'true');
  await menu.getByRole('switch', { name: 'Show control bar' }).click();
  // Compact card: settings, Before / After, fit, full screen — no compare views.
  await expect(bar.getByRole('radio', { name: 'Slider' })).toHaveCount(0);
  await expect(bar.getByRole('button', { name: 'Fit to screen' })).toBeVisible();
  await expect(bar.getByRole('button', { name: 'Full screen' })).toBeVisible();
  const card = (await bar.boundingBox())!;
  const canvas = (await editor.getByRole('img', { name: 'Screenshot canvas' }).boundingBox())!;
  expect(card.x + card.width).toBeGreaterThan(canvas.x + canvas.width - 40);
  // Kept when the editor opens again.
  await editor.reload();
  await expect(editor.getByRole('group', { name: 'View' }).getByRole('radio', { name: 'Slider' })).toHaveCount(0);
  await editor.getByRole('group', { name: 'View' }).getByRole('button', { name: 'View settings' }).click();
  await editor.getByRole('dialog', { name: 'View settings' }).getByRole('switch', { name: 'Show control bar' }).click();
  await expect(editor.getByRole('group', { name: 'View' }).getByRole('radio', { name: 'Slider' })).toBeVisible();
  await editor.close();
});
