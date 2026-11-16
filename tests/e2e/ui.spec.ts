import { expect, test } from './fixtures';

test.describe('popup and settings UI', () => {
  test('popup shows Screenshot and Record tabs with all capture options', async ({ context, extensionId }) => {
    const popup = await context.newPage();
    await popup.setViewportSize({ width: 380, height: 600 });
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    for (const name of ['Visible Part', 'Full Page', 'Selected Area', 'Visible Part after Delay 3s', 'Entire Screen & App Window', 'Annotate Local & Clipboard Image', 'Create Collage', 'Take Screenshot & Extract Text']) {
      await expect(popup.getByRole('button', { name, exact: true })).toBeVisible();
    }
    // No sign-in / feedback in this release.
    await expect(popup.getByText(/sign in/i)).toHaveCount(0);
    await expect(popup.getByText(/feedback/i)).toHaveCount(0);

    await popup.getByRole('tab', { name: 'Record' }).click();
    for (const name of ['Desktop', 'Camera Only', 'This Tab', 'Custom Area']) {
      await expect(popup.getByRole('radio', { name, exact: true })).toBeVisible();
    }
    await popup.getByRole('radio', { name: 'Desktop' }).click();
    await expect(popup.getByRole('radio', { name: 'Desktop' })).toHaveAttribute('aria-checked', 'true');
    await expect(popup.getByRole('button', { name: 'Start Recording' })).toBeVisible();
    await expect(popup.getByRole('button', { name: 'Edit a Video File' })).toBeVisible();
    await expect(popup.getByRole('button', { name: 'Teleprompter' })).toBeVisible();
    // Custom area can be a region of this tab or of a screen / window.
    await popup.getByRole('radio', { name: /Custom Area/ }).click();
    await popup.getByRole('radiogroup', { name: 'Custom area source' }).getByRole('radio', { name: 'A screen / window' }).click();
    await expect(popup.getByRole('radiogroup', { name: 'Custom area source' }).getByRole('radio', { name: 'A screen / window' })).toHaveAttribute('aria-checked', 'true');

    // Flow Capture during a recording has the same options as a screenshot flow, including no delay.
    await popup.getByRole('radio', { name: 'This Tab', exact: true }).click();
    // Like the Screenshot tab: the Flow Capture button opens its settings (on by default, with step screenshots).
    await expect(popup.getByRole('switch', { name: 'Flow Capture with this recording' })).toHaveCount(0);
    await popup.getByRole('button', { name: 'Flow Capture', exact: true }).click();
    await expect(popup.getByRole('switch', { name: 'Flow Capture with this recording' })).toHaveAttribute('aria-checked', 'true');
    await expect(popup.getByRole('switch', { name: 'Auto steps' })).toHaveAttribute('aria-checked', 'true');
    await expect(popup.getByRole('radiogroup', { name: 'Click pictures' }).getByRole('radio', { name: 'On click' })).toHaveAttribute('aria-checked', 'true');
    await expect(popup.getByText('No delay (every step)')).toBeVisible();
    await expect(popup.getByRole('group', { name: 'Take screenshots on' })).toBeVisible();
    await popup.getByRole('group', { name: 'Take screenshots on' }).getByRole('checkbox', { name: /Scrolling/ }).click();
    await popup.getByRole('button', { name: /^Wait before picture/ }).click();
    await popup.getByRole('menuitemradio', { name: /No delay/ }).click();
    await expect(popup.getByRole('button', { name: 'Wait before picture: No delay' })).toBeVisible();
    // Its own screen, like the screenshot Flow Capture setup; Done goes back.
    await expect(popup.getByRole('region', { name: 'Privacy' })).toBeVisible();
    await popup.getByRole('button', { name: 'Done' }).click();
    await expect(popup.getByRole('button', { name: 'Start Recording' })).toBeVisible();

    await popup.getByRole('button', { name: 'More recording settings' }).click();
    await expect(popup.getByText('Recording settings')).toBeVisible();
    await expect(popup.getByText('Maximum duration')).toBeVisible();
    await popup.getByRole('button', { name: 'Back' }).click();

    // The popup remembers the last tab.
    await popup.reload();
    await expect(popup.getByRole('tab', { name: 'Record' })).toHaveAttribute('aria-selected', 'true');
    // The flow options are kept (shared with screenshot Flow Capture).
    await popup.getByRole('button', { name: 'Flow Capture', exact: true }).click();
    await expect(popup.getByRole('button', { name: 'Wait before picture: No delay' })).toBeVisible();
    await expect(popup.getByRole('group', { name: 'Take screenshots on' }).getByRole('checkbox', { name: /Scrolling/ })).toHaveAttribute('aria-checked', 'false');
  });

  test('settings persist and the history page shows an empty state', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html#history`);
    await expect(page.getByRole('heading', { name: 'No captures yet' })).toBeVisible();

    await page.goto(`chrome-extension://${extensionId}/options.html#general`);
    await page.getByRole('radio', { name: 'Dark' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.reload();
    await expect(page.getByRole('radio', { name: 'Dark' })).toHaveAttribute('aria-checked', 'true');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  });

  test('Settings › Advanced repairs Pixora storage', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html#advanced`);
    await page.getByRole('button', { name: /^Repair storage/ }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Repair' }).click();
    await page.getByText('Storage repaired').waitFor();
    // Saving works afterwards: the database opens with its stores.
    const ok = await page.evaluate(() => new Promise<boolean>((res) => {
      const r = indexedDB.open('glint-capture');
      r.onsuccess = () => { const db = r.result; res(['captures', 'blobs', 'chunks', 'sessions', 'flows'].every((n) => db.objectStoreNames.contains(n))); db.close(); };
      r.onerror = () => res(false);
    }));
    if (!ok) throw new Error('storage not rebuilt');
  });
});
