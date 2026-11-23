import { expect, test } from './fixtures';

test('camera and microphone settings open as a page of the popup (Back / Done), like Flow Capture', async ({ context, extensionId }) => {
  const popup = await context.newPage();
  await popup.setViewportSize({ width: 380, height: 600 });
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  await popup.getByRole('tab', { name: 'Record' }).click();

  await popup.getByRole('button', { name: 'Camera settings' }).click();
  await expect(popup.getByRole('region', { name: 'Camera', exact: true })).toBeVisible();
  await expect(popup.getByRole('radio', { name: 'Desktop' })).toHaveCount(0);
  // Nothing sticks out of the popup.
  const overflow = await popup.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  if (process.env.SHOTS) await popup.screenshot({ path: 'test-results/shot-camera-page.png', fullPage: true });
  await popup.getByRole('button', { name: 'Done' }).click();
  await expect(popup.getByRole('radio', { name: 'Desktop' })).toBeVisible();

  await popup.getByRole('button', { name: 'Microphone settings' }).click();
  await expect(popup.getByRole('region', { name: 'Microphone', exact: true })).toBeVisible();
  if (process.env.SHOTS) await popup.screenshot({ path: 'test-results/shot-mic-page.png', fullPage: true });
  await popup.getByRole('button', { name: 'Back', exact: true }).first().click();
  await expect(popup.getByRole('radio', { name: 'Desktop' })).toBeVisible();
});

test('Settings: camera and microphone set up and tested there; one "Mouse cursor between clicks" setting', async ({ context, extensionId, extPage }) => {
  const settings = await context.newPage();
  await settings.setViewportSize({ width: 1280, height: 900 });
  await settings.goto(`chrome-extension://${extensionId}/options.html#recording`);
  // Camera: the same fields as the popup's camera page (or the permission button), and the page stays open.
  await expect(settings.getByRole('switch', { name: 'Camera overlay' })).toBeVisible();
  const cam = settings.getByRole('region', { name: 'Camera settings' });
  const grant = settings.getByRole('button', { name: 'Grant camera access' });
  await expect(cam.or(grant).first()).toBeVisible();
  if (await cam.isVisible()) {
    await expect(cam.getByLabel('Camera preview')).toBeVisible();
    await cam.getByRole('radio', { name: 'Square' }).click();
    await expect.poll(() => extPage.evaluate(async () => ((await chrome.storage.local.get('glint.settings'))['glint.settings'] as { recording: { cameraShape: string } }).recording.cameraShape)).toBe('square');
  }
  const mic = settings.getByRole('region', { name: 'Microphone settings' });
  await expect(mic.or(settings.getByRole('button', { name: 'Grant microphone access' })).first()).toBeVisible();

  // Cursor: one setting, saved as halo / drawn cursor.
  await expect(settings.getByText('Cursor highlight', { exact: true })).toHaveCount(0);
  const moving = settings.getByRole('radiogroup', { name: 'Mouse cursor between clicks' });
  await moving.getByRole('radio', { name: 'Both' }).click();
  await expect(settings.getByRole('slider', { name: 'Halo size' })).toBeVisible();
  // The drawn cursor uses the click cursor's look (no second design / size / colour controls).
  await expect(settings.getByText('Uses the cursor design, size and colours chosen under Highlight mouse clicks › Cursor design.')).toBeVisible();
  await expect(settings.getByRole('slider', { name: 'Smooth movement' })).toBeVisible();
  await expect.poll(() => extPage.evaluate(async () => {
    const fx = ((await chrome.storage.local.get('glint.settings'))['glint.settings'] as { recording: { cursorEffects: { cursor: boolean; pointer: boolean } } }).recording.cursorEffects;
    return `${fx.cursor}/${fx.pointer}`;
  })).toBe('true/true');
  await moving.getByRole('radio', { name: 'Off' }).click();
  await expect(settings.getByRole('slider', { name: 'Halo size' })).toHaveCount(0);
  await expect(settings).toHaveURL(/options\.html/);
});
