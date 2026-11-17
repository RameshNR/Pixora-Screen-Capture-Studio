import { expect, test } from './fixtures';

test('settings pages sit next to the sidebar (left), and "Take screenshots on" shows its chips under a readable label', async ({ context, extensionId }) => {
  const p = await context.newPage();
  await p.setViewportSize({ width: 2000, height: 1000 });
  await p.goto(`chrome-extension://${extensionId}/options.html#flow`);
  const group = p.getByRole('group', { name: 'Take screenshots on' });
  await expect(group).toBeVisible();

  // Left-aligned: the page header starts right after the sidebar, not centred in the window.
  const nav = await p.locator('nav').first().boundingBox();
  const title = await p.getByRole('heading', { level: 1 }).first().boundingBox();
  expect(nav && title).toBeTruthy();
  expect(title!.x - (nav!.x + nav!.width)).toBeLessThan(120);

  // The row label isn't squeezed into a narrow column: it fits on one line, and the chips sit below it.
  const row = group.locator('xpath=ancestor::div[contains(@class,"row")][1]');
  const label = row.getByText('Take screenshots on', { exact: true });
  await expect(label).toHaveCount(1); // no duplicated title inside the picker
  const lb = await label.boundingBox();
  const gb = await group.boundingBox();
  expect(lb!.height).toBeLessThan(30);
  expect(gb!.y).toBeGreaterThan(lb!.y + lb!.height);
  await expect(row.getByRole('button', { name: 'All' })).toBeVisible();
  await expect(row.getByRole('button', { name: 'None' })).toBeVisible();
  await p.screenshot({ path: 'test-results/round49-flow.png', fullPage: false, clip: { x: 0, y: Math.max(0, gb!.y - 300), width: 2000, height: 600 } });
});
