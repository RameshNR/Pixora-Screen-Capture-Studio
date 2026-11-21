import { expect, test } from './fixtures';
import { drag, openStripes, part, region, section } from './redact-helpers';

test('Outside area keeps the area clear with every choice offered (Bokeh, Spin…); inside-only parts are greyed out', async ({ context, extensionId }) => {
  test.setTimeout(180_000);
  const { editor, cx, cy } = await openStripes(context, extensionId);
  // The very middle (star and heart shapes are narrow there).
  const inside = { x: cx - 10, y: cy - 6, width: 20, height: 12 };
  const clean = await editor.screenshot({ clip: inside });
  await editor.keyboard.press('b');
  await drag(editor, cx - 150, cy - 100, cx + 150, cy + 100);
  await editor.getByRole('radiogroup', { name: 'Apply to' }).getByRole('radio', { name: 'Outside area' }).click();
  const leaks: string[] = [];
  const disabled: string[] = [];
  for (const name of ['Effect', 'Strength', 'Shape', 'Edges', 'Colour', 'Glass']) {
    const opts = (await part(editor, 'Blur', name)).getByRole('option');
    for (let i = 0; i < (await opts.count()); i++) {
      const o = opts.nth(i);
      const label = `${name}: ${await o.getAttribute('aria-label')}`;
      if (await o.isDisabled()) { disabled.push(label); continue; }
      await o.click();
      await editor.waitForTimeout(150);
      if (Buffer.compare(await editor.screenshot({ clip: inside }), clean) !== 0) leaks.push(label);
    }
  }
  expect(leaks).toEqual([]);
  expect(disabled).toEqual(expect.arrayContaining(['Edges: Fade top', 'Edges: Tilt-shift', 'Edges: Soft edges', 'Glass: Frosted glass']));
  expect(disabled).not.toContain('Effect: Bokeh');
  expect(disabled).not.toContain('Edges: Sharp');
  await expect(editor.getByText('These work only inside an area. Choose “This area” above to use them.')).toBeVisible();
  // Back to This area: they can be used again.
  await editor.getByRole('radiogroup', { name: 'Apply to' }).getByRole('radio', { name: 'This area' }).click();
  await expect((await part(editor, 'Blur', 'Edges')).getByRole('option', { name: 'Fade top' })).toBeEnabled();
  // Adjust: strength, opacity, and the border's style, colour and thickness.
  await editor.getByRole('tab', { name: 'Adjust' }).click();
  const opacity = editor.getByRole('slider', { name: 'Blur opacity' });
  await opacity.focus();
  await opacity.press('ArrowLeft');
  await expect(opacity).toHaveValue('0.95');
  await editor.getByRole('radiogroup', { name: 'Blur border' }).getByRole('radio', { name: 'Solid' }).click();
  await expect(editor.getByRole('slider', { name: 'Border thickness' })).toBeVisible();
  await expect(editor.getByRole('radiogroup', { name: 'Border colour' })).toBeVisible();
  // A strength set with the slider shows as Custom.
  const strength = editor.getByRole('slider', { name: 'Blur strength' });
  await strength.focus();
  await strength.press('ArrowRight');
  await editor.getByRole('tab', { name: 'Designs' }).click();
  await expect(section(editor, 'Strength')).toContainText('Custom');
});

test('Circle is round and Oval is not; border under Adjust; Move the mask only moves it; Shift draws a square up to the pointer', async ({ context, extensionId }) => {
  test.setTimeout(120_000);
  const { editor, cx, cy } = await openStripes(context, extensionId);

  // Shift: a square no bigger than the drag (it ends at the pointer, it does not grow past it).
  await editor.keyboard.press('m');
  await drag(editor, cx - 200, cy - 60, cx + 100, cy + 40, true);
  const sq = await region(editor);
  expect(Math.abs(sq.w - sq.h)).toBeLessThanOrEqual(2);
  await editor.keyboard.press('Delete');
  await drag(editor, cx - 200, cy - 60, cx + 100, cy + 40);
  const free = await region(editor);
  expect(sq.w).toBe(free.h);

  // Circle makes the area round; Oval makes it longer again. One choice is selected.
  const shape = await part(editor, 'Mask', 'Shape');
  await shape.getByRole('option', { name: 'Circle' }).click();
  const circle = await region(editor);
  expect(circle.w).toBe(circle.h);
  await expect(shape.getByRole('option', { selected: true })).toHaveAccessibleName('Circle');
  await shape.getByRole('option', { name: 'Oval' }).click();
  const oval = await region(editor);
  expect(oval.w).toBeGreaterThan(oval.h);
  await expect(shape.getByRole('option', { selected: true })).toHaveAccessibleName('Oval');

  // Border is set under Adjust (no border choices among the designs); a mask's opacity is its colour's.
  await editor.getByRole('tab', { name: 'Adjust' }).click();
  await editor.getByRole('radiogroup', { name: 'Mask border' }).getByRole('radio', { name: 'Dashed' }).click();
  await editor.getByRole('radiogroup', { name: 'Border colour' }).getByRole('radio').nth(4).click();
  const thick = editor.getByRole('slider', { name: 'Border thickness' });
  await thick.focus();
  for (let i = 0; i < 5; i++) await thick.press('ArrowRight');
  await expect(editor.getByRole('slider', { name: 'Mask opacity' })).toHaveCount(0);
  await editor.getByRole('tab', { name: 'Designs' }).click();
  // A face goes inside the shape (the shape stays), and the border stays.
  await (await part(editor, 'Mask', 'Inside the mask')).getByRole('option', { name: 'Face' }).click();
  await expect(section(editor, 'Shape')).toContainText('Oval');
  await editor.getByRole('tab', { name: 'Adjust' }).click();
  await expect(editor.getByRole('radiogroup', { name: 'Mask border' }).getByRole('radio', { name: 'Dashed' })).toHaveAttribute('aria-checked', 'true');
  await editor.getByRole('tab', { name: 'Designs' }).click();

  // Move to the top / centre / bottom only moves it: the size stays (no full-width band).
  const before = await region(editor);
  for (const where of ['top', 'centre', 'bottom']) {
    await editor.getByRole('button', { name: `Move to the ${where}` }).click();
    expect(await region(editor)).toEqual(before);
  }
  // Outside the area: the face (which can't show there) is taken off, and such looks are greyed out.
  await editor.getByRole('radiogroup', { name: 'Apply to' }).getByRole('radio', { name: 'Outside area' }).click();
  await expect(section(editor, 'Inside the mask')).toContainText('Not outside the area');
  await expect((await part(editor, 'Mask', 'Inside the mask')).getByRole('option', { name: 'Card' })).toBeDisabled();
});
