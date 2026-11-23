import { buildRecordingConfig } from '../../src/recording/services/config';
import { DEFAULT_SETTINGS } from '../../src/shared/constants/defaults';
import { chunkCount, expect, recordingState, send, test, waitForPage } from './fixtures';

test.use({ headed: true });
import type { BrowserContext, Page } from '@playwright/test';
import { stripes } from './redact-helpers';

/** A short camera recording (MediaRecorder gives no data headless, so these tests run headed). */
async function importVideo(context: BrowserContext, extPage: Page): Promise<Page> {
  const cfg = { ...buildRecordingConfig(DEFAULT_SETTINGS.recording, { mode: 'camera' }), countdownSeconds: 0, resolution: '720p' as const };
  await send(extPage, { target: 'background', type: 'recording/start', config: cfg, tabId: null });
  await expect.poll(async () => (await recordingState(extPage)).status, { timeout: 20_000 }).toBe('recording');
  await expect.poll(() => chunkCount(extPage), { timeout: 30_000 }).toBeGreaterThanOrEqual(2);
  await send(extPage, { target: 'background', type: 'recording/command', command: 'stop' });
  const page = await waitForPage(context, (u) => u.includes('/video.html?id='));
  await page.setViewportSize({ width: 1400, height: 900 });
  await expect(page.getByRole('heading', { name: 'Recording details' })).toBeVisible({ timeout: 20_000 });
  return page;
}

async function importShot(context: BrowserContext, extensionId: string, name: string) {
  const p = await context.newPage();
  await p.goto(`chrome-extension://${extensionId}/editor.html?import=1`);
  await p.locator('input[type="file"]').first().setInputFiles({ name, mimeType: 'image/png', buffer: await stripes(p) });
  await expect(p.getByRole('img', { name: 'Screenshot canvas' })).toBeVisible();
  await p.close();
}

test('video Export: sections with cards like the flow export', async ({ context, extPage }) => {
  test.setTimeout(120_000);
  const video = await importVideo(context, extPage);
  await video.getByRole('button', { name: 'Export / Convert' }).click();
  const dlg = video.getByRole('dialog', { name: 'Export recording' });
  for (const s of ['Format', 'Range', 'Size and frame rate', 'Quality', 'Audio']) await expect(dlg.getByRole('region', { name: s })).toBeVisible();
  const format = dlg.getByRole('radiogroup', { name: 'Format' });
  await expect(format.getByRole('radio')).toHaveCount(2);
  await format.getByRole('radio', { name: 'WebM' }).click();
  await expect(format.getByRole('radio', { name: 'WebM' })).toHaveAttribute('aria-checked', 'true');
  await expect(dlg.getByRole('radiogroup', { name: 'Quality' }).getByRole('radio')).toHaveCount(5);
  await expect(dlg.getByLabel('Output summary')).toContainText('WebM');
  await video.close();
});

test('Recent captures: videos are refused by images (with a message); groups hold screenshots and videos, can be named, opened, emptied and ungrouped', async ({ context, extensionId, extPage }) => {
  test.setTimeout(300_000);
  await importShot(context, extensionId, 'shot-a.png');
  await importShot(context, extensionId, 'shot-b.png');
  const v = await importVideo(context, extPage);
  await v.close();
  const h = await context.newPage();
  await h.setViewportSize({ width: 1400, height: 900 });
  await h.goto(`chrome-extension://${extensionId}/options.html#history`);
  const card = (name: RegExp) => h.locator('li', { has: h.getByRole('button', { name }) });
  const videoCard = card(/^Open (Pixora Recording|Recording)/);
  await expect(videoCard).toBeVisible();

  // A video dropped on a screenshot: refused, with a message; nothing becomes a flow.
  await videoCard.dragTo(card(/^Open shot-a/));
  await expect(h.getByText('Videos can’t go into a flow')).toBeVisible();
  await expect(h.getByRole('button', { name: /^Open Flow/ })).toHaveCount(0);

  // New group, named "Trip".
  await h.getByRole('button', { name: 'New group' }).click();
  const nameBox = h.getByRole('textbox', { name: 'Group name' });
  await nameBox.fill('Trip');
  await nameBox.press('Enter');
  const group = h.locator('li', { has: h.getByRole('button', { name: 'Open group Trip' }) });
  await expect(group).toBeVisible();
  await expect(group.getByText(/Empty/)).toBeVisible();

  // Drag the video and a screenshot into it: they leave the main grid.
  await videoCard.dragTo(group);
  await expect(group.getByText('1 item · 1 video')).toBeVisible();
  await expect(videoCard).toHaveCount(0);
  await card(/^Open shot-b/).dragTo(group);
  await expect(group.getByText('2 items · 1 video')).toBeVisible();

  // Open it: its captures; take one out through the "All captures" crumb.
  await h.getByRole('button', { name: 'Open group Trip' }).click();
  await expect(card(/^Open (Pixora Recording|Recording)/)).toBeVisible();
  await expect(card(/^Open shot-a/)).toHaveCount(0);
  await card(/^Open shot-b/).dragTo(h.getByRole('button', { name: /All captures/ }));
  await expect(h.getByText('Taken out of the group')).toBeVisible();
  await expect(card(/^Open shot-b/)).toHaveCount(0);
  // Rename from the open group.
  await h.getByRole('button', { name: 'Rename the group' }).click();
  await nameBox.fill('Holiday');
  await nameBox.press('Enter');
  await expect(h.getByRole('button', { name: 'Rename the group' })).toContainText('Holiday');
  // Kept after a reload; ungroup brings the video back to the main grid.
  await h.reload();
  const holiday = h.locator('li', { has: h.getByRole('button', { name: 'Open group Holiday' }) });
  await expect(holiday.getByText('1 item · 1 video')).toBeVisible();
  await holiday.getByRole('button', { name: 'Ungroup Holiday' }).click();
  await expect(card(/^Open (Pixora Recording|Recording)/)).toBeVisible();
  await h.close();
});
