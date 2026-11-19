import type { BrowserContext, Page } from '@playwright/test';
import { expect, test } from './fixtures';

/** Opens a plain white 640 × 400 image in the editor; returns the page and the image's centre. */
async function openEditor(context: BrowserContext, extensionId: string) {
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
  return { editor, cx: b.x + b.width / 2, cy: b.y + b.height / 2, box: b };
}

const drag = async (p: Page, x1: number, y1: number, x2: number, y2: number) => {
  await p.mouse.move(x1, y1);
  await p.mouse.down();
  await p.mouse.move(x2, y2, { steps: 6 });
  await p.mouse.up();
};

/** Colour on the editor's canvas at a screen position. */
const pixel = (p: Page, box: { x: number; y: number }, x: number, y: number) =>
  p.getByRole('img', { name: 'Screenshot canvas' }).evaluate((el, at) => {
    const c = el as HTMLCanvasElement;
    const k = c.width / c.clientWidth;
    return [...c.getContext('2d')!.getImageData(Math.round(at.x * k), Math.round(at.y * k), 1, 1).data];
  }, { x: x - box.x, y: y - box.y });

test('a drawing added and removed again is not an edit', async ({ context, extensionId }) => {
  const { editor, cx, cy } = await openEditor(context, extensionId);
  const reset = editor.getByRole('button', { name: 'Reset to original (undoable)' });
  await expect(reset).toBeDisabled();
  await editor.keyboard.press('r');
  await drag(editor, cx - 60, cy - 40, cx + 60, cy + 40);
  await expect(reset).toBeEnabled();
  await editor.keyboard.press('Delete');
  await expect(reset).toBeDisabled();
  await editor.getByRole('toolbar', { name: 'Editor tools' }).getByRole('button', { name: 'Compare with original' }).click();
  await expect(editor.getByRole('dialog', { name: 'Original screenshot' })).toBeVisible();
  await expect(editor.getByRole('dialog', { name: 'Original vs edited screenshot' })).toHaveCount(0);
});

test('the arrow panel only offers what the design can do', async ({ context, extensionId }) => {
  const { editor } = await openEditor(context, extensionId);
  await editor.keyboard.press('a');
  await editor.getByRole('tablist', { name: 'Line settings' }).getByRole('tab', { name: 'Customize' }).click();
  await expect(editor.getByText('Line style', { exact: true })).toBeVisible();
  await expect(editor.getByText('Curve points', { exact: true })).toBeVisible();

  await editor.getByRole('button', { name: /^Line design/ }).click();
  await editor.getByRole('menuitemradio', { name: /^Pointer/ }).click();
  await expect(editor.getByText('Line style', { exact: true })).toHaveCount(0);
  await expect(editor.getByText('Arrow heads', { exact: true })).toHaveCount(0);

  await editor.getByRole('radio', { name: 'Elbow' }).click();
  await expect(editor.getByText('Curve points', { exact: true })).toHaveCount(0);
});

test('a rectangle highlight shrinks again when the pointer moves back', async ({ context, extensionId }) => {
  const { editor, cx, cy, box } = await openEditor(context, extensionId);
  await editor.keyboard.press('g');
  await editor.getByRole('tab', { name: 'Rectangle', exact: true }).click();
  await editor.getByRole('option', { name: 'Yellow box' }).click();
  await editor.mouse.move(cx - 120, cy - 70);
  await editor.mouse.down();
  await editor.mouse.move(cx + 150, cy + 110, { steps: 6 });
  await editor.mouse.move(cx - 20, cy - 10, { steps: 6 });
  await editor.mouse.up();
  await editor.keyboard.press('Escape');
  await editor.waitForTimeout(200);
  const inside = await pixel(editor, box, cx - 70, cy - 40);
  const left = await pixel(editor, box, cx + 110, cy + 80);
  expect(inside[2]!).toBeLessThan(230);
  expect(left.slice(0, 3)).toEqual([255, 255, 255]);
});

test('blur on a higher layer also blurs the drawing beneath it', async ({ context, extensionId }) => {
  const { editor, cx, cy, box } = await openEditor(context, extensionId);
  await editor.keyboard.press('p');
  await drag(editor, cx - 120, cy, cx + 120, cy);
  await editor.keyboard.press('Escape');
  await editor.waitForTimeout(200);
  const before = await pixel(editor, box, cx, cy + 12);
  expect(before.slice(0, 3)).toEqual([255, 255, 255]);
  await editor.keyboard.press('b');
  await drag(editor, cx - 80, cy - 50, cx + 80, cy + 50);
  await editor.keyboard.press('Escape');
  await expect.poll(async () => (await pixel(editor, box, cx, cy + 12))[1]!).toBeLessThan(250);
});

test('Ctrl + drag moves an annotation without selecting it', async ({ context, extensionId }) => {
  const { editor, cx, cy } = await openEditor(context, extensionId);
  await editor.keyboard.press('n');
  await editor.mouse.click(cx, cy);
  await editor.keyboard.press('v');
  await editor.keyboard.press('Escape');
  await editor.keyboard.down('Control');
  await drag(editor, cx, cy, cx + 90, cy + 50);
  await editor.keyboard.up('Control');
  await expect(editor.getByRole('toolbar', { name: 'Selected object' })).toBeHidden();
  await editor.getByRole('tab', { name: /^History/ }).click();
  await expect(editor.getByRole('button', { name: /Move marker/ })).toBeVisible();
});

test('the watermark can be dragged and put back', async ({ context, extensionId }) => {
  const { editor, cx, cy } = await openEditor(context, extensionId);
  await editor.keyboard.press('w');
  await editor.getByRole('switch', { name: 'Watermark' }).click();
  await editor.getByRole('tablist', { name: 'Watermark settings' }).getByRole('tab', { name: 'Style' }).click();
  await editor.getByRole('button', { name: /^Position/ }).click();
  await editor.getByRole('menuitemradio', { name: 'Centre' }).click();
  const back = editor.getByRole('button', { name: 'Reset position' });
  await expect(back).toBeDisabled();
  await drag(editor, cx, cy, cx + 120, cy + 70);
  await expect(back).toBeEnabled();
  await back.click();
  await expect(back).toBeDisabled();
});
