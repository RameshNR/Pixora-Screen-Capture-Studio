import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

const steps = async (editor: Page) => Number((await editor.getByRole('tab', { name: /^History/ }).innerText()).replace(/\D/g, '') || 0);

test('Lock and Move only from the right-click menu and the Layers panel', async ({ context, extensionId }) => {
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

  // A numbered marker, selected with the Select tool.
  await editor.keyboard.press('n');
  await editor.mouse.click(cx, cy);
  await editor.keyboard.press('v');
  await expect.poll(() => steps(editor)).toBe(1);
  const dragFrom = async (x: number, y: number) => {
    await editor.mouse.move(x, y);
    await editor.mouse.down();
    await editor.mouse.move(x + 80, y + 40, { steps: 5 });
    await editor.mouse.up();
  };

  // Lock: no moving, no deleting.
  await editor.mouse.click(cx, cy, { button: 'right' });
  await editor.getByRole('menuitem', { name: 'Lock', exact: true }).click();
  await expect.poll(() => steps(editor)).toBe(2);
  await dragFrom(cx, cy);
  await editor.keyboard.press('Delete');
  await editor.waitForTimeout(300);
  expect(await steps(editor)).toBe(2);
  await expect(editor.getByRole('complementary', { name: 'Properties' }).getByText('Locked', { exact: true })).toBeVisible();

  // The Layers panel shows it locked and unlocks it.
  await editor.getByRole('tab', { name: /^Layers/ }).click();
  const unlock = editor.getByRole('button', { name: 'Unlock', exact: true });
  await expect(unlock).toBeVisible();
  await expect(editor.getByRole('button', { name: 'Remove', exact: true })).toBeDisabled();
  await unlock.click();
  await expect(editor.getByRole('button', { name: 'Lock', exact: true })).toBeVisible();
  await editor.getByRole('tab', { name: /^Properties/ }).click();
  expect(await steps(editor)).toBe(3);

  // Move only: ready to drag at once (nothing is saved on the marker); no deleting; a click elsewhere ends it.
  await editor.mouse.click(cx, cy, { button: 'right' });
  await editor.getByRole('menuitem', { name: 'Move only', exact: true }).click();
  await expect(editor.getByRole('complementary', { name: 'Properties' }).getByText('Move only', { exact: true })).toBeVisible();
  expect(await steps(editor)).toBe(3);
  await dragFrom(cx, cy);
  await expect.poll(() => steps(editor)).toBe(4);
  await editor.keyboard.press('Delete');
  await editor.waitForTimeout(300);
  expect(await steps(editor)).toBe(4);
  await editor.mouse.click(b.x + 20, b.y + 20);
  await expect(editor.getByRole('complementary', { name: 'Properties' }).getByText('Move only', { exact: true })).toHaveCount(0);
  await editor.mouse.click(cx + 80, cy + 40);
  await editor.keyboard.press('Delete');
  await expect.poll(() => steps(editor)).toBe(5);
});

test('the Pan tool moves a picture that fits in the view', async ({ context, extensionId }) => {
  const editor = await context.newPage();
  await editor.setViewportSize({ width: 1500, height: 900 });
  await editor.goto(`chrome-extension://${extensionId}/editor.html?import=1`);
  const png = await editor.evaluate(async () => {
    const c = new OffscreenCanvas(400, 250);
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 400, 250);
    return Array.from(new Uint8Array(await (await c.convertToBlob({ type: 'image/png' })).arrayBuffer()));
  });
  await editor.locator('input[type="file"]').setInputFiles({ name: 'small.png', mimeType: 'image/png', buffer: Buffer.from(png) });
  const canvas = editor.getByRole('img', { name: 'Screenshot canvas' });
  await expect(canvas).toBeVisible();
  await editor.waitForTimeout(400);
  const b = (await canvas.boundingBox())!;
  const cx = b.x + b.width / 2;
  const cy = b.y + b.height / 2;
  /** Is the picture (white) at this screen point? */
  const white = (x: number) => canvas.evaluate((el, at) => {
    const c = el as HTMLCanvasElement;
    const k = c.width / c.clientWidth;
    const d = c.getContext('2d')!.getImageData(Math.round(at.x * k), Math.round(at.y * k), 1, 1).data;
    return d[0]! > 245 && d[1]! > 245 && d[2]! > 245;
  }, { x: x - b.x, y: cy - b.y });
  expect(await white(cx + 240)).toBe(false);
  await editor.keyboard.press('h');
  await editor.mouse.move(cx, cy);
  // (an empty spot: the Move & pan tool pans; on an annotation it would move it)
  await editor.mouse.down();
  await editor.mouse.move(cx + 150, cy, { steps: 6 });
  await editor.mouse.up();
  await expect.poll(() => white(cx + 240)).toBe(true);
});
