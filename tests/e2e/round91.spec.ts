import { expect, test } from './fixtures';
import type { Page } from '@playwright/test';
import { drag, eraseTool, redShare } from './redact-helpers';

/** Blue / white stripes with a red ball in the middle (an "object" on a patterned background). */
async function ballPicture(page: Page): Promise<Buffer> {
  return Buffer.from(await page.evaluate(async () => {
    const c = new OffscreenCanvas(1000, 700);
    const x = c.getContext('2d')!;
    for (let i = 0; i < 1000; i += 20) {
      x.fillStyle = (i / 20) % 2 ? '#1d4ed8' : '#f8fafc';
      x.fillRect(i, 0, 20, 700);
    }
    x.fillStyle = '#e11d1d';
    x.beginPath();
    x.arc(500, 350, 110, 0, Math.PI * 2);
    x.fill();
    return Array.from(new Uint8Array(await (await c.convertToBlob({ type: 'image/png' })).arrayBuffer()));
  }));
}

async function openBall(context: import('@playwright/test').BrowserContext, extensionId: string) {
  const editor = await context.newPage();
  await editor.setViewportSize({ width: 1500, height: 950 });
  await editor.goto(`chrome-extension://${extensionId}/editor.html?import=1`);
  await editor.locator('input[type="file"]').first().setInputFiles({ name: 'ball.png', mimeType: 'image/png', buffer: await ballPicture(editor) });
  const canvas = editor.getByRole('img', { name: 'Screenshot canvas' });
  await expect(canvas).toBeVisible();
  const box = (await canvas.boundingBox())!;
  return { editor, cx: box.x + box.width / 2, cy: box.y + box.height / 2 };
}

/** Shares of red and of blue (stripe) pixels around the ball. */
async function colours(editor: Page, cx: number, cy: number, half = 40) {
  const shot = await editor.screenshot({ clip: { x: cx - half, y: cy - half, width: half * 2, height: half * 2 } });
  const red = await redShare(editor, shot);
  const blue = await editor.evaluate(async (b64) => {
    const bmp = await createImageBitmap(new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], { type: 'image/png' }));
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    const x = c.getContext('2d')!;
    x.drawImage(bmp, 0, 0);
    const d = x.getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i]! < 90 && d[i + 1]! < 130 && d[i + 2]! > 150) n++;
    return n / (d.length / 4);
  }, shot.toString('base64'));
  return { red, blue };
}

test('Remove object: an AI click selects the ball, Enter removes it and the stripes carry on behind it', async ({ context, extensionId }) => {
  test.setTimeout(120_000);
  const { editor, cx, cy } = await openBall(context, extensionId);
  expect((await colours(editor, cx, cy)).red).toBeGreaterThan(0.9);
  await eraseTool(editor, 'Object');
  await expect(editor.getByRole('radio', { name: 'AI click' })).toHaveAttribute('aria-checked', 'true');
  const remove = editor.getByRole('button', { name: 'Remove (Enter)' });
  await expect(remove).toBeDisabled();
  await editor.mouse.click(cx, cy);
  await expect(remove).toBeEnabled({ timeout: 30_000 });
  await editor.keyboard.press('Enter');
  await expect.poll(async () => (await colours(editor, cx, cy)).red, { timeout: 30_000 }).toBeLessThan(0.02);
  // Not a white patch: the stripes were rebuilt.
  expect((await colours(editor, cx, cy)).blue).toBeGreaterThan(0.25);
  await editor.keyboard.press('Control+z');
  await expect.poll(async () => (await colours(editor, cx, cy)).red).toBeGreaterThan(0.9);
  await editor.close();
});

test('area bar: Remove content fills the marked part with matching background', async ({ context, extensionId }) => {
  test.setTimeout(90_000);
  const { editor, cx, cy } = await openBall(context, extensionId);
  const zoom = (await editor.getByRole('img', { name: 'Screenshot canvas' }).boundingBox())!.width / 1000;
  const r = 125 * Math.min(1, zoom);
  await drag(editor, cx - r, cy - r, cx + r, cy + r);
  await editor.getByRole('toolbar', { name: 'Marked area' }).getByRole('button', { name: 'Remove content (fill with background)' }).click();
  await expect.poll(async () => (await colours(editor, cx, cy)).red, { timeout: 30_000 }).toBeLessThan(0.02);
  expect((await colours(editor, cx, cy)).blue).toBeGreaterThan(0.25);
  await editor.close();
});

test('Erase image › Background (smart eraser) paints the ball away with stripes', async ({ context, extensionId }) => {
  test.setTimeout(90_000);
  const { editor, cx, cy } = await openBall(context, extensionId);
  await eraseTool(editor, 'Image');
  await editor.getByRole('radiogroup', { name: 'Erase to' }).getByRole('radio', { name: 'Background' }).click();
  await expect(editor.getByText('AI fill strength')).toBeVisible();
  await expect(editor.getByRole('switch', { name: 'Preserve surrounding details' })).toHaveAttribute('aria-checked', 'true');
  // A brush wider than the ball, over its middle.
  await editor.keyboard.press(']');
  for (let i = 0; i < 12; i++) await editor.keyboard.press(']');
  await drag(editor, cx - 10, cy, cx + 10, cy);
  await expect.poll(async () => (await colours(editor, cx, cy, 25)).red, { timeout: 30_000 }).toBeLessThan(0.05);
  expect((await colours(editor, cx, cy, 25)).blue).toBeGreaterThan(0.2);
  await editor.close();
});

test('Remove background: finds the ball, Apply keeps it and removes the stripes; White and Colour backgrounds', async ({ context, extensionId }) => {
  test.setTimeout(120_000);
  const { editor, cx, cy } = await openBall(context, extensionId);
  await eraseTool(editor, 'Background');
  await expect(editor.getByText(/^Found the subject in the picture/)).toBeVisible({ timeout: 30_000 });
  for (const name of ['None', 'White', 'Colour', 'Image', 'Blur']) await expect(editor.getByRole('radiogroup', { name: 'New background' }).getByRole('radio', { name, exact: true })).toBeVisible();
  // A flat graphic: exact edges, so the photo edge sliders are replaced by a note (Round 94).
  await expect(editor.getByText(/edges are kept exact and sharp/)).toBeVisible();
  await editor.getByRole('radio', { name: 'Restore' }).click();
  await expect(editor.getByText('Brush hardness')).toBeVisible();
  await editor.getByRole('radio', { name: 'White', exact: true }).click();
  // Preview: ball kept, stripes gone around it.
  const side = { x: cx + 220 * Math.min(1, (await editor.getByRole('img', { name: 'Screenshot canvas' }).boundingBox())!.width / 1000), y: cy };
  await expect.poll(async () => (await colours(editor, side.x, side.y, 20)).blue).toBeLessThan(0.02);
  expect((await colours(editor, cx, cy)).red).toBeGreaterThan(0.9);
  await editor.getByRole('button', { name: 'Apply (Enter)' }).click();
  await expect(editor.getByRole('button', { name: 'Select & move' })).toHaveAttribute('aria-pressed', 'true');
  expect((await colours(editor, side.x, side.y, 20)).blue).toBeLessThan(0.02);
  expect((await colours(editor, cx, cy)).red).toBeGreaterThan(0.9);
  await editor.keyboard.press('Control+z');
  await expect.poll(async () => (await colours(editor, side.x, side.y, 20)).blue).toBeGreaterThan(0.3);
  await editor.close();
});

test('Filters: tabs Presets / Adjust / Effects, Noir makes it grey, Before / After split on the picture, intensity, resets', async ({ context, extensionId }) => {
  test.setTimeout(120_000);
  const { editor, cx, cy } = await openBall(context, extensionId);
  await editor.getByRole('button', { name: /^Filters/ }).click();
  const tabs = editor.getByRole('tablist', { name: 'Filter settings' });
  const presets = editor.getByRole('radiogroup', { name: 'Filter preset' });
  for (const p of ['Original', 'Vivid', 'Warm', 'Cool', 'Cinematic', 'Vintage', 'B&W', 'Noir', 'Bright', 'Soft', 'Dramatic', 'Retro', 'Portrait']) await expect(presets.getByRole('radio', { name: p, exact: true })).toBeVisible();
  await presets.getByRole('radio', { name: 'Noir', exact: true }).click();
  await expect.poll(async () => (await colours(editor, cx, cy)).red).toBeLessThan(0.02);

  // Before / After on the picture: left of the divider is the original, right is filtered.
  await editor.getByRole('switch', { name: 'Before / After' }).click();
  await expect.poll(async () => (await colours(editor, cx - 50, cy, 15)).red).toBeGreaterThan(0.9);
  expect((await colours(editor, cx + 50, cy, 15)).red).toBeLessThan(0.02);
  // Drag the divider to the right: all of the ball is "before".
  await editor.mouse.move(cx, cy);
  await editor.mouse.down();
  await editor.mouse.move(cx + 200, cy, { steps: 6 });
  await editor.mouse.up();
  await expect.poll(async () => (await colours(editor, cx + 50, cy, 15)).red).toBeGreaterThan(0.9);
  await editor.getByRole('switch', { name: 'Before / After' }).click();
  await expect.poll(async () => (await colours(editor, cx, cy)).red).toBeLessThan(0.02);

  // Adjust: its own reset, and the value box.
  await tabs.getByRole('tab', { name: 'Adjust' }).click();
  for (const s2 of ['Brightness', 'Contrast', 'Saturation', 'Exposure', 'Temperature', 'Tint', 'Highlights', 'Shadows', 'Sharpness', 'Noise']) {
    await expect(editor.getByRole('slider', { name: s2, exact: true })).toBeVisible();
  }
  const reset = editor.getByRole('button', { name: 'Reset brightness' });
  await expect(reset).toBeDisabled();
  await editor.getByRole('slider', { name: 'Brightness', exact: true }).focus();
  await editor.keyboard.press('ArrowRight');
  await expect(editor.getByRole('textbox', { name: 'Brightness value' })).toHaveValue('+1');
  await reset.click();
  await expect(reset).toBeDisabled();
  await editor.getByRole('textbox', { name: 'Contrast value' }).fill('25');
  await expect(editor.getByRole('slider', { name: 'Contrast', exact: true })).toHaveValue('25');
  await editor.getByRole('button', { name: 'Reset adjustments' }).click();
  await expect(editor.getByRole('slider', { name: 'Contrast', exact: true })).toHaveValue('0');

  // Effects: tiles and sliders.
  await tabs.getByRole('tab', { name: 'Effects' }).click();
  const fx = editor.getByRole('radiogroup', { name: 'Effect' });
  for (const e of ['None', 'Blur', 'Bokeh', 'Vignette', 'Glow', 'Grain', 'Fade', 'Sharpen']) await expect(fx.getByRole('radio', { name: e, exact: true })).toBeVisible();
  await fx.getByRole('radio', { name: 'Vignette', exact: true }).click();
  await expect(editor.getByRole('slider', { name: 'Vignette', exact: true })).toHaveValue('50');
  await editor.getByRole('button', { name: 'Reset effects' }).click();
  await expect(fx.getByRole('radio', { name: 'None', exact: true })).toHaveAttribute('aria-checked', 'true');

  // Intensity 0: the picture as it was.
  await tabs.getByRole('tab', { name: 'Presets' }).click();
  const intensity = editor.getByRole('slider', { name: 'Filter intensity' });
  await intensity.focus();
  await editor.keyboard.press('Home');
  await expect.poll(async () => (await colours(editor, cx, cy)).red).toBeGreaterThan(0.9);
  await editor.keyboard.press('End');
  await expect.poll(async () => (await colours(editor, cx, cy)).red).toBeLessThan(0.02);
  await editor.getByRole('button', { name: 'Reset all filters' }).click();
  await expect.poll(async () => (await colours(editor, cx, cy)).red).toBeGreaterThan(0.9);
  await editor.keyboard.press('Control+z');
  await expect.poll(async () => (await colours(editor, cx, cy)).red).toBeLessThan(0.02);
  await editor.close();
});
