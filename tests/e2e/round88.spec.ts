import { expect, readCaptures, test } from './fixtures';
import { drag, openStripes } from './redact-helpers';

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

test('popup tooltips: right column ends with the card, no narrow wrapping', async ({ context, extensionId }) => {
  const popup = await context.newPage();
  await popup.setViewportSize({ width: 380, height: 600 });
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  await popup.getByRole('tab', { name: 'Record' }).click();
  const widths: Record<string, number> = {};
  for (const name of ['Desktop', 'Camera Only', 'This Tab', 'Custom Area']) {
    const card = popup.getByRole('radio', { name });
    await card.hover();
    const tip = popup.getByRole('tooltip');
    await expect(tip).toBeVisible();
    const r = (await tip.boundingBox())!;
    const c = (await card.boundingBox())!;
    widths[name] = r.width;
    // Its own width (not squeezed by the window edge): at most two lines.
    expect(r.height, name).toBeLessThan(50);
    expect(r.x, name).toBeGreaterThanOrEqual(0);
    expect(r.x + r.width, name).toBeLessThanOrEqual(380);
    if (r.width > c.width) {
      if (c.x < 190) expect(Math.abs(r.x - c.x), name).toBeLessThanOrEqual(1);
      else expect(Math.abs(r.x + r.width - (c.x + c.width)), name).toBeLessThanOrEqual(1);
    }
    await popup.mouse.move(5, 590);
    await expect(tip).toHaveCount(0);
  }
  // "Record yourself with the webcam" is laid out on one line, wider than its card.
  expect(widths['Camera Only']).toBeGreaterThan(160);
});

test('select tool: dragging marks an area (no panning); Delete clears it, undo brings it back, Crop crops', async ({ context, extensionId }) => {
  const { editor, cx, cy } = await openStripes(context, extensionId);
  await expect(editor.getByRole('button', { name: 'Select & move' })).toHaveAttribute('aria-pressed', 'true');
  const scroller = editor.getByRole('img', { name: 'Screenshot canvas' }).locator('..');
  const before = await scroller.evaluate((el) => [el.scrollLeft, el.scrollTop]);
  const clip = { x: cx - 30, y: cy - 30, width: 60, height: 60 };
  expect(await blueShare(editor, clip)).toBeGreaterThan(0.3);

  await drag(editor, cx - 80, cy - 80, cx + 80, cy + 80);
  const bar = editor.getByRole('toolbar', { name: 'Marked area' });
  await expect(bar).toBeVisible();
  await expect(bar).toContainText('×');
  // The picture didn't move.
  expect(await scroller.evaluate((el) => [el.scrollLeft, el.scrollTop])).toEqual(before);

  await editor.keyboard.press('Delete');
  await expect(bar).toHaveCount(0);
  await expect.poll(() => blueShare(editor, clip)).toBeLessThan(0.02);
  await editor.keyboard.press('Control+z');
  await expect.poll(() => blueShare(editor, clip)).toBeGreaterThan(0.3);

  // A click (no drag) clears a marked area.
  await drag(editor, cx - 80, cy - 80, cx + 80, cy + 80);
  await expect(bar).toBeVisible();
  await editor.mouse.click(cx + 200, cy + 150);
  await expect(bar).toHaveCount(0);

  // Crop to the area.
  await drag(editor, cx - 80, cy - 80, cx + 80, cy + 80);
  const size = (await bar.textContent())!.match(/(\d+)\s*×\s*(\d+)/)!;
  await bar.getByRole('button', { name: 'Crop to area' }).click();
  await expect(editor.getByText(`${size[1]} × ${size[2]}`).first()).toBeVisible();
  await editor.close();
});

test('the area bar copies the marked part to the clipboard', async ({ context, extensionId }) => {
  const { editor, cx, cy } = await openStripes(context, extensionId);
  // What the editor puts on the clipboard (the test browser's clipboard can't be read back here).
  await editor.evaluate(() => {
    const w = window as unknown as { copied: Promise<number[]> | null };
    w.copied = null;
    navigator.clipboard.write = async (items: ClipboardItem[]) => {
      w.copied = items[0]!.getType('image/png').then(createImageBitmap).then((b) => [b.width, b.height]);
    };
  });
  await drag(editor, cx - 50, cy - 40, cx + 50, cy + 40);
  const bar = editor.getByRole('toolbar', { name: 'Marked area' });
  const size = (await bar.textContent())!.match(/(\d+)\s*×\s*(\d+)/)!;
  await bar.getByRole('button', { name: 'Copy area (Ctrl+C)' }).click();
  await expect(editor.getByText('Area copied')).toBeVisible();
  const dims = await editor.evaluate(() => (window as unknown as { copied: Promise<number[]> }).copied);
  expect(dims).toEqual([Number(size[1]), Number(size[2])]);
  await editor.close();
});

test('"extract text" runs once: opening the capture again does not run OCR again', async ({ context, extensionId, extPage }) => {
  test.setTimeout(120_000);
  const { editor } = await openStripes(context, extensionId);
  await expect.poll(async () => (await readCaptures(extPage)).length).toBeGreaterThan(0);
  const id = (await readCaptures(extPage))[0]!.id as string;
  await editor.close();
  // As "Take screenshot & extract text" leaves it.
  await extPage.evaluate((cid) => new Promise<void>((resolve, reject) => {
    const req = indexedDB.open('glint-capture');
    req.onsuccess = () => {
      const tx = req.result.transaction('captures', 'readwrite');
      const store = tx.objectStore('captures');
      const get = store.get(cid);
      get.onsuccess = () => store.put({ ...get.result, ocrRequested: true });
      tx.oncomplete = () => { req.result.close(); resolve(); };
      tx.onerror = () => reject(tx.error);
    };
    req.onerror = () => reject(req.error);
  }), id);

  const first = await context.newPage();
  await first.goto(`chrome-extension://${extensionId}/editor.html?id=${id}`);
  await expect(first.getByRole('dialog', { name: 'Extracted text' })).toBeVisible();
  await expect.poll(async () => (await readCaptures(extPage)).find((c) => c.id === id)?.ocrRequested).toBe(false);
  await first.close();

  const again = await context.newPage();
  await again.goto(`chrome-extension://${extensionId}/editor.html?id=${id}`);
  await expect(again.getByRole('img', { name: 'Screenshot canvas' })).toBeVisible();
  await again.waitForTimeout(1500);
  await expect(again.getByRole('dialog', { name: 'Extracted text' })).toHaveCount(0);
  await again.close();
});
