import { expect, test } from './fixtures';

test('the bar menu and the right-click menu match; the Move & pan tool moves annotations', async ({ context, extensionId }) => {
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
  await editor.keyboard.press('n');
  await editor.mouse.click(cx, cy);

  const names = async () => (await editor.getByRole('menuitem').allInnerTexts()).map((t) => t.split('\n')[0]!.trim());
  const bar = editor.getByRole('toolbar', { name: 'Selected object' });
  await bar.getByRole('button', { name: 'More options' }).click();
  const fromBar = await names();
  await editor.keyboard.press('Escape');
  await editor.mouse.click(cx, cy, { button: 'right' });
  const fromRightClick = await names();
  await editor.keyboard.press('Escape');
  expect(fromBar.length).toBeGreaterThan(8);
  expect(fromBar).toEqual(fromRightClick);

  // Move & pan: dragging the marker moves it.
  const steps = async () => Number((await editor.getByRole('tab', { name: /^History/ }).innerText()).replace(/\D/g, '') || 0);
  const before = await steps();
  await editor.keyboard.press('h');
  await editor.mouse.move(cx, cy);
  await editor.mouse.down();
  await editor.mouse.move(cx + 90, cy + 40, { steps: 5 });
  await editor.mouse.up();
  await expect.poll(steps).toBe(before + 1);
});
