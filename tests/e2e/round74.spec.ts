import { expect, test } from './fixtures';

const OUT = process.env.SHOT_DIR;

/** Two pictures of an element a moment apart differ: it is animating. */
async function animates(loc: import('@playwright/test').Locator): Promise<boolean> {
  const a = await loc.screenshot();
  await loc.page().waitForTimeout(170);
  const b = await loc.screenshot();
  return !a.equals(b);
}

test('click highlight settings: cards, animated preview, every look and motion applied, try it', async ({ context, extensionId, extPage }) => {
  test.setTimeout(120_000);
  const settings = await context.newPage();
  await settings.setViewportSize({ width: 1400, height: 1000 });
  await settings.goto(`chrome-extension://${extensionId}/options.html#recording`);
  const toggle = settings.getByRole('switch', { name: 'Highlight clicks' });
  if ((await toggle.getAttribute('aria-checked')) !== 'true') await toggle.click();

  // Cards as in the design, two columns side by side.
  for (const name of ['Click effect', 'Quick looks', 'Effect settings', 'Click colours', 'Cursor design', 'Other options']) {
    await expect(settings.getByRole('region', { name, exact: true })).toBeVisible();
  }
  const left = (await settings.getByRole('region', { name: 'Quick looks', exact: true }).boundingBox())!;
  const right = (await settings.getByRole('region', { name: 'Effect settings', exact: true }).boundingBox())!;
  if (OUT) await settings.screenshot({ path: `${OUT}/shot74a.png`, fullPage: true });
  expect(right.x).toBeGreaterThan(left.x + left.width - 1);

  // Animated looks are really different: each stores its own motion and is the one highlighted.
  const stored = () => extPage.evaluate(async () => ((await chrome.storage.local.get('glint.settings'))['glint.settings'] as { recording: { cursorEffects: Record<string, unknown> } })?.recording.cursorEffects);
  const looks = settings.getByRole('listbox', { name: 'Cursor quick looks' });
  for (const [name, trail] of [['Ghost', 'ghost'], ['Bounce', 'signal'], ['Wavy', 'wave'], ['Trail', 'trail']] as const) {
    await looks.getByRole('option', { name, exact: true }).click();
    await expect(looks.getByRole('option', { name, exact: true })).toHaveAttribute('aria-selected', 'true');
    await expect(looks.locator('[aria-selected="true"]')).toHaveCount(1);
    await expect.poll(async () => (await stored())?.clickTrail).toBe(trail);
    await expect(settings.getByRole('radiogroup', { name: 'Cursor motion' }).getByRole('radio', { checked: true })).toHaveCount(1);
  }
  // The preview plays the animation.
  const preview = settings.getByRole('img', { name: /Click effect preview/ });
  await expect.poll(() => animates(preview), { timeout: 15000 }).toBe(true);

  // Cursor size, mouse-button mark and spotlight (now available for clicks).
  await expect(settings.getByRole('slider', { name: 'Cursor size' })).toBeVisible();
  await expect(settings.getByRole('switch', { name: 'Show the mouse button' })).toBeVisible();
  await expect(settings.getByRole('radiogroup', { name: 'Click effect' }).getByRole('radio', { name: 'Spotlight' })).toBeVisible();

  // Try it: the click plays where clicked and is gone after the animation.
  await settings.getByRole('slider', { name: 'Animation duration' }).focus();
  const tryIt = settings.getByRole('button', { name: /Try the click effect/ });
  await tryIt.click();
  const card = tryIt.locator('xpath=ancestor::section[1]');
  await expect(card.locator('canvas')).toHaveCount(2);
  await expect(card.locator('canvas')).toHaveCount(1, { timeout: 5000 });
  if (OUT) await settings.getByRole('switch', { name: 'Highlight clicks' }).locator('xpath=ancestor::section[1]').screenshot({ path: `${OUT}/shot74b.png` });

  // The narrow popup width: one column.
  await settings.setViewportSize({ width: 700, height: 1000 });
  const l2 = (await settings.getByRole('region', { name: 'Quick looks', exact: true }).boundingBox())!;
  const r2 = (await settings.getByRole('region', { name: 'Effect settings', exact: true }).boundingBox())!;
  expect(r2.y).toBeGreaterThan(l2.y);
});

test('editor cursor tool: the same motion pictures and an animated click preview with duration', async ({ context, extensionId }) => {
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
  const motion = editor.getByRole('radiogroup', { name: 'Cursor motion' });
  await expect(motion.getByRole('radio')).toHaveCount(8);
  await motion.getByRole('radio', { name: 'Ghost' }).click();
  await expect(motion.getByRole('radio', { name: 'Ghost' })).toHaveAttribute('aria-checked', 'true');
  await editor.getByRole('tab', { name: 'Click & effects' }).click();
  const anim = editor.getByRole('img', { name: 'Animated cursor preview' });
  await expect(anim).toBeVisible();
  await expect.poll(() => animates(anim), { timeout: 15000 }).toBe(true);
  await expect(editor.getByRole('slider', { name: 'Animation duration' })).toBeVisible();
  await expect(editor.getByRole('combobox', { name: 'Cursor animation in videos' }).or(editor.getByRole('button', { name: /Cursor animation in videos/ }))).toBeVisible();
  if (OUT) await editor.screenshot({ path: `${OUT}/shot74e.png` });
});
