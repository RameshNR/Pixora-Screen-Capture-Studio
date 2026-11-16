import { buildRecordingConfig } from '../../src/recording/services/config';
import { DEFAULT_SETTINGS } from '../../src/shared/constants/defaults';
import { chunkCount, expect, recordingState, send, test, waitForPage } from './fixtures';

// MediaRecorder emits no data in headless Chromium, so this runs headed (like recording.spec).
test.use({ headed: true });

test('the popup is the recording controller; choosing a zoom area pauses the recording until done', async ({ context, extPage, extensionId }) => {
  const cfg = { ...buildRecordingConfig(DEFAULT_SETTINGS.recording, { mode: 'camera' }), countdownSeconds: 0, resolution: '720p' as const };
  // The separate control window is off by default now.
  expect(cfg.controlBar).toBe(false);
  await send(extPage, { target: 'background', type: 'recording/start', config: cfg, tabId: null });
  const recorder = await waitForPage(context, (u) => u.includes('/recorder.html'));
  await expect.poll(async () => (await recordingState(extPage)).status, { timeout: 20_000 }).toBe('recording');
  await expect.poll(() => chunkCount(extPage), { timeout: 30_000 }).toBeGreaterThanOrEqual(1);
  expect(context.pages().some((p) => p.url().includes('/controlbar.html'))).toBe(false);

  // Live tools in the popup do real work.
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  const tools = popup.getByRole('group', { name: 'Live tools' });
  await expect(tools).toBeVisible();
  await tools.getByRole('button', { name: 'Spotlight' }).click();
  await expect.poll(async () => ((await recordingState(extPage)) as unknown as { effects: { spotlight: boolean } }).effects.spotlight).toBe(true);
  // Zoom in asks where: the picker opens on the recorder's preview; a click there zooms 2×.
  await tools.getByRole('button', { name: 'Zoom in' }).click();
  const where = recorder.getByRole('dialog', { name: /Click where to zoom in/ });
  await expect(where).toBeVisible();
  const box = (await where.locator('div').first().boundingBox())!;
  await recorder.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect.poll(async () => ((await recordingState(extPage)) as unknown as { effects: { zoom: number } }).effects.zoom).toBe(2);
  // The popup closes itself after Zoom in (like a real popup); open it again.
  const popup2 = popup.isClosed() ? await context.newPage() : popup;
  if (popup2 !== popup) await popup2.goto(`chrome-extension://${extensionId}/popup.html`);
  else await popup2.reload();
  const tools2 = popup2.getByRole('group', { name: 'Live tools' });
  await expect(tools2.getByRole('button', { name: 'Zoom out' })).toHaveAttribute('aria-pressed', 'true');
  await tools2.getByRole('button', { name: 'Zoom out' }).click();
  await expect.poll(async () => ((await recordingState(extPage)) as unknown as { effects: { zoom: number } }).effects.zoom).toBe(1);
  await tools2.getByRole('button', { name: /^Marker/ }).click();
  await expect.poll(async () => ((await recordingState(extPage)) as unknown as { markers: unknown[] }).markers.length).toBe(1);

  // Zoom to area (camera recordings pick on the preview): the recording pauses meanwhile…
  await send(extPage, { target: 'background', type: 'recording/region-select', purpose: 'zoom' });
  const picker = recorder.getByRole('dialog', { name: /Click where to zoom in/ });
  await expect(picker).toBeVisible();
  await expect.poll(async () => (await recordingState(extPage)).status).toBe('paused');
  // …and resumes when it is cancelled.
  await picker.getByRole('button', { name: 'Cancel' }).click();
  await expect.poll(async () => (await recordingState(extPage)).status).toBe('recording');
  await send(extPage, { target: 'background', type: 'recording/command', command: 'cancel' });
});
