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
  const picker = settings.getByRole('radiogroup', { name: 'Theme' });
  await expect(picker).toBeVisible();
  // 7 dark + 8 light themes, plus "Match my computer"; Midnight Purple is the default.
  await expect(picker.getByRole('radio')).toHaveCount(16);
  await expect(picker.getByRole('radio', { name: 'Midnight Purple' })).toHaveAttribute('aria-checked', 'true');

  // Every other window, already open.
  const pages: Page[] = [];
  for (const url of ['popup.html', 'controlbar.html', 'flowbar.html', 'progress.html?mode=countdown&s=30', 'teleprompter.html', 'options.html#history']) {
    const p = await context.newPage();
    await p.goto(ext(url));
    pages.push(p);
  }
  for (const p of pages) await expect.poll(() => palette(p)).toBe('midnight-purple');

  await picker.getByRole('radio', { name: 'Rose Coral' }).click();
  await expect(picker.getByRole('radio', { name: 'Rose Coral' })).toHaveAttribute('aria-checked', 'true');
  for (const p of [settings, ...pages]) {
    await expect.poll(() => palette(p)).toBe('rose-coral');
    await expect(p.locator('html')).toHaveAttribute('data-theme', 'light');
  }
  expect((await token(settings, '--c-bg')).toLowerCase()).toBe('#ffffff');

  await picker.getByRole('radio', { name: 'Emerald Green' }).click();
  for (const p of [settings, ...pages]) await expect.poll(() => palette(p)).toBe('emerald-green');
  await expect(settings.locator('html')).toHaveAttribute('data-theme', 'dark');
  // Bright accent: dark button labels (readable on green).
  expect((await token(settings, '--c-on-primary')).toLowerCase()).not.toBe('#ffffff');

  // A window opened later starts in the chosen theme straight away (no flash of another theme).
  const late = await context.newPage();
  await late.goto(ext('popup.html'));
  expect(await palette(late)).toBe('emerald-green');

  // Match my computer: Classic Blue in light mode (headless Chrome reports light).
  await picker.getByRole('radio', { name: /Match my computer/ }).click();
  await expect.poll(() => palette(settings)).toBe('classic-blue');
});
