import { readFileSync } from 'node:fs';
import { DEFAULT_SETTINGS } from '../../src/shared/constants/defaults';
import { expect, send, tabIdFor, test, waitForPage } from './fixtures';

async function flowState(extPage: import('@playwright/test').Page): Promise<{ status: string; items: number; steps: number; flowId: string | null }> {
  return send(extPage, { target: 'background', type: 'flow/get-state' });
}

async function readFlow(extPage: import('@playwright/test').Page, id: string): Promise<{ items: Array<{ id: string; description: string; auto: boolean }>; steps: Array<{ action: string; title: string; value?: string; masked?: boolean; itemId?: string }> }> {
  return extPage.evaluate(
    (fid) =>
      new Promise((resolve, reject) => {
        const req = indexedDB.open('glint-capture');
        req.onsuccess = () => {
          const get = req.result.transaction('flows').objectStore('flows').get(fid);
          get.onsuccess = () => resolve(get.result);
          get.onerror = () => reject(get.error);
        };
      }),
    id,
  );
}

test.describe('Flow Capture', () => {
  test('captures images on demand, records grouped steps with masked secrets, and opens the Flow Editor', async ({ context, extPage, baseUrl }) => {
    const page = await context.newPage();
    await page.setViewportSize({ width: 1200, height: 800 });
    await page.goto(`${baseUrl}/form`);
    const tabId = await tabIdFor(extPage, `${baseUrl}/form`);

    await send(extPage, { target: 'background', type: 'flow/start', tabId, config: { ...DEFAULT_SETTINGS.flow, autoSteps: true, minShotIntervalMs: 500, area: null } });
    const bar = await waitForPage(context, (u) => u.includes('/flowbar.html'));
    await expect(bar.getByRole('toolbar', { name: 'Flow capture' })).toBeVisible();
    const { flowId } = await flowState(extPage);

    // Manual capture of the visible part.
    await page.bringToFront();
    await send(extPage, { target: 'background', type: 'flow/capture', mode: 'visible' });
    await expect.poll(async () => (await flowState(extPage)).items).toBeGreaterThanOrEqual(1);

    // Interactions: typing is one step per field; the password is never stored.
    await page.locator('#email').click();
    await page.keyboard.type('jane@example.com', { delay: 15 });
    await page.locator('#password').click();
    await page.keyboard.type('hunter2-secret', { delay: 15 });
    await page.locator('#country').selectOption('Japan');
    await page.locator('#terms').check();
    await page.locator('#go').click();
    await expect(page).toHaveURL(/\/form\/done$/);
    await expect.poll(async () => (await readFlow(extPage, flowId!)).steps.map((s) => s.action), { timeout: 15_000 }).toEqual(
      expect.arrayContaining(['type', 'select', 'check', 'click', 'submit', 'navigate']),
    );
    const flow = await readFlow(extPage, flowId!);
    const typing = flow.steps.filter((s) => s.action === 'type');
    expect(typing).toHaveLength(2);
    expect(typing[0]!.value).toBe('jane@example.com');
    expect(typing[1]).toMatchObject({ masked: true, value: '••••••' });
    expect(JSON.stringify(flow)).not.toContain('hunter2');
    // Auto steps added screenshots.
    expect(flow.items.filter((i) => i.auto).length).toBeGreaterThan(0);

    // Full-page capture into the flow, then undo it.
    await page.bringToFront();
    const before = (await flowState(extPage)).items;
    await send(extPage, { target: 'background', type: 'flow/capture', mode: 'full' });
    await expect.poll(async () => (await flowState(extPage)).items).toBe(before + 1);
    await bar.getByRole('button', { name: /Undo last capture/ }).click();
    await expect.poll(async () => (await flowState(extPage)).items).toBe(before);

    // Pause blocks captures; resume allows them again.
    await bar.getByRole('button', { name: /^Pause/ }).click();
    await expect.poll(async () => (await flowState(extPage)).status).toBe('paused');
    await expect(bar.getByRole('button', { name: 'Capture', exact: true })).toBeDisabled();
    await bar.getByRole('button', { name: /^Resume/ }).click();
    await expect.poll(async () => (await flowState(extPage)).status).toBe('recording');

    // Finish opens the Flow Editor.
    await bar.getByRole('button', { name: 'Finish' }).click();
    const editor = await waitForPage(context, (u) => u.includes('/flow.html?id='));
    await editor.setViewportSize({ width: 1500, height: 950 });
    await expect(editor.getByRole('img', { name: 'Screenshot canvas' })).toBeVisible({ timeout: 15_000 });
    const count = (await readFlow(extPage, flowId!)).items.length;
    await expect(editor.getByRole('button', { name: /^Open image/ })).toHaveCount(count);
    expect((await flowState(extPage)).status).toBe('idle');

    // Steps tab lists the workflow with the masked password.
    await editor.getByRole('tab', { name: /Steps/ }).click();
    await expect(editor.getByText('Value hidden (sensitive field)')).toBeVisible();
    await editor.getByRole('tab', { name: /Images/ }).click();

    // Edit image 1, switch to image 2 and back: its own undo history is kept.
    const canvas = editor.getByRole('img', { name: 'Screenshot canvas' });
    const b = (await canvas.boundingBox())!;
    await editor.keyboard.press('r');
    await editor.mouse.move(b.x + 60, b.y + 60);
    await editor.mouse.down();
    await editor.mouse.move(b.x + 220, b.y + 160, { steps: 5 });
    await editor.mouse.up();
    await editor.getByRole('button', { name: 'Open image 2' }).click();
    await expect(editor.getByText('Image 2', { exact: true })).toBeVisible();
    await editor.getByRole('button', { name: 'Open image 1' }).click();
    await expect(editor.getByText('Image 1', { exact: true })).toBeVisible();
    await expect(editor.getByRole('toolbar', { name: 'Editor tools' }).getByRole('button', { name: 'Undo', exact: true })).toBeEnabled();
    await expect(editor.locator('li', { hasText: 'edited' }).first()).toBeVisible();

    // Rename an image and reorder.
    await editor.getByRole('textbox', { name: 'Description of image 2' }).fill('Filled form');
    await editor.getByRole('button', { name: 'Move up' }).nth(1).click();
    await expect.poll(async () => (await readFlow(extPage, flowId!)).items[0]?.description).toBe('Filled form');

    // Export: ZIP and PDF.
    await editor.getByRole('button', { name: 'Export…' }).click();
    const dialog = editor.getByRole('dialog', { name: 'Export flow' });
    let download = editor.waitForEvent('download');
    await dialog.getByRole('button', { name: /^Export \d+ image/ }).click();
    const zip = readFileSync((await (await download).path())!);
    expect(zip.readUInt32LE(0)).toBe(0x04034b50);
    expect(zip.toString('latin1')).toContain('metadata.csv');
    expect(zip.toString('latin1')).toContain('01 - Filled form.png');

    await editor.getByRole('button', { name: 'Export…' }).click();
    await dialog.getByRole('radio', { name: 'PDF' }).click();
    download = editor.waitForEvent('download');
    await dialog.getByRole('button', { name: /^Export \d+ image/ }).click();
    const pdf = readFileSync((await (await download).path())!);
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.toString('latin1')).toContain(`/Count ${count}`);

    await editor.getByRole('button', { name: 'Export…' }).click();
    await dialog.getByRole('radio', { name: 'Word' }).click();
    download = editor.waitForEvent('download');
    await dialog.getByRole('button', { name: /^Export \d+ image/ }).click();
    const word = await download;
    expect(word.suggestedFilename()).toMatch(/\.docx$/);
    const docx = readFileSync((await word.path())!);
    expect(docx.readUInt32LE(0)).toBe(0x04034b50);
    const text = docx.toString('utf8');
    expect(text).toContain('word/document.xml');
    expect(text).toContain('Filled form');
    expect(text).toContain(`word/media/image${count}.png`);
    if (process.env.GLINT_SAVE_DOCX) await word.saveAs(process.env.GLINT_SAVE_DOCX);
  });

  test('cancelling asks first and deletes the session', async ({ context, extPage, baseUrl }) => {
    const page = await context.newPage();
    await page.goto(`${baseUrl}/short`);
    const tabId = await tabIdFor(extPage, `${baseUrl}/short`);
    await send(extPage, { target: 'background', type: 'flow/start', tabId, config: { ...DEFAULT_SETTINGS.flow, area: null } });
    const bar = await waitForPage(context, (u) => u.includes('/flowbar.html'));
    await page.bringToFront();
    await send(extPage, { target: 'background', type: 'flow/capture', mode: 'visible' });
    await expect.poll(async () => (await flowState(extPage)).items).toBe(1);
    const { flowId } = await flowState(extPage);
    await bar.getByRole('button', { name: 'Cancel flow' }).click();
    await expect(bar.getByRole('alertdialog', { name: 'Cancel this flow?' })).toBeVisible();
    await bar.getByRole('button', { name: 'Keep' }).click();
    expect((await flowState(extPage)).status).toBe('recording');
    await bar.getByRole('button', { name: 'Cancel flow' }).click();
    await bar.getByRole('button', { name: 'Delete flow' }).click();
    await expect.poll(async () => (await flowState(extPage)).status).toBe('idle');
    expect(await readFlow(extPage, flowId!)).toBeUndefined();
  });

  test('refuses duplicate images, shows the selected image, restores deleted images and hides the panel', async ({ context, extPage, baseUrl }) => {
    const page = await context.newPage();
    await page.setViewportSize({ width: 1100, height: 700 });
    await page.goto(`${baseUrl}/short`);
    const tabId = await tabIdFor(extPage, `${baseUrl}/short`);
    await send(extPage, { target: 'background', type: 'flow/start', tabId, config: { ...DEFAULT_SETTINGS.flow, area: null } });
    const bar = await waitForPage(context, (u) => u.includes('/flowbar.html'));
    const { flowId } = await flowState(extPage);

    await page.bringToFront();
    await send(extPage, { target: 'background', type: 'flow/capture', mode: 'visible' });
    await expect.poll(async () => (await flowState(extPage)).items).toBe(1);
    // Same screen again: not added.
    await send(extPage, { target: 'background', type: 'flow/capture', mode: 'visible' });
    expect((await flowState(extPage)).items).toBe(1);
    await expect(bar.getByText(/Same as image 1/)).toBeVisible();
    // A changed screen is added.
    await page.evaluate(() => { document.body.style.background = '#1d2433'; document.body.style.color = '#fff'; });
    await page.bringToFront();
    await send(extPage, { target: 'background', type: 'flow/capture', mode: 'visible' });
    await expect.poll(async () => (await flowState(extPage)).items).toBe(2);

    await bar.getByRole('button', { name: 'Finish' }).click();
    const editor = await waitForPage(context, (u) => u.includes('/flow.html?id='));
    await editor.setViewportSize({ width: 1400, height: 900 });
    const canvas = editor.getByRole('img', { name: 'Screenshot canvas' });
    await expect(canvas).toBeVisible({ timeout: 15_000 });
    await editor.waitForTimeout(400);
    const first = await canvas.screenshot();
    // Selecting image 2 shows image 2 (not the first image).
    await editor.getByRole('button', { name: 'Open image 2' }).click();
    await expect(editor.getByText('Image 2', { exact: true })).toBeVisible();
    await editor.waitForTimeout(400);
    const second = await canvas.screenshot();
    expect(second.equals(first)).toBe(false);
    await editor.getByRole('button', { name: 'Previous image' }).click();
    await expect(editor.getByText('Image 1', { exact: true })).toBeVisible();
    await editor.waitForTimeout(400);
    expect((await canvas.screenshot()).equals(second)).toBe(false);

    // Delete image 2, then restore it from Deleted.
    await editor.getByRole('button', { name: 'Delete image' }).nth(1).click();
    await editor.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
    await expect(editor.getByRole('button', { name: /^Open image/ })).toHaveCount(1);
    await expect.poll(async () => ((await readFlow(extPage, flowId!)) as unknown as { deleted?: unknown[] }).deleted?.length ?? 0).toBe(1);
    await editor.getByRole('tab', { name: 'Deleted (1)' }).click();
    await editor.getByRole('button', { name: /^Restore image/ }).click();
    await editor.getByRole('tab', { name: /Images/ }).click();
    await expect(editor.getByRole('button', { name: /^Open image/ })).toHaveCount(2);
    expect((await readFlow(extPage, flowId!)).items).toHaveLength(2);

    // Hide and show the image panel.
    await editor.getByRole('button', { name: 'Hide image panel' }).click();
    await expect(editor.getByRole('button', { name: /^Open image/ })).toHaveCount(0);
    await expect(canvas).toBeVisible();
    await editor.getByRole('button', { name: 'Show image panel' }).click();
    await expect(editor.getByRole('button', { name: /^Open image/ })).toHaveCount(2);
  });

  test('dropdowns are captured fully open, and only chosen interactions take screenshots', async ({ context, extPage, baseUrl }) => {
    const page = await context.newPage();
    await page.setViewportSize({ width: 900, height: 600 });
    await page.goto(`${baseUrl}/menu`);
    const tabId = await tabIdFor(extPage, `${baseUrl}/menu`);
    const captureOn = { ...DEFAULT_SETTINGS.flow.captureOn, checkbox: false };
    await send(extPage, { target: 'background', type: 'flow/start', tabId, config: { ...DEFAULT_SETTINGS.flow, autoSteps: true, shotTiming: 'after-click', captureOn, minShotIntervalMs: 500, area: null } });
    await waitForPage(context, (u) => u.includes('/flowbar.html'));
    const { flowId } = await flowState(extPage);
    await page.bringToFront();
    await page.locator('#open').click();
    await expect.poll(async () => (await readFlow(extPage, flowId!)).items.length, { timeout: 15_000 }).toBe(1);
    const flow = await readFlow(extPage, flowId!);
    expect(flow.steps[0]).toMatchObject({ action: 'open', title: 'Open the “Choose plan” dropdown' });
    // The list is fully open in the picture (4 rows × 40 px), not squashed mid-animation.
    const innerWidth = await page.evaluate(() => window.innerWidth);
    const measured = await extPage.evaluate(async ([id, cssWidth]) => {
      const blob = await new Promise<Blob>((resolve) => {
        const req = indexedDB.open('glint-capture');
        req.onsuccess = () => {
          const g = req.result.transaction('blobs').objectStore('blobs').get(id as string);
          g.onsuccess = () => resolve(g.result as Blob);
        };
      });
      const bmp = await createImageBitmap(blob);
      const c = new OffscreenCanvas(bmp.width, bmp.height);
      const ctx = c.getContext('2d')!;
      ctx.drawImage(bmp, 0, 0);
      const k = bmp.width / (cssWidth as number);
      const x = Math.round(200 * k);
      const col = ctx.getImageData(x, 0, 1, bmp.height).data;
      let top = -1;
      let bottom = -1;
      let yellow = 0;
      for (let y = Math.round(80 * k); y < bmp.height; y++) {
        const [r, g, b] = [col[y * 4]!, col[y * 4 + 1]!, col[y * 4 + 2]!];
        const isList = (b > 240 && r < 240) || (r > 230 && g > 190 && b < 80);
        if (r > 230 && g > 190 && b < 80) yellow++;
        if (isList) {
          if (top < 0) top = y;
          bottom = y;
        }
      }
      return { css: (bottom - top + 1) / k, yellowCss: yellow / k };
    }, [flow.items[0]!.id, innerWidth] as const);
    expect(measured.css).toBeGreaterThan(150);
    expect(measured.yellowCss).toBeGreaterThan(36);

    // Checkboxes are turned off: the step is listed, but no screenshot is added.
    await page.waitForTimeout(700);
    await page.locator('#agree').check();
    await expect.poll(async () => (await readFlow(extPage, flowId!)).steps.map((s) => s.action)).toContain('check');
    await page.waitForTimeout(1200);
    expect((await readFlow(extPage, flowId!)).items).toHaveLength(1);
  });

  test('a scroll picture still waiting for the page is taken when the user clicks (not after the click)', async ({ context, extPage, baseUrl }) => {
    const page = await context.newPage();
    await page.setViewportSize({ width: 900, height: 600 });
    await page.goto(`${baseUrl}/short`);
    // A long page that keeps the network busy (like real sites), and a button that turns the page red
    // (like a site's loading fog after "View Details").
    await page.setContent(`<body style="margin:0;font:20px sans-serif;background:#f8fafc">
      <div id="fog" style="position:fixed;inset:0;pointer-events:none"></div>
      <button id="go" style="position:fixed;right:30px;bottom:30px;padding:14px 22px" onclick="document.getElementById('fog').style.background='rgb(220,0,0)'">View Details</button>
      ${Array.from({ length: 40 }, (_, i) => `<p style="height:120px;margin:0;border-bottom:1px solid #ccc">Row ${i + 1}</p>`).join('')}
      <script>setInterval(() => fetch('/short?' + Math.random()).catch(() => 0), 150);</script></body>`);
    const tabId = await tabIdFor(extPage, `${baseUrl}/*`);
    await send(extPage, { target: 'background', type: 'flow/start', tabId, config: { ...DEFAULT_SETTINGS.flow, autoSteps: true, shotTiming: 'on-click', shotDelayMs: -1, minShotIntervalMs: 0, area: null } });
    await waitForPage(context, (u) => u.includes('/flowbar.html'));
    const { flowId } = await flowState(extPage);
    await page.bringToFront();
    await page.waitForTimeout(800);
    await page.mouse.move(400, 300);
    await page.mouse.wheel(0, 1500);
    // The scroll step is reported 500 ms after the scroll stops; its picture then waits for the page.
    await page.waitForTimeout(800);
    // A real click: the button is held for a moment (the site reacts on release).
    const go = (await page.locator('#go').boundingBox())!;
    await page.mouse.move(go.x + go.width / 2, go.y + go.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(250);
    await page.mouse.up();
    await expect.poll(async () => (await readFlow(extPage, flowId!)).steps.find((st) => st.action === 'scroll')?.itemId ?? null, { timeout: 20_000 }).not.toBeNull();
    const flow = await readFlow(extPage, flowId!);
    const scrollItem = flow.steps.find((st) => st.action === 'scroll')!.itemId!;
    const centre = await extPage.evaluate(async (id) => {
      const db: IDBDatabase = await new Promise((r) => { const q = indexedDB.open('glint-capture'); q.onsuccess = () => r(q.result); });
      const blob: Blob = await new Promise((r) => { const q = db.transaction('blobs').objectStore('blobs').get(id); q.onsuccess = () => r(q.result); });
      const bmp = await createImageBitmap(blob);
      const c = new OffscreenCanvas(bmp.width, bmp.height);
      const x = c.getContext('2d')!;
      x.drawImage(bmp, 0, 0);
      return Array.from(x.getImageData(Math.floor(bmp.width / 3), Math.floor(bmp.height / 2), 1, 1).data.slice(0, 3));
    }, scrollItem);
    // The scroll picture shows the scrolled page, not the red page that only exists after the click.
    expect(centre[0]! > 200 && centre[1]! < 60).toBe(false);
  });

  test('quick clicks with On click pictures: every click step gets its own picture', async ({ context, extPage, baseUrl }) => {
    const page = await context.newPage();
    await page.setViewportSize({ width: 900, height: 600 });
    await page.goto(`${baseUrl}/short`);
    // Three buttons; each click repaints the page in its own colour.
    await page.setContent(`<body style="margin:0;font:20px sans-serif"><div id="bg" style="position:fixed;inset:0"></div>
      ${['#e11d48', '#16a34a', '#2563eb'].map((c, i) => `<button id="b${i}" style="position:relative;margin:40px 20px;padding:14px 22px" onclick="document.getElementById('bg').style.background='${c}'">Step ${i + 1}</button>`).join('')}</body>`);
    const tabId = await tabIdFor(extPage, `${baseUrl}/*`);
    await send(extPage, { target: 'background', type: 'flow/start', tabId, config: { ...DEFAULT_SETTINGS.flow, autoSteps: true, shotTiming: 'on-click', minShotIntervalMs: 0, area: null } });
    await waitForPage(context, (u) => u.includes('/flowbar.html'));
    const { flowId } = await flowState(extPage);
    await page.bringToFront();
    await page.waitForTimeout(800);
    for (const i of [0, 1, 2]) {
      await page.locator(`#b${i}`).click();
      await page.waitForTimeout(250);
    }
    await expect.poll(async () => (await readFlow(extPage, flowId!)).steps.filter((st) => st.action === 'click').length, { timeout: 20_000 }).toBe(3);
    await expect.poll(async () => (await readFlow(extPage, flowId!)).steps.filter((st) => st.action === 'click' && st.itemId).length, { timeout: 20_000 }).toBe(3);
    const flow = await readFlow(extPage, flowId!);
    const ids = flow.steps.filter((st) => st.action === 'click').map((st) => st.itemId);
    expect(new Set(ids).size).toBe(3);
  });

  test('capture on hover: the click step shows the control before it was clicked', async ({ context, extPage, baseUrl }) => {
    const page = await context.newPage();
    await page.setViewportSize({ width: 900, height: 600 });
    await page.goto(`${baseUrl}/menu`);
    const tabId = await tabIdFor(extPage, `${baseUrl}/menu`);
    await send(extPage, { target: 'background', type: 'flow/start', tabId, config: { ...DEFAULT_SETTINGS.flow, autoSteps: true, shotTiming: 'on-hover', minShotIntervalMs: 500, area: null } });
    await waitForPage(context, (u) => u.includes('/flowbar.html'));
    const { flowId } = await flowState(extPage);
    await page.bringToFront();
    await page.locator('#open').hover();
    await page.waitForTimeout(1200);
    await page.locator('#open').click();
    await expect.poll(async () => (await readFlow(extPage, flowId!)).items.length, { timeout: 15_000 }).toBe(1);
    const flow = await readFlow(extPage, flowId!);
    expect(flow.steps[0]).toMatchObject({ action: 'open', itemId: flow.items[0]!.id });
    await expect(page.locator('#list')).toHaveClass(/open/);
    // The picture was taken before the click: the dropdown list is not open in it.
    const innerWidth = await page.evaluate(() => window.innerWidth);
    const listPx = await extPage.evaluate(async ([id, cssWidth]) => {
      const blob = await new Promise<Blob>((resolve) => {
        const req = indexedDB.open('glint-capture');
        req.onsuccess = () => {
          const g = req.result.transaction('blobs').objectStore('blobs').get(id as string);
          g.onsuccess = () => resolve(g.result as Blob);
        };
      });
      const bmp = await createImageBitmap(blob);
      const c = new OffscreenCanvas(bmp.width, bmp.height);
      const ctx = c.getContext('2d')!;
      ctx.drawImage(bmp, 0, 0);
      const k = bmp.width / (cssWidth as number);
      const col = ctx.getImageData(Math.round(200 * k), 0, 1, bmp.height).data;
      let n = 0;
      for (let y = Math.round(80 * k); y < bmp.height; y++) {
        const [r, g, b] = [col[y * 4]!, col[y * 4 + 1]!, col[y * 4 + 2]!];
        if ((b > 240 && r < 240) || (r > 230 && g > 190 && b < 80)) n++;
      }
      return n / k;
    }, [flow.items[0]!.id, innerWidth] as const);
    expect(listPx).toBeLessThan(40);
  });

  test('frame Apply / Apply to all, original screenshot zoom, and drag to reorder', async ({ context, extPage, baseUrl }) => {
    const page = await context.newPage();
    await page.setViewportSize({ width: 1100, height: 700 });
    await page.goto(`${baseUrl}/short`);
    const tabId = await tabIdFor(extPage, `${baseUrl}/short`);
    await send(extPage, { target: 'background', type: 'flow/start', tabId, config: { ...DEFAULT_SETTINGS.flow, area: null } });
    const bar = await waitForPage(context, (u) => u.includes('/flowbar.html'));
    const { flowId } = await flowState(extPage);
    for (const [n, c] of [[1, '#fdfdfd'], [2, '#1d2433'], [3, '#2e9e5b']] as const) {
      await page.evaluate((col) => { document.body.style.background = col; }, c);
      await page.bringToFront();
      await page.waitForTimeout(600);
      await send(extPage, { target: 'background', type: 'flow/capture', mode: 'visible' });
      await expect.poll(async () => (await flowState(extPage)).items).toBe(n);
    }
    await bar.getByRole('button', { name: 'Finish' }).click();
    const editor = await waitForPage(context, (u) => u.includes('/flow.html?id='));
    await editor.setViewportSize({ width: 1400, height: 900 });
    await expect(editor.getByRole('img', { name: 'Screenshot canvas' })).toBeVisible({ timeout: 15_000 });

    // Restore reacts to an edit at once (no need to switch images first).
    const restoreBtn = editor.getByRole('group', { name: 'Restore' }).getByRole('button', { name: 'Restore', exact: true });
    await expect(restoreBtn).toBeDisabled();
    const cbox = (await editor.getByRole('img', { name: 'Screenshot canvas' }).boundingBox())!;
    await editor.keyboard.press('r');
    await editor.mouse.move(cbox.x + cbox.width / 2 - 60, cbox.y + cbox.height / 2 - 40);
    await editor.mouse.down();
    await editor.mouse.move(cbox.x + cbox.width / 2 + 60, cbox.y + cbox.height / 2 + 40, { steps: 5 });
    await editor.mouse.up();
    await expect(restoreBtn).toBeEnabled();
    await restoreBtn.click();
    await expect(restoreBtn).toBeDisabled();
    await editor.keyboard.press('v');

    // Right click: a menu on the canvas, none on other parts of the page; any click closes it.
    await editor.mouse.click(cbox.x + cbox.width / 2, cbox.y + cbox.height / 2, { button: 'right' });
    await expect(editor.getByRole('menu', { name: 'Actions' })).toBeVisible();
    await editor.mouse.click(cbox.x + 20, cbox.y + 20);
    await expect(editor.getByRole('menu', { name: 'Actions' })).toHaveCount(0);
    await editor.getByText('Select all').click({ button: 'right' });
    await expect(editor.getByRole('menu', { name: 'Actions' })).toHaveCount(0);

    // Copy and Download sit in the image bar; the editor has no second export panel or logo.
    await expect(editor.getByRole('button', { name: 'Download', exact: true })).toHaveCount(1);
    await expect(editor.getByRole('button', { name: 'Copy', exact: true })).toHaveCount(1);
    await expect(editor.getByText('Export', { exact: true })).toHaveCount(0);
    // Border & frame: switch on a border and give it to every image.
    await editor.getByRole('button', { name: /Border & browser frame/ }).click();
    await editor.getByRole('switch', { name: 'Background & padding' }).click();
    await editor.getByRole('button', { name: 'Apply to all (3)' }).click();
    await expect(editor.getByText('Frame applied to 3 images')).toBeVisible({ timeout: 15_000 });
    await expect(editor.locator('li', { hasText: 'edited' })).toHaveCount(3);
    const sizes = (await readFlow(extPage, flowId!)).items.map((i) => i.id);
    expect(sizes).toHaveLength(3);
    // Applying again does not add a second border (framed from the original).
    await editor.getByRole('button', { name: 'Apply to all (3)' }).click();
    await expect(editor.getByText('Frame applied to 3 images').last()).toBeVisible({ timeout: 15_000 });
    const dims = await extPage.evaluate((ids) => Promise.all(ids.map((id) => new Promise<number>((resolve) => {
      const req = indexedDB.open('glint-capture');
      req.onsuccess = () => {
        const g = req.result.transaction('captures').objectStore('captures').get(id);
        g.onsuccess = () => resolve((g.result as { width: number }).width);
      };
    }))), sizes);
    expect(new Set(dims).size).toBe(1);

    // Original screenshot: zoom in and out.
    await editor.getByRole('button', { name: 'View original' }).nth(1).click();
    const dialog = editor.getByRole('dialog');
    const level = dialog.getByRole('toolbar', { name: 'Zoom' });
    const before = await level.innerText();
    await dialog.getByRole('button', { name: 'Zoom in' }).click();
    await dialog.getByRole('button', { name: 'Zoom in' }).click();
    await expect.poll(async () => level.innerText()).not.toBe(before);
    await dialog.getByRole('button', { name: /Fit/ }).click();
    // Edited image: compare it with the original.
    const compare = dialog.getByRole('radiogroup', { name: 'Compare' });
    const layout = dialog.getByRole('radiogroup', { name: 'Layout' });
    await layout.getByRole('radio', { name: 'Side by side' }).click();
    await expect(dialog.getByRole('img', { name: 'Screenshot: Edited' })).toBeVisible();
    await expect(dialog.getByRole('img', { name: 'Screenshot: Original' })).toBeVisible();
    await expect(layout.getByRole('radio', { name: 'Slider' })).toBeDisabled(); // the border changed the size
    await expect(dialog.getByRole('checkbox', { name: 'Highlight Changes' })).toBeDisabled(); // different sizes
    await compare.getByRole('radio', { name: 'Original' }).click();
    await expect(dialog.getByRole('img', { name: 'Screenshot: Edited' })).toHaveCount(0);
    await editor.keyboard.press('Escape');

    // Restore the originals of all images at once.
    await editor.getByRole('button', { name: 'More restore options' }).click();
    await editor.getByRole('menuitem', { name: /Restore all \(3\)/ }).click();
    await editor.getByRole('dialog').getByRole('button', { name: 'Restore originals' }).click();
    await expect(editor.getByText('3 originals restored')).toBeVisible();
    await expect(editor.locator('li', { hasText: 'edited' })).toHaveCount(0);
    // The image open in the editor is restored too, and stays restored.
    await editor.waitForTimeout(1000);
    await expect(restoreBtn).toBeDisabled();
    await expect(editor.locator('li', { hasText: 'edited' })).toHaveCount(0);

    // The image list follows unsaved edits live, and Restore all clears them at once.
    const thumb1 = editor.getByRole('button', { name: 'Open image 1' }).locator('img');
    const storedThumb = await thumb1.getAttribute('src');
    await editor.keyboard.press('r');
    await editor.mouse.move(cbox.x + cbox.width / 2 - 50, cbox.y + cbox.height / 2 - 30);
    await editor.mouse.down();
    await editor.mouse.move(cbox.x + cbox.width / 2 + 50, cbox.y + cbox.height / 2 + 30, { steps: 5 });
    await editor.mouse.up();
    await editor.keyboard.press('v');
    await expect.poll(() => thumb1.getAttribute('src')).toMatch(/^blob:/);
    await expect(editor.locator('li', { hasText: 'edited' })).toHaveCount(1);
    await editor.getByRole('button', { name: 'More restore options' }).click();
    await editor.getByRole('menuitem', { name: /Restore all \(1\)/ }).click();
    await editor.getByRole('dialog').getByRole('button', { name: 'Restore originals' }).click();
    await expect(editor.locator('li', { hasText: 'edited' })).toHaveCount(0);
    await expect.poll(() => thumb1.getAttribute('src')).toBe(storedThumb);
    await editor.waitForTimeout(800);
    await expect(restoreBtn).toBeDisabled();

    // Right click on an image card: Pixora's menu for that image.
    await editor.locator('li', { has: editor.getByRole('button', { name: 'Open image 2' }) }).click({ button: 'right', position: { x: 60, y: 12 } });
    const menu = editor.getByRole('menu', { name: 'Actions' });
    await expect(menu.getByRole('menuitem', { name: 'Delete image' })).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: 'Duplicate' })).toBeVisible();
    await editor.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    // A right click on Restore (or its arrow) opens its own dropdown.
    await editor.getByRole('group', { name: 'Restore' }).click({ button: 'right', position: { x: 30, y: 10 } });
    await expect(editor.getByRole('menuitem', { name: /Restore all/ })).toBeVisible();
    await editor.keyboard.press('Escape');
    await editor.getByRole('button', { name: 'More restore options' }).click({ button: 'right' });
    await expect(editor.getByRole('menuitem', { name: /Restore all/ })).toBeVisible();
    await editor.keyboard.press('Escape');

    // A design selected on the image: Delete removes the design, not the ticked images.
    await editor.getByRole('checkbox', { name: 'Select image 3' }).check();
    await editor.keyboard.press('r');
    await editor.mouse.move(cbox.x + cbox.width / 2 - 40, cbox.y + cbox.height / 2 - 30);
    await editor.mouse.down();
    await editor.mouse.move(cbox.x + cbox.width / 2 + 40, cbox.y + cbox.height / 2 + 30, { steps: 5 });
    await editor.mouse.up();
    await expect(editor.getByText(/· selected/)).toBeVisible();
    await editor.keyboard.press('Delete');
    await expect(editor.getByRole('dialog')).toHaveCount(0);
    await expect(editor.getByText(/· selected/)).toHaveCount(0);
    expect((await readFlow(extPage, flowId!)).items).toHaveLength(3);
    await editor.keyboard.press('v');
    await editor.getByRole('checkbox', { name: 'Select image 3' }).uncheck();

    // Tick image 3 and press Delete: it asks, then the image moves to Deleted.
    await editor.getByRole('checkbox', { name: 'Select image 3' }).check();
    await editor.keyboard.press('Delete');
    await expect(editor.getByRole('dialog').getByText('Delete this image?')).toBeVisible();
    await editor.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
    await editor.getByRole('checkbox', { name: 'Select image 3' }).uncheck();

    // Drag image 3 above image 1.
    const firstId = (await readFlow(extPage, flowId!)).items[0]!.id;
    const thirdId = (await readFlow(extPage, flowId!)).items[2]!.id;
    await editor.locator('li', { has: editor.getByRole('button', { name: 'Open image 3' }) }).dragTo(
      editor.locator('li', { has: editor.getByRole('button', { name: 'Open image 1' }) }),
      { targetPosition: { x: 40, y: 10 } },
    );
    await expect.poll(async () => (await readFlow(extPage, flowId!)).items.map((i) => i.id)[0]).toBe(thirdId);
    expect((await readFlow(extPage, flowId!)).items[1]!.id).toBe(firstId);

    // "Don't ask me again" in the delete question: the next delete happens straight away.
    await editor.getByRole('checkbox', { name: 'Select image 3' }).check();
    await editor.keyboard.press('Delete');
    const ask = editor.getByRole('dialog');
    await ask.getByText("Don't ask me again").click();
    await ask.getByRole('button', { name: 'Delete' }).click();
    await expect.poll(async () => (await readFlow(extPage, flowId!)).items.length).toBe(2);
    await editor.getByRole('checkbox', { name: 'Select image 2' }).check();
    await editor.keyboard.press('Delete');
    await expect.poll(async () => (await readFlow(extPage, flowId!)).items.length).toBe(1);
    await expect(editor.getByRole('dialog')).toHaveCount(0);
  });

  test('waits for page loaders before an automatic screenshot; collage of flow images', async ({ context, extPage, baseUrl }) => {
    const page = await context.newPage();
    await page.setViewportSize({ width: 900, height: 600 });
    await page.goto(`${baseUrl}/loader`);
    const tabId = await tabIdFor(extPage, `${baseUrl}/loader`);
    await send(extPage, { target: 'background', type: 'flow/start', tabId, config: { ...DEFAULT_SETTINGS.flow, autoSteps: true, shotTiming: 'after-click', minShotIntervalMs: 500, area: null } });
    const bar = await waitForPage(context, (u) => u.includes('/flowbar.html'));
    const { flowId } = await flowState(extPage);
    await page.bringToFront();
    await page.locator('#go').click();
    await expect.poll(async () => (await readFlow(extPage, flowId!)).items.length, { timeout: 20_000 }).toBe(1);
    // The picture shows the loaded content (green), not the grey loading screen.
    const innerWidth = await page.evaluate(() => window.innerWidth);
    const rgb = await extPage.evaluate(async ([id, cssWidth]) => {
      const blob = await new Promise<Blob>((resolve) => {
        const req = indexedDB.open('glint-capture');
        req.onsuccess = () => {
          const g = req.result.transaction('blobs').objectStore('blobs').get(id as string);
          g.onsuccess = () => resolve(g.result as Blob);
        };
      });
      const bmp = await createImageBitmap(blob);
      const c = new OffscreenCanvas(bmp.width, bmp.height);
      const ctx = c.getContext('2d')!;
      ctx.drawImage(bmp, 0, 0);
      const k = bmp.width / (cssWidth as number);
      return Array.from(ctx.getImageData(Math.round(450 * k), Math.round(400 * k), 1, 1).data.slice(0, 3));
    }, [(await readFlow(extPage, flowId!)).items[0]!.id, innerWidth] as const);
    expect(rgb[1]).toBeGreaterThan(130);
    expect(rgb[0]).toBeLessThan(90);

    // A second, manual capture, then a collage of both images in the Flow Editor.
    await page.evaluate(() => { document.getElementById('content')!.style.background = '#3657d6'; });
    await page.bringToFront();
    await send(extPage, { target: 'background', type: 'flow/capture', mode: 'visible' });
    await expect.poll(async () => (await flowState(extPage)).items).toBe(2);
    await bar.getByRole('button', { name: 'Finish' }).click();
    const editor = await waitForPage(context, (u) => u.includes('/flow.html?id='));
    await editor.setViewportSize({ width: 1400, height: 900 });
    await expect(editor.getByRole('img', { name: 'Screenshot canvas' })).toBeVisible({ timeout: 15_000 });
    await editor.getByRole('banner').getByRole('button', { name: 'Collage Flows', exact: true }).click();
    await expect(editor.getByRole('img', { name: 'Collage preview' })).toBeVisible();
    await editor.getByRole('button', { name: 'Add to flow' }).click();
    await expect(editor.getByRole('button', { name: /^Open image/ })).toHaveCount(3);
    await expect.poll(async () => (await readFlow(extPage, flowId!)).items.at(-1)?.description).toBe('Collage');
  });
});
