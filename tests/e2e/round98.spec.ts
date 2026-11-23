import { expect, test } from './fixtures';

test('Filters on a 6000 × 3376 photo: names above the sliders, sliders keep up, Full screen in the bar under the picture', async ({ context, extensionId }) => {
  test.setTimeout(180_000);
  const editor = await context.newPage();
  await editor.setViewportSize({ width: 1500, height: 950 });
  await editor.goto(`chrome-extension://${extensionId}/editor.html?import=1`);
  const png = Buffer.from(await editor.evaluate(async () => {
    const c = new OffscreenCanvas(6000, 3376);
    const x = c.getContext('2d')!;
    const g = x.createLinearGradient(0, 0, 6000, 3376);
    g.addColorStop(0, '#2f7d32');
    g.addColorStop(1, '#a5c94a');
    x.fillStyle = g;
    x.fillRect(0, 0, 6000, 3376);
    x.fillStyle = '#e11d1d';
    x.beginPath();
    x.arc(3000, 1688, 700, 0, Math.PI * 2);
    x.fill();
    return Array.from(new Uint8Array(await (await c.convertToBlob({ type: 'image/jpeg', quality: 0.9 })).arrayBuffer()));
  }));
  await editor.locator('input[type="file"]').first().setInputFiles({ name: 'big.jpg', mimeType: 'image/jpeg', buffer: png });
  await expect(editor.getByRole('img', { name: 'Screenshot canvas' })).toBeVisible();
  await editor.getByRole('button', { name: /^Filters/ }).click();
  await editor.getByRole('tab', { name: 'Adjust' }).click();

  // The name is on its own line above the slider, value box and reset.
  const name = (await editor.getByText('Brightness', { exact: true }).boundingBox())!;
  const slider = editor.getByRole('slider', { name: 'Brightness', exact: true });
  const s = (await slider.boundingBox())!;
  const value = (await editor.getByRole('textbox', { name: 'Brightness value' }).boundingBox())!;
  expect(name.y + name.height).toBeLessThanOrEqual(s.y + 2);
  expect(Math.abs((value.y + value.height / 2) - (s.y + s.height / 2))).toBeLessThan(6);

  // Twenty steps with the keyboard: each one is drawn quickly (the screen shows a screen-sized picture).
  await slider.focus();
  const t = Date.now();
  for (let i = 0; i < 20; i++) await editor.keyboard.press('ArrowRight');
  await expect(editor.getByRole('textbox', { name: 'Brightness value' })).toHaveValue('+20');
  await editor.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  expect(Date.now() - t).toBeLessThan(8000);

  // The bar under the picture: Before / After, Fit, Split view and Full screen (no Pan).
  const bar = editor.getByRole('group', { name: 'View' });
  await expect(bar.getByRole('button', { name: 'Pan' })).toHaveCount(0);
  await expect(bar.getByRole('button', { name: 'Full screen' })).toBeVisible();
  await expect(bar.getByRole('button', { name: 'Fit to screen' })).toBeVisible();
  await expect(bar.getByRole('radio', { name: 'Slider' })).toBeVisible();
  await editor.close();
});

test('area bar › Remove content shows "Removing content…" over the area while it works', async ({ context, extensionId }) => {
  test.setTimeout(90_000);
  const { openStripes, drag } = await import('./redact-helpers');
  const { editor, cx, cy } = await openStripes(context, extensionId);
  // Note every time the working sign appears (a quick fill may be over before a check could see it).
  await editor.evaluate(() => {
    (window as unknown as { seen: string[] }).seen = [];
    new MutationObserver(() => {
      const el = document.querySelector('[role="status"][aria-label="Removing content…"]');
      if (el) (window as unknown as { seen: string[] }).seen.push((el as HTMLElement).style.width);
    }).observe(document.body, { subtree: true, childList: true });
  });
  await drag(editor, cx - 80, cy - 50, cx + 80, cy + 50);
  await editor.getByRole('toolbar', { name: 'Marked area' }).getByRole('button', { name: 'Remove content (fill with background)' }).click();
  await expect.poll(() => editor.evaluate(() => (window as unknown as { seen: string[] }).seen.length)).toBeGreaterThan(0);
  // It covers the marked area (about 160 px wide on screen) and goes away when done.
  const width = await editor.evaluate(() => (window as unknown as { seen: string[] }).seen[0]);
  expect(Math.abs(parseFloat(width!) - 160)).toBeLessThan(6);
  await expect(editor.locator('[role="status"][aria-label="Removing content…"]')).toHaveCount(0, { timeout: 30_000 });
  await editor.close();
});

test('Settings › Highlight mouse clicks: the "Try it" box shows the normal mouse pointer, not a plus', async ({ context, extensionId }) => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html#recording`);
  const highlight = page.getByRole('switch', { name: 'Highlight clicks', exact: true });
  if ((await highlight.getAttribute('aria-checked')) !== 'true') await highlight.click();
  const tryIt = page.getByRole('button', { name: /^Try the click effect/ });
  await expect(tryIt).toBeVisible();
  expect(await tryIt.evaluate((el) => getComputedStyle(el).cursor)).toBe('default');
  await page.close();
});
