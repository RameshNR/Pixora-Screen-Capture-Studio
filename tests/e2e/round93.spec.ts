import { expect, test } from './fixtures';
import type { Locator, Page } from '@playwright/test';

const radius = (l: Locator) => l.evaluate((el) => { const s = getComputedStyle(el); return [s.borderTopLeftRadius, s.borderTopRightRadius]; });
const width = async (l: Locator) => (await l.boundingBox())!.width;

test('popup tabs: the selected tab is rounded only on its inner top corner', async ({ context, extensionId }) => {
  const popup = await context.newPage();
  await popup.setViewportSize({ width: 380, height: 600 });
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  const shot = popup.getByRole('tab', { name: 'Screenshot' });
  const rec = popup.getByRole('tab', { name: 'Record' });
  await shot.click();
  expect(await radius(shot)).toEqual(['0px', '14px']);
  await rec.click();
  expect(await radius(rec)).toEqual(['14px', '0px']);
  await popup.close();
});

test('Settings › Mouse cursor between clicks keeps one width for Off, Halo, Cursor and Both', async ({ context, extensionId }) => {
  const page = await context.newPage();
  await page.setViewportSize({ width: 1500, height: 1000 });
  await page.goto(`chrome-extension://${extensionId}/options.html#recording`);
  const group = page.getByRole('radiogroup', { name: 'Mouse cursor between clicks' });
  await group.scrollIntoViewIfNeeded();
  const widths: number[] = [];
  for (const name of ['Off', 'Halo', 'Cursor', 'Both']) {
    await group.getByRole('radio', { name, exact: true }).click();
    widths.push(Math.round(await width(group)));
  }
  expect(new Set(widths).size).toBe(1);
  expect(widths[0]).toBeLessThanOrEqual(576);
  await page.close();
});

/** The camera card in Settings, or null without camera access. */
async function cameraCard(page: Page): Promise<Locator | null> {
  await page.setViewportSize({ width: 1500, height: 1000 });
  const cam = page.getByRole('region', { name: 'Camera settings' });
  return (await cam.waitFor({ state: 'visible', timeout: 8000 }).then(() => true, () => false)) ? cam : null;
}

test('Settings › Camera: the card keeps its width for every background; the bubble sits the same distance from the left and bottom, and can be dragged', async ({ context, extensionId }) => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html#recording`);
  const cam = await cameraCard(page);
  test.skip(!cam, 'No camera access in this browser');
  const card = cam!;
  const bg = card.getByRole('radiogroup', { name: 'Camera background' });
  const widths: number[] = [];
  for (const name of ['None', 'Blur', 'Remove', 'Colour']) {
    await bg.getByRole('radio', { name, exact: true }).click();
    widths.push(Math.round(await width(card)));
  }
  expect(new Set(widths).size).toBe(1);
  await bg.getByRole('radio', { name: 'None', exact: true }).click();

  const stage = card.getByLabel('Camera preview', { exact: true });
  const bubble = stage.locator('div[title="Drag to place the camera"]');
  // Bottom-left: the same gap on the left and below.
  await card.getByRole('radio', { name: /^Position 0%, 100%/ }).click();
  await expect.poll(async () => {
    const s = (await stage.boundingBox())!;
    const b = (await bubble.boundingBox())!;
    return Math.abs((b.x - s.x) - (s.y + s.height - (b.y + b.height)));
  }).toBeLessThan(2);

  // Drag it to the top-right corner and past it: it stays inside, at the same small margin.
  await stage.scrollIntoViewIfNeeded();
  const b = (await bubble.boundingBox())!;
  const s = (await stage.boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(s.x + s.width + 40, s.y - 40, { steps: 8 });
  await page.mouse.up();
  await expect(card.getByRole('radio', { name: /^Position 100%, 0%/ })).toHaveAttribute('aria-checked', 'true');
  await stage.scrollIntoViewIfNeeded();
  const s2 = (await stage.boundingBox())!;
  const a = (await bubble.boundingBox())!;
  expect(Math.abs((s2.x + s2.width - (a.x + a.width)) - (a.y - s2.y))).toBeLessThan(2);
  // Dragged into the middle: no corner is picked, and it stays where it was put.
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(s2.x + s2.width * 0.4, s2.y + s2.height * 0.55, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => {
    const m = (await bubble.boundingBox())!;
    return Math.round(((m.x + m.width / 2 - s2.x) / s2.width) * 100);
  }).toBe(40);
  await expect(card.getByRole('radio', { name: /^Position 100%, 0%/ })).toHaveAttribute('aria-checked', 'false');
  await page.close();
});
