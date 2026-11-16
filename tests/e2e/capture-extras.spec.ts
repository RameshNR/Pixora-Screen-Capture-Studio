import { readFileSync } from 'node:fs';
import { expect, readCaptures, send, tabIdFor, test } from './fixtures';

async function makePng(page: import('@playwright/test').Page, w = 320, h = 200): Promise<number[]> {
  return page.evaluate(async ([w, h]) => {
    const c = new OffscreenCanvas(w!, h!);
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#4F8DF7';
    ctx.fillRect(0, 0, w!, h!);
    const b = await c.convertToBlob({ type: 'image/png' });
    return Array.from(new Uint8Array(await b.arrayBuffer()));
  }, [w, h]);
}

test.describe('capture extras', () => {
  test('full page finds scrollable panels and captures their whole content', async ({ context, extPage, baseUrl }) => {
    const page = await context.newPage();
    await page.setViewportSize({ width: 1200, height: 700 });
    await page.goto(`${baseUrl}/panels`);
    const tabId = await tabIdFor(extPage, `${baseUrl}/panels`);
    const report = await send<{ pageScrolls: boolean; areas: Array<{ index: number; label: string; screens: number }> }>(extPage, { target: 'background', type: 'screenshot/scroll-areas', tabId });
    expect(report.pageScrolls).toBe(false);
    expect(report.areas.map((a) => a.label).sort()).toEqual(['Main content', 'Sidebar']);
    // The panels are outlined and numbered on the page.
    await expect.poll(() => page.evaluate(() => document.querySelectorAll('#glint-scroll-areas > div').length)).toBe(2);

    const main = report.areas.find((a) => a.label === 'Main content')!;
    const side = report.areas.find((a) => a.label === 'Sidebar')!;
    await send(extPage, { target: 'background', type: 'screenshot/capture', mode: 'full', tabId, scrollAreas: [{ index: main.index, screens: 0 }, { index: side.index, screens: 2 }] });
    await expect.poll(async () => (await readCaptures(extPage)).length, { timeout: 30_000 }).toBe(1);
    const [shot] = await readCaptures(extPage);
    // 40 rows × 120 px of main content, at the device pixel ratio.
    const dpr = await page.evaluate(() => devicePixelRatio);
    expect(shot!.height as number).toBeGreaterThanOrEqual(Math.floor(40 * 120 * dpr * 0.95));
    // The page is restored afterwards.
    expect(await page.evaluate(() => [getComputedStyle(document.querySelector('.main')!).overflowY, document.querySelectorAll('[data-glint-area]').length])).toEqual(['auto', 0]);
  });

  test('editor exports a PDF and makes a QR code; collage has undo, redo, revert and zoom', async ({ context, extensionId, extPage }) => {
    const editor = await context.newPage();
    await editor.setViewportSize({ width: 1500, height: 900 });
    await editor.goto(`chrome-extension://${extensionId}/editor.html?import=1`);
    const png = Buffer.from(await makePng(editor));
    await editor.locator('input[type="file"]').setInputFiles({ name: 'pdf.png', mimeType: 'image/png', buffer: png });
    await expect(editor.getByRole('img', { name: 'Screenshot canvas' })).toBeVisible();

    // Export settings live in a popup opened from the toolbar (not at the bottom of the side panel).
    await expect(editor.getByRole('complementary', { name: 'Properties' }).getByRole('button', { name: 'Save as…' })).toHaveCount(0);
    await editor.getByRole('button', { name: 'Export…' }).click();
    await expect(editor.getByRole('dialog', { name: 'Export' })).toBeVisible();
    await editor.getByRole('button', { name: 'PDF…' }).click();
    await expect(editor.getByRole('dialog', { name: 'Export' })).toHaveCount(0);
    const download = editor.waitForEvent('download');
    await editor.getByRole('button', { name: 'Download PDF' }).click();
    const pdf = readFileSync((await (await download).path())!);
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');

    await editor.getByRole('button', { name: 'Export…' }).click();
    const wordDownload = editor.waitForEvent('download');
    await editor.getByRole('button', { name: 'Word', exact: true }).click();
    const word = await wordDownload;
    expect(word.suggestedFilename()).toMatch(/\.docx$/);
    const docx = readFileSync((await word.path())!);
    expect(docx.toString('utf8')).toContain('word/media/image1.png');

    await editor.getByRole('button', { name: 'QR code…' }).click();
    await editor.getByRole('radio', { name: 'A link I paste' }).click();
    await editor.getByRole('textbox', { name: 'Link for the QR code' }).fill('https://example.com/shared/image');
    await expect(editor.getByLabel('QR code preview').locator('svg')).toBeVisible();
    await editor.keyboard.press('Escape');

    // Text Settings: Basic / Design / Advanced, each with its cards in order.
    await editor.keyboard.press('t');
    const cards = async () => (await editor.getByRole('complementary', { name: 'Properties' }).locator('summary').allInnerTexts()).map((t) => t.replace(/See all|Fewer/, '').trim());
    expect(await cards()).toEqual(['Text content', 'Typography', 'Quick presets']);
    const tabs = editor.getByRole('tablist', { name: 'Text settings' });
    await tabs.getByRole('tab', { name: 'Design' }).click();
    expect(await cards()).toEqual(['Background', 'Border', 'Spacing & corners']);
    await tabs.getByRole('tab', { name: 'Advanced' }).click();
    expect(await cards()).toEqual(['Effects', 'Header & footer']);

    // Collage: history, revert and zoom.
    const page = await context.newPage();
    await page.setViewportSize({ width: 1400, height: 860 });
    await page.goto(`chrome-extension://${extensionId}/editor.html?collage=1`);
    await page.locator('input[type="file"][multiple]').first().setInputFiles([0, 1, 2].map((i) => ({ name: `${i}.png`, mimeType: 'image/png', buffer: png })));
    await expect(page.getByRole('img', { name: 'Collage preview' })).toBeVisible();
    await page.waitForTimeout(500);
    await page.getByRole('button', { name: 'Stacked' }).click();
    await page.waitForTimeout(500);
    await page.getByRole('tab', { name: /History/ }).click();
    await expect(page.getByRole('button', { name: 'Layout: Stacked' })).toBeVisible();
    await page.getByRole('button', { name: 'Undo', exact: true }).last().click();
    await expect(page.getByRole('button', { name: 'Layout: Stacked' })).toHaveClass(/historyFuture/);
    await page.getByRole('button', { name: 'Redo', exact: true }).last().click();
    await page.getByRole('button', { name: /Revert to original/ }).click();
    await expect(page.getByRole('button', { name: 'Revert to original', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Zoom in' }).click();
    await expect(page.getByRole('textbox', { name: 'Collage zoom level' })).not.toHaveValue(/^\s*$/);
    await page.getByRole('button', { name: 'Fit to screen' }).click();
    await page.getByRole('tab', { name: /Images/ }).click();
    await expect(page.locator('li', { hasText: '0.png' })).toBeVisible();

    // Keyboard: select an image and press Delete: it leaves the collage (the capture is kept).
    const captures = (await readCaptures(extPage)).length;
    const box = (await page.getByRole('img', { name: 'Collage preview' }).boundingBox())!;
    await page.mouse.click(box.x + box.width * 0.2, box.y + box.height / 2);
    await page.keyboard.press('Delete');
    await expect(page.locator('li', { hasText: '.png' })).toHaveCount(2);
    expect((await readCaptures(extPage)).length).toBe(captures);
  });

  test('finds the email and password typed in a sign-in form, ignores ordinary words, and the dialog can be dragged', async ({ context, extensionId }) => {
    test.setTimeout(120_000);
    const editor = await context.newPage();
    await editor.setViewportSize({ width: 1500, height: 950 });
    await editor.goto(`chrome-extension://${extensionId}/editor.html?import=1`);
    const png = Buffer.from(await editor.evaluate(async () => {
      const c = new OffscreenCanvas(1240, 760);
      const ctx = c.getContext('2d')!;
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, 1240, 760);
      ctx.fillStyle = '#333';
      ctx.font = '40px Arial';
      ctx.fillText('Sign In', 185, 60);
      ctx.font = '16px Georgia';
      ctx.fillText('You can now sign in to both websites using your costco.com email and password. Learn more', 230, 130);
      const field = (y: number, label: string, value: string) => {
        ctx.strokeStyle = '#8a8a8a';
        ctx.lineWidth = 1;
        ctx.strokeRect(220, y, 755, 46);
        ctx.fillStyle = '#fff';
        ctx.fillRect(232, y - 8, ctx.measureText(label).width + 30, 16);
        ctx.fillStyle = '#333';
        ctx.font = '14px Arial';
        ctx.fillText(label, 238, y + 4);
        ctx.font = '18px Arial';
        ctx.fillStyle = '#111';
        ctx.fillText(value, 238, y + 30);
      };
      field(220, 'Email Address', 'sridhevi2006@gmail.com');
      field(292, 'Password', 'fdsfsdfsd');
      ctx.font = '13px Arial';
      ctx.fillStyle = '#111';
      ctx.fillText('Check this box only when on a private device.', 220, 480);
      const b = await c.convertToBlob({ type: 'image/png' });
      return Array.from(new Uint8Array(await b.arrayBuffer()));
    }));
    await editor.locator('input[type="file"]').setInputFiles({ name: 'signin.png', mimeType: 'image/png', buffer: png });
    await expect(editor.getByRole('img', { name: 'Screenshot canvas' })).toBeVisible();
    await editor.getByRole('button', { name: 'Find sensitive info (emails, numbers, keys)' }).click();
    const dialog = editor.getByRole('dialog', { name: 'Find sensitive information' });
    const list = dialog.getByRole('list', { name: 'Sensitive text found' });
    await expect(list).toBeVisible({ timeout: 90_000 });
    const text = await list.innerText();
    expect(text).toContain('sridhevi2006@gmail.com');
    expect(text).toContain('Password');
    expect(text).toContain('fdsfsdfsd');
    expect(text).not.toContain('device');

    // Drag the dialog by its title bar.
    const before = (await dialog.boundingBox())!;
    const title = dialog.getByRole('heading', { name: 'Find sensitive information' });
    const t = (await title.boundingBox())!;
    await editor.mouse.move(t.x + 20, t.y + 8);
    await editor.mouse.down();
    await editor.mouse.move(t.x - 180, t.y + 120, { steps: 6 });
    await editor.mouse.up();
    const after = (await dialog.boundingBox())!;
    expect(after.x).toBeLessThan(before.x - 150);
    expect(after.y).toBeGreaterThan(before.y + 100);
  });
});
