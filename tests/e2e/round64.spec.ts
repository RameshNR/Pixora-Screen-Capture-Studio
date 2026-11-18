import type { Page } from '@playwright/test';
import { expect, send, tabIdFor, test, waitForPage } from './fixtures';

/** Number of steps in the editor's History tab (0 when nothing was changed). */
const steps = async (editor: Page) => {
  const text = await editor.getByRole('tab', { name: /^History/ }).innerText();
  return Number(text.replace(/\D/g, '') || 0);
};

test('canvas clicks: outside the image, Ctrl+click, and Ctrl+Shift+click for several objects', async ({ context, extPage, baseUrl }) => {
  test.setTimeout(90_000);
  const page = await context.newPage();
  await page.setViewportSize({ width: 900, height: 600 });
  await page.goto(`${baseUrl}/short`);
  await page.bringToFront();
  const tabId = await tabIdFor(extPage, `${baseUrl}/*`);
  const editorP = waitForPage(context, (u) => u.includes('/editor.html?id='));
  await send(extPage, { target: 'background', type: 'screenshot/capture', mode: 'visible', tabId });
  const editor = await editorP;
  await editor.setViewportSize({ width: 1500, height: 950 });
  const canvas = editor.getByRole('img', { name: 'Screenshot canvas' });
  await expect(canvas).toBeVisible();
  await editor.waitForTimeout(500);
  const c = (await canvas.boundingBox())!;
  const cx = c.x + c.width / 2;
  const cy = c.y + c.height / 2;

  // Markers are added with one click. The grey area around the image adds nothing.
  await editor.keyboard.press('n');
  await editor.mouse.click(c.x + 6, c.y + 6);
  expect(await steps(editor)).toBe(0);

  await editor.mouse.click(cx - 120, cy);
  await expect.poll(() => steps(editor)).toBe(1);
  await editor.mouse.click(cx + 120, cy);
  await expect.poll(() => steps(editor)).toBe(2);
  await expect(editor.getByText('Marker', { exact: false }).first()).toBeVisible();

  // Holding Ctrl: the "add" cursor goes away at once, and comes back on release.
  const layer = editor.locator('[class*="stickyLayer"]');
  const cursor = () => layer.evaluate((el) => (el as HTMLElement).style.cursor);
  await editor.mouse.move(cx, cy + 90);
  await editor.mouse.move(cx + 2, cy + 90);
  await expect.poll(cursor).toBe('crosshair');
  await editor.keyboard.down('Control');
  await expect.poll(cursor).toBe('default');
  await editor.mouse.move(cx + 6, cy + 90);
  await expect.poll(cursor).toBe('default');
  await editor.keyboard.up('Control');
  await expect.poll(cursor).toBe('crosshair');

  // Ctrl+click on the image: nothing added, nothing selected.
  await editor.keyboard.down('Control');
  await editor.mouse.click(cx, cy + 90);
  await editor.keyboard.up('Control');
  await editor.waitForTimeout(200);
  expect(await steps(editor)).toBe(2);
  await expect(editor.getByRole('toolbar', { name: 'Selected object' })).toBeHidden();

  // Ctrl+Shift+click: both markers, with the limited actions only.
  await editor.keyboard.down('Control');
  await editor.keyboard.down('Shift');
  await editor.mouse.click(cx - 120, cy);
  await editor.mouse.click(cx + 120, cy);
  await editor.keyboard.up('Shift');
  await editor.keyboard.up('Control');
  const bar = editor.getByRole('toolbar', { name: 'Selected object' });
  await expect(bar.getByText('2 selected')).toBeVisible();
  expect(await steps(editor)).toBe(2);
  await bar.getByRole('button', { name: 'More options' }).click();
  const menu = editor.getByRole('menu', { name: 'Object options' });
  for (const name of ['Copy', 'Paste', 'Duplicate', 'Delete']) await expect(menu.getByRole('menuitem', { name })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Layer' })).toHaveCount(0);
  await expect(menu.getByRole('menuitem', { name: 'Align to image' })).toHaveCount(0);
  await editor.keyboard.press('Escape');

  // Drag one: both move in a single step.
  await editor.mouse.move(cx - 120, cy);
  await editor.mouse.down();
  await editor.mouse.move(cx - 100, cy + 40, { steps: 4 });
  await editor.mouse.up();
  await expect.poll(() => steps(editor)).toBe(3);
  await expect(bar.getByText('2 selected')).toBeVisible();

  // Duplicate selects the copies; Delete removes them in one step.
  await bar.getByRole('button', { name: /^Duplicate/ }).click();
  await expect.poll(() => steps(editor)).toBe(4);
  await expect(bar.getByText('2 selected')).toBeVisible();
  await editor.keyboard.press('Delete');
  await expect.poll(() => steps(editor)).toBe(5);
  await expect(bar).toBeHidden();
});
