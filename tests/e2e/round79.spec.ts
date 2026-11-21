import { expect, test } from './fixtures';
import { drag, openStripes, part, redShare, section } from './redact-helpers';

test('blur, pixelate and mask: each part of the look on its own, and apply to this area, outside it or the whole image', async ({ context, extensionId }) => {
  test.setTimeout(120_000);
  const { editor, cx, cy } = await openStripes(context, extensionId);
  // A spot of the picture beside the area: it must stay as it is while the effect is "This area".
  const corner = { x: cx - 270, y: cy - 20, width: 60, height: 40 };
  const cornerShot = () => editor.screenshot({ clip: corner });
  const clean = await cornerShot();

  // ---- Blur: one choice per part; Bokeh then Zoom — only the area is blurred.
  await editor.keyboard.press('b');
  await drag(editor, cx - 80, cy - 50, cx + 80, cy + 50);
  const apply = editor.getByRole('radiogroup', { name: 'Apply to' });
  await expect(apply.getByRole('radio', { name: 'This area' })).toHaveAttribute('aria-checked', 'true');
  const effect = await part(editor, 'Blur', 'Effect');
  await effect.getByRole('option', { name: 'Bokeh' }).click();
  await effect.getByRole('option', { name: 'Zoom' }).click();
  await expect(effect.getByRole('option', { selected: true })).toHaveAccessibleName('Zoom');
  await editor.waitForTimeout(300);
  expect(Buffer.compare(await cornerShot(), clean)).toBe(0);
  // Glass: exactly one choice is selected (never all the glass looks at once), other parts unchanged.
  const glass = await part(editor, 'Blur', 'Glass');
  await glass.getByRole('option', { name: 'Frosted glass' }).click();
  await expect(glass.getByRole('option', { selected: true })).toHaveCount(1);
  await expect(section(editor, 'Glass')).toContainText('Frosted glass');
  await expect(section(editor, 'Effect')).toContainText('Zoom');
  await expect(section(editor, 'Colour')).toContainText('Original');

  // Outside area: the spot is blurred now; the area stays clear; glass (inside only) is taken off.
  await apply.getByRole('radio', { name: 'Outside area' }).click();
  await expect(apply.getByRole('radio', { name: 'Outside area' })).toHaveAttribute('aria-checked', 'true');
  await expect(editor.getByText(/Blurs everything around the area/)).toBeVisible();
  await expect.poll(async () => Buffer.compare(await cornerShot(), clean) !== 0).toBe(true);
  await expect(section(editor, 'Glass')).toContainText('Not outside the area');
  await expect((await part(editor, 'Blur', 'Glass')).getByRole('option', { name: 'Frosted glass' })).toBeDisabled();
  // Another effect keeps "Outside area".
  await (await part(editor, 'Blur', 'Effect')).getByRole('option', { name: 'Bokeh' }).click();
  await expect(apply.getByRole('radio', { name: 'Outside area' })).toHaveAttribute('aria-checked', 'true');

  // Whole image: the area covers the picture; back to an area to move and resize.
  await apply.getByRole('radio', { name: 'Whole image' }).click();
  await expect(editor.getByText('Region: 1200 × 700 px — drag the handles to resize.')).toBeVisible();
  await apply.getByRole('radio', { name: 'This area' }).click();
  await expect(editor.getByText('Region: 600 × 350 px — drag the handles to resize.')).toBeVisible();
  await editor.keyboard.press('Delete');
  await expect.poll(async () => Buffer.compare(await cornerShot(), clean)).toBe(0);

  // ---- Whole image with nothing selected adds one covering the picture.
  await editor.keyboard.press('Escape');
  await editor.keyboard.press('x');
  await editor.getByRole('radiogroup', { name: 'Apply to' }).getByRole('radio', { name: 'Whole image' }).click();
  await expect(editor.getByText('Region: 1200 × 700 px — drag the handles to resize.')).toBeVisible();
  await expect(editor.getByText(/Pixelates the whole image/)).toBeVisible();
  await expect.poll(async () => Buffer.compare(await cornerShot(), clean) !== 0).toBe(true);
  await editor.keyboard.press('Delete');

  // ---- Mask: colour, shape and what is inside it are separate; Outside area covers the rest in that colour.
  await editor.keyboard.press('Escape');
  await editor.keyboard.press('m');
  await drag(editor, cx - 80, cy - 50, cx + 80, cy + 50);
  await (await part(editor, 'Mask', 'Inside the mask')).getByRole('option', { name: 'Text lines' }).click();
  await (await part(editor, 'Mask', 'Shape')).getByRole('option', { name: 'Cloud' }).click();
  await section(editor, 'Colour').locator('button[aria-expanded]').first().click();
  await editor.getByRole('radiogroup', { name: 'Mask colour' }).getByRole('radio', { name: '#E05252' }).click();
  // The text lines stay, drawn inside the cloud (a choice adds to the others).
  await expect(section(editor, 'Inside the mask')).toContainText('Text lines');
  await expect(section(editor, 'Shape')).toContainText('Cloud');
  expect(await redShare(editor, await cornerShot())).toBeLessThan(0.05);
  await editor.getByRole('radiogroup', { name: 'Apply to' }).getByRole('radio', { name: 'Outside area' }).click();
  await expect.poll(async () => redShare(editor, await cornerShot())).toBeGreaterThan(0.9);
  // Outside the area the text lines can't show: taken off, and that part says so.
  await expect(section(editor, 'Inside the mask')).toContainText('Not outside the area');
  for (const name of ['Move to the top', 'Move to the centre', 'Move to the bottom']) await expect(editor.getByRole('button', { name })).toBeVisible();
});
