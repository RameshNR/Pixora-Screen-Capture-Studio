import { expect, test } from './fixtures';
import type { BrowserContext, Page } from '@playwright/test';
import { drag, eraseTool, openStripes, stripes } from './redact-helpers';

async function fakeFullScreen(page: Page) {
  await page.evaluate(() => {
    let full: Element | null = null;
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => full });
    Element.prototype.requestFullscreen = function (this: Element) { full = this; document.dispatchEvent(new Event('fullscreenchange')); return Promise.resolve(); };
    document.exitFullscreen = () => { full = null; document.dispatchEvent(new Event('fullscreenchange')); return Promise.resolve(); };
  });
}

async function addImages(editor: Page, n: number) {
  const buf = await stripes(editor);
  const start = await editor.getByRole('button', { name: /^Open image \d+$/ }).count();
  for (let i = 0; i < n; i++) {
    await editor.locator('input[type="file"]').last().setInputFiles({ name: `img${i}.png`, mimeType: 'image/png', buffer: buf });
    await expect(editor.getByRole('button', { name: `Open image ${start + i + 1}` })).toBeVisible({ timeout: 15_000 });
  }
}

test('Details button on the tools row: image details in the side panel (not under every tool); a colour click copies its value', async ({ context, extensionId }) => {
  const { editor } = await openStripes(context, extensionId);
  await editor.evaluate(() => {
    (window as unknown as { copied: string[] }).copied = [];
    navigator.clipboard.writeText = async (t: string) => { (window as unknown as { copied: string[] }).copied.push(t); };
  });
  await expect(editor.getByRole('region', { name: 'Image details' })).toHaveCount(0);
  const btn = editor.getByRole('toolbar', { name: 'Editor tools' }).getByRole('button', { name: /^Image details/ });
  await btn.click();
  const info = editor.getByRole('region', { name: 'Image details' });
  await expect(info.getByRole('img', { name: /Colour histogram/ })).toBeVisible();
  const swatch = info.getByRole('group', { name: 'Main colours' }).getByRole('button').first();
  const label = (await swatch.getAttribute('aria-label'))!;
  await swatch.click();
  await expect(swatch).toContainText('Copied');
  expect(await editor.evaluate(() => (window as unknown as { copied: string[] }).copied[0])).toBe(label.replace('Copy colour ', ''));
  // Closing brings the tool settings back.
  await info.getByRole('button', { name: 'Close image details' }).click();
  await expect(info).toHaveCount(0);
  await editor.close();
});

test('bar: Original shows the original picture; full screen: details as a popup, or docked beside the picture when the setting is off', async ({ context, extensionId }) => {
  const { editor, cx, cy } = await openStripes(context, extensionId);
  const bar = editor.getByRole('group', { name: 'View' });
  await expect(bar.getByRole('button', { name: /original/i }).first()).toBeDisabled();
  await eraseTool(editor, 'Image');
  await editor.getByRole('radiogroup', { name: 'Erase to' }).getByRole('radio', { name: 'White', exact: true }).click();
  await editor.getByRole('slider', { name: 'Brush size' }).fill('300');
  await drag(editor, cx - 150, cy, cx + 150, cy);
  const orig = bar.getByRole('button', { name: 'Show the original picture' });
  await orig.click();
  await expect(bar.getByRole('button', { name: 'Show the edited picture' })).toHaveAttribute('aria-pressed', 'true');
  await bar.getByRole('button', { name: 'Show the edited picture' }).click();

  await fakeFullScreen(editor);
  await bar.getByRole('button', { name: 'Full screen' }).click();
  // Popup (default).
  await bar.getByRole('button', { name: /^Image details/ }).click();
  const details = editor.getByRole('dialog', { name: 'Image details' });
  await expect(details).toBeVisible();
  const canvasW = (await editor.getByRole('img', { name: 'Screenshot canvas' }).boundingBox())!.width;
  await details.getByRole('button', { name: 'Close image details' }).click();
  // Docked.
  await bar.getByRole('button', { name: 'View settings' }).click();
  await editor.getByRole('dialog', { name: 'View settings' }).getByRole('switch', { name: 'Details as a popup' }).click();
  await editor.keyboard.press('Escape');
  await editor.mouse.click(700, 300);
  await editor.keyboard.press('ArrowDown');
  await expect(details).toBeVisible();
  await expect.poll(async () => (await editor.getByRole('img', { name: 'Screenshot canvas' }).boundingBox())!.width).toBeLessThan(canvasW - 300);
  const d = (await details.boundingBox())!;
  expect(d.x + d.width).toBeGreaterThan(editor.viewportSize()!.width - 24);
  await editor.close();
});

test('full screen strip: drag to scroll; switching shows the arrows from the first frame (no jump)', async ({ context, extensionId }) => {
  test.setTimeout(180_000);
  const { editor } = await openStripes(context, extensionId);
  await addImages(editor, 13);
  await fakeFullScreen(editor);
  await editor.getByRole('group', { name: 'View' }).getByRole('button', { name: 'Full screen' }).click();
  const strip = editor.getByRole('group', { name: 'Open images' });
  const row = strip.getByRole('list');
  await expect(strip.getByRole('button', { name: /^Earlier images/ })).toBeVisible();
  // Drag the row: it scrolls, the open image stays.
  const current = await strip.locator('[aria-current="true"]').getAttribute('aria-label');
  const before = await row.evaluate((el) => el.scrollLeft);
  const box = (await row.boundingBox())!;
  await editor.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await editor.mouse.down();
  await editor.mouse.move(box.x + box.width / 2 + 200, box.y + box.height / 2, { steps: 8 });
  await editor.mouse.up();
  await expect.poll(() => row.evaluate((el) => el.scrollLeft)).toBeLessThan(before - 50);
  expect(await strip.locator('[aria-current="true"]').getAttribute('aria-label')).toBe(current);
  // Every strip put on the screen already has its arrows (they no longer appear a moment later).
  await editor.evaluate(() => {
    const w = window as unknown as { bare: number };
    w.bare = 0;
    new MutationObserver((list) => {
      for (const m of list) for (const n of m.addedNodes) {
        if (!(n instanceof HTMLElement)) continue;
        const s = n.matches('[aria-label="Open images"]') ? n : n.querySelector('[aria-label="Open images"]');
        if (s && !s.querySelector('[aria-label^="Earlier images"]')) w.bare++;
      }
    }).observe(document.body, { childList: true, subtree: true });
  });
  await editor.keyboard.press('ArrowLeft');
  await editor.keyboard.press('ArrowLeft');
  await expect(strip.locator('[aria-current="true"]')).not.toHaveAttribute('aria-label', current!);
  expect(await editor.evaluate(() => (window as unknown as { bare: number }).bare)).toBe(0);
  await editor.close();
});

async function openFlow(context: BrowserContext, extensionId: string): Promise<Page> {
  const { editor } = await openStripes(context, extensionId);
  await addImages(editor, 1);
  await editor.close();
  const h = await context.newPage();
  await h.goto(`chrome-extension://${extensionId}/options.html#history`);
  const [flow] = await Promise.all([context.waitForEvent('page'), h.getByRole('button', { name: /^Open Flow/ }).click()]);
  await h.close();
  await flow.setViewportSize({ width: 1500, height: 950 });
  await expect(flow.getByRole('img', { name: 'Screenshot canvas' })).toBeVisible({ timeout: 20_000 });
  return flow;
}

test('Flow Editor: no Original popup button (the bar has it); the export window: cards, no JSON, a ZIP has no JSON file', async ({ context, extensionId }) => {
  test.setTimeout(150_000);
  const flow = await openFlow(context, extensionId);
  await expect(flow.getByRole('button', { name: 'Original', exact: true })).toHaveCount(0);
  await expect(flow.getByRole('group', { name: 'View' }).getByRole('button', { name: /original/i }).first()).toBeVisible();
  await flow.getByRole('button', { name: /^Export…/ }).click();
  const dlg = flow.getByRole('dialog', { name: 'Export flow' });
  const targets = dlg.getByRole('radiogroup', { name: 'Export as' });
  await expect(targets.getByRole('radio')).toHaveCount(5);
  await expect(targets.getByRole('radio', { name: 'JSON' })).toHaveCount(0);
  await expect(dlg.getByRole('radiogroup', { name: 'Image format' }).getByRole('radio', { name: 'Original' })).toHaveAttribute('aria-checked', 'true');
  await expect(dlg.getByText(/metadata\.csv/).first()).toBeVisible();
  await expect(dlg.getByText(/metadata\.json/)).toHaveCount(0);
  // PDF: no picture format or file names; pages instead.
  await targets.getByRole('radio', { name: 'PDF' }).click();
  await expect(dlg.getByRole('radiogroup', { name: 'Image format' })).toHaveCount(0);
  await expect(dlg.getByRole('checkbox', { name: /Original file names/ })).toHaveCount(0);
  await expect(dlg.getByRole('radiogroup', { name: 'Page size' })).toBeVisible();
  await flow.close();
});
