import { expect, readCaptures, test } from './fixtures';

/** A PNG of the given size and colour, made in the page (no binary fixtures in the repo). */
async function png(page: import('@playwright/test').Page, w: number, h: number, color: string): Promise<Buffer> {
  return Buffer.from(await page.evaluate(async ([w, h, color]) => {
    const c = new OffscreenCanvas(w as number, h as number);
    const x = c.getContext('2d')!;
    x.fillStyle = color as string;
    x.fillRect(0, 0, w as number, h as number);
    x.fillStyle = '#ffffff';
    x.fillRect(20, 20, 80, 40);
    return Array.from(new Uint8Array(await (await c.convertToBlob({ type: 'image/png' })).arrayBuffer()));
  }, [w, h, color] as const));
}

test('screenshot editor: select-drag pans, cut keeps zoom, image panel, compare, collage', async ({ context, extensionId, extPage }) => {
  const editor = await context.newPage();
  await editor.setViewportSize({ width: 1500, height: 900 });
  await editor.goto(`chrome-extension://${extensionId}/editor.html?import=1`);
  await editor.locator('input[type="file"]').first().setInputFiles({ name: 'first.png', mimeType: 'image/png', buffer: await png(editor, 1600, 1200, '#3366cc') });
  const canvas = editor.getByRole('img', { name: 'Screenshot canvas' });
  await expect(canvas).toBeVisible();

  // ---- Select tool: dragging an empty spot moves around the image (like the hand tool).
  const zoom = editor.getByRole('textbox', { name: 'Zoom level' });
  await zoom.click();
  await zoom.fill('200');
  await zoom.press('Enter');
  await editor.keyboard.press('v');
  const scroller = canvas.locator('xpath=ancestor::*[contains(@class,"workspace")][1]');
  const before = await scroller.evaluate((el) => [el.scrollLeft, el.scrollTop]);
  const box = (await canvas.boundingBox())!;
  await editor.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await editor.mouse.down();
  await editor.mouse.move(box.x + box.width / 2 - 150, box.y + box.height / 2 - 120, { steps: 6 });
  await editor.mouse.up();
  const after = await scroller.evaluate((el) => [el.scrollLeft, el.scrollTop]);
  expect(after[0]! - before[0]!).toBeGreaterThan(100);
  expect(after[1]! - before[1]!).toBeGreaterThan(80);
  await expect(editor.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled(); // nothing was drawn or moved

  // ---- Cut out & join keeps the zoom.
  await editor.getByRole('button', { name: 'Cut out & join' }).click();
  const panel = editor.getByRole('complementary', { name: 'Properties' });
  await panel.getByRole('button', { name: 'Cut out & join' }).click();
  await expect(editor.getByText('1600 × 960 px')).toBeVisible();
  await expect(zoom).toHaveValue('200%');
  await editor.keyboard.press('Escape');

  // ---- Image panel: add a second image from the computer; switching keeps the edits.
  const rail = editor.getByRole('complementary', { name: 'Images' });
  await expect(rail.getByText('Images (1)')).toBeVisible();
  await rail.getByRole('button', { name: 'Add image' }).click();
  await expect(editor.getByRole('menuitem', { name: /From your computer/ })).toBeVisible();
  await editor.keyboard.press('Escape');
  await rail.getByLabel('Images to add').setInputFiles({ name: 'second.png', mimeType: 'image/png', buffer: await png(editor, 800, 600, '#cc3333') });
  await expect(rail.getByText('Images (2)')).toBeVisible();
  await expect(editor.getByText('800 × 600 px')).toBeVisible(); // the added image is open
  await rail.getByRole('button', { name: 'Open image 1' }).click();
  await expect(editor.getByText('1600 × 960 px')).toBeVisible(); // the cut is still there
  await expect(rail.getByText('edited')).toHaveCount(1);
  await expect(editor).toHaveURL(/set=/);

  // ---- Compare: original vs edited, highlight changes needs equal sizes.
  await editor.getByRole('button', { name: 'Compare with original' }).first().click();
  const cmp = editor.getByRole('dialog', { name: 'Original vs edited screenshot' });
  await expect(cmp.getByRole('img', { name: 'Screenshot: Original' })).toBeVisible();
  await expect(cmp.getByRole('img', { name: 'Screenshot: Edited' })).toBeVisible();
  await expect(cmp.getByText('1,600 × 1,200')).toBeVisible();
  await expect(cmp.getByText('1,600 × 960')).toBeVisible();
  await expect(cmp.getByRole('checkbox', { name: 'Sync Zoom' })).toBeChecked();
  await expect(cmp.getByRole('checkbox', { name: 'Highlight Changes' })).toBeDisabled(); // the cut changed the size
  const level = cmp.getByRole('toolbar', { name: 'Zoom' });
  const lv = await level.innerText();
  await cmp.getByRole('button', { name: 'Zoom in' }).click();
  await expect.poll(() => level.innerText()).not.toBe(lv);
  await cmp.getByRole('radiogroup', { name: 'Compare' }).getByRole('radio', { name: 'Edited' }).click();
  await expect(cmp.getByRole('img', { name: 'Screenshot: Original' })).toHaveCount(0);

  // Restore original from the Compare window.
  await cmp.getByRole('button', { name: 'Restore Original' }).click();
  await expect(cmp).toHaveCount(0);
  await expect(editor.getByText('1600 × 1200 px')).toBeVisible();
  await expect(rail.getByText('edited')).toHaveCount(0);

  // ---- Highlight changes (same size): draw a box, compare, the changed share is reported.
  await editor.keyboard.press('r');
  const b2 = (await canvas.boundingBox())!;
  await editor.mouse.move(b2.x + b2.width / 2 - 80, b2.y + b2.height / 2 - 60);
  await editor.mouse.down();
  await editor.mouse.move(b2.x + b2.width / 2 + 80, b2.y + b2.height / 2 + 60, { steps: 5 });
  await editor.mouse.up();
  await editor.getByRole('button', { name: 'Compare with original' }).first().click();
  await expect(cmp.getByRole('radio', { name: 'Slider' })).toBeEnabled();
  // Click the visible label like a user would (the real checkbox is visually hidden, and forcing a
  // click on it while the window is still opening sometimes landed outside the viewport).
  await cmp.locator('label', { hasText: 'Highlight Changes' }).click();
  await expect(cmp.getByRole('checkbox', { name: 'Highlight Changes' })).toBeChecked();
  await expect(cmp.getByText(/% of the picture changed/)).toBeVisible();
  await cmp.getByRole('button', { name: 'Done' }).click();

  // ---- Collage of the panel's images.
  await rail.getByRole('button', { name: /^Collage/ }).click();
  await expect(editor.getByText(/Output: \d+ × \d+ px/)).toBeVisible();
  // The collage holds both images of the panel (the tab shows the count).
  await expect(editor.getByRole('tab', { name: /^Images\s*2$/ })).toBeVisible();

  // Both images are kept as captures.
  const shots = (await readCaptures(extPage)).filter((c) => c.kind === 'screenshot');
  expect(shots.length).toBeGreaterThanOrEqual(2);
});
