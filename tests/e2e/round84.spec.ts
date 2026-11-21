import { expect, test } from './fixtures';

/** Icons in buttons sit next to their text: no button pushes its icon away (a global margin:auto did). */
async function wideIconGaps(page: import('@playwright/test').Page): Promise<string[]> {
  return page.evaluate(() => {
    const bad: string[] = [];
    for (const svg of Array.from(document.querySelectorAll('button > svg'))) {
      const b = svg.parentElement as HTMLElement;
      const r = b.getBoundingClientRect();
      if (!r.width || !(b.textContent ?? '').trim()) continue;
      const cs = getComputedStyle(svg);
      if (parseFloat(cs.marginLeft) > 16 || parseFloat(cs.marginRight) > 16) bad.push((b.getAttribute('aria-label') ?? b.textContent ?? '').trim().slice(0, 40));
    }
    return bad;
  });
}

test('buttons with an icon and text keep them together (popup tabs, Settings Try it, editor)', async ({ context, extensionId }) => {
  const popup = await context.newPage();
  await popup.setViewportSize({ width: 380, height: 640 });
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  await expect(popup.getByRole('tab', { name: 'Record' })).toBeVisible();
  expect(await wideIconGaps(popup)).toEqual([]);
  // The tab's icon is right next to its label.
  const tab = popup.getByRole('tab', { name: 'Record' });
  const gap = await tab.evaluate((el) => {
    const svg = el.querySelector('svg')!.getBoundingClientRect();
    const range = document.createRange();
    const text = Array.from(el.childNodes).find((n) => n.nodeType === Node.TEXT_NODE && n.textContent!.trim()) ?? el.lastChild!;
    range.selectNodeContents(text);
    return range.getBoundingClientRect().left - svg.right;
  });
  expect(gap).toBeLessThan(16);

  const settings = await context.newPage();
  await settings.setViewportSize({ width: 1280, height: 900 });
  await settings.goto(`chrome-extension://${extensionId}/options.html#recording`);
  const toggle = settings.getByRole('switch', { name: 'Highlight clicks' });
  if ((await toggle.getAttribute('aria-checked')) !== 'true') await toggle.click();
  await expect(settings.getByRole('img', { name: /Click effect preview/ })).toBeVisible();
  expect(await wideIconGaps(settings)).toEqual([]);

  const editor = await context.newPage();
  await editor.goto(`chrome-extension://${extensionId}/editor.html?import=1`);
  await expect(editor.getByRole('button', { name: 'Choose file' })).toBeVisible();
  expect(await wideIconGaps(editor)).toEqual([]);
});
