import { expect, test } from './fixtures';
import { drag, eraseTool, openStripes } from './redact-helpers';

test('pasting a copied area lets go of the marked area: only the pasted copy is selected', async ({ context, extensionId }) => {
  const { editor, cx, cy } = await openStripes(context, extensionId);
  await editor.evaluate(() => { navigator.clipboard.write = async () => undefined; });
  const bar = editor.getByRole('toolbar', { name: 'Marked area' });
  const objectBar = editor.getByRole('toolbar', { name: 'Selected object' });

  await drag(editor, cx - 60, cy - 40, cx + 60, cy + 40);
  await bar.getByRole('button', { name: 'Copy area (Ctrl+C)' }).click();
  await expect(editor.getByText('Area copied')).toBeVisible();
  await expect(bar).toBeVisible();
  // Right-click › Paste while the area is still marked.
  await editor.mouse.click(cx + 250, cy + 180, { button: 'right' });
  await editor.getByRole('menuitem', { name: /^Paste/ }).click();
  await expect(objectBar).toBeVisible();
  await expect(bar).toHaveCount(0);
  await editor.close();
});

test('Duplicate area is quick and selects only the copy', async ({ context, extensionId }) => {
  const { editor, cx, cy } = await openStripes(context, extensionId);
  const bar = editor.getByRole('toolbar', { name: 'Marked area' });
  const objectBar = editor.getByRole('toolbar', { name: 'Selected object' });
  await drag(editor, cx - 60, cy - 40, cx + 60, cy + 40);
  const start = Date.now();
  await editor.keyboard.press('Control+d');
  await expect(objectBar).toBeVisible();
  expect(Date.now() - start).toBeLessThan(1500);
  await expect(bar).toHaveCount(0);
  await editor.close();
});

test('Resize dialog: − / + buttons change the size and keep the ratio', async ({ context, extensionId }) => {
  const { editor } = await openStripes(context, extensionId);
  await editor.getByRole('button', { name: 'Resize image' }).click();
  const dialog = editor.getByRole('dialog', { name: 'Resize image' });
  const width = dialog.getByRole('spinbutton', { name: 'Width' });
  const height = dialog.getByRole('spinbutton', { name: 'Height' });
  const w0 = Number(await width.inputValue());
  const h0 = Number(await height.inputValue());
  await dialog.locator('button[title^="Increase"]').first().click();
  await expect(width).toHaveValue(String(w0 + 1));
  await dialog.locator('button[title^="Decrease"]').first().click({ modifiers: ['Shift'] });
  await expect(width).toHaveValue(String(w0 - 9));
  await expect(height).toHaveValue(String(Math.max(1, Math.round((w0 - 9) / (w0 / h0)))));
  // Arrow keys still work in the field.
  await width.focus();
  await editor.keyboard.press('ArrowUp');
  await expect(width).toHaveValue(String(w0 - 8));
  await editor.close();
});

test('both erasers have their own drawn icons', async ({ context, extensionId }) => {
  const { editor } = await openStripes(context, extensionId);
  // One toolbar button (Round 94) with the eraser icon; Erase image's own icon in its panel.
  const button = editor.getByRole('button', { name: /^Erase & remove/ });
  await expect(button.locator('svg rect')).toHaveCount(1);
  await eraseTool(editor, 'Image');
  await expect(editor.locator('summary', { hasText: 'Erase image' }).locator('svg circle')).toHaveCount(1);
  await editor.close();
});
