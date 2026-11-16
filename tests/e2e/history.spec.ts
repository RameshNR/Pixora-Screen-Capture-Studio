import { DEFAULT_SETTINGS } from '../../src/shared/constants/defaults';
import { expect, readCaptures, send, tabIdFor, test, waitForPage } from './fixtures';

test.describe('recent captures and empty flows', () => {
  test('select several captures to download or delete; each card has its own download and delete', async ({ context, extPage, extensionId, baseUrl }) => {
    const page = await context.newPage();
    await page.goto(`${baseUrl}/short`);
    const tabId = await tabIdFor(extPage, `${baseUrl}/short`);
    for (let i = 0; i < 3; i++) {
      await page.bringToFront();
      await send(extPage, { target: 'background', type: 'screenshot/capture', mode: 'visible', tabId });
      await expect.poll(async () => (await readCaptures(extPage)).length, { timeout: 20_000 }).toBe(i + 1);
    }
    // Opening the editor tabs is not needed for this test.
    for (const p of context.pages()) if (p.url().includes('/editor.html')) await p.close();

    const history = await context.newPage();
    await history.setViewportSize({ width: 1200, height: 900 });
    await history.goto(`chrome-extension://${extensionId}/options.html#history`);
    const cards = history.getByRole('listitem').filter({ has: history.getByRole('button', { name: /^Open / }) });
    await expect(cards).toHaveCount(3);

    // Per-item download.
    let download = history.waitForEvent('download');
    await cards.first().getByRole('button', { name: /^Download / }).click();
    expect((await download).suggestedFilename()).toMatch(/\.(png|jpe?g|webp)$/);

    // Select two and download them together.
    await cards.nth(0).getByRole('checkbox').check();
    await cards.nth(1).getByRole('checkbox').check();
    const bar = history.getByRole('toolbar', { name: 'Selection' });
    await expect(bar.getByText('2 selected')).toBeVisible();
    const downloads: string[] = [];
    history.on('download', (d) => downloads.push(d.suggestedFilename()));
    await bar.getByRole('button', { name: 'Download' }).click();
    await expect.poll(() => downloads.length).toBe(2);

    // Delete the two selected ones (after confirming).
    await bar.getByRole('button', { name: 'Delete' }).click();
    await history.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
    await expect(cards).toHaveCount(1);
    expect(await readCaptures(extPage)).toHaveLength(1);

    // Per-item delete.
    await cards.first().getByRole('button', { name: /^Delete / }).click();
    await history.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
    await expect(cards).toHaveCount(0);
  });

  test('finishing a flow with no images just stops it', async ({ context, extPage, baseUrl }) => {
    const page = await context.newPage();
    await page.goto(`${baseUrl}/short`);
    const tabId = await tabIdFor(extPage, `${baseUrl}/short`);
    await send(extPage, { target: 'background', type: 'flow/start', tabId, config: { ...DEFAULT_SETTINGS.flow, area: null } });
    const bar = await waitForPage(context, (u) => u.includes('/flowbar.html'));
    await expect(bar.getByRole('button', { name: 'Stop', exact: true })).toBeVisible();
    await bar.getByRole('button', { name: 'Stop', exact: true }).click();
    await expect.poll(async () => (await send<{ status: string }>(extPage, { target: 'background', type: 'flow/get-state' })).status).toBe('idle');
    await page.waitForTimeout(800);
    expect(context.pages().some((p) => p.url().includes('/flow.html'))).toBe(false);
    expect(await readCaptures(extPage)).toHaveLength(0);
  });
});
