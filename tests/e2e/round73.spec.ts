import { expect, test } from './fixtures';

const OUT = process.env.SHOT_DIR;

/** Every cursor design in the picker, group by group. */
async function allDesigns(page: import('@playwright/test').Page): Promise<string[]> {
  const tabs = page.getByRole('tablist', { name: 'Cursor design groups' }).getByRole('tab');
  const names: string[] = [];
  for (let i = 0; i < (await tabs.count()); i++) {
    await tabs.nth(i).click();
    names.push(...(await page.getByRole('radiogroup', { name: 'Cursor design' }).getByRole('radio').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label') ?? ''))));
  }
  return names.sort();
}

test('click highlights offer the same quick looks, designs and effects as the editor, as pictures', async ({ context, extensionId }) => {
  test.setTimeout(120_000);
  const settings = await context.newPage();
  await settings.setViewportSize({ width: 1400, height: 1000 });
  await settings.goto(`chrome-extension://${extensionId}/options.html#recording`);
  const toggle = settings.getByRole('switch', { name: 'Highlight clicks' });
  if ((await toggle.getAttribute('aria-checked')) !== 'true') await toggle.click();

  // Effects are pictures with names; a quick look sets the cursor and its effect in one click.
  const effects = settings.getByRole('radiogroup', { name: 'Click effect' });
  await expect(effects.getByRole('radio')).toHaveCount(10);
  await expect(effects.locator('canvas')).toHaveCount(10);
  await effects.getByRole('radio', { name: 'Burst', exact: true }).click();
  await expect(effects.getByRole('radio', { name: 'Burst', exact: true })).toHaveAttribute('aria-checked', 'true');
  await settings.getByRole('listbox', { name: 'Cursor quick looks' }).getByRole('option', { name: 'Purple target' }).click();
  await expect(settings.getByRole('switch', { name: 'Show the cursor with each click' })).toHaveAttribute('aria-checked', 'true');
  // The chosen look is highlighted, and the cursor's colours can be changed.
  await expect(settings.getByRole('option', { name: 'Purple target' })).toHaveAttribute('aria-selected', 'true');
  await expect(settings.getByRole('option', { name: 'Red target' })).toHaveAttribute('aria-selected', 'false');
  await expect(settings.getByText('Cursor colour', { exact: true })).toBeVisible();
  await expect(settings.getByText('Outline colour', { exact: true })).toBeVisible();
  // The preview keeps its size whatever the effect size.
  const preview = settings.getByRole('img', { name: /Click effect preview/ });
  const before = (await preview.boundingBox())!;
  const sizeSlider = settings.getByRole('slider', { name: 'Effect size' });
  await sizeSlider.focus();
  for (let i = 0; i < 60; i++) await sizeSlider.press('ArrowRight');
  await settings.waitForTimeout(300);
  const after = (await preview.boundingBox())!;
  expect(Math.round(after.height)).toBe(Math.round(before.height));
  expect(Math.round(after.width)).toBe(Math.round(before.width));
  for (let i = 0; i < 100; i++) await sizeSlider.press('ArrowLeft');
  await settings.waitForTimeout(300);
  expect(Math.round((await preview.boundingBox())!.height)).toBe(Math.round(before.height));
  // Try it on the settings page: a click there plays the effect.
  const pad = settings.getByRole('button', { name: /Try the click effect/ });
  await pad.click({ button: 'right' });
  await expect(pad.locator('xpath=ancestor::section[1]').locator('canvas')).toHaveCount(2);
  const fromSettings = await allDesigns(settings);
  if (OUT) await settings.screenshot({ path: `${OUT}/shot74.png`, fullPage: true });

  // The image editor's Cursor tool: the same designs.
  const editor = await context.newPage();
  await editor.setViewportSize({ width: 1500, height: 950 });
  await editor.goto(`chrome-extension://${extensionId}/editor.html?import=1`);
  const png = await editor.evaluate(async () => {
    const c = new OffscreenCanvas(320, 200);
    c.getContext('2d')!.fillRect(0, 0, 320, 200);
    return Array.from(new Uint8Array(await (await c.convertToBlob({ type: 'image/png' })).arrayBuffer()));
  });
  await editor.locator('input[type="file"]').setInputFiles({ name: 'a.png', mimeType: 'image/png', buffer: Buffer.from(png) });
  await expect(editor.getByRole('img', { name: 'Screenshot canvas' })).toBeVisible();
  await editor.keyboard.press('u');
  const fromEditor = await allDesigns(editor);
  expect(fromSettings.length).toBeGreaterThan(30);
  expect(fromSettings).toEqual(fromEditor);
});
