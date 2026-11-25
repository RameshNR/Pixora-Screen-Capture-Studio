import { buildRecordingConfig } from '../../src/recording/services/config';
import { DEFAULT_SETTINGS } from '../../src/shared/constants/defaults';
import { chunkCount, expect, recordingState, send, test, waitForPage } from './fixtures';
import type { Page } from '@playwright/test';

// MediaRecorder gives no data headless, and the sharing bar only exists on a real desktop.
test.use({ headed: true });

/**
 * Pixels of the "Stop sharing" pill (light blue #A8C7FA on the dark bar, or #0B57D0 on the light one)
 * that sit on Chrome's plain bar colour, in the bottom band of a <video>'s current frame.
 */
async function pillPixels(page: Page, selector: string): Promise<number> {
  return page.locator(selector).first().evaluate((v: HTMLVideoElement) => {
    const W = v.videoWidth, H = v.videoHeight;
    const c = new OffscreenCanvas(W, H);
    const x = c.getContext('2d', { willReadFrequently: true })!;
    x.drawImage(v, 0, 0);
    // The bottom band of the screen, where Chrome puts its bar (not a picture of the screen shown higher up).
    const top = Math.floor(H * 0.82);
    const d = x.getImageData(0, top, W, H - top).data;
    const w = W;
    const blue = (i: number) => d[i + 2]! >= 150 && d[i + 2]! - d[i]! >= 50 && d[i + 2]! - d[i + 1]! >= 25;
    let n = 0;
    for (let y = 0; y < H - top; y += 2) {
      for (let px = 0; px < w; px += 2) {
        const i = (y * w + px) * 4;
        if (!blue(i)) continue;
        // On the bar: plain grey a little to the left (the bar, not a blue picture).
        const j = (y * w + Math.max(0, px - 30)) * 4;
        if (Math.max(d[j]!, d[j + 1]!, d[j + 2]!) - Math.min(d[j]!, d[j + 1]!, d[j + 2]!) <= 24) n++;
      }
    }
    return n;
  });
}

test('screen recording: Chrome’s “is sharing your screen” bar is painted out of the recorded video', async ({ context, extPage }) => {
  test.setTimeout(180_000);
  const cfg = { ...buildRecordingConfig(DEFAULT_SETTINGS.recording, { mode: 'desktop' }), countdownSeconds: 0, controlBar: false, resolution: '1080p' as const, systemAudio: false };
  await send(extPage, { target: 'background', type: 'recording/start', config: cfg, tabId: null });
  const recorder = await waitForPage(context, (u) => u.includes('/recorder.html'));
  const outcome = await expect.poll(async () => (await recordingState(extPage)).status, { timeout: 20_000 }).toBe('recording').then(() => 'recording', () => 'unavailable');
  test.skip(outcome !== 'recording', 'desktop capture is not available in this environment');
  await expect.poll(() => chunkCount(extPage), { timeout: 30_000 }).toBeGreaterThanOrEqual(2);
  // Control: the live preview shows the raw screen, bar included (when Chrome shows one here).
  await recorder.waitForTimeout(1500);
  const before = await pillPixels(recorder, 'video');
  if (process.env.SHAREBAR_DEBUG) await saveFrame(recorder, 'test-results/sharebar-preview.png');
  test.skip(before < 200, `Chrome showed no sharing bar on this desktop (${before} pill pixels)`);
  await recorder.waitForTimeout(2500);
  await send(extPage, { target: 'background', type: 'recording/command', command: 'stop' });
  const result = await waitForPage(context, (u) => u.includes('/video.html?id='));
  await expect(result.getByRole('heading', { name: 'Recording details' })).toBeVisible({ timeout: 20_000 });
  const v = result.locator('video').first();
  await v.evaluate(async (el: HTMLVideoElement) => {
    if (el.readyState < 1) await new Promise((r) => el.addEventListener('loadedmetadata', r, { once: true }));
    el.currentTime = Math.min(2, (el.duration || 3) / 2);
    await new Promise((r) => el.addEventListener('seeked', r, { once: true }));
  });
  const after = await pillPixels(result, 'video');
  if (process.env.SHAREBAR_DEBUG) await saveFrame(result, 'test-results/sharebar-recorded.png');
  console.log(`SHAREBAR pill pixels: preview ${before}, recording ${after}`);
  expect(after).toBeLessThan(before * 0.05);
});

async function saveFrame(page: Page, path: string): Promise<void> {
  const b64 = await page.locator('video').first().evaluate(async (v: HTMLVideoElement) => {
    const c = new OffscreenCanvas(v.videoWidth, v.videoHeight);
    c.getContext('2d')!.drawImage(v, 0, 0);
    const blob = await c.convertToBlob({ type: 'image/png' });
    return await new Promise<string>((ok) => { const r = new FileReader(); r.onload = () => ok((r.result as string).split(',')[1]!); r.readAsDataURL(blob); });
  });
  (await import('node:fs')).writeFileSync(path, Buffer.from(b64, 'base64'));
}
