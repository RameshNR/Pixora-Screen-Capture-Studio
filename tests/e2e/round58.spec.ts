import type { Page } from '@playwright/test';
import { expect, send, tabIdFor, test, waitForPage } from './fixtures';

/** Records the label of every button that shows the spinner (aria-busy) on this page. */
const watchBusy = (p: Page) =>
  p.evaluate(() => {
    const seen = new Set<string>();
    (window as unknown as { busySeen: Set<string> }).busySeen = seen;
    const note = () => document.querySelectorAll('button[aria-busy="true"]').forEach((b) => seen.add((b.getAttribute('aria-label') || b.textContent || '').trim()));
    new MutationObserver(note).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['aria-busy'], childList: true });
  });
const busySeen = (p: Page) => p.evaluate(() => [...(window as unknown as { busySeen: Set<string> }).busySeen]);

async function openEditorWithTallShot(context: import('@playwright/test').BrowserContext, extPage: Page, baseUrl: string) {
  const page = await context.newPage();
  await page.goto(`${baseUrl}/short`);
  await page.setViewportSize({ width: 1600, height: 900 });
  await page.evaluate(() => {
    document.body.innerHTML = Array.from({ length: 16 }, (_, i) => `<div style="height:500px;background:hsl(${i * 37},60%,80%);font:40px sans-serif;padding:20px">Section ${i + 1} ${'text '.repeat(60)}</div>`).join('');
  });
  await page.bringToFront();
  const tabId = await tabIdFor(extPage, `${baseUrl}/*`);
  const ed = waitForPage(context, (u) => u.includes('/editor.html?id='), 120_000);
  void send(extPage, { target: 'background', type: 'screenshot/capture', mode: 'full', tabId });
  const editor = await ed;
  await expect(editor.getByRole('img', { name: 'Screenshot canvas' })).toBeVisible({ timeout: 60_000 });
  return editor;
}

test('editor Export popup: the clicked button spins (only it), and the popup closes once the file is saved', async ({ context, extPage, baseUrl }) => {
  test.setTimeout(200_000);
  const editor = await openEditorWithTallShot(context, extPage, baseUrl);
  // An edit, so the export really re-encodes (takes a moment).
  await editor.keyboard.press('r');
  const c = (await editor.getByRole('img', { name: 'Screenshot canvas' }).boundingBox())!;
  await editor.mouse.move(c.x + c.width / 2 - 15, c.y + c.height / 2 - 15);
  await editor.mouse.down();
  await editor.mouse.move(c.x + c.width / 2 + 15, c.y + c.height / 2 + 15, { steps: 4 });
  await editor.mouse.up();

  await editor.getByRole('button', { name: /^Export/ }).first().click();
  const dialog = editor.getByRole('dialog', { name: 'Export' });
  await expect(dialog).toBeVisible();
  await watchBusy(editor);
  const dl = editor.waitForEvent('download', { timeout: 60_000 });
  await dialog.getByRole('button', { name: 'Download', exact: true }).click();
  await dl;
  await expect(dialog).toBeHidden({ timeout: 15_000 });
  const busy = await busySeen(editor);
  expect(busy.some((l) => /^Download$/.test(l))).toBe(true);
  expect(busy.filter((l) => /Copy|Save as/.test(l))).toEqual([]);
});

test('collage Export popup: Download spins (not "Edit collage"), and the popup closes after the download', async ({ context, extPage, baseUrl }) => {
  test.setTimeout(200_000);
  const editor = await openEditorWithTallShot(context, extPage, baseUrl);
  await editor.getByRole('button', { name: /^Collage/ }).first().click();
  await expect(editor.getByRole('img', { name: 'Collage preview' })).toBeVisible();
  // The collage's own Export… (the editor's toolbar is underneath the collage).
  await editor.getByRole('button', { name: 'Export…', exact: true }).last().click();
  const dialog = editor.getByRole('dialog', { name: 'Export collage' });
  await expect(dialog).toBeVisible();
  await watchBusy(editor);
  const dl = editor.waitForEvent('download', { timeout: 60_000 });
  await dialog.getByRole('button', { name: 'Download', exact: true }).click();
  await dl;
  await expect(dialog).toBeHidden({ timeout: 15_000 });
  const busy = await busySeen(editor);
  expect(busy.some((l) => /^Download$/.test(l))).toBe(true);
  expect(busy.filter((l) => /Edit collage|Add to flow/.test(l))).toEqual([]);
});
