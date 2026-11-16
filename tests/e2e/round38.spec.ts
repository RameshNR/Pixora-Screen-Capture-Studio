import { readFileSync } from 'node:fs';
import { buildRecordingConfig } from '../../src/recording/services/config';
import { DEFAULT_SETTINGS } from '../../src/shared/constants/defaults';
import { chunkCount, expect, readCaptures, recordingState, send, test, waitForPage } from './fixtures';

// MediaRecorder emits no data in headless Chromium, so this runs headed (like recording.spec).
test.use({ headed: true });

test('advanced video editor: draw on a frame, timed overlay with animation, preview, saved, burned into the export', async ({ context, extPage }) => {
  test.setTimeout(240_000);
  const cfg = { ...buildRecordingConfig(DEFAULT_SETTINGS.recording, { mode: 'camera' }), countdownSeconds: 0, controlBar: false, resolution: '720p' as const };
  await send(extPage, { target: 'background', type: 'recording/start', config: cfg, tabId: null });
  await expect.poll(async () => (await recordingState(extPage)).status, { timeout: 20_000 }).toBe('recording');
  await expect.poll(() => chunkCount(extPage), { timeout: 30_000 }).toBeGreaterThanOrEqual(5);
  await send(extPage, { target: 'background', type: 'recording/command', command: 'stop' });
  const page = await waitForPage(context, (u) => u.includes('/video.html?id='));
  await page.setViewportSize({ width: 1600, height: 900 });
  await expect(page.getByRole('heading', { name: 'Recording details' })).toBeVisible({ timeout: 20_000 });

  // The Advanced Video Editor is on by default: the Annotate rail is next to the video.
  await expect(page.getByRole('switch', { name: 'Advanced Video Editor' })).toHaveAttribute('aria-checked', 'true');
  const rail = page.getByRole('navigation', { name: 'Annotate' });
  await rail.getByRole('button', { name: 'Shapes' }).click();
  // Drawing happens on the paused video itself (the Draw tab shows the tool settings).
  const layer = page.getByRole('region', { name: 'Draw on the video' });
  const canvas = layer.getByRole('img', { name: 'Screenshot canvas' });
  await expect(canvas).toBeVisible({ timeout: 20_000 });
  await expect(rail.getByRole('button', { name: 'Shapes' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('tab', { name: /^Annotations/ })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('complementary', { name: 'Properties' })).toBeVisible();
  const b = (await canvas.boundingBox())!;
  await page.mouse.move(b.x + b.width * 0.35, b.y + b.height * 0.35);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width * 0.65, b.y + b.height * 0.65, { steps: 6 });
  await page.mouse.up();

  // A track on the timeline, and the Apply to video card for the selected drawing.
  await expect(page.getByRole('slider', { name: 'Shape time' })).toBeVisible();
  const apply = page.getByRole('region', { name: 'Apply to video' });
  await expect(apply.getByRole('textbox', { name: 'Start time' })).toBeVisible();
  // Several animations: Fade in (default) + Slide in from left; effects: Pulse.
  await apply.getByRole('button', { name: 'Add to Animations in' }).click();
  await page.getByRole('menuitem', { name: 'Slide in from left (fade)' }).click();
  await expect(apply.getByRole('group', { name: 'Animations in' })).toContainText('Fade in');
  await expect(apply.getByRole('group', { name: 'Animations in' })).toContainText('Slide in from left (fade)');
  await apply.getByRole('button', { name: 'Add to Effects while shown' }).click();
  await page.getByRole('menuitem', { name: 'Pulse' }).click();
  await expect(apply.getByRole('group', { name: 'Effects while shown' })).toContainText('Pulse');
  await expect(apply.getByText('Saved')).toBeVisible();
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'C:/Users/RameshNR/AppData/Local/Temp/claude/e38ee6abf2d525ee/d20cb01a-01df-4a28-a8bd-03dbd5aa20f8/scratchpad/video-studio.png' });
  // Move over time: at a later moment, drag the drawing — it glides there.
  await apply.getByRole('checkbox', { name: /Move over time/ }).check({ force: true });
  await page.locator('video').evaluate((v: HTMLVideoElement) => { v.currentTime = 2.5; });
  await expect(page.getByRole('region', { name: 'Draw on the video' }).getByRole('img', { name: 'Screenshot canvas' })).toBeVisible();
  await page.getByRole('button', { name: /^Shape$/ }).first().click();
  await page.waitForTimeout(600);
  const c2 = (await page.getByRole('region', { name: 'Draw on the video' }).getByRole('img', { name: 'Screenshot canvas' }).boundingBox())!;
  await page.mouse.move(c2.x + c2.width * 0.5, c2.y + c2.height * 0.35);
  await page.mouse.down();
  await page.mouse.move(c2.x + c2.width * 0.7, c2.y + c2.height * 0.45, { steps: 6 });
  await page.mouse.up();
  await expect(page.getByRole('list', { name: 'Move points' }).getByRole('listitem')).toHaveCount(1);
  // Clicking the track shows its details and its times on both sides of the bar.
  await expect(page.getByRole('region', { name: 'Apply to video' })).toBeVisible();
  await expect(page.locator('[aria-label="Annotation tracks"]')).toContainText(/0:0\d\.\d{3}/);
  await page.screenshot({ path: 'C:/Users/RameshNR/AppData/Local/Temp/claude/e38ee6abf2d525ee/d20cb01a-01df-4a28-a8bd-03dbd5aa20f8/scratchpad/video-studio2.png' });

  // Hide / show from the track.
  await page.getByRole('button', { name: 'Hide Shape' }).click();
  await page.getByRole('button', { name: 'Show Shape' }).click();

  // Playing: the editor gives way to the live preview of the overlay.
  await page.getByRole('tab', { name: 'Details' }).click();
  await page.locator('video').evaluate((v: HTMLVideoElement) => { v.currentTime = 1.2; });
  await page.waitForTimeout(800);
  await expect.poll(() => page.locator('[data-player] canvas').first().evaluate((c: HTMLCanvasElement) => {
    const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 3; i < d.length; i += 16) if (d[i]! > 0) n++;
    return n;
  })).toBeGreaterThan(50);

  // Saved with the recording.
  await expect.poll(async () => ((await readCaptures(extPage)).find((c) => c.kind === 'video')?.overlays as unknown[] | undefined)?.length ?? 0).toBe(1);

  // Export burns it into the frames.
  await page.getByRole('button', { name: 'Export / Convert' }).click();
  const dialog = page.getByRole('dialog', { name: 'Export recording' });
  await expect(dialog.getByRole('checkbox', { name: /Burn in drawings \(1\)/ })).toBeChecked();
  await dialog.getByRole('radio', { name: 'WebM' }).click();
  const download = page.waitForEvent('download', { timeout: 120_000 });
  await dialog.getByRole('button', { name: 'Export & download' }).click();
  const file = readFileSync((await (await download).path())!);
  // Decode a frame of the exported video where the overlay shows and look for the box colour.
  const found = await page.evaluate(async (bytes) => {
    const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'video/webm' }));
    const v = document.createElement('video');
    v.muted = true;
    v.src = url;
    await new Promise((r) => { v.onloadeddata = r; });
    v.currentTime = 1.5;
    await new Promise((r) => { v.onseeked = r; });
    const c = new OffscreenCanvas(v.videoWidth, v.videoHeight);
    const x = c.getContext('2d')!;
    x.drawImage(v, 0, 0);
    // Scan across where the box's top edge and left edge are (the outline is a few px wide).
    // The whole frame: the box moves (Move over time), so look everywhere for its red outline.
    // The stroke is #E05252 (green ≈ blue); the brown test video has blue far below green.
    const d = x.getImageData(0, 0, v.videoWidth, v.videoHeight).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i]! > 190 && d[i + 1]! < 130 && d[i + 2]! < 130 && Math.abs(d[i + 1]! - d[i + 2]!) < 30) n++;
    return n > 100;
  }, Array.from(file));
  // The shape's red outline is in the exported frames.
  expect(found).toBe(true);
});
