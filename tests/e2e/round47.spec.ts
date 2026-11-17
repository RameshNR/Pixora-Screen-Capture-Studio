import { expect, test } from './fixtures';

const read = (p: import('@playwright/test').Page) =>
  p.evaluate(async () => (await chrome.storage.local.get('glint.settings'))['glint.settings'] as { screenshot: { delaySeconds: number; fullPage: { hideScrollbars: boolean } }; recording: { countdownSeconds: number } });

test('settings: grouped page with icons; Reset to defaults resets only that page, after asking', async ({ context, extensionId }) => {
  const p = await context.newPage();
  await p.setViewportSize({ width: 1600, height: 1000 });
  await p.goto(`chrome-extension://${extensionId}/options.html#screenshot`);
  await expect(p.getByRole('heading', { level: 1, name: 'Screenshot' })).toBeVisible();
  // Titled groups, each a labelled region.
  for (const g of ['Capture', 'After capturing', 'Image format & size', 'Full page', 'Browser header & frames', 'Entire screen & app window']) {
    await expect(p.getByRole('region', { name: g, exact: true })).toBeVisible();
  }
  // Change a Screenshot setting and a Recording setting.
  await p.getByRole('switch', { name: 'Hide scrollbars' }).click();
  await p.evaluate(async () => {
    const cur = (await chrome.storage.local.get('glint.settings'))['glint.settings'] as Record<string, Record<string, unknown>>;
    await chrome.storage.local.set({ 'glint.settings': { ...cur, recording: { ...cur.recording, countdownSeconds: 10 } } });
  });
  await expect.poll(async () => (await read(p)).screenshot.fullPage.hideScrollbars).toBe(false);

  // Cancel keeps everything.
  await p.getByRole('button', { name: 'Reset to defaults' }).click();
  await p.getByRole('button', { name: 'Cancel' }).click();
  expect((await read(p)).screenshot.fullPage.hideScrollbars).toBe(false);

  // Reset: Screenshot settings back to defaults, Recording untouched.
  await p.getByRole('button', { name: 'Reset to defaults' }).click();
  await p.getByRole('button', { name: 'Reset', exact: true }).click();
  await expect.poll(async () => (await read(p)).screenshot.fullPage.hideScrollbars).toBe(true);
  expect((await read(p)).recording.countdownSeconds).toBe(10);
  await expect(p.getByRole('switch', { name: 'Hide scrollbars' })).toBeChecked();
});
