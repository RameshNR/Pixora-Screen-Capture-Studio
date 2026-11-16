import { readFileSync } from 'node:fs';
import { expect, readCaptures, test } from './fixtures';

/** 320×200 solid PNG generated in the page (no binary fixtures in the repo). */
async function makePng(page: import('@playwright/test').Page): Promise<number[]> {
  return page.evaluate(async () => {
    const c = new OffscreenCanvas(320, 200);
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 320, 200);
    ctx.fillStyle = '#4f8df7';
    ctx.fillRect(20, 20, 120, 80);
    const blob = await c.convertToBlob({ type: 'image/png' });
    return Array.from(new Uint8Array(await blob.arrayBuffer()));
  });
}

/** Opens a tab of a tool panel ("Pen settings" → "Style"…). */
async function panelTab(page: import('@playwright/test').Page, panel: string, tab: string) {
  await page.getByRole('tablist', { name: `${panel} settings` }).getByRole('tab', { name: tab, exact: true }).click();
}

test.describe('screenshot editor', () => {
  test('imports an image, annotates it, undoes/redoes and exports', async ({ context, extensionId, extPage }) => {
    const editor = await context.newPage();
    await editor.goto(`chrome-extension://${extensionId}/editor.html?import=1`);
    await expect(editor.getByRole('heading', { name: 'Annotate an image' })).toBeVisible();

    const png = Buffer.from(await makePng(editor));
    await editor.locator('input[type="file"]').setInputFiles({ name: 'fixture.png', mimeType: 'image/png', buffer: png });
    const canvas = editor.getByRole('img', { name: 'Screenshot canvas' });
    await expect(canvas).toBeVisible();
    await expect(editor).toHaveURL(/editor\.html\?id=/);

    // Draw a rectangle with the R tool.
    await editor.keyboard.press('r');
    await expect(editor.getByRole('button', { name: 'Shapes' })).toHaveAttribute('aria-pressed', 'true');
    const box = (await canvas.boundingBox())!;
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    await editor.mouse.move(cx - 60, cy - 30);
    await editor.mouse.down();
    await editor.mouse.move(cx + 60, cy + 30, { steps: 6 });
    await editor.mouse.up();

    const undo = editor.getByRole('button', { name: 'Undo', exact: true });
    const redo = editor.getByRole('button', { name: 'Redo', exact: true });
    await expect(undo).toBeEnabled();
    await expect(editor.getByText('Shapes · selected')).toBeVisible();

    await editor.keyboard.press('Control+z');
    await expect(undo).toBeDisabled();
    await expect(redo).toBeEnabled();
    await editor.keyboard.press('Control+y');
    await expect(undo).toBeEnabled();

    // Add text.
    await editor.keyboard.press('t');
    await editor.mouse.click(cx - 100, cy + 60);
    const textbox = editor.getByRole('textbox', { name: 'Annotation text' });
    await textbox.fill('Hello Pixora');
    await textbox.press('Control+Enter');
    await expect(editor.getByText('Text · selected')).toBeVisible();

    // Export as JPEG.
    await editor.getByRole('button', { name: 'Export…' }).click();
    const exportDialog = editor.getByRole('dialog', { name: 'Export' });
    await exportDialog.getByRole('radio', { name: 'JPEG' }).click();
    const download = editor.waitForEvent('download');
    await exportDialog.getByRole('button', { name: 'Download', exact: true }).click();
    await expect(exportDialog).toHaveCount(0);
    const file = await download;
    // (Playwright renames downloads to a GUID; the file name logic is covered by unit tests.)
    const path = await file.path();
    const bytes = readFileSync(path!);
    expect(bytes[0]).toBe(0xff); // JPEG SOI marker
    expect(bytes[1]).toBe(0xd8);

    // The edited version is saved back to Recent captures.
    await expect.poll(async () => (await readCaptures(extPage))[0]?.edited).toBe(true);
    expect((await readCaptures(extPage))[0]?.name).toBe('fixture.png');
  });

  test('cursor tool: designs, sizes, colours, click indicators and effects', async ({ context, extensionId }) => {
    const editor = await context.newPage();
    await editor.setViewportSize({ width: 1400, height: 900 });
    await editor.goto(`chrome-extension://${extensionId}/editor.html?import=1`);
    const png = Buffer.from(await makePng(editor));
    await editor.locator('input[type="file"]').setInputFiles({ name: 'fixture.png', mimeType: 'image/png', buffer: png });
    const canvas = editor.getByRole('img', { name: 'Screenshot canvas' });
    await expect(canvas).toBeVisible();
    const box = (await canvas.boundingBox())!;

    // U picks the cursor tool; each click places a cursor with the current look.
    await editor.keyboard.press('u');
    await expect(editor.getByRole('button', { name: /Cursor & click effects/ })).toHaveAttribute('aria-pressed', 'true');
    await editor.mouse.click(box.x + box.width / 2 - 90, box.y + box.height / 2 - 50);
    await expect(editor.getByText('Cursor & click · selected')).toBeVisible();

    // Change the selected cursor: design, size, click, effect and colours.
    const designs = editor.getByRole('radiogroup', { name: 'Cursor design' });
    await expect(designs.getByRole('radio')).toHaveCount(9);
    // Other groups hold the rest of the cursor sheet.
    await editor.getByRole('tablist', { name: 'Cursor design groups' }).getByRole('tab', { name: 'Resize' }).click();
    await expect(designs.getByRole('radio', { name: 'Resize horizontal' })).toBeVisible();
    await editor.getByRole('tablist', { name: 'Cursor design groups' }).getByRole('tab', { name: 'Classic & system' }).click();
    await designs.getByRole('radio', { name: 'Hand (link)' }).click();
    await panelTab(editor, 'Cursor', 'Click & effects');
    await editor.getByRole('radiogroup', { name: 'Click indicator' }).getByRole('radio', { name: 'Right' }).click();
    await editor.getByRole('button', { name: 'Cursor effect' }).click();
    await editor.getByRole('menuitemradio', { name: /Spotlight/ }).click();
    const layers = async () => {
      await editor.getByRole('tab', { name: /Layers/ }).click();
      const t = await editor.getByRole('complementary', { name: 'Properties' }).locator('li').allInnerTexts();
      await editor.getByRole('tab', { name: /Properties/ }).click();
      return t.join('|');
    };
    await expect.poll(layers).toMatch(/Cursor \(right click\)/);

    // A second cursor keeps its own design and effect.
    await editor.keyboard.press('Escape');
    await editor.keyboard.press('u');
    await panelTab(editor, 'Cursor', 'Design');
    await designs.getByRole('radio', { name: 'Presenter dot' }).click();
    await panelTab(editor, 'Cursor', 'Click & effects');
    await editor.getByRole('button', { name: 'Cursor effect' }).click();
    await editor.getByRole('menuitemradio', { name: /Ripple/ }).click();
    await editor.mouse.click(box.x + box.width / 2 + 70, box.y + box.height / 2 + 30);
    await expect.poll(layers).toMatch(/Cursor.*\|.*Cursor/s);

    // Undo removes the last cursor, redo brings it back.
    await editor.keyboard.press('Control+z');
    await expect.poll(async () => ((await layers()).match(/Cursor/g) ?? []).length).toBe(1);
    await editor.keyboard.press('Control+y');
    await expect.poll(async () => ((await layers()).match(/Cursor/g) ?? []).length).toBe(2);
    await editor.keyboard.press('Escape');
    await canvas.screenshot({ path: test.info().outputPath('cursors.png') });
  });

  test('design library: shapes, premium callouts, badges, device mockups and cursor looks', async ({ context, extensionId, extPage }) => {
    const editor = await context.newPage();
    await editor.setViewportSize({ width: 1500, height: 950 });
    await editor.goto(`chrome-extension://${extensionId}/editor.html?import=1`);
    const png = Buffer.from(await makePng(editor));
    await editor.locator('input[type="file"]').setInputFiles({ name: 'fixture.png', mimeType: 'image/png', buffer: png });
    const canvas = editor.getByRole('img', { name: 'Screenshot canvas' });
    await expect(canvas).toBeVisible();
    const box = (await canvas.boundingBox())!;
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    const layers = async () => {
      await editor.getByRole('tab', { name: /Layers/ }).click();
      const t = await editor.getByRole('complementary', { name: 'Properties' }).locator('li').allInnerTexts();
      await editor.getByRole('tab', { name: /Properties/ }).click();
      return t.join('|');
    };

    // Shape library: pick a badge shape and draw it.
    await editor.keyboard.press('r');
    await editor.getByRole('tablist', { name: 'Shape categories' }).getByRole('tab', { name: 'Badge & label' }).click();
    await editor.getByRole('listbox', { name: 'Shapes' }).getByRole('option', { name: 'Green seal' }).click();
    await editor.mouse.move(cx - 120, cy - 70);
    await editor.mouse.down();
    await editor.mouse.move(cx - 60, cy - 10, { steps: 4 });
    await editor.mouse.up();
    await expect.poll(layers).toMatch(/Seal/);

    // Premium callout: a step with a number badge.
    await editor.keyboard.press('Escape');
    await editor.keyboard.press('k');
    await editor.getByRole('tablist', { name: 'Callout categories' }).getByRole('tab', { name: 'Steps' }).click();
    await editor.getByRole('listbox', { name: 'Callout designs' }).getByRole('option', { name: 'Step · purple seal' }).click();
    await editor.mouse.click(cx + 10, cy - 60);
    await editor.keyboard.press('Control+Enter');
    await expect.poll(layers).toMatch(/Callout/);
    await editor.getByRole('tablist', { name: 'Callout categories' }).getByRole('tab', { name: 'Badges' }).click();
    await expect(editor.getByRole('listbox', { name: 'Callout designs' }).getByRole('option')).toHaveCount(16);

    // Device mockup with perspective, then export.
    await editor.keyboard.press('Escape');
    await editor.getByRole('button', { name: /Border & browser frame/ }).click();
    await panelTab(editor, 'Frame', 'Device');
    await editor.getByRole('switch', { name: 'Device mockup' }).click();
    await editor.getByRole('radiogroup', { name: 'Device' }).getByRole('radio', { name: 'Laptop' }).click();
    await editor.getByRole('radiogroup', { name: 'Device finish' }).getByRole('radio', { name: 'Silver' }).click();
    await panelTab(editor, 'Frame', 'Background');
    await editor.getByRole('button', { name: 'Perspective' }).click();
    await editor.getByRole('menuitemradio', { name: /Tilt left/ }).click();
    const [download] = await Promise.all([editor.waitForEvent('download'), editor.getByRole('button', { name: 'Download', exact: true }).first().click()]);
    expect(download.suggestedFilename()).toMatch(/\.png$/);

    // Cursor quick look.
    await editor.keyboard.press('u');
    await editor.getByRole('listbox', { name: 'Cursor quick looks' }).getByRole('option', { name: 'Purple target' }).click();
    await editor.mouse.click(box.x + box.width - 60, box.y + box.height - 60);
    await expect.poll(layers).toMatch(/Cursor/);
    void extPage;
  });

  test('round 23 designs: pens, highlighters, blur, masks, markers, stickers, text settings, watermark', async ({ context, extensionId }) => {
    const editor = await context.newPage();
    await editor.setViewportSize({ width: 1500, height: 950 });
    await editor.goto(`chrome-extension://${extensionId}/editor.html?import=1`);
    const png = Buffer.from(await makePng(editor));
    await editor.locator('input[type="file"]').setInputFiles({ name: 'fixture.png', mimeType: 'image/png', buffer: png });
    const canvas = editor.getByRole('img', { name: 'Screenshot canvas' });
    await expect(canvas).toBeVisible();
    const box = (await canvas.boundingBox())!;
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    const layers = async () => {
      await editor.getByRole('tab', { name: /Layers/ }).click();
      const t = await editor.getByRole('complementary', { name: 'Properties' }).locator('li').allInnerTexts();
      await editor.getByRole('tab', { name: /Properties/ }).click();
      return t.join('|');
    };
    const drag = async (x1: number, y1: number, x2: number, y2: number) => {
      await editor.mouse.move(x1, y1);
      await editor.mouse.down();
      await editor.mouse.move(x2, y2, { steps: 6 });
      await editor.mouse.up();
    };

    // One Shapes button (no separate circle button); O opens it with the ellipse.
    await expect(editor.getByRole('button', { name: 'Circle / ellipse' })).toHaveCount(0);
    await editor.keyboard.press('o');
    await expect(editor.getByRole('button', { name: 'Shapes' })).toHaveAttribute('aria-pressed', 'true');

    // Pen design (neon) and highlighter design (text box).
    await editor.keyboard.press('p');
    await editor.getByRole('tablist', { name: 'Pen design categories' }).getByRole('tab', { name: 'Special effects' }).click();
    await editor.getByRole('listbox', { name: 'Pen designs' }).getByRole('option', { name: 'Cyan neon' }).click();
    await drag(cx - 120, cy - 60, cx - 20, cy - 40);
    await expect.poll(layers).toMatch(/Pen/);
    await editor.keyboard.press('Escape');
    await editor.keyboard.press('g');
    await editor.getByRole('tablist', { name: 'Highlighter design categories' }).getByRole('tab', { name: 'Text box' }).click();
    await editor.getByRole('listbox', { name: 'Highlighter designs' }).getByRole('option', { name: 'Green text box' }).click();
    await drag(cx - 100, cy + 40, cx + 20, cy + 40);
    await expect.poll(layers).toMatch(/Highlight/);

    // Blur with a design (focus) and a mask placed over the header.
    await editor.keyboard.press('Escape');
    await editor.keyboard.press('b');
    await editor.getByRole('tablist', { name: 'Blur design categories' }).getByRole('tab', { name: 'Motion' }).click();
    await editor.getByRole('listbox', { name: 'Blur designs' }).getByRole('option', { name: 'Horizontal' }).click();
    await drag(cx + 30, cy - 70, cx + 120, cy - 20);
    await expect.poll(layers).toMatch(/Blur/);
    await editor.keyboard.press('Escape');
    await editor.keyboard.press('m');
    await editor.getByRole('tablist', { name: 'Mask design categories' }).getByRole('tab', { name: 'Text & content' }).click();
    await editor.getByRole('listbox', { name: 'Mask designs' }).getByRole('option', { name: 'Password mask' }).click();
    await drag(cx + 30, cy + 10, cx + 130, cy + 50);
    await editor.getByRole('button', { name: 'Top (header)' }).click();
    await expect(editor.getByText(/Region: \d+ × \d+ px/)).toBeVisible();

    // Marker with a label beside it.
    await editor.keyboard.press('Escape');
    await editor.keyboard.press('n');
    await editor.getByRole('radiogroup', { name: 'Marker shape' }).getByRole('radio', { name: 'square speech' }).click();
    await editor.getByRole('textbox', { name: 'Marker label' }).fill('Step One');
    await editor.mouse.click(cx - 140, cy + 70);
    await expect.poll(layers).toMatch(/Marker/);

    // Icon sticker with the die-cut edge.
    await editor.keyboard.press('Escape');
    await editor.keyboard.press('s');
    await editor.getByRole('tab', { name: 'Check & status' }).click();
    await editor.getByRole('option', { name: 'Toggle on' }).click();
    await editor.mouse.click(cx + 140, cy + 70);
    await expect.poll(layers).toMatch(/Sticker Toggle on/);

    // Text: Basic / Design / Advanced, a preset, and apply to all.
    await editor.keyboard.press('Escape');
    await editor.keyboard.press('t');
    // An empty spot on the left (clicking an object with the text tool selects it instead).
    await editor.mouse.click(box.x + box.width * 0.12, box.y + box.height * 0.55);
    await editor.getByRole('textbox', { name: 'Annotation text' }).fill('Hello');
    await editor.getByRole('textbox', { name: 'Annotation text' }).press('Control+Enter');
    await editor.getByRole('button', { name: 'See all' }).click();
    await editor.getByRole('tablist', { name: 'Text design categories' }).getByRole('tab', { name: 'Banner' }).click();
    await editor.getByRole('listbox', { name: 'Text designs' }).getByRole('option', { name: 'UPDATE' }).click();
    const tabs = editor.getByRole('tablist', { name: 'Text settings' });
    await tabs.getByRole('tab', { name: 'Design' }).click();
    await expect(editor.getByRole('radiogroup', { name: 'Background type' }).getByRole('radio', { name: 'Design' })).toHaveAttribute('aria-checked', 'true');
    await tabs.getByRole('tab', { name: 'Advanced' }).click();
    await expect(editor.getByRole('slider', { name: 'Letter spacing' })).toBeVisible();
    await editor.getByRole('button', { name: 'Apply to all text' }).click();

    // Scrolling inside a long dropdown scrolls it instead of closing it.
    await tabs.getByRole('tab', { name: 'Basic' }).click();
    await editor.getByRole('button', { name: /^Font: / }).first().click();
    const menu = editor.getByRole('menu').last();
    await expect(menu).toBeVisible();
    const mb = (await menu.boundingBox())!;
    await editor.mouse.move(mb.x + mb.width / 2, mb.y + mb.height / 2);
    await editor.mouse.wheel(0, 300);
    await editor.waitForTimeout(200);
    await expect(menu).toBeVisible();
    await editor.keyboard.press('Escape');

    // Watermark design.
    await editor.keyboard.press('Escape');
    await editor.keyboard.press('w');
    await editor.getByRole('switch', { name: 'Watermark' }).click();
    await editor.getByRole('tablist', { name: 'Watermark design categories' }).getByRole('tab', { name: 'Stamp' }).click();
    await editor.getByRole('listbox', { name: 'Watermark designs' }).getByRole('option', { name: 'Approved stamp' }).click();
    await panelTab(editor, 'Watermark', 'Style');
    await expect(editor.getByRole('button', { name: 'Watermark style: Round stamp' })).toBeVisible();

    const [download] = await Promise.all([editor.waitForEvent('download'), editor.getByRole('button', { name: 'Download', exact: true }).first().click()]);
    expect(download.suggestedFilename()).toMatch(/\.png$/);
  });

  test('crops and rotates (undoably)', async ({ context, extensionId }) => {
    const editor = await context.newPage();
    await editor.goto(`chrome-extension://${extensionId}/editor.html?import=1`);
    const png = Buffer.from(await makePng(editor));
    await editor.locator('input[type="file"]').setInputFiles({ name: 'crop.png', mimeType: 'image/png', buffer: png });
    await expect(editor.getByText('320 × 200 px')).toBeVisible();

    await editor.keyboard.press('c');
    await editor.getByLabel('Crop width').fill('100');
    await editor.getByLabel('Crop height').fill('50');
    await editor.getByRole('button', { name: 'Apply' }).click();
    await expect(editor.getByText('100 × 50 px')).toBeVisible();

    await editor.getByRole('button', { name: 'Rotate & flip' }).click();
    await editor.getByRole('menuitem', { name: 'Rotate right' }).click();
    await expect(editor.getByText('50 × 100 px')).toBeVisible();

    await editor.keyboard.press('Control+z');
    await editor.keyboard.press('Control+z');
    await expect(editor.getByText('320 × 200 px')).toBeVisible();
  });

  test('click-to-click arrows and marker counting for every marker', async ({ context, extensionId }) => {
    const editor = await context.newPage();
    await editor.setViewportSize({ width: 1400, height: 900 });
    await editor.goto(`chrome-extension://${extensionId}/editor.html?import=1`);
    const png = Buffer.from(await makePng(editor));
    await editor.locator('input[type="file"]').setInputFiles({ name: 'clicks.png', mimeType: 'image/png', buffer: png });
    const canvas = editor.getByRole('img', { name: 'Screenshot canvas' });
    await expect(canvas).toBeVisible();
    const box = (await canvas.boundingBox())!;
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    // Selecting a new object shows Properties, so open Layers before each check.
    const layer = async (text: string | RegExp) => {
      await editor.getByRole('tab', { name: /Layers/ }).click();
      return editor.locator('li', { hasText: text });
    };
    const arrowCount = async () => (await layer(/arrow/i)).count();

    // Click A, then click B: an arrow from A to B (no dragging).
    await editor.keyboard.press('a');
    await editor.mouse.click(cx - 120, cy + 40);
    await expect.poll(arrowCount).toBe(0);
    await editor.mouse.move(cx + 40, cy - 20, { steps: 4 });
    await editor.mouse.click(cx + 80, cy - 40);
    await expect.poll(arrowCount).toBe(1);
    // Escape after the first click cancels.
    await editor.mouse.click(cx - 120, cy + 90);
    await editor.keyboard.press('Escape');
    await editor.mouse.move(cx + 60, cy + 90, { steps: 3 });
    await editor.waitForTimeout(150);
    await expect.poll(arrowCount).toBe(1);
    // Dragging still works.
    await editor.mouse.move(cx - 100, cy + 100);
    await editor.mouse.down();
    await editor.mouse.move(cx + 60, cy + 100, { steps: 6 });
    await editor.mouse.up();
    await expect.poll(arrowCount).toBe(2);

    // Three markers, then switch counting once: all of them change.
    await editor.keyboard.press('Escape');
    await editor.keyboard.press('n');
    for (const dx of [-130, -60, 10]) await editor.mouse.click(cx + dx, cy - 75);
    await expect(await layer('Marker 3')).toBeVisible();
    await editor.getByRole('tab', { name: /Properties/ }).click();
    await editor.getByRole('radiogroup', { name: 'Marker counting' }).getByRole('radio', { name: 'A B C', exact: true }).click();
    for (const l of ['A', 'B', 'C']) await expect(await layer(`Marker ${l}`)).toBeVisible();
    await expect(editor.locator('li', { hasText: /Marker \d/ })).toHaveCount(0);
    // Undo restores the numbers in one step; new markers keep the chosen counting.
    await editor.keyboard.press('Control+z');
    await expect(await layer('Marker 2')).toBeVisible();
    await editor.keyboard.press('Control+y');
    await editor.mouse.click(cx + 80, cy - 75);
    await expect(await layer('Marker D')).toBeVisible();
    // The heart shape is available.
    await editor.getByRole('tab', { name: /Properties/ }).click();
    await expect(editor.getByRole('radio', { name: 'heart' })).toBeVisible();
  });

  test('floating selection bar, straight curve points, custom text stickers and marker shapes for all', async ({ context, extensionId }) => {
    const editor = await context.newPage();
    await editor.setViewportSize({ width: 1400, height: 900 });
    await editor.goto(`chrome-extension://${extensionId}/editor.html?import=1`);
    const png = Buffer.from(await makePng(editor));
    await editor.locator('input[type="file"]').setInputFiles({ name: 'bar.png', mimeType: 'image/png', buffer: png });
    const canvas = editor.getByRole('img', { name: 'Screenshot canvas' });
    await expect(canvas).toBeVisible();
    const box = (await canvas.boundingBox())!;
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    const layers = async () => {
      await editor.getByRole('tab', { name: /Layers/ }).click();
      const t = await editor.getByRole('complementary', { name: 'Properties' }).locator('li').allInnerTexts();
      await editor.getByRole('tab', { name: /Properties/ }).click();
      return t.map((x) => x.split('\n')[0] ?? '');
    };

    // Floating bar: duplicate, layer order, align, delete.
    await editor.keyboard.press('r');
    await editor.mouse.move(cx - 60, cy - 30);
    await editor.mouse.down();
    await editor.mouse.move(cx + 10, cy + 20, { steps: 5 });
    await editor.mouse.up();
    const bar = editor.getByRole('toolbar', { name: 'Selected object' });
    await expect(bar).toBeVisible();
    await bar.getByRole('button', { name: /Duplicate/ }).click();
    await expect.poll(async () => (await layers()).length).toBe(2);
    await bar.getByRole('button', { name: 'More options' }).click();
    await editor.getByRole('menuitem', { name: 'Align to image' }).click();
    await editor.getByRole('menuitem', { name: 'Left' }).click();
    await expect(editor.getByRole('menu')).toHaveCount(0);
    await editor.getByRole('tab', { name: /History/ }).click();
    await expect(editor.getByRole('button', { name: /Align rectangle left/ })).toBeVisible();
    await editor.getByRole('tab', { name: /Properties/ }).click();
    await bar.getByRole('button', { name: 'More options' }).click();
    await editor.getByRole('menuitem', { name: 'Layer' }).click();
    await editor.getByRole('menuitem', { name: 'Send to back' }).click();
    await bar.getByRole('button', { name: 'More options' }).click();
    await editor.getByRole('menuitem', { name: 'Copy' }).click();
    await bar.getByRole('button', { name: 'More options' }).click();
    await editor.getByRole('menuitem', { name: 'Paste' }).click();
    await expect.poll(async () => (await layers()).length).toBe(3);
    await bar.getByRole('button', { name: /Delete/ }).click();
    await expect.poll(async () => (await layers()).length).toBe(2);
    await editor.keyboard.press('Escape');
    await expect(bar).toHaveCount(0);

    // Right click on an object: Pixora's menu for it (no browser menu).
    await editor.mouse.click(cx - 25, cy - 30, { button: 'right' });
    const menu = editor.getByRole('menu', { name: 'Actions' });
    await expect(menu.getByRole('menuitem', { name: /Bring to front/ })).toBeVisible();
    await menu.getByRole('menuitem', { name: /Duplicate/ }).click();
    await expect.poll(async () => (await layers()).length).toBe(3);
    await editor.keyboard.press('Control+z');
    await expect.poll(async () => (await layers()).length).toBe(2);
    await editor.keyboard.press('Escape');

    // Curve points: the line stays straight (points sit on it) until a point is dragged.
    await editor.keyboard.press('a');
    await editor.mouse.move(cx - 120, cy + 70);
    await editor.mouse.down();
    await editor.mouse.move(cx + 120, cy + 70, { steps: 6 });
    await editor.mouse.up();
    await panelTab(editor, 'Line', 'Customize');
    await editor.getByRole('radiogroup', { name: 'Curve points' }).getByRole('radio', { name: '2' }).click();
    // The canvas row through the line shows the stroke (still straight) at the point positions.
    // Sample the row of the line between the points (a third of the way along): a bent S-curve leaves it there.
    const straight = await editor.evaluate(({ x, y }) => {
      const c = document.querySelector('canvas[aria-label="Screenshot canvas"]') as HTMLCanvasElement;
      const r = c.getBoundingClientRect();
      const ctx = c.getContext('2d')!;
      const k = c.width / r.width;
      return [x - 30, x + 110].map((sx) => {
        const px = ctx.getImageData(Math.round((sx - r.left) * k), Math.round((y - r.top) * k), 1, 1).data;
        return px[0]! > 150 && px[1]! < 120; // red stroke
      });
    }, { x: cx - 40, y: cy + 70 });
    expect(straight).toEqual([true, true]);

    // Text sticker with the user's own words.
    await editor.keyboard.press('Escape');
    await editor.keyboard.press('s');
    await editor.getByRole('textbox', { name: 'Text sticker words' }).fill('SHIP IT');
    await editor.mouse.click(cx + 100, cy - 70);
    await expect.poll(async () => (await layers()).some((t) => /SHIP IT/.test(t))).toBe(true);
    await editor.getByRole('textbox', { name: 'Text sticker words' }).fill('Ask Sam');
    await expect.poll(async () => (await layers()).some((t) => /Ask Sam/.test(t))).toBe(true);

    // Markers: apply the chosen shape to all.
    await editor.keyboard.press('Escape');
    await editor.keyboard.press('Escape');
    await editor.keyboard.press('n');
    await editor.mouse.click(cx - 140, cy - 80);
    await editor.mouse.click(cx - 100, cy - 80);
    await editor.keyboard.press('Escape');
    await editor.getByRole('radio', { name: 'heart' }).click();
    await editor.getByRole('button', { name: 'Apply to all markers' }).click();
    await editor.getByRole('tab', { name: /History/ }).click();
    await expect(editor.getByRole('button', { name: /Apply marker shape to all/ })).toBeVisible();
    await editor.getByRole('tab', { name: /Properties/ }).click();

    // With the highlighter active, a click selects an object and its handles resize it (no Select tool needed).
    await editor.keyboard.press('Escape');
    await editor.keyboard.press('r');
    await editor.mouse.move(cx + 60, cy + 95);
    await editor.mouse.down();
    await editor.mouse.move(cx + 160, cy + 150, { steps: 5 });
    await editor.mouse.up();
    await editor.keyboard.press('Escape');
    const before = (await layers()).length;
    await editor.keyboard.press('g');
    await editor.mouse.click(cx + 110, cy + 95);
    await expect(editor.getByRole('toolbar', { name: 'Selected object' })).toBeVisible();
    await editor.mouse.move(cx + 160, cy + 150);
    await editor.mouse.down();
    await editor.mouse.move(cx + 200, cy + 180, { steps: 5 });
    await editor.mouse.up();
    expect((await layers()).length).toBe(before);
    await editor.getByRole('tab', { name: /History/ }).click();
    await expect(editor.getByRole('button', { name: /Resize rectangle/ })).toBeVisible();
  });

  test('styles arrows, adds callouts, stickers, watermark and browser frame, and edits past changes', async ({ context, extensionId, extPage }) => {
    const editor = await context.newPage();
    await editor.setViewportSize({ width: 1500, height: 900 });
    await editor.goto(`chrome-extension://${extensionId}/editor.html?import=1`);
    const png = Buffer.from(await makePng(editor));
    await editor.locator('input[type="file"]').setInputFiles({ name: 'deco.png', mimeType: 'image/png', buffer: png });
    const canvas = editor.getByRole('img', { name: 'Screenshot canvas' });
    await expect(canvas).toBeVisible();
    const box = (await canvas.boundingBox())!;
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    const drag = async (x1: number, y1: number, x2: number, y2: number) => {
      await editor.mouse.move(x1, y1);
      await editor.mouse.down();
      await editor.mouse.move(x2, y2, { steps: 6 });
      await editor.mouse.up();
    };

    // S-curve arrow (two bend points) via a preset, then three bends.
    await editor.keyboard.press('a');
    await drag(cx - 80, cy + 40, cx + 60, cy - 30);
    // New lines default to 14 px.
    await panelTab(editor, 'Line', 'Customize');
    await expect(editor.getByRole('slider', { name: 'Thickness' })).toHaveValue('14');
    await panelTab(editor, 'Line', 'Styles');
    const styles = editor.getByRole('listbox', { name: 'Line and arrow styles' });
    await styles.getByRole('option', { name: 'S-curve' }).click();
    // The chosen style is highlighted.
    await expect(styles.getByRole('option', { name: 'S-curve' })).toHaveAttribute('aria-selected', 'true');
    await panelTab(editor, 'Line', 'Customize');
    await expect(editor.getByRole('radiogroup', { name: 'Curve points' }).getByRole('radio', { name: '2' })).toHaveAttribute('aria-checked', 'true');
    await editor.getByRole('radiogroup', { name: 'Curve points' }).getByRole('radio', { name: '6' }).click();
    await expect(editor.getByRole('radiogroup', { name: 'Curve points' }).getByRole('radio', { name: '6' })).toHaveAttribute('aria-checked', 'true');
    await panelTab(editor, 'Line', 'Styles');
    await expect(styles.getByRole('option', { name: 'S-curve' })).toHaveAttribute('aria-selected', 'false');

    // Callout with text.
    await editor.keyboard.press('Escape');
    await editor.keyboard.press('k');
    await drag(cx - 60, cy - 70, cx + 40, cy - 30);
    const text = editor.getByRole('textbox', { name: 'Annotation text' });
    await text.fill('Look here');
    await text.press('Control+Enter');
    // A HUD-style design with its own title, pointing with a leader line.
    await editor.getByRole('listbox', { name: 'Callout designs' }).getByRole('option', { name: 'Tag' }).click();
    await expect(editor.getByRole('listbox', { name: 'Callout designs' }).getByRole('option', { name: 'Tag' })).toHaveAttribute('aria-selected', 'true');
    await panelTab(editor, 'Callout', 'Advanced');
    await expect(editor.getByRole('radiogroup', { name: 'Pointer' }).getByRole('radio', { name: 'Leader line' })).toHaveAttribute('aria-checked', 'true');
    await panelTab(editor, 'Callout', 'Text');
    await editor.getByRole('textbox', { name: 'Callout title' }).fill('Step 1');
    await editor.getByRole('slider', { name: 'Title size' }).fill('40');
    await expect(editor.getByRole('slider', { name: 'Title size' })).toHaveValue('40');
    // Rotate it from the keyboard (15° per press).
    await editor.getByRole('tab', { name: /Layers/ }).click();
    await editor.locator('li', { hasText: 'Callout “Look here”' }).click();
    await editor.keyboard.press('.');
    await editor.keyboard.press('.');
    await expect(editor.getByRole('textbox', { name: 'Rotation angle' })).toHaveValue('30');
    await editor.keyboard.press('Escape');

    // Sticker.
    await editor.keyboard.press('s');
    await editor.getByRole('tab', { name: 'Status words' }).click();
    await editor.getByRole('option', { name: 'NEW' }).click();
    await editor.mouse.click(cx + 70, cy + 40);

    // Watermark + browser frame.
    await editor.keyboard.press('w');
    await editor.getByRole('switch', { name: 'Watermark' }).click();
    await editor.getByRole('textbox', { name: 'Watermark text' }).fill('© Pixora test');
    await editor.keyboard.press('Escape');
    await editor.getByRole('button', { name: 'Border & browser frame' }).click();
    // The border goes around the padded frame, so it is enabled once the background is on.
    await expect(editor.getByRole('switch', { name: 'Border', exact: true })).toBeDisabled();
    await editor.getByRole('switch', { name: 'Background & padding' }).click();
    await expect(editor.getByRole('slider', { name: 'Padding' })).toBeVisible();
    await editor.getByRole('switch', { name: 'Border', exact: true }).click();
    await expect(editor.getByRole('slider', { name: 'Border width' })).toBeVisible();
    // No horizontal scrolling in the side panel.
    expect(await editor.getByRole('complementary', { name: 'Properties' }).evaluate((el) => [...el.querySelectorAll('*')].every((n) => (n as HTMLElement).scrollWidth <= (n as HTMLElement).clientWidth + 1 || getComputedStyle(n).overflowX === 'hidden' || getComputedStyle(n).overflowX === 'visible'))).toBe(true);
    await panelTab(editor, 'Frame', 'Window');
    await editor.getByRole('switch', { name: 'Browser window' }).click();
    await editor.getByRole('radio', { name: 'Chrome mac' }).click();
    await expect(editor.getByRole('radio', { name: 'Chrome mac' })).toHaveAttribute('aria-checked', 'true');
    await editor.getByRole('textbox', { name: 'Browser URL' }).fill('https://glint.example/page');

    // Layers: remove the earlier arrow without undoing the later changes.
    await editor.getByRole('tab', { name: /Layers/ }).click();
    const layers = editor.locator('li', { hasText: /arrow/i });
    await expect(layers).toHaveCount(1);
    await layers.getByRole('button', { name: 'Remove' }).click();
    await expect(editor.locator('li', { hasText: /arrow/i })).toHaveCount(0);
    await expect(editor.locator('li', { hasText: 'Callout “Look here”' })).toBeVisible();
    await expect(editor.locator('li', { hasText: 'Watermark' })).toBeVisible();

    // History lists labelled steps and can jump back.
    await editor.getByRole('tab', { name: /History/ }).click();
    await expect(editor.getByRole('button', { name: /Add sticker NEW/ })).toBeVisible();
    await expect(editor.getByRole('button', { name: /Remove curved arrow/ })).toBeVisible();

    // Export includes the frame (bigger than the 320×200 image).
    const download = editor.waitForEvent('download');
    await editor.getByRole('button', { name: 'Download', exact: true }).last().click();
    const bytes = readFileSync((await (await download).path())!);
    const w = bytes.readUInt32BE(16);
    const h = bytes.readUInt32BE(20);
    expect(w).toBeGreaterThan(320);
    expect(h).toBeGreaterThan(200);
    await expect.poll(async () => (await readCaptures(extPage))[0]?.edited).toBe(true);
  });

  test('builds a resizable collage from several images and opens it in the editor', async ({ context, extensionId, extPage }) => {
    const page = await context.newPage();
    await page.setViewportSize({ width: 1400, height: 860 });
    await page.goto(`chrome-extension://${extensionId}/editor.html?collage=1`);
    await expect(page.getByRole('heading', { name: 'Create a collage' })).toBeVisible();
    const png = Buffer.from(await makePng(page));
    await page.locator('input[type="file"][multiple]').first().setInputFiles(
      Array.from({ length: 6 }, (_, i) => ({ name: `${i}.png`, mimeType: 'image/png', buffer: png })),
    );
    const preview = page.getByRole('img', { name: 'Collage preview' });
    await expect(preview).toBeVisible();

    // Six images switch to a grid automatically; the column count is adjustable.
    await expect(page.getByRole('slider', { name: 'Columns' })).toBeVisible();
    await page.getByRole('switch', { name: 'Split lines' }).click();
    await page.getByRole('radio', { name: 'Dashed' }).click();
    await page.getByRole('button', { name: 'Stacked' }).click();
    const out = page.getByText(/Output: \d+ × \d+ px/);
    await expect(out).toBeVisible();
    const ratio = async () => { const [, w, h] = (await out.innerText()).match(/(\d+) × (\d+)/)!.map(Number); return h! / w!; };
    const tall = await ratio();
    await page.getByRole('button', { name: 'Side by side' }).click();
    await expect.poll(ratio).toBeLessThan(tall); // vertical vs horizontal layouts
    // Fixed export sizes up to 8K.
    await page.getByRole('tablist', { name: 'Collage settings' }).getByRole('tab', { name: 'Canvas' }).click();
    await page.getByRole('button', { name: 'Export size' }).click();
    await page.getByRole('menuitemradio', { name: /8K UHD/ }).click();
    await expect(page.getByText(/Output: 7680 × \d+ px/)).toBeVisible();

    // Drag the first divider to resize cells, select an image and zoom it.
    const b = (await preview.boundingBox())!;
    await page.mouse.move(b.x + b.width / 3, b.y + b.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 5 });
    await page.mouse.up();
    await page.mouse.click(b.x + b.width * 0.97, b.y + b.height / 2);
    await expect(page.getByText('Image 6')).toBeVisible();
    await page.getByRole('radio', { name: 'Show whole image' }).click();

    await page.getByRole('button', { name: 'Edit collage' }).click();
    await expect(page).toHaveURL(/editor\.html\?id=/);
    await expect(page.getByRole('img', { name: 'Screenshot canvas' })).toBeVisible();
    const [rec] = await readCaptures(extPage);
    expect(rec).toMatchObject({ kind: 'screenshot', width: 7680 });
    expect(String(rec!.name)).toMatch(/^Pixora Collage /);
  });

  test('selects earlier annotations with any tool, edits text in the panel and uses transparent colours', async ({ context, extensionId }) => {
    const editor = await context.newPage();
    await editor.setViewportSize({ width: 1500, height: 900 });
    await editor.goto(`chrome-extension://${extensionId}/editor.html?import=1`);
    const png = Buffer.from(await makePng(editor));
    await editor.locator('input[type="file"]').setInputFiles({ name: 'sel.png', mimeType: 'image/png', buffer: png });
    const canvas = editor.getByRole('img', { name: 'Screenshot canvas' });
    const b = (await canvas.boundingBox())!;
    const cx = b.x + b.width / 2;
    const cy = b.y + b.height / 2;

    // A rectangle, then switch to the pen and click the rectangle: it becomes selected (no dot drawn).
    await editor.keyboard.press('r');
    await editor.mouse.move(cx - 80, cy - 40);
    await editor.mouse.down();
    await editor.mouse.move(cx + 80, cy + 40, { steps: 5 });
    await editor.mouse.up();
    await editor.keyboard.press('Escape');
    await editor.keyboard.press('p');
    await editor.mouse.click(cx - 80, cy);
    await expect(editor.getByText('Shapes · selected')).toBeVisible();

    // Transparent stroke colour.
    await panelTab(editor, 'Shapes', 'Style');
    await editor.getByRole('slider', { name: 'Stroke colour opacity' }).fill('40');
    await expect(editor.getByText('40%').first()).toBeVisible();

    // Text: add, then pick it up with another tool and change it from the panel.
    await editor.keyboard.press('t');
    await editor.mouse.click(cx - 100, cy + 80);
    await editor.getByRole('textbox', { name: 'Annotation text' }).fill('First');
    await editor.getByRole('textbox', { name: 'Annotation text' }).press('Control+Enter');
    await editor.keyboard.press('r');
    await editor.mouse.click(cx - 90, cy + 90);
    await expect(editor.getByText('Text · selected')).toBeVisible();
    await editor.getByRole('textbox', { name: 'Edit text' }).fill('Changed later');
    await editor.getByRole('tab', { name: /Layers/ }).click();
    await expect(editor.locator('li', { hasText: 'Text “Changed later”' })).toBeVisible();

    // Shift + highlighter draws a straight highlight.
    await editor.getByRole('tab', { name: /Properties/ }).click();
    await editor.keyboard.press('g');
    await editor.keyboard.down('Shift');
    await editor.mouse.move(b.x + 20, b.y + 20);
    await editor.mouse.down();
    await editor.mouse.move(b.x + 120, b.y + 26, { steps: 8 });
    await editor.mouse.move(b.x + 200, b.y + 31, { steps: 8 });
    await editor.mouse.up();
    await editor.keyboard.up('Shift');
    await editor.getByRole('tab', { name: /History/ }).click();
    await expect(editor.getByRole('button', { name: /Add highlight/ })).toBeVisible();
  });

  test('types a zoom level, shows shortcuts, styles text with header and padding, and sizes the eraser', async ({ context, extensionId }) => {
    const editor = await context.newPage();
    await editor.setViewportSize({ width: 1500, height: 900 });
    await editor.goto(`chrome-extension://${extensionId}/editor.html?import=1`);
    const png = Buffer.from(await makePng(editor));
    await editor.locator('input[type="file"]').setInputFiles({ name: 'text.png', mimeType: 'image/png', buffer: png });
    const canvas = editor.getByRole('img', { name: 'Screenshot canvas' });
    const b = (await canvas.boundingBox())!;

    // Zoom by typing a value.
    const zoom = editor.getByRole('textbox', { name: 'Zoom level' });
    await zoom.click();
    await zoom.fill('50');
    await zoom.press('Enter');
    await expect(zoom).toHaveValue('50%');

    // Shortcut list.
    await editor.locator('body').press('?');
    await expect(editor.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible();
    await editor.keyboard.press('Escape');

    // Pen and highlighter defaults; one opacity control (in the colour).
    await editor.keyboard.press('p');
    await panelTab(editor, 'Pen', 'Style');
    await expect(editor.getByRole('slider', { name: 'Thickness' })).toHaveValue('14');
    await expect(editor.getByRole('slider', { name: 'Opacity', exact: true })).toHaveCount(0);
    await editor.keyboard.press('g');
    await panelTab(editor, 'Highlighter', 'Style');
    await expect(editor.getByRole('slider', { name: 'Thickness' })).toHaveValue('35');
    await expect(editor.getByRole('slider', { name: 'Colour opacity' })).toHaveValue('60');
    // Opacity 0 keeps the colour and its slider.
    await editor.getByRole('slider', { name: 'Colour opacity' }).fill('0');
    await expect(editor.getByRole('slider', { name: 'Colour opacity' })).toBeVisible();
    await editor.getByRole('slider', { name: 'Colour opacity' }).fill('60');

    // Text with a title, underline and its own padding per side.
    await editor.keyboard.press('t');
    await editor.mouse.click(b.x + 60, b.y + 80);
    await editor.getByRole('textbox', { name: 'Annotation text' }).fill('Body text');
    await editor.getByRole('textbox', { name: 'Annotation text' }).press('Control+Enter');
    await expect(editor.getByText('Text · selected')).toBeVisible();
    await editor.getByRole('button', { name: 'Underline', exact: true }).click();
    await expect(editor.getByRole('button', { name: 'Underline', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await editor.getByRole('tablist', { name: 'Text settings' }).getByRole('tab', { name: 'Advanced' }).click();
    await editor.getByRole('switch', { name: 'Header' }).click();
    await editor.getByRole('textbox', { name: 'Header text', exact: true }).fill('Release notes');
    await editor.getByRole('tablist', { name: 'Text settings' }).getByRole('tab', { name: 'Design' }).click();
    await editor.getByRole('switch', { name: 'Text border' }).click();
    await editor.getByRole('button', { name: 'Set each side separately' }).click();
    await editor.getByRole('slider', { name: 'Left' }).fill('40');
    await expect(editor.getByRole('slider', { name: 'Left' })).toHaveValue('40');
    await editor.getByRole('tab', { name: /Layers/ }).click();
    await expect(editor.locator('li', { hasText: 'Text “Body text”' })).toBeVisible();

    // Eraser size.
    await editor.getByRole('tab', { name: /Properties/ }).click();
    await editor.keyboard.press('e');
    await editor.getByRole('slider', { name: 'Eraser size' }).fill('80');
    await expect(editor.getByRole('slider', { name: 'Eraser size' })).toHaveValue('80');

    // Settings are kept: a new editor tab starts with the eraser size and pen width the user chose.
    await editor.keyboard.press('p');
    await editor.getByRole('slider', { name: 'Thickness' }).fill('22');
    await editor.waitForTimeout(600);
    const again = await context.newPage();
    await again.setViewportSize({ width: 1500, height: 900 });
    await again.goto(`chrome-extension://${extensionId}/editor.html?import=1`);
    await again.locator('input[type="file"]').setInputFiles({ name: 'again.png', mimeType: 'image/png', buffer: png });
    await expect(again.getByRole('img', { name: 'Screenshot canvas' })).toBeVisible();
    await again.keyboard.press('p');
    await panelTab(again, 'Pen', 'Style');
    await expect(again.getByRole('slider', { name: 'Thickness' })).toHaveValue('22');
    await again.keyboard.press('e');
    await expect(again.getByRole('slider', { name: 'Eraser size' })).toHaveValue('80');
  });

  test('solid mask tool and text section backgrounds', async ({ context, extensionId }) => {
    const editor = await context.newPage();
    await editor.setViewportSize({ width: 1500, height: 900 });
    await editor.goto(`chrome-extension://${extensionId}/editor.html?import=1`);
    const png = Buffer.from(await makePng(editor));
    await editor.locator('input[type="file"]').setInputFiles({ name: 'mask.png', mimeType: 'image/png', buffer: png });
    const canvas = editor.getByRole('img', { name: 'Screenshot canvas' });
    const b = (await canvas.boundingBox())!;
    await editor.keyboard.press('m');
    await expect(editor.getByText('Solid mask', { exact: true })).toBeVisible();
    await editor.mouse.move(b.x + b.width / 2 - 60, b.y + b.height / 2 - 30);
    await editor.mouse.down();
    await editor.mouse.move(b.x + b.width / 2 + 60, b.y + b.height / 2 + 30, { steps: 5 });
    await editor.mouse.up();
    await expect(editor.getByText('Solid mask · selected')).toBeVisible();
    await editor.getByRole('tab', { name: /Layers/ }).click();
    await expect(editor.getByRole('complementary', { name: 'Properties' }).locator('li', { hasText: 'Mask' })).toBeVisible();
    await editor.getByRole('tab', { name: /Properties/ }).click();

    // Text with a header that has its own background and padding.
    await editor.keyboard.press('t');
    await editor.mouse.click(b.x + 40, b.y + 40);
    await editor.getByRole('textbox', { name: 'Annotation text' }).fill('Body');
    await editor.getByRole('textbox', { name: 'Annotation text' }).press('Control+Enter');
    const textTabs = editor.getByRole('tablist', { name: 'Text settings' });
    await textTabs.getByRole('tab', { name: 'Advanced' }).click();
    await editor.getByRole('switch', { name: 'Header' }).click();
    await textTabs.getByRole('tab', { name: 'Design' }).click();
    await editor.getByRole('radiogroup', { name: 'Edit style for' }).getByRole('radio', { name: 'Title' }).click();
    await editor.getByRole('radiogroup', { name: 'Header section background' }).getByRole('radio', { name: '#4F8DF7' }).click();
    await expect(editor.getByRole('slider', { name: 'Header section padding' })).toBeVisible();
    await editor.getByRole('radiogroup', { name: 'Edit style for' }).getByRole('radio', { name: 'Body' }).click();
    await editor.getByRole('radiogroup', { name: 'Section background', exact: true }).getByRole('radio', { name: '#FFD84D' }).click();
    await expect(editor.getByRole('slider', { name: 'Section padding', exact: true })).toBeVisible();
  });
});
