import { readFileSync } from 'node:fs';
import { expect, test } from './fixtures';
import type { BrowserContext, Page } from '@playwright/test';
import { drag, eraseTool } from './redact-helpers';

/** The editor with a picture (PNG bytes). */
async function openPng(context: BrowserContext, extensionId: string, png: Buffer) {
  const editor = await context.newPage();
  await editor.setViewportSize({ width: 1500, height: 950 });
  await editor.goto(`chrome-extension://${extensionId}/editor.html?import=1`);
  await editor.locator('input[type="file"]').first().setInputFiles({ name: 'pic.png', mimeType: 'image/png', buffer: png });
  const canvas = editor.getByRole('img', { name: 'Screenshot canvas' });
  await expect(canvas).toBeVisible();
  return editor;
}

/** Maps picture px to screen px (the picture is centred in the canvas at the shown zoom). */
async function mapper(editor: Page, w: number, h: number) {
  const c = (await editor.getByRole('img', { name: 'Screenshot canvas' }).boundingBox())!;
  const k = Number((await editor.getByLabel('Zoom level').inputValue()).replace('%', '')) / 100;
  return (x: number, y: number) => [c.x + c.width / 2 + (x - w / 2) * k, c.y + c.height / 2 + (y - h / 2) * k] as const;
}

/** A picture made with the page's canvas (a function body run in the page, receiving ctx, w, h). */
async function makePng(page: Page, w: number, h: number, kind: 'card' | 'badges'): Promise<Buffer> {
  return Buffer.from(await page.evaluate(async ([W, H, k]) => {
    const c = new OffscreenCanvas(W, H);
    const x = c.getContext('2d')!;
    if (k === 'card') {
      x.fillStyle = '#1d4ed8';
      x.fillRect(0, 0, W, H);
      x.fillStyle = '#ffffff';
      x.beginPath();
      x.roundRect(100, 100, 600, 300, 40);
      x.fill();
      x.fillStyle = '#111827';
      x.font = 'bold 48px sans-serif';
      x.fillText('Hello', 320, 270);
    } else {
      x.fillStyle = '#ffffff';
      x.fillRect(0, 0, W, H);
      x.fillStyle = '#e11d1d';
      for (const cx of [200, 500]) { x.beginPath(); x.arc(cx, 250, 50, 0, Math.PI * 2); x.fill(); }
    }
    return Array.from(new Uint8Array(await (await c.convertToBlob({ type: 'image/png' })).arrayBuffer()));
  }, [w, h, kind] as const));
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
const share = (d: number[], test: (r: number, g: number, b: number) => boolean) => {
  let n = 0;
  for (let i = 0; i < d.length; i += 4) if (test(d[i]!, d[i + 1]!, d[i + 2]!)) n++;
  return n / (d.length / 4);
};
const RED = (r: number, g: number, b: number) => r > 200 && g < 120 && b < 120;

test('one Erase & remove button: the panel switches between Annotation, Image, Object and Background; the button reopens the last one', async ({ context, extensionId }) => {
  const page = await context.newPage();
  const editor = await openPng(context, extensionId, await makePng(page, 700, 500, 'badges'));
  await page.close();
  for (const old of [/^Eraser \(/, /^Erase image/, /^Remove object/, /^Remove background/]) await expect(editor.getByRole('button', { name: old })).toHaveCount(0);
  const button = editor.getByRole('button', { name: /^Erase & remove/ });
  await button.click();
  const kinds = editor.getByRole('radiogroup', { name: 'What to erase' });
  await expect(kinds.getByRole('radio')).toHaveCount(4);
  await expect(kinds.getByRole('radio', { name: 'Annotation' })).toHaveAttribute('aria-checked', 'true');
  await kinds.getByRole('radio', { name: 'Object' }).click();
  await expect(editor.getByText('Remove object', { exact: true })).toBeVisible();
  await editor.getByRole('button', { name: 'Select & move' }).click();
  await button.click();
  await expect(kinds.getByRole('radio', { name: 'Object' })).toHaveAttribute('aria-checked', 'true');
  await editor.close();
});

test('Remove object: Ctrl+Z / Ctrl+Y step through the selection first; Unmark takes a part out; clicks outside the picture do nothing', async ({ context, extensionId }) => {
  test.setTimeout(120_000);
  const page = await context.newPage();
  const editor = await openPng(context, extensionId, await makePng(page, 700, 500, 'badges'));
  await page.close();
  const at = await mapper(editor, 700, 500);
  await eraseTool(editor, 'Object');
  const remove = editor.getByRole('button', { name: 'Remove (Enter)' });
  // Hatching lightens the red ball (its white stripes over red look pink).
  const hatched = async (x: number, y: number) => share(await pixels(editor, at(x, y), 6), (r, g, b) => r > 200 && g > 100 && b > 100) > 0.15;

  // Outside the picture: nothing selected, no message.
  const [ox, oy] = at(-40, 250);
  await editor.mouse.click(ox, oy);
  await editor.waitForTimeout(800);
  await expect(remove).toBeDisabled();
  await expect(editor.getByText(/Couldn’t find/)).toHaveCount(0);

  await editor.mouse.click(...at(200, 250));
  await expect(remove).toBeEnabled({ timeout: 30_000 });
  await editor.mouse.click(...at(500, 250));
  await expect.poll(() => hatched(500, 250), { timeout: 30_000 }).toBe(true);
  // Ctrl+Z: the second ball leaves the selection; the first stays; the picture's history is untouched.
  await editor.keyboard.press('Control+z');
  await expect.poll(() => hatched(500, 250)).toBe(false);
  expect(await hatched(200, 250)).toBe(true);
  await editor.keyboard.press('Control+y');
  await expect.poll(() => hatched(500, 250)).toBe(true);

  // Unmark: paint over the second ball's selection.
  await editor.getByRole('radio', { name: 'Unmark' }).click();
  await editor.getByRole('slider', { name: 'Brush size' }).fill('200');
  await drag(editor, ...at(470, 250), ...at(530, 250));
  await expect.poll(() => hatched(500, 250)).toBe(false);
  expect(await hatched(200, 250)).toBe(true);

  // Remove, then Ctrl+Z brings the ball back.
  await editor.keyboard.press('Enter');
  await expect.poll(async () => share(await pixels(editor, at(200, 250), 10), RED), { timeout: 30_000 }).toBeLessThan(0.05);
  expect(share(await pixels(editor, at(500, 250), 10), RED)).toBeGreaterThan(0.8);
  await editor.keyboard.press('Control+z');
  await expect.poll(async () => share(await pixels(editor, at(200, 250), 10), RED)).toBeGreaterThan(0.8);
  await editor.close();
});

test('Remove background on a graphic: sharp edges with no trace of the old colour; strokes undo with Ctrl+Z', async ({ context, extensionId }) => {
  test.setTimeout(120_000);
  const page = await context.newPage();
  const editor = await openPng(context, extensionId, await makePng(page, 800, 500, 'card'));
  await page.close();
  const at = await mapper(editor, 800, 500);
  await eraseTool(editor, 'Background');
  await expect(editor.getByText(/^Found the subject in the picture/)).toBeVisible({ timeout: 30_000 });
  await expect(editor.getByText(/edges are kept exact and sharp/)).toBeVisible();
  await expect(editor.getByText('Edge refinement (hair, fine edges)')).toHaveCount(0);
  await editor.getByRole('radio', { name: 'White', exact: true }).click();

  // A Remove stroke over the card, then Ctrl+Z: the card is whole again (the stroke was a step of its own).
  await editor.getByRole('radio', { name: 'Remove', exact: true }).click();
  await drag(editor, ...at(150, 200), ...at(250, 200));
  await editor.waitForTimeout(400);
  await editor.keyboard.press('Control+z');
  await editor.waitForTimeout(400);
  await editor.getByRole('button', { name: 'Apply (Enter)' }).click();
  await expect(editor.getByRole('button', { name: 'Select & move' })).toHaveAttribute('aria-pressed', 'true');
  // No blue anywhere around the card's rounded corner and edges, and none left behind.
  await expect.poll(async () => share(await pixels(editor, at(50, 50), 20), (r, _g, b) => b - r > 25)).toBe(0);
  for (const [x, y] of [[112, 112], [100, 250], [400, 100], [700, 250], [688, 388]] as const) {
    expect(share(await pixels(editor, at(x, y), 8), (r, _g, b) => b - r > 25), `${x},${y}`).toBe(0);
  }
  // The text is still there.
  expect(share(await pixels(editor, at(380, 255), 30), (r, g, b) => r < 80 && g < 80 && b < 80)).toBeGreaterThan(0.05);
  await editor.close();
});

test('AI click on a photo inside a large screenshot selects just that object (no stray patches elsewhere)', async ({ context, extensionId }) => {
  test.setTimeout(180_000);
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/editor.html?import=1`);
  const bloom = readFileSync('C:/Windows/Web/Wallpaper/Spotlight/img14.jpg').toString('base64');
  // A 3000 × 1600 "page" with lines of text and the photo at (300, 400) – (1260, 1000).
  const png = Buffer.from(await page.evaluate(async (b64) => {
    const photo = await createImageBitmap(new Blob([Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0))], { type: 'image/jpeg' }));
    const c = new OffscreenCanvas(3000, 1600);
    const x = c.getContext('2d')!;
    x.fillStyle = '#ffffff';
    x.fillRect(0, 0, 3000, 1600);
    x.fillStyle = '#111827';
    x.font = '28px sans-serif';
    for (let y = 450; y < 1500; y += 48) x.fillText('Experience smoother gameplay, faster loading times and enhanced graphics.', 1400, y);
    x.drawImage(photo, 300, 400, 960, 600);
    return Array.from(new Uint8Array(await (await c.convertToBlob({ type: 'image/png' })).arrayBuffer()));
  }, bloom));
  await page.close();
  const editor = await openPng(context, extensionId, png);
  const at = await mapper(editor, 3000, 1600);
  await eraseTool(editor, 'Object');
  // What each spot looks like before anything is marked (the hatching changes what it covers).
  const spots = [[800, 760], [1800, 600], [2400, 1000], [1600, 1400], [700, 1300], [2000, 300]] as const;
  const before = await Promise.all(spots.map(([x, y]) => pixels(editor, at(x, y), 12)));
  await editor.mouse.click(...at(800, 760)); // the bloom
  await expect(editor.getByRole('button', { name: 'Remove (Enter)' })).toBeEnabled({ timeout: 60_000 });
  await editor.waitForTimeout(500);
  const changed = (a: number[], b: number[]) => { let d = 0; for (let i = 0; i < a.length; i++) d += Math.abs(a[i]! - b[i]!); return d / a.length; };
  // Marked on the bloom; nothing marked on the text beside it, below it or above.
  expect(changed(before[0]!, await pixels(editor, at(800, 760), 12))).toBeGreaterThan(8);
  for (let i = 1; i < spots.length; i++) {
    const [sx, sy] = spots[i]!;
    expect(changed(before[i]!, await pixels(editor, at(sx, sy), 12)), `${sx},${sy}`).toBeLessThan(1);
  }
  await editor.close();
});
