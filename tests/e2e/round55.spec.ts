import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

const palette = (p: Page) => p.evaluate(() => document.documentElement.dataset.palette);
const token = (p: Page, name: string) => p.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), name);

test('Settings › General › Theme: picking a theme recolours every Pixora window, live', async ({ context, extensionId }) => {
  test.setTimeout(120_000);
  const ext = (p: string) => `chrome-extension://${extensionId}/${p}`;
  const settings = await context.newPage();
  await settings.setViewportSize({ width: 1400, height: 1000 });
  await settings.goto(ext('options.html#general'));
  const modes = settings.getByRole('radiogroup', { name: 'Theme mode' });
  await expect(modes).toBeVisible();
  // Graphite Dark is the default: Dark is chosen and only the 9 dark themes are listed.
  await expect(modes.getByRole('radio', { name: /Dark/ })).toHaveAttribute('aria-checked', 'true');
  const darkList = settings.getByRole('radiogroup', { name: 'Dark themes' });
  await expect(darkList.getByRole('radio')).toHaveCount(9);
  await expect(darkList.getByRole('radio', { name: 'Graphite Dark' })).toHaveAttribute('aria-checked', 'true');
  await expect(settings.getByRole('radiogroup', { name: 'Light themes' })).toHaveCount(0);

  // Every other window, already open.
  const pages: Page[] = [];
  for (const url of ['popup.html', 'controlbar.html', 'flowbar.html', 'progress.html?mode=countdown&s=30', 'teleprompter.html', 'options.html#history']) {
    const p = await context.newPage();
    await p.goto(ext(url));
    pages.push(p);
  }
  for (const p of pages) await expect.poll(() => palette(p)).toBe('graphite-dark');

  // Light: the light list appears (9 themes) and the light theme applies; then pick Rose Coral.
  await modes.getByRole('radio', { name: /Light/ }).click();
  const lightList = settings.getByRole('radiogroup', { name: 'Light themes' });
  await expect(lightList.getByRole('radio')).toHaveCount(9);
  await expect(settings.getByRole('radiogroup', { name: 'Dark themes' })).toHaveCount(0);
  await expect.poll(() => palette(settings)).toBe('classic-blue');
  await lightList.getByRole('radio', { name: 'Rose Coral' }).click();
  await expect(lightList.getByRole('radio', { name: 'Rose Coral' })).toHaveAttribute('aria-checked', 'true');
  for (const p of [settings, ...pages]) {
    await expect.poll(() => palette(p)).toBe('rose-coral');
    await expect(p.locator('html')).toHaveAttribute('data-theme', 'light');
  }
  expect((await token(settings, '--c-bg')).toLowerCase()).toBe('#ffffff');

  await modes.getByRole('radio', { name: /Dark/ }).click();
  await settings.getByRole('radiogroup', { name: 'Dark themes' }).getByRole('radio', { name: 'Emerald Green' }).click();
  for (const p of [settings, ...pages]) await expect.poll(() => palette(p)).toBe('emerald-green');
  await expect(settings.locator('html')).toHaveAttribute('data-theme', 'dark');
  // Bright accent: dark button labels (readable on green).
  expect((await token(settings, '--c-on-primary')).toLowerCase()).not.toBe('#ffffff');

  // A window opened later starts in the chosen theme straight away (no flash of another theme).
  const late = await context.newPage();
  await late.goto(ext('popup.html'));
  expect(await palette(late)).toBe('emerald-green');

  // Back to Light: the last light theme (Rose Coral) comes back.
  await modes.getByRole('radio', { name: /Light/ }).click();
  await expect.poll(() => palette(settings)).toBe('rose-coral');

  // System follows the computer: Classic Blue in light mode (headless Chrome reports light); no list.
  await modes.getByRole('radio', { name: /System/ }).click();
  await expect(settings.getByText(/Follows your computer/)).toBeVisible();
  await expect.poll(() => palette(settings)).toBe('classic-blue');
});
