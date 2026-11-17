import { expect, test } from './fixtures';

const systemAudio = (p: import('@playwright/test').Page) =>
  p.evaluate(async () => ((await chrome.storage.local.get('glint.settings'))['glint.settings'] as { recording?: { systemAudio?: boolean } } | undefined)?.recording?.systemAudio);

test('popup Record tab: System sound button next to the microphone; tip about Chrome\'s sharing bar for Desktop', async ({ context, extensionId }) => {
  const pop = await context.newPage();
  await pop.setViewportSize({ width: 400, height: 640 });
  await pop.goto(`chrome-extension://${extensionId}/popup.html`);
  await pop.getByRole('tab', { name: /Record/ }).click();
  await pop.getByRole('radio', { name: /Desktop/ }).click();
  const sound = pop.getByRole('switch', { name: 'System sound' });
  await expect(sound).toBeChecked(); // on by default
  await expect(pop.getByText(/click Hide on it during the countdown/)).toBeVisible();
  await expect(pop.getByText(/Share system audio/)).toBeVisible();
  await sound.click();
  await expect(sound).not.toBeChecked();
  await expect.poll(() => systemAudio(pop)).toBe(false);
  await sound.click();
  await expect.poll(() => systemAudio(pop)).toBe(true);
  // Camera Only: no system sound (disabled), no sharing-bar tip.
  await pop.getByRole('radio', { name: /Camera Only/ }).click();
  await expect(pop.getByRole('switch', { name: 'System sound' })).toBeDisabled();
  await expect(pop.getByText(/click Hide on it during the countdown/)).toHaveCount(0);
});
