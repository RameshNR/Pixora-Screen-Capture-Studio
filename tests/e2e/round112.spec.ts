import { expect, test } from './fixtures';
import type { Page } from '@playwright/test';
import { stripes } from './redact-helpers';

/** The picture area (the scroller around the canvas). */
const area = (p: Page) => p.getByRole('img', { name: 'Screenshot canvas' }).locator('xpath=ancestor::div[contains(@class, "workspace")][1]');

test('a fitted picture shows no scrollbars (no scrollbar on / off loop on scaled screens); zoomed in, it scrolls', async ({ context, extensionId }) => {
  const p = await context.newPage();
  await p.setViewportSize({ width: 1400, height: 860 });
  await p.goto(`chrome-extension://${extensionId}/editor.html?import=1`);
  await p.locator('input[type="file"]').first().setInputFiles({ name: 'wide.png', mimeType: 'image/png', buffer: await stripes(p) });
  await expect(p.getByRole('img', { name: 'Screenshot canvas' })).toBeVisible();
  await p.keyboard.press('Control+0');
  await expect.poll(() => area(p).evaluate((el) => getComputedStyle(el).overflow)).toBe('hidden');
  const zoom = p.getByRole('textbox', { name: 'Zoom level' });
  await zoom.fill('400');
  await zoom.press('Enter');
  await expect.poll(() => area(p).evaluate((el) => getComputedStyle(el).overflow)).toBe('auto');
  await expect.poll(() => area(p).evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
  await p.keyboard.press('Control+0');
  await expect.poll(() => area(p).evaluate((el) => getComputedStyle(el).overflow)).toBe('hidden');
  await p.close();
});

test('Flow Editor: the busy pill stays a small pill at the top (it used to fill the picture area as a dark shape)', async ({ context, extensionId }) => {
  const ed = await context.newPage();
  await ed.setViewportSize({ width: 1400, height: 860 });
  await ed.goto(`chrome-extension://${extensionId}/editor.html?import=1`);
  await ed.locator('input[type="file"]').first().setInputFiles({ name: 'a.png', mimeType: 'image/png', buffer: await stripes(ed) });
  await expect(ed.getByRole('img', { name: 'Screenshot canvas' })).toBeVisible();
  await ed.locator('input[type="file"]').last().setInputFiles({ name: 'b.png', mimeType: 'image/png', buffer: await stripes(ed) });
  await expect(ed.getByRole('button', { name: 'Open image 2' })).toBeVisible({ timeout: 20_000 });
  await ed.waitForTimeout(1200);
  const flowId = await ed.evaluate(() => new Promise<string>((ok) => {
    const r = indexedDB.open('glint-capture');
    r.onsuccess = () => {
      const q = r.result.transaction('captures').objectStore('captures').getAll();
      q.onsuccess = () => ok((q.result as { flowId?: string }[]).find((c) => c.flowId)?.flowId ?? '');
    };
  }));
  await ed.close();
  const p = await context.newPage();
  await p.setViewportSize({ width: 1400, height: 860 });
  await p.goto(`chrome-extension://${extensionId}/flow.html?id=${flowId}`);
  await expect(p.getByRole('img', { name: 'Screenshot canvas' })).toBeVisible({ timeout: 20_000 });
  // A slow add: the pill shows while the picture is stored.
  await p.locator('input[type="file"]').last().setInputFiles({ name: 'c.png', mimeType: 'image/png', buffer: await stripes(p) });
  const pill = p.getByRole('status', { name: /^Adding/ });
  await pill.waitFor({ timeout: 5000 }).catch(() => undefined);
  if (await pill.count()) {
    const box = (await pill.boundingBox())!;
    expect(box.height).toBeLessThan(60);
    expect(box.width).toBeLessThan(400);
  }
  // The rule that stretches the editor to fill its frame leaves status elements alone.
  const stretched = await p.evaluate(() => {
    const frame = document.getElementById('pixora-fs-root')!;
    const probe = document.createElement('div');
    probe.setAttribute('role', 'status');
    frame.appendChild(probe);
    const pos = getComputedStyle(probe).position;
    probe.remove();
    return pos;
  });
  expect(stretched).not.toBe('absolute');
  await p.close();
});
