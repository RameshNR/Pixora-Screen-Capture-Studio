import { readFileSync } from 'node:fs';
import { expect, test } from './fixtures';
import type { BrowserContext, Page } from '@playwright/test';
import { drag, eraseTool } from './redact-helpers';

async function openPng(context: BrowserContext, extensionId: string, png: Buffer) {
  const editor = await context.newPage();
  await editor.setViewportSize({ width: 1500, height: 950 });
  await editor.goto(`chrome-extension://${extensionId}/editor.html?import=1`);
  await editor.locator('input[type="file"]').first().setInputFiles({ name: 'pic.png', mimeType: 'image/png', buffer: png });
  await expect(editor.getByRole('img', { name: 'Screenshot canvas' })).toBeVisible();
  return editor;
}

async function mapper(editor: Page, w: number, h: number) {
  const c = (await editor.getByRole('img', { name: 'Screenshot canvas' }).boundingBox())!;
  const k = Number((await editor.getByLabel('Zoom level').inputValue()).replace('%', '')) / 100;
  return (x: number, y: number) => [c.x + c.width / 2 + (x - w / 2) * k, c.y + c.height / 2 + (y - h / 2) * k] as const;
}

async function pixels(editor: Page, [x, y]: readonly [number, number], half: number): Promise<number[]> {
  const shot = await editor.screenshot({ clip: { x: x - half, y: y - half, width: half * 2, height: half * 2 } });
  return editor.evaluate(async (b64) => {
    const bmp = await createImageBitmap(new Blob([Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0))], { type: 'image/png' }));
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    const x2 = c.getContext('2d')!;
    x2.drawImage(bmp, 0, 0);
    return Array.from(x2.getImageData(0, 0, c.width, c.height).data);
  }, shot.toString('base64'));
}
const share = (d: number[], t: (r: number, g: number, b: number) => boolean) => {
  let n = 0;
  for (let i = 0; i < d.length; i += 4) if (t(d[i]!, d[i + 1]!, d[i + 2]!)) n++;
  return n / (d.length / 4);
};

/**
 * A page like a shop's: a dark header with white text, a white page, a product photo (a dark box
 * with a blue band on top and a white console inside, on the white page) and text beside it.
 */
async function shopPage(page: Page): Promise<Buffer> {
  return Buffer.from(await page.evaluate(async () => {
    const c = new OffscreenCanvas(1400, 900);
    const x = c.getContext('2d')!;
    x.fillStyle = '#ffffff';
    x.fillRect(0, 0, 1400, 900);
    x.fillStyle = '#131921';
    x.fillRect(0, 0, 1400, 90);
    x.fillStyle = '#ffffff';
    x.font = 'bold 26px sans-serif';
    x.fillText('Deliver to RAMESH', 220, 55);
    x.fillText('amazon', 30, 55);
    // The product: dark box, blue band, white console with a shaded edge.
    x.fillStyle = '#1e3a8a';
    x.fillRect(200, 250, 500, 24);
    const g = x.createLinearGradient(200, 274, 700, 650);
    g.addColorStop(0, '#111111');
    g.addColorStop(1, '#2a2a2a');
    x.fillStyle = g;
    x.fillRect(200, 274, 500, 380);
    x.fillStyle = '#ffffff';
    x.beginPath();
    x.moveTo(330, 300); x.lineTo(420, 300); x.lineTo(470, 640); x.lineTo(350, 640);
    x.fill();
    x.fillStyle = '#111827';
    x.font = '22px sans-serif';
    for (let y = 300; y < 640; y += 36) x.fillText('Experience smoother gameplay and faster loading.', 780, y);
    return Array.from(new Uint8Array(await (await c.convertToBlob({ type: 'image/png' })).arrayBuffer()));
  }));
}

test('Remove object on a product photo in a page: the whole photo (blue band and white console too) goes, nothing left behind, text untouched', async ({ context, extensionId }) => {
  test.setTimeout(120_000);
  const page = await context.newPage();
  const editor = await openPng(context, extensionId, await shopPage(page));
  await page.close();
  const at = await mapper(editor, 1400, 900);
  await eraseTool(editor, 'Object');
  await editor.mouse.click(...at(600, 500)); // the dark box
  await expect(editor.getByRole('button', { name: 'Remove (Enter)' })).toBeEnabled({ timeout: 60_000 });
  await editor.keyboard.press('Enter');
  const dark = (r: number, g: number, b: number) => r < 120 && g < 120 && b < 160;
  // Box, band and console all gone: white page there now.
  for (const [x, y] of [[600, 500], [450, 262], [400, 450], [220, 640]] as const) {
    await expect.poll(async () => share(await pixels(editor, at(x, y), 6), dark), { timeout: 30_000, message: `${x},${y}` }).toBe(0);
  }
  // The text beside it is still there.
  expect(share(await pixels(editor, at(900, 400), 60), dark)).toBeGreaterThan(0.02);
  await editor.close();
});

test('Erase image › Background on a plain dark header: the text goes and the hole is exactly the header colour', async ({ context, extensionId }) => {
  test.setTimeout(90_000);
  const page = await context.newPage();
  const editor = await openPng(context, extensionId, await shopPage(page));
  await page.close();
  const at = await mapper(editor, 1400, 900);
  await eraseTool(editor, 'Image');
  await editor.getByRole('radiogroup', { name: 'Erase to' }).getByRole('radio', { name: 'Background' }).click();
  await editor.getByRole('slider', { name: 'Brush size' }).fill('46');
  await drag(editor, ...at(225, 45), ...at(470, 45));
  // Exactly the header colour (#131921) where the words were: no light smear.
  await expect.poll(async () => {
    const d = await pixels(editor, at(340, 45), 10);
    return share(d, (r, g, b) => Math.abs(r - 0x13) < 10 && Math.abs(g - 0x19) < 10 && Math.abs(b - 0x21) < 10);
  }, { timeout: 30_000 }).toBeGreaterThan(0.97);
  await editor.close();
});

test('Remove background › Apply is one step in History; Undo (toolbar) brings the picture back; toolbar Undo also steps back selection strokes', async ({ context, extensionId }) => {
  test.setTimeout(120_000);
  const editor = await openPng(context, extensionId, readFileSync('tests/unit/fixtures/clicks-shot.png'));
  const at = await mapper(editor, 1280, 800);
  const undo = editor.getByRole('button', { name: /^Undo/ });
  await eraseTool(editor, 'Background');
  await expect(editor.getByText(/^Found the subject|No clear subject/)).toBeVisible({ timeout: 60_000 });
  await expect(undo).toBeDisabled();
  // A Remove stroke: a selection step, so Undo is on and History says so.
  await editor.getByRole('radio', { name: 'Remove', exact: true }).click();
  await drag(editor, ...at(600, 400), ...at(700, 400));
  await expect(undo).toBeEnabled();
  await editor.getByRole('tab', { name: 'History' }).click();
  await expect(editor.getByText(/1 selection step\./)).toBeVisible();
  await undo.click();
  await expect(undo).toBeDisabled();
  await editor.getByRole('tab', { name: 'Properties' }).click();
  await editor.getByRole('radio', { name: 'White', exact: true }).click();
  await editor.getByRole('button', { name: 'Apply (Enter)' }).click();
  await expect(undo).toBeEnabled({ timeout: 30_000 });
  await editor.getByRole('tab', { name: 'History' }).click();
  await expect(editor.getByText('Replace background')).toBeVisible();
  await undo.click();
  // Undone: it can be redone, and nothing is left to undo.
  await expect(editor.getByRole('button', { name: /^Redo/ })).toBeEnabled();
  await expect(undo).toBeDisabled();
  await editor.close();
});
