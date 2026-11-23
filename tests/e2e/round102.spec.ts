import { expect, test } from './fixtures';
import type { Page } from '@playwright/test';
import { drag, eraseTool, openStripes } from './redact-helpers';

/** Share of pixels around a screen point matching a test. */
async function share(editor: Page, x: number, y: number, half: number, test: (r: number, g: number, b: number) => boolean): Promise<number> {
  const shot = await editor.screenshot({ clip: { x: x - half, y: y - half, width: half * 2, height: half * 2 } });
  const d = await editor.evaluate(async (b64) => {
    const bmp = await createImageBitmap(new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], { type: 'image/png' }));
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    const x2 = c.getContext('2d')!;
    x2.drawImage(bmp, 0, 0);
    return Array.from(x2.getImageData(0, 0, c.width, c.height).data);
  }, shot.toString('base64'));
  let n = 0;
  for (let i = 0; i < d.length; i += 4) if (test(d[i]!, d[i + 1]!, d[i + 2]!)) n++;
  return n / (d.length / 4);
}
const blue = (r: number, _g: number, b: number) => r < 80 && b > 160;
const red = (r: number, g: number, b: number) => r > 150 && g < 120 && b < 150;

async function changed(editor: Page, cx: number, cy: number) {
  await eraseTool(editor, 'Image');
  await editor.getByRole('radiogroup', { name: 'Erase to' }).getByRole('radio', { name: 'White', exact: true }).click();
  await editor.getByRole('slider', { name: 'Brush size' }).fill('300');
  await drag(editor, cx - 150, cy, cx + 150, cy);
  await expect.poll(() => share(editor, cx, cy, 15, blue)).toBeLessThan(0.02);
}

test('the top toolbar has no zoom box and no Compare button; the zoom is in the bar under the picture (type a size)', async ({ context, extensionId }) => {
  const { editor } = await openStripes(context, extensionId);
  const tools = editor.getByRole('toolbar', { name: 'Editor tools' });
  await expect(tools.getByRole('button', { name: 'Compare with original' })).toHaveCount(0);
  await expect(tools.getByRole('button', { name: /^Zoom in/ })).toHaveCount(0);
  await expect(editor.getByRole('textbox', { name: 'Zoom level' })).toHaveCount(1);
  const box = editor.getByRole('group', { name: 'View' }).getByRole('textbox', { name: 'Zoom level' });
  await box.fill('150');
  await box.press('Enter');
  await expect(box).toHaveValue('150%');
  await editor.close();
});

test('view settings: Show Original / Edited / Both; Highlight changes tints the changed band red', async ({ context, extensionId }) => {
  const { editor, cx, cy } = await openStripes(context, extensionId);
  const bar = editor.getByRole('group', { name: 'View' });
  await bar.getByRole('button', { name: 'View settings' }).click();
  const menu = editor.getByRole('dialog', { name: 'View settings' });
  const show = menu.getByRole('radiogroup', { name: 'Show' });
  // Nothing changed yet: greyed out.
  await expect(show.getByRole('radio', { name: 'Original' })).toBeDisabled();
  for (const s of ['Sync zoom', 'Sync scroll', 'Highlight changes']) await expect(menu.getByRole('switch', { name: s })).toBeDisabled();
  await editor.mouse.click(5, 300);
  await changed(editor, cx, cy);

  await bar.getByRole('button', { name: 'View settings' }).click();
  await show.getByRole('radio', { name: 'Original' }).click();
  await expect.poll(() => share(editor, cx, cy, 15, blue)).toBeGreaterThan(0.2);
  await expect(bar.getByRole('switch', { name: 'Before / After', exact: true })).toHaveAttribute('aria-checked', 'false');
  await show.getByRole('radio', { name: 'Edited' }).click();
  await expect.poll(() => share(editor, cx, cy, 15, blue)).toBeLessThan(0.02);
  await show.getByRole('radio', { name: 'Both' }).click();
  await expect(bar.getByRole('switch', { name: 'Before / After', exact: true })).toHaveAttribute('aria-checked', 'true');
  await show.getByRole('radio', { name: 'Edited' }).click();
  // Highlight changes on the edited picture.
  await menu.getByRole('switch', { name: 'Highlight changes' }).click();
  await expect.poll(() => share(editor, cx, cy, 15, red)).toBeGreaterThan(0.4);
  expect(await share(editor, cx, cy - 120, 15, red)).toBeLessThan(0.05);
  await editor.close();
});

test('side by side: the wheel zooms a pane; Sync zoom zooms both, off only the one under the pointer', async ({ context, extensionId }) => {
  const { editor, cx, cy } = await openStripes(context, extensionId);
  await changed(editor, cx, cy);
  const bar = editor.getByRole('group', { name: 'View' });
  await bar.getByRole('radio', { name: 'Side by side' }).click();
  const leftPane = { x: cx - 90, y: cy };
  const rightPane = { x: cx + 90, y: cy };
  const before = await editor.screenshot({ clip: { x: leftPane.x - 40, y: leftPane.y - 40, width: 80, height: 80 } });
  const right0 = await editor.screenshot({ clip: { x: rightPane.x - 40, y: rightPane.y - 40, width: 80, height: 80 } });
  // Sync zoom on (default): the wheel over the left pane changes both.
  await editor.mouse.move(leftPane.x, leftPane.y);
  for (let i = 0; i < 2; i++) await editor.mouse.wheel(0, -150);
  await expect.poll(async () => (await editor.screenshot({ clip: { x: leftPane.x - 40, y: leftPane.y - 40, width: 80, height: 80 } })).equals(before)).toBe(false);
  await expect.poll(async () => (await editor.screenshot({ clip: { x: rightPane.x - 40, y: rightPane.y - 40, width: 80, height: 80 } })).equals(right0)).toBe(false);
  // Sync zoom off: only the pane under the pointer.
  await bar.getByRole('button', { name: 'View settings' }).click();
  await editor.getByRole('dialog', { name: 'View settings' }).getByRole('switch', { name: 'Sync zoom' }).click();
  await editor.mouse.click(5, 300);
  const left1 = await editor.screenshot({ clip: { x: leftPane.x - 40, y: leftPane.y - 40, width: 80, height: 80 } });
  const right1 = await editor.screenshot({ clip: { x: rightPane.x - 40, y: rightPane.y - 40, width: 80, height: 80 } });
  await editor.mouse.move(leftPane.x, leftPane.y);
  for (let i = 0; i < 2; i++) await editor.mouse.wheel(0, 150);
  await expect.poll(async () => (await editor.screenshot({ clip: { x: leftPane.x - 40, y: leftPane.y - 40, width: 80, height: 80 } })).equals(left1)).toBe(false);
  await editor.waitForTimeout(300);
  expect((await editor.screenshot({ clip: { x: rightPane.x - 40, y: rightPane.y - 40, width: 80, height: 80 } })).equals(right1)).toBe(true);
  await editor.close();
});
