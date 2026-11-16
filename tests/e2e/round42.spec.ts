import { buildRecordingConfig } from '../../src/recording/services/config';
import { DEFAULT_SETTINGS } from '../../src/shared/constants/defaults';
import { chunkCount, expect, readCaptures, recordingState, send, tabIdFor, test, waitForPage } from './fixtures';

// MediaRecorder emits no data in headless Chromium, so this runs headed (like recording.spec).
test.use({ headed: true });

test('full page: progress and Stop are in the popup', async ({ context, extPage, extensionId, baseUrl }) => {
  const page = await context.newPage();
  await page.setViewportSize({ width: 900, height: 400 });
  await page.goto(`${baseUrl}/long`);
  await page.evaluate(() => {
    document.body.innerHTML = Array.from({ length: 40 }, (_, i) => `<div style="height:400px;background:hsl(${i * 9},70%,85%);font:40px sans-serif">Section ${i + 1}</div>`).join('');
  });
  await page.bringToFront();
  const tabId = await tabIdFor(extPage, `${baseUrl}/*`);
  const before = (await readCaptures(extPage)).length;
  await extPage.evaluate((id) => { void chrome.runtime.sendMessage({ target: 'background', type: 'screenshot/capture', mode: 'full', tabId: id, scrollAreas: [] }); }, tabId);
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  const card = popup.getByRole('status', { name: 'Full-page capture' });
  await expect(card).toBeVisible({ timeout: 15_000 });
  await expect(card).toContainText('Full page capturing…');
  await expect(card).toContainText(/do not scroll/);
  await expect(card.getByRole('progressbar', { name: 'Captured' })).toBeVisible();
  // The popup is exactly as tall as this view: no empty space below Stop.
  const gap = await card.evaluate((el) => el.parentElement!.getBoundingClientRect().height - el.getBoundingClientRect().height);
  expect(gap).toBeLessThan(2);
  // No extra window: only Pixora's popup shows it.
  expect(context.pages().some((p) => p.url().includes('progress.html'))).toBe(false);
  await card.getByRole('button', { name: /^Stop$/ }).click();
  await expect.poll(async () => (await readCaptures(extPage)).length, { timeout: 20_000 }).toBe(before + 1);
  // The popup closes itself (or at least drops the card) when the editor opens.
  await expect.poll(async () => popup.isClosed() || (await card.count()) === 0, { timeout: 15_000 }).toBe(true);
  await page.bringToFront();
});

test('zoom: a click picks where to zoom; timeline right-click menu and Delete key', async ({ context, extPage }) => {
  test.setTimeout(180_000);
  const cfg = { ...buildRecordingConfig(DEFAULT_SETTINGS.recording, { mode: 'camera' }), countdownSeconds: 0, resolution: '720p' as const };
  await send(extPage, { target: 'background', type: 'recording/start', config: cfg, tabId: null });
  const recorder = await waitForPage(context, (u) => u.includes('/recorder.html'));
  await expect.poll(async () => (await recordingState(extPage)).status, { timeout: 20_000 }).toBe('recording');
  await expect.poll(() => chunkCount(extPage), { timeout: 30_000 }).toBeGreaterThanOrEqual(3);

  // Zoom in: click a point on the picture (no drag) → 2× there; the recording resumes.
  await send(extPage, { target: 'background', type: 'recording/region-select', purpose: 'zoom' });
  const picker = recorder.getByRole('dialog', { name: /Click where to zoom in/ });
  await expect(picker).toBeVisible();
  const area = (await picker.locator('div').first().boundingBox())!;
  await recorder.mouse.click(area.x + area.width * 0.2, area.y + area.height * 0.25);
  await expect.poll(async () => ((await recordingState(extPage)) as unknown as { effects: { zoom: number } }).effects.zoom).toBe(2);
  await expect.poll(async () => (await recordingState(extPage)).status).toBe('recording');

  await send(extPage, { target: 'background', type: 'recording/command', command: 'stop' });
  const page = await waitForPage(context, (u) => u.includes('/video.html?id='));
  await page.setViewportSize({ width: 1500, height: 900 });
  await expect(page.getByRole('heading', { name: 'Recording details' })).toBeVisible({ timeout: 20_000 });
  // Draw a box so there is a track.
  await page.getByRole('navigation', { name: 'Annotate' }).getByRole('button', { name: 'Shapes' }).click();
  const canvas = page.getByRole('region', { name: 'Draw on the video' }).getByRole('img', { name: 'Screenshot canvas' });
  await expect(canvas).toBeVisible({ timeout: 20_000 });
  const b = (await canvas.boundingBox())!;
  await page.mouse.move(b.x + b.width * 0.3, b.y + b.height * 0.3);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width * 0.6, b.y + b.height * 0.6, { steps: 5 });
  await page.mouse.up();
  const track = page.locator('[data-overlay-id]');
  await expect(track).toHaveCount(1);
  // Right-click on the track: its menu (Duplicate adds a second track).
  await track.first().getByRole('slider').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Duplicate' }).click();
  await expect(track).toHaveCount(2);
  // Select one on the timeline and press Delete.
  await track.first().getByRole('button', { name: /^Shape$/ }).click();
  await page.keyboard.press('Delete');
  await expect(track).toHaveCount(1);
});

test('full page: a very long page comes out as several full-resolution images, all in the editor', async ({ context, extPage, baseUrl }) => {
  test.setTimeout(240_000);
  const page = await context.newPage();
  await page.setViewportSize({ width: 800, height: 400 });
  await page.goto(`${baseUrl}/long`);
  // 64 screens of 400 px = 25 600 px: more than one part (24 000 device px at 1×).
  await page.evaluate(() => {
    document.body.style.margin = '0';
    document.body.innerHTML = Array.from({ length: 64 }, (_, i) => `<div style="height:400px;background:hsl(${i * 7},70%,85%);font:40px sans-serif">Section ${i + 1}</div>`).join('');
  });
  await page.bringToFront();
  const tabId = await tabIdFor(extPage, `${baseUrl}/*`);
  const before = (await readCaptures(extPage)).length;
  await send(extPage, { target: 'background', type: 'screenshot/capture', mode: 'full', tabId, scrollAreas: [] });
  await expect.poll(async () => (await readCaptures(extPage)).length, { timeout: 120_000 }).toBe(before + 2);
  const shots = (await readCaptures(extPage)).sort((a, b) => Number(a.createdAt) - Number(b.createdAt)).slice(-2);
  // Full resolution (the window's real width — the headed test window can be wider than the
  // emulated viewport — never scaled down), same width for both parts, named in order.
  const widths = shots.map((s) => Number(s.width));
  expect(widths[0]).toBe(widths[1]);
  expect(widths[0]).toBeGreaterThanOrEqual(800);
  expect(Number(shots[0]!.height)).toBeGreaterThan(Number(shots[1]!.height));
  const notes = shots.flatMap((s) => (s.notes as string[] | undefined) ?? []).join(' ');
  expect(notes).not.toMatch(/scaled down/);
  expect(notes).toMatch(/in 2 images/);
  expect(shots.map((s) => String(s.name)).join(' | ')).toMatch(/part 1 of 2.*part 2 of 2|part 2 of 2.*part 1 of 2/);
  const editor = await waitForPage(context, (u) => u.includes('/editor.html?') && u.includes('set='));
  await expect(editor.getByText('Images (2)')).toBeVisible({ timeout: 20_000 });
});

test('screenshot editor: the picture re-fits once after a resize (no flicker)', async ({ context, extensionId }) => {
  const editor = await context.newPage();
  await editor.setViewportSize({ width: 1500, height: 900 });
  await editor.goto(`chrome-extension://${extensionId}/editor.html?import=1`);
  const png = Buffer.from(await editor.evaluate(async () => { const c = new OffscreenCanvas(1600, 900); const x = c.getContext('2d')!; x.fillStyle = '#dde'; x.fillRect(0, 0, 1600, 900); return Array.from(new Uint8Array(await (await c.convertToBlob()).arrayBuffer())); }));
  await editor.locator('input[type="file"]').first().setInputFiles({ name: 'a.png', mimeType: 'image/png', buffer: png });
  const zoom = editor.getByRole('textbox', { name: 'Zoom level' });
  await expect(editor.getByRole('img', { name: 'Screenshot canvas' })).toBeVisible();
  await editor.setViewportSize({ width: 1024, height: 700 });
  await editor.waitForTimeout(600);
  // Watch the zoom for a while: it settles on one value (it used to flip back and forth).
  const seen = new Set<string>();
  for (let i = 0; i < 12; i++) {
    seen.add(await zoom.inputValue());
    await editor.waitForTimeout(100);
  }
  expect(seen.size).toBe(1);
});
