import { expect, type BrowserContext, type Page } from '@playwright/test';

/** A striped test picture (blur and pixelate change it visibly everywhere). */
export async function stripes(page: Page): Promise<Buffer> {
  return Buffer.from(await page.evaluate(async () => {
    const c = new OffscreenCanvas(1200, 700);
    const x = c.getContext('2d')!;
    for (let i = 0; i < 1200; i += 20) {
      x.fillStyle = (i / 20) % 2 ? '#1d4ed8' : '#f8fafc';
      x.fillRect(i, 0, 20, 700);
    }
    return Array.from(new Uint8Array(await (await c.convertToBlob({ type: 'image/png' })).arrayBuffer()));
  }));
}

/** The editor with the striped picture, and the picture's centre on screen. */
export async function openStripes(context: BrowserContext, extensionId: string): Promise<{ editor: Page; cx: number; cy: number }> {
  const editor = await context.newPage();
  await editor.setViewportSize({ width: 1500, height: 950 });
  await editor.goto(`chrome-extension://${extensionId}/editor.html?import=1`);
  await editor.locator('input[type="file"]').first().setInputFiles({ name: 'stripes.png', mimeType: 'image/png', buffer: await stripes(editor) });
  const canvas = editor.getByRole('img', { name: 'Screenshot canvas' });
  await expect(canvas).toBeVisible();
  const box = (await canvas.boundingBox())!;
  return { editor, cx: box.x + box.width / 2, cy: box.y + box.height / 2 };
}

export async function drag(editor: Page, x1: number, y1: number, x2: number, y2: number, shift = false): Promise<void> {
  await editor.mouse.move(x1, y1);
  if (shift) await editor.keyboard.down('Shift');
  await editor.mouse.down();
  await editor.mouse.move(x2, y2, { steps: 6 });
  await editor.mouse.up();
  if (shift) await editor.keyboard.up('Shift');
}

/** Share of red pixels in a screenshot (the mask colour). */
export async function redShare(page: Page, shot: Buffer): Promise<number> {
  return page.evaluate(async (b64) => {
    const bmp = await createImageBitmap(new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], { type: 'image/png' }));
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    const ctx = c.getContext('2d')!;
    ctx.drawImage(bmp, 0, 0);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i]! > 200 && d[i + 1]! < 110 && d[i + 2]! < 110) n++;
    return n / (d.length / 4);
  }, shot.toString('base64'));
}

/** One part of the look (Effect, Shape, Edges…): its section. */
export const section = (editor: Page, name: string) => editor.getByRole('region', { name, exact: true });

/** Opens one part of the look and returns its choices. */
export async function part(editor: Page, kind: 'Blur' | 'Pixelate' | 'Mask', name: string) {
  const head = section(editor, name).locator('button[aria-expanded]').first();
  if ((await head.getAttribute('aria-expanded')) !== 'true') await head.click();
  return editor.getByRole('listbox', { name: `${kind} ${name.toLowerCase()}` });
}

/** The area's size from the panel ("Region: W × H px"). */
export async function region(editor: Page): Promise<{ w: number; h: number }> {
  const t = await editor.getByText(/Region: \d+ × \d+ px/).innerText();
  const m = /(\d+) × (\d+)/.exec(t)!;
  return { w: Number(m[1]), h: Number(m[2]) };
}
