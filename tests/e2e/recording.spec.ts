import { readFileSync } from 'node:fs';
import { buildRecordingConfig } from '../../src/recording/services/config';
import { DEFAULT_SETTINGS } from '../../src/shared/constants/defaults';
import type { RecordingConfig } from '../../src/shared/types';
import { chunkCount, expect, readCaptures, recordingState, send, tabIdFor, test, waitForPage } from './fixtures';

function config(overrides: Partial<RecordingConfig> & Pick<RecordingConfig, 'mode'>): RecordingConfig {
  return { ...buildRecordingConfig(DEFAULT_SETTINGS.recording, { mode: overrides.mode }), countdownSeconds: 0, controlBar: false, ...overrides };
}

/** The first encoder in a fresh browser takes a moment to warm up; wait until data is flowing. */
async function waitForData(extPage: import('@playwright/test').Page, min = 1) {
  await expect.poll(() => chunkCount(extPage), { timeout: 30_000 }).toBeGreaterThanOrEqual(min);
}

async function waitStatus(extPage: import('@playwright/test').Page, status: string, timeout = 20_000) {
  await expect.poll(async () => (await recordingState(extPage)).status, { timeout }).toBe(status);
}

// MediaRecorder emits no data in headless Chromium (verified separately), so these run headed.
test.use({ headed: true });

test.describe('recording', () => {
  test('records the camera with microphone, pauses, resumes and saves', async ({ context, extPage }) => {
    const cfg = config({ mode: 'camera', resolution: '720p', mic: { ...buildRecordingConfig(DEFAULT_SETTINGS.recording).mic, enabled: true } });
    await send(extPage, { target: 'background', type: 'recording/start', config: cfg, tabId: null });
    const recorder = await waitForPage(context, (u) => u.includes('/recorder.html?session='));
    await waitStatus(extPage, 'recording');
    const live = await recordingState(extPage);
    expect(live.actual!.width).toBeGreaterThan(0);
    expect(live.actual!.width).toBeLessThanOrEqual(1280);

    await waitForData(extPage);
    await send(extPage, { target: 'background', type: 'recording/command', command: 'pause' });
    await waitStatus(extPage, 'paused');
    await recorder.waitForTimeout(1500);
    await send(extPage, { target: 'background', type: 'recording/command', command: 'resume' });
    await waitStatus(extPage, 'recording');
    await recorder.waitForTimeout(1500);
    await send(extPage, { target: 'background', type: 'recording/command', command: 'stop' });

    const result = await waitForPage(context, (u) => u.includes('/video.html?id='));
    await expect(result.getByRole('heading', { name: 'Recording details' })).toBeVisible();
    const [video] = await readCaptures(extPage);
    expect(video).toMatchObject({ kind: 'video' });
    expect(video!.audio).toEqual({ microphone: true, system: false });
    // Paused time (1.5 s) is excluded from the duration.
    const s = await recordingState(extPage);
    expect(s.status).toBe('idle');
    expect(video!.durationMs as number).toBeGreaterThan(1000);
    expect(video!.size as number).toBeGreaterThan(1000);
    // The player can decode it and knows its duration (WebM duration was patched).
    await expect.poll(() => result.locator('video').evaluate((v: HTMLVideoElement) => (Number.isFinite(v.duration) ? v.duration : -1))).toBeGreaterThan(1);

    // Remove the audio after recording.
    await result.getByRole('button', { name: 'Remove audio…' }).click();
    await result.getByRole('button', { name: 'Remove audio', exact: true }).click();
    await expect.poll(async () => (await readCaptures(extPage))[0]?.audio).toEqual({ microphone: false, system: false });
    // The player says there is no sound (hover badge, disabled volume) and so does the export dialog.
    await expect(result.getByRole('note', { name: 'This video has no audio' })).toBeAttached();
    await expect(result.getByRole('slider', { name: 'Volume (no audio)' })).toBeDisabled();
    await expect(result.locator('video')).toHaveAttribute('title', 'This video has no audio');
    await expect(result.getByRole('button', { name: 'No audio to remove' })).toBeDisabled();

    // Export at a lower resolution and quality, keeping a copy.
    await result.getByRole('button', { name: 'Export / Convert' }).click();
    const dialog = result.getByRole('dialog', { name: 'Export recording' });
    await expect(dialog.getByText('This video has no audio')).toBeVisible();
    await dialog.getByRole('radio', { name: 'WebM' }).click();
    await dialog.getByRole('button', { name: /^Resolution/ }).click();
    await result.getByRole('menuitemradio', { name: '240p' }).click();
    await dialog.getByRole('radio', { name: 'Low' }).click();
    await expect(dialog.getByLabel('Output summary')).toContainText('426 × 240');
    await dialog.getByRole('button', { name: /Export & keep copy/ }).click();
    await expect.poll(async () => (await readCaptures(extPage)).find((c) => String(c.name).includes('(240p)'))?.height, { timeout: 60_000 }).toBe(240);
  });

  test('saves, downloads and copies video frames, and builds a flow from chosen frames', async ({ context, extPage }) => {
    await send(extPage, { target: 'background', type: 'recording/start', config: config({ mode: 'camera', resolution: '720p' }), tabId: null });
    await waitForPage(context, (u) => u.includes('/recorder.html'));
    await waitStatus(extPage, 'recording');
    await waitForData(extPage, 5); // a few seconds, so two clearly different frames exist
    await send(extPage, { target: 'background', type: 'recording/command', command: 'stop' });
    const page = await waitForPage(context, (u) => u.includes('/video.html?id='));
    await page.setViewportSize({ width: 1400, height: 900 });
    await expect(page.getByRole('heading', { name: 'Recording details' })).toBeVisible({ timeout: 20_000 });
    const seek = async (t: number) => {
      await page.evaluate((sec) => new Promise<void>((resolve) => {
        const v = document.querySelector('video')!;
        v.addEventListener('seeked', () => resolve(), { once: true });
        v.currentTime = sec;
      }), t);
      await page.waitForTimeout(300);
    };
    await seek(0.3);
    await page.getByRole('tab', { name: 'Frames' }).click();

    // Download the frame as a PNG.
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download', exact: true }).last().click();
    const png = readFileSync((await (await download).path())!);
    expect(png.subarray(1, 4).toString()).toBe('PNG');

    // Copy it to the clipboard.
    await page.bringToFront();
    await page.getByRole('button', { name: 'Copy', exact: true }).last().click();
    await expect(page.getByText('Frame copied')).toBeVisible();

    // Save it to Recent captures.
    const before = (await readCaptures(extPage)).filter((c) => c.kind === 'screenshot').length;
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect.poll(async () => (await readCaptures(extPage)).filter((c) => c.kind === 'screenshot').length).toBe(before + 1);

    // Pick two frames (the same frame twice is refused) and make a flow.
    await page.getByRole('button', { name: /^Add this frame/ }).click();
    await expect(page.getByRole('button', { name: /^Go to frame 1/ })).toBeVisible();
    await page.getByRole('button', { name: /^Add this frame/ }).click();
    await expect(page.getByText('Same picture as frame 1')).toBeVisible();
    // A clearly different moment of the fake camera feed (frames 1.3 s apart could look alike).
    const dur = await page.evaluate(() => document.querySelector('video')!.duration);
    await seek(Number.isFinite(dur) && dur > 2 ? Math.max(1.6, dur - 0.4) : 1.6);
    await page.getByRole('button', { name: /^Add this frame/ }).click();
    await expect(page.getByRole('button', { name: /^Go to frame 2/ })).toBeVisible();
    await page.getByRole('textbox', { name: 'Caption of frame 1' }).fill('Start');
    await page.getByRole('button', { name: 'Create flow (2 frames)' }).click();
    const flowPage = await waitForPage(context, (u) => u.includes('/flow.html?id='));
    await expect(flowPage.getByRole('button', { name: /^Open image/ })).toHaveCount(2, { timeout: 15_000 });
    await expect(flowPage.getByRole('textbox', { name: 'Description of image 1' })).toHaveValue('Start');
    expect((await readCaptures(extPage)).some((c) => c.kind === 'flow')).toBe(true);

    // Link the flow to the recording (as Flow Capture does): one step list on the Frames tab.
    const recId = new URL(page.url()).searchParams.get('id')!;
    const flowId = new URL(flowPage.url()).searchParams.get('id')!;
    await extPage.evaluate(([rid, fid]) => new Promise<void>((resolve, reject) => {
      const req = indexedDB.open('glint-capture');
      req.onsuccess = () => {
        const store = req.result.transaction('captures', 'readwrite').objectStore('captures');
        const get = store.get(rid!);
        get.onsuccess = () => {
          const put = store.put({ ...get.result, linkedFlowId: fid });
          put.onsuccess = () => resolve();
          put.onerror = () => reject(put.error);
        };
      };
    }), [recId, flowId] as const);
    await page.reload();
    await expect(page.getByRole('heading', { name: /Flow steps/ })).toBeVisible({ timeout: 20_000 });
    const list = page.getByRole('list', { name: 'Flow steps of this recording' });
    await expect(list.locator('li')).toHaveCount(2);
    await page.getByRole('button', { name: 'Remove step 2' }).click();
    await expect(list.locator('li')).toHaveCount(1);
    await expect(page.getByRole('button', { name: /^Flow steps \(1\)/ })).toBeVisible();
    // A new frame joins the list in video order (before the frame at 0.3 s).
    await seek(0.1);
    await page.getByRole('button', { name: /^Add this frame/ }).click();
    await expect(list.locator('li')).toHaveCount(2);
    await expect(page.getByRole('textbox', { name: 'Caption of step 2' })).toHaveValue('Start');
  });

  test('opens a local video file for editing', async ({ context, extensionId, extPage }) => {
    // Make a real WebM: a short camera recording without audio, read back from storage.
    await send(extPage, { target: 'background', type: 'recording/start', config: config({ mode: 'camera', resolution: '720p' }), tabId: null });
    await waitForPage(context, (u) => u.includes('/recorder.html'));
    await waitStatus(extPage, 'recording');
    await waitForData(extPage, 2);
    await send(extPage, { target: 'background', type: 'recording/command', command: 'stop' });
    const recorded = await waitForPage(context, (u) => u.includes('/video.html?id='));
    const id = new URL(recorded.url()).searchParams.get('id')!;
    const b64 = await extPage.evaluate(
      (captureId) =>
        new Promise<string>((resolve, reject) => {
          const req = indexedDB.open('glint-capture');
          req.onsuccess = () => {
            const get = req.result.transaction('blobs', 'readonly').objectStore('blobs').get(captureId);
            get.onsuccess = async () => {
              const buf = new Uint8Array(await (get.result as Blob).arrayBuffer());
              let s = '';
              for (const x of buf) s += String.fromCharCode(x);
              resolve(btoa(s));
            };
            get.onerror = () => reject(get.error);
          };
          req.onerror = () => reject(req.error);
        }),
      id,
    );

    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/video.html?import=1`);
    await expect(page.getByRole('heading', { name: 'Edit a video file' })).toBeVisible();
    expect(b64.length).toBeGreaterThan(1000);
    await page.locator('input[type="file"]').setInputFiles({ name: 'clip.webm', mimeType: 'video/webm', buffer: Buffer.from(b64, 'base64') });
    await expect(page).toHaveURL(/video\.html\?id=/, { timeout: 20_000 });
    await expect(page.getByRole('heading', { name: 'Recording details' })).toBeVisible();
    await expect(page.getByText('640 × 360').first()).toBeVisible();
    // It has no sound, and says so.
    await expect(page.getByRole('note', { name: 'This video has no audio' })).toBeAttached();
  });

  test('requests 1080p and reports the real recorded resolution', async ({ context, extPage }) => {
    await send(extPage, { target: 'background', type: 'recording/start', config: config({ mode: 'camera', resolution: '1080p' }), tabId: null });
    await waitForPage(context, (u) => u.includes('/recorder.html'));
    await waitStatus(extPage, 'recording');
    const { actual } = await recordingState(extPage);
    await waitForData(extPage);
    expect(actual!.width).toBeLessThanOrEqual(1920);
    expect(actual!.height).toBeLessThanOrEqual(1080);
    await send(extPage, { target: 'background', type: 'recording/command', command: 'stop' });
    await waitForPage(context, (u) => u.includes('/video.html'));
    const [video] = await readCaptures(extPage);
    expect(video!.width).toBe(actual!.width);
  });

  test('attempts 4K 30 fps without upscaling beyond the source', async ({ context, extPage }) => {
    await send(extPage, { target: 'background', type: 'recording/start', config: config({ mode: 'camera', resolution: '2160p', fps: 30 }), tabId: null });
    await waitForPage(context, (u) => u.includes('/recorder.html'));
    await waitStatus(extPage, 'recording');
    const { actual } = await recordingState(extPage);
    await waitForData(extPage);
    expect(actual!.width).toBeLessThanOrEqual(3840);
    expect(actual!.height).toBeLessThanOrEqual(2160);
    await send(extPage, { target: 'background', type: 'recording/command', command: 'stop' });
    await waitForPage(context, (u) => u.includes('/video.html'));
    const [video] = await readCaptures(extPage);
    test.info().annotations.push({ type: '4K attempt', description: `recorded ${video!.width}×${video!.height}; notes: ${(video!.notes as string[]).join(' | ')}` });
  });

  test('prevents a second recording while one is running', async ({ context, extPage }) => {
    await send(extPage, { target: 'background', type: 'recording/start', config: config({ mode: 'camera' }), tabId: null });
    await waitForPage(context, (u) => u.includes('/recorder.html'));
    await waitStatus(extPage, 'recording');
    const res = (await extPage.evaluate(
      (c) => chrome.runtime.sendMessage({ target: 'background', type: 'recording/start', config: c, tabId: null }),
      config({ mode: 'camera' }),
    )) as { ok: boolean; error?: { code: string } };
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe('already-recording');
    await send(extPage, { target: 'background', type: 'recording/command', command: 'cancel' });
    await waitStatus(extPage, 'idle');
  });

  test('trims, exports and converts a recording on the result page', async ({ context, extPage }) => {
    await send(extPage, { target: 'background', type: 'recording/start', config: config({ mode: 'camera', resolution: '720p' }), tabId: null });
    await waitForPage(context, (u) => u.includes('/recorder.html'));
    await waitStatus(extPage, 'recording');
    await waitForData(extPage, 3);
    await send(extPage, { target: 'background', type: 'recording/command', command: 'stop' });
    const result = await waitForPage(context, (u) => u.includes('/video.html?id='));
    await expect(result.getByRole('heading', { name: 'Recording details' })).toBeVisible();

    // Trim (keeps the original) and export as WebM (packet copy, no re-encode).
    await expect.poll(() => result.locator('video').first().evaluate((v: HTMLVideoElement) => (Number.isFinite(v.duration) ? v.duration : 0))).toBeGreaterThan(1);
    await expect(result.getByRole('slider', { name: 'Trim start' }).first()).toBeVisible();
    const end = result.getByRole('textbox', { name: 'End time' });
    await end.fill('1.5');
    await end.press('Enter');
    await expect(end).toHaveValue('0:01.500');
    await result.getByRole('button', { name: 'Export trimmed' }).click();
    await result.getByRole('radio', { name: 'WebM' }).click();
    let download = result.waitForEvent('download', { timeout: 60_000 });
    await result.getByRole('button', { name: 'Export & download' }).click();
    const webm = readFileSync((await (await download).path())!);
    expect(webm.readUInt32BE(0)).toBe(0x1a45dfa3); // EBML magic

    // Convert to MP4 (H.264 via WebCodecs). Some Chromium builds lack an H.264 encoder; then the
    // app must report it clearly instead of failing silently.
    await result.getByRole('button', { name: 'Export / Convert' }).click();
    await result.getByRole('radio', { name: 'MP4 (H.264)' }).click();
    download = result.waitForEvent('download', { timeout: 90_000 });
    await result.getByRole('button', { name: 'Export & download' }).click();
    const outcome = await Promise.race([
      download.then(async (d) => ({ ok: true as const, bytes: readFileSync((await d.path())!) })),
      result.getByRole('alert').first().waitFor({ timeout: 90_000 }).then(async () => ({ ok: false as const, text: await result.getByRole('alert').first().innerText() })),
    ]);
    if (outcome.ok) {
      expect(outcome.bytes.subarray(4, 8).toString('ascii')).toBe('ftyp');
    } else {
      test.info().annotations.push({ type: 'mp4', description: `MP4 encoding unavailable here: ${outcome.text}` });
      expect(outcome.text).toMatch(/not supported|Conversion failed/i);
    }
    // The original recording is untouched.
    const [original] = (await readCaptures(extPage)).filter((c) => c.kind === 'video');
    expect(original).toBeTruthy();
  });

  test('records the desktop through Chrome’s picker', async ({ context, extPage }) => {
    await send(extPage, { target: 'background', type: 'recording/start', config: config({ mode: 'desktop', resolution: '1080p', systemAudio: false }), tabId: null });
    const recorder = await waitForPage(context, (u) => u.includes('/recorder.html'));
    const outcome = await Promise.race([
      waitStatus(extPage, 'recording', 20_000).then(() => 'recording'),
      recorder.getByRole('heading', { name: 'Sharing was cancelled' }).waitFor({ timeout: 20_000 }).then(() => 'cancelled'),
    ]).catch(() => 'timeout');
    // --auto-select-desktop-capture-source answers the picker in automation; without a desktop
    // session (e.g. some CI hosts) Chrome cannot share the screen.
    test.skip(outcome !== 'recording', `desktop picker not available in this environment (${outcome})`);
    await waitForData(extPage);
    const { actual } = await recordingState(extPage);
    expect(actual!.width).toBeLessThanOrEqual(1920);
    await send(extPage, { target: 'background', type: 'recording/command', command: 'stop' });
    await waitForPage(context, (u) => u.includes('/video.html?id='));
    const [video] = await readCaptures(extPage);
    expect(video).toMatchObject({ kind: 'video', width: actual!.width, height: actual!.height });
  });

  test('records this tab via tab capture (requires a user gesture in real Chrome)', async ({ context, extPage, baseUrl }) => {
    const page = await context.newPage();
    await page.goto(`${baseUrl}/long`);
    await page.bringToFront();
    const tabId = await tabIdFor(extPage, `${baseUrl}/long`);
    const res = (await extPage.evaluate(
      ({ c, tabId: t }) => chrome.runtime.sendMessage({ target: 'background', type: 'recording/start', config: c, tabId: t }),
      { c: config({ mode: 'tab', resolution: '1080p' }), tabId },
    )) as { ok: boolean; error?: { code: string } };
    // Chrome only grants tab capture after the user clicks the extension (activeTab); automation
    // cannot do that, so here we verify the failure is reported cleanly instead of hanging.
    test.skip(!res.ok, `tab capture needs a real toolbar click: ${res.error?.code}`);
    await waitStatus(extPage, 'recording');
    await waitForData(extPage);
    await send(extPage, { target: 'background', type: 'recording/command', command: 'stop' });
    await waitForPage(context, (u) => u.includes('/video.html'));
  });
});
