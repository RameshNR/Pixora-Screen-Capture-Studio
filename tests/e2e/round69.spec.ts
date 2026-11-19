import { expect, test } from './fixtures';

test('cut a highlight with a shape from the right-click menu, and undo the cut', async ({ context, extensionId }) => {
  const editor = await context.newPage();
  await editor.setViewportSize({ width: 1500, height: 900 });
  await editor.goto(`chrome-extension://${extensionId}/editor.html?import=1`);
  const png = await editor.evaluate(async () => {
    const c = new OffscreenCanvas(640, 400);
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 640, 400);
    return Array.from(new Uint8Array(await (await c.convertToBlob({ type: 'image/png' })).arrayBuffer()));
  });
  await editor.locator('input[type="file"]').setInputFiles({ name: 'white.png', mimeType: 'image/png', buffer: Buffer.from(png) });
  const canvas = editor.getByRole('img', { name: 'Screenshot canvas' });
  await expect(canvas).toBeVisible();
  await editor.waitForTimeout(400);
  const b = (await canvas.boundingBox())!;
  const cx = b.x + b.width / 2;
  const cy = b.y + b.height / 2;
  /** Blue channel at a screen point (a yellow highlight lowers it). */
  const blue = (x: number, y: number) => canvas.evaluate((el, at) => {
    const c = el as HTMLCanvasElement;
    const k = c.width / c.clientWidth;
    return c.getContext('2d')!.getImageData(Math.round(at.x * k), Math.round(at.y * k), 1, 1).data[2]!;
  }, { x: x - b.x, y: y - b.y });

  // A highlight across, and a rectangle over its middle.
  await editor.keyboard.press('g');
  await editor.mouse.move(cx - 200, cy);
  await editor.mouse.down();
  await editor.mouse.move(cx + 200, cy, { steps: 8 });
  await editor.mouse.up();
  await editor.keyboard.press('r');
  await editor.mouse.move(cx - 60, cy - 50);
  await editor.mouse.down();
  await editor.mouse.move(cx + 60, cy + 50, { steps: 5 });
  await editor.mouse.up();
  await editor.keyboard.press('Escape');
  await editor.waitForTimeout(200);
  expect(await blue(cx, cy)).toBeLessThan(200);
  expect(await blue(cx - 150, cy)).toBeLessThan(200);

  // One object alone: no cutting.
  await editor.mouse.click(cx - 150, cy, { button: 'right' });
  await expect(editor.getByRole('menuitem', { name: 'Duplicate' })).toBeVisible();
  await expect(editor.getByRole('menuitem', { name: /Cut the highlight/ })).toHaveCount(0);
  await editor.keyboard.press('Escape');
  await editor.keyboard.press('Escape');

  // Select both (Ctrl+Shift+click), right-click one of them: cut it away inside the shape.
  await editor.keyboard.down('Control');
  await editor.keyboard.down('Shift');
  await editor.mouse.click(cx - 150, cy);
  await editor.mouse.click(cx + 58, cy - 48);
  await editor.keyboard.up('Shift');
  await editor.keyboard.up('Control');
  await expect(editor.getByRole('toolbar', { name: 'Selected object' }).getByText('2 selected')).toBeVisible();
  await editor.mouse.click(cx - 150, cy, { button: 'right' });
  await editor.getByRole('menuitem', { name: 'Cut the highlight away inside the shape' }).click();
  await expect.poll(() => blue(cx, cy)).toBeGreaterThan(240);
  expect(await blue(cx - 150, cy)).toBeLessThan(200);
  // The shape was used up: only the highlight is left.
  await editor.getByRole('tab', { name: /^Layers/ }).click();
  await expect(editor.getByRole('complementary', { name: 'Properties' }).locator('li')).toHaveCount(1);
  await editor.getByRole('tab', { name: /^Properties/ }).click();

  // Undo cut: the whole highlight again.
  await editor.mouse.click(cx - 150, cy, { button: 'right' });
  await editor.getByRole('menuitem', { name: 'Undo cut' }).click();
  await expect.poll(() => blue(cx, cy)).toBeLessThan(200);

  // Ctrl+Z twice: back to the highlight and the shape, then the same from the bar’s ⋯ menu.
  await editor.keyboard.press('Escape');
  await editor.keyboard.press('Escape');
  await editor.keyboard.press('Control+z');
  await editor.keyboard.press('Control+z');
  await editor.getByRole('tab', { name: /^Layers/ }).click();
  await expect(editor.getByRole('complementary', { name: 'Properties' }).locator('li')).toHaveCount(2);
  await editor.getByRole('tab', { name: /^Properties/ }).click();
  await expect.poll(() => blue(cx, cy)).toBeLessThan(200);
  await editor.keyboard.down('Control');
  await editor.keyboard.down('Shift');
  await editor.mouse.click(cx - 150, cy);
  await editor.mouse.click(cx + 58, cy - 48);
  await editor.keyboard.up('Shift');
  await editor.keyboard.up('Control');
  const bar = editor.getByRole('toolbar', { name: 'Selected object' });
  await bar.getByRole('button', { name: 'More options' }).click();
  await editor.getByRole('menuitem', { name: 'Keep the highlight only inside the shape' }).click();
  await expect.poll(() => blue(cx - 150, cy)).toBeGreaterThan(240);
  expect(await blue(cx, cy)).toBeLessThan(200);
});
