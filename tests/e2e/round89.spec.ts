import { expect, test } from './fixtures';
import { drag, eraseTool, openStripes } from './redact-helpers';

/** Share of the blue stripe colour in a screenshot of part of the page. */
async function blueShare(page: import('@playwright/test').Page, clip: { x: number; y: number; width: number; height: number }): Promise<number> {
  const shot = await page.screenshot({ clip });
  return page.evaluate(async (b64) => {
    const bmp = await createImageBitmap(new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], { type: 'image/png' }));
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    const x = c.getContext('2d')!;
    x.drawImage(bmp, 0, 0);
    const d = x.getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i]! < 80 && d[i + 1]! < 120 && d[i + 2]! > 160) n++;
    return n / (d.length / 4);
  }, shot.toString('base64'));
}

test('undoing a crop shows the whole picture again (fit), not the cropped zoom', async ({ context, extensionId }) => {
  const { editor, cx, cy } = await openStripes(context, extensionId);
  const zoom = editor.getByRole('textbox', { name: 'Zoom level' });
  const fitted = await zoom.inputValue();
  await drag(editor, cx - 40, cy - 20, cx + 40, cy + 20);
  await editor.getByRole('toolbar', { name: 'Marked area' }).getByRole('button', { name: 'Crop to area' }).click();
  await expect(zoom).not.toHaveValue(fitted);
  await editor.keyboard.press('Control+z');
  await expect(zoom).toHaveValue(fitted);
  await editor.keyboard.press('Control+y');
  await expect(zoom).not.toHaveValue(fitted);
  await editor.getByRole('button', { name: 'Reset to original (undoable)' }).click();
  await expect(zoom).toHaveValue(fitted);
  await editor.close();
});

test('marked area: Duplicate adds a movable copy; after Copy the right-click Paste is enabled', async ({ context, extensionId }) => {
  const { editor, cx, cy } = await openStripes(context, extensionId);
  await editor.evaluate(() => { navigator.clipboard.write = async () => undefined; });
  const bar = editor.getByRole('toolbar', { name: 'Marked area' });
  const objectBar = editor.getByRole('toolbar', { name: 'Selected object' });

  await drag(editor, cx - 60, cy - 40, cx + 60, cy + 40);
  await bar.getByRole('button', { name: 'Duplicate area (Ctrl+D)' }).click();
  await expect(bar).toHaveCount(0);
  await expect(objectBar).toBeVisible();
  await expect(editor.getByRole('complementary', { name: 'Properties' })).toContainText('Image');
  await editor.keyboard.press('Escape');

  await drag(editor, cx - 200, cy - 150, cx - 120, cy - 90);
  await bar.getByRole('button', { name: 'Copy area (Ctrl+C)' }).click();
  await expect(editor.getByText('Area copied')).toBeVisible();
  await editor.keyboard.press('Escape');
  await editor.mouse.click(cx + 250, cy + 180, { button: 'right' });
  const paste = editor.getByRole('menuitem', { name: /^Paste/ });
  await expect(paste).toBeEnabled();
  await paste.click();
  await expect(objectBar).toBeVisible();
  await editor.close();
});

test('Erase image paints over the picture itself; undo brings it back', async ({ context, extensionId }) => {
  const { editor, cx, cy } = await openStripes(context, extensionId);
  const clip = { x: cx - 20, y: cy - 20, width: 40, height: 40 };
  expect(await blueShare(editor, clip)).toBeGreaterThan(0.3);
  await eraseTool(editor, 'Image');
  const panel = editor.getByRole('complementary', { name: 'Properties' });
  await expect(panel).toContainText('Erase image');
  await panel.getByRole('slider', { name: 'Brush size' }).fill('200');
  await drag(editor, cx - 60, cy, cx + 60, cy);
  await expect.poll(() => blueShare(editor, clip)).toBeLessThan(0.02);
  await editor.keyboard.press('Control+z');
  await expect.poll(() => blueShare(editor, clip)).toBeGreaterThan(0.3);
  // The annotation eraser still leaves the picture alone.
  await editor.keyboard.press('e');
  await drag(editor, cx - 60, cy, cx + 60, cy);
  expect(await blueShare(editor, clip)).toBeGreaterThan(0.3);
  await editor.close();
});
