import { expect, test } from './fixtures';
import { drag, openStripes } from './redact-helpers';

test('right-click on an annotation: Cut takes it away (Paste brings it back), Crop to this object crops the picture to it', async ({ context, extensionId }) => {
  const { editor, cx, cy } = await openStripes(context, extensionId);
  await expect(editor.getByText('1200 × 700 px')).toBeVisible();
  // A numbered marker in the middle.
  await editor.keyboard.press('n');
  await editor.mouse.click(cx, cy);
  await editor.keyboard.press('v');
  await editor.getByRole('tab', { name: 'Layers' }).click();
  const layers = editor.getByRole('complementary', { name: 'Properties' });
  await expect(layers.getByText(/Marker/i).first()).toBeVisible();

  await editor.mouse.click(cx, cy, { button: 'right' });
  await editor.getByRole('menuitem', { name: /^Cut/ }).click();
  await expect(layers.getByText(/Marker/i)).toHaveCount(0);
  await editor.mouse.click(cx + 200, cy + 150, { button: 'right' });
  await editor.getByRole('menuitem', { name: /^Paste/ }).click();
  await expect(layers.getByText(/Marker/i).first()).toBeVisible();

  // Crop to the pasted marker: the picture becomes the marker's size.
  await editor.getByRole('tab', { name: 'Properties' }).click();
  const marker = editor.getByRole('toolbar', { name: 'Selected object' });
  await expect(marker).toBeVisible();
  await editor.keyboard.press('Escape');
  // Right-click where the pasted marker is (24 px below-right of the original).
  const k = Number((await editor.getByLabel('Zoom level').inputValue()).replace('%', '')) / 100;
  await editor.mouse.click(cx + 24 * k, cy + 24 * k, { button: 'right' });
  await editor.getByRole('menuitem', { name: 'Crop to this object' }).click();
  await expect(editor.getByText(/^\d{2,3} × \d{2,3} px$/)).toBeVisible();
  await editor.close();
});

test('right-click on a marked area shows the area actions: Crop to area and Cut area work', async ({ context, extensionId }) => {
  const { editor, cx, cy } = await openStripes(context, extensionId);
  await editor.evaluate(() => { navigator.clipboard.write = async () => undefined; });
  await drag(editor, cx - 100, cy - 60, cx + 100, cy + 60);
  const bar = editor.getByRole('toolbar', { name: 'Marked area' });
  await expect(bar).toBeVisible();
  const size = (await bar.textContent())!.match(/(\d+)\s*×\s*(\d+)/)!;
  await editor.mouse.click(cx, cy, { button: 'right' });
  for (const item of ['Cut area', 'Copy area', 'Duplicate area', 'Crop to area', 'Remove content (fill with background)', 'Delete area', 'Clear selection']) {
    await expect(editor.getByRole('menuitem', { name: new RegExp(`^${item.replace(/[()]/g, '\\$&')}`) })).toBeVisible();
  }
  await editor.getByRole('menuitem', { name: /^Crop to area/ }).click();
  await expect(editor.getByText(`${size[1]} × ${size[2]} px`)).toBeVisible();

  // Cut area from the right-click menu.
  const c2 = (await editor.getByRole('img', { name: 'Screenshot canvas' }).boundingBox())!;
  const mx = c2.x + c2.width / 2, my = c2.y + c2.height / 2;
  await drag(editor, mx - 40, my - 30, mx + 40, my + 30);
  await expect(bar).toBeVisible();
  await editor.mouse.click(mx, my, { button: 'right' });
  await editor.getByRole('menuitem', { name: /^Cut area/ }).click();
  await expect(editor.getByText('Area cut')).toBeVisible();
  await expect(bar).toHaveCount(0);
  await editor.close();
});
