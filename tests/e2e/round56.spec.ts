import { expect, send, tabIdFor, test, waitForPage } from './fixtures';

test('Recent captures: hovering a card animates on the GPU (almost no repaints)', async ({ context, extPage, baseUrl, extensionId }) => {
  test.setTimeout(120_000);
  const page = await context.newPage();
  await page.setViewportSize({ width: 1300, height: 800 });
  await page.goto(`${baseUrl}/short`);
  await page.bringToFront();
  const tabId = await tabIdFor(extPage, `${baseUrl}/*`);
  for (let i = 0; i < 3; i++) {
    const ed = waitForPage(context, (u) => u.includes('/editor.html?id='));
    await send(extPage, { target: 'background', type: 'screenshot/capture', mode: 'visible', tabId });
    await (await ed).close();
  }
  const p = await context.newPage();
  await p.setViewportSize({ width: 1400, height: 800 });
  await p.goto(`chrome-extension://${extensionId}/options.html#history`);
  const cards = p.locator('[class*="card_"]');
  await cards.first().waitFor();
  await p.mouse.move(5, 5);
  await p.waitForTimeout(800);
  const cdp = await context.newCDPSession(p);
  const events: Array<{ name: string }> = [];
  cdp.on('Tracing.dataCollected', (e) => { events.push(...(e.value as unknown as Array<{ name: string }>)); });
  const done = new Promise<void>((r) => cdp.once('Tracing.tracingComplete', () => r()));
  await cdp.send('Tracing.start', { categories: 'devtools.timeline,disabled-by-default-devtools.timeline', transferMode: 'ReportEvents' });
  const box = (await cards.nth(1).boundingBox())!;
  await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await p.waitForTimeout(700);
  await p.mouse.move(5, 5);
  await p.waitForTimeout(700);
  await cdp.send('Tracing.end');
  await done;
  const count = (n: string) => events.filter((e) => e.name === n).length;
  // Lift, shadow and accent edge are compositor animations: a couple of paints, not one per frame
  // (it was ~70 when the shadow / border / image zoom were repainted every frame).
  expect(count('Paint')).toBeLessThanOrEqual(8);
  expect(count('Layout')).toBeLessThanOrEqual(2);
});
