import { readFileSync } from 'node:fs';
import { expect, test } from './fixtures';
import type { BrowserContext, Page } from '@playwright/test';
import { eraseTool } from './redact-helpers';

/** The editor with a store screenshot (1280 × 800) and a mapper from picture px to screen px. */
async function openShot(context: BrowserContext, extensionId: string) {
  const editor = await context.newPage();
  await editor.setViewportSize({ width: 1500, height: 950 });
  await editor.goto(`chrome-extension://${extensionId}/editor.html?import=1`);
  await editor.locator('input[type="file"]').first().setInputFiles({ name: 'shot.png', mimeType: 'image/png', buffer: readFileSync('tests/unit/fixtures/editor-shot.png') });
  const canvas = editor.getByRole('img', { name: 'Screenshot canvas' });
  await expect(canvas).toBeVisible();
  const c = (await canvas.boundingBox())!;
  const k = Number((await editor.getByLabel('Zoom level').inputValue()).replace('%', '')) / 100;
  const at = (x: number, y: number) => [c.x + c.width / 2 + (x - 640) * k, c.y + c.height / 2 + (y - 400) * k] as const;
  return { editor, at, k };
}

type Px = (r: number, g: number, b: number) => boolean;

/** Share of pixels near one screen point matching a colour test. */
async function share(editor: Page, [x, y]: readonly [number, number], test: Px, half = 6): Promise<number> {
  const shot = await editor.screenshot({ clip: { x: x - half, y: y - half, width: half * 2, height: half * 2 } });
  const d = await editor.evaluate(async (b64) => {
    const bmp = await createImageBitmap(new Blob([Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0))], { type: 'image/png' }));
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    const x2 = c.getContext('2d')!;
    x2.drawImage(bmp, 0, 0);
    return Array.from(x2.getImageData(0, 0, c.width, c.height).data);
  }, shot.toString('base64'));
  let n = 0;
  for (let i = 0; i < d.length; i += 4) if (test(d[i]!, d[i + 1]!, d[i + 2]!)) n++;
  return n / (d.length / 4);
}
const PURPLE: Px = (r, g, b) => r > 90 && r < 160 && g < 90 && b > 200;
const RED: Px = (r, g, b) => r > 200 && g < 120 && b < 120;
const WHITE: Px = (r, g, b) => r > 245 && g > 245 && b > 245;

test('screenshots: a click on a button label selects the whole button; a click on the badge selects it; both are removed', async ({ context, extensionId }) => {
  test.setTimeout(120_000);
  const { editor, at } = await openShot(context, extensionId);
  const button = at(660, 589); // the Book trip button, away from its label
  expect(await share(editor, button, PURPLE)).toBeGreaterThan(0.8);
  await eraseTool(editor, 'Object');
  const remove = editor.getByRole('button', { name: 'Remove (Enter)' });
  await editor.mouse.click(...at(742, 589)); // on the label "Book trip"
  await expect(remove).toBeEnabled({ timeout: 30_000 });
  // The whole button is marked (red / white hatching), not just the word.
  await expect.poll(() => share(editor, button, PURPLE)).toBeLessThan(0.5);
  await editor.mouse.click(...at(822, 428)); // the red "1" badge
  await editor.waitForTimeout(800);
  await editor.keyboard.press('Enter');
  await expect.poll(() => share(editor, button, PURPLE), { timeout: 30_000 }).toBeLessThan(0.05);
  await expect.poll(() => share(editor, at(822, 428), RED)).toBeLessThan(0.05);
  // Nothing else went: the chart bars are still there.
  expect(await share(editor, at(340, 560), PURPLE)).toBeGreaterThan(0.5);
  await editor.close();
});

test('a click on the empty page selects nothing (no huge selection)', async ({ context, extensionId }) => {
  test.setTimeout(90_000);
  const { editor, at } = await openShot(context, extensionId);
  await eraseTool(editor, 'Object');
  await editor.mouse.click(...at(140, 440)); // plain white space in the chart card, above the bars
  await expect(editor.getByText(/Couldn’t find an object there/)).toBeVisible({ timeout: 30_000 });
  await expect(editor.getByRole('button', { name: 'Remove (Enter)' })).toBeDisabled();
  await editor.close();
});

test('Ctrl+drag paints a straight mark (Remove object) and erases in a straight line (Erase image)', async ({ context, extensionId }) => {
  test.setTimeout(90_000);
  const { editor, at } = await openShot(context, extensionId);
  await eraseTool(editor, 'Object');
  const a = at(150, 470), b = at(560, 470), mid = at(355, 470), off = at(340, 540);
  await editor.keyboard.down('Control');
  await editor.mouse.move(...a);
  await editor.mouse.down();
  // A wobbly path: the mark is still straight from start to end.
  await editor.mouse.move(...at(250, 560), { steps: 5 });
  await editor.mouse.move(...b, { steps: 5 });
  await editor.mouse.up();
  await editor.keyboard.up('Control');
  await expect(editor.getByRole('button', { name: 'Remove (Enter)' })).toBeEnabled();
  expect(await share(editor, mid, (r, g, b) => (r > 200 && g < 140 && b < 140) || (r > 240 && g > 240 && b > 240), 4)).toBeGreaterThan(0.6);
  expect(await share(editor, at(250, 560), RED, 4)).toBe(0);
  await editor.getByRole('button', { name: 'Clear selection (Esc)' }).click();

  await eraseTool(editor, 'Image');
  await editor.getByRole('radio', { name: 'White', exact: true }).click();
  expect(await share(editor, off, PURPLE, 3)).toBeGreaterThan(0.5);
  await editor.keyboard.down('Control');
  await editor.mouse.move(...at(340, 500));
  await editor.mouse.down();
  await editor.mouse.move(...at(420, 450), { steps: 4 });
  await editor.mouse.move(...at(340, 580), { steps: 4 });
  await editor.mouse.up();
  await editor.keyboard.up('Control');
  // Straight down from 500 to 580: the bar at 540 is now white.
  await expect.poll(() => share(editor, off, WHITE, 3)).toBeGreaterThan(0.9);
  await editor.close();
});
