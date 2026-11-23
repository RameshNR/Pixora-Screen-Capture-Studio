import { buildRecordingConfig } from '../../src/recording/services/config';
import { DEFAULT_SETTINGS } from '../../src/shared/constants/defaults';
import type { RecordingConfig } from '../../src/shared/types';
import { chunkCount, expect, readCaptures, recordingState, send, tabIdFor, test, waitForPage } from './fixtures';

function config(overrides: Partial<RecordingConfig> & Pick<RecordingConfig, 'mode'>): RecordingConfig {
  return { ...buildRecordingConfig(DEFAULT_SETTINGS.recording, { mode: overrides.mode }), countdownSeconds: 0, controlBar: false, ...overrides };
}

async function waitStatus(extPage: import('@playwright/test').Page, status: string, timeout = 20_000) {
  await expect.poll(async () => (await recordingState(extPage)).status, { timeout }).toBe(status);
}

/** Counts strongly red pixels in a PNG screenshot of the page (decoded in the browser). */
async function redPixels(page: import('@playwright/test').Page, png: Buffer): Promise<number> {
  return page.evaluate(async (b64) => {
    const blob = await (await fetch(`data:image/png;base64,${b64}`)).blob();
    const bmp = await createImageBitmap(blob);
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    const ctx = c.getContext('2d')!;
    ctx.drawImage(bmp, 0, 0);
    const d = ctx.getImageData(0, 0, bmp.width, bmp.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i]! > 180 && d[i + 1]! < 120 && d[i + 2]! < 120) n++;
    return n;
  }, png.toString('base64'));
}

// MediaRecorder needs a headed browser (see recording.spec.ts).
test.use({ headed: true });

test.describe('live recording tools', () => {
  test('markers, live drawing on the page, effects and the control bar while recording', async ({ context, extPage, baseUrl }) => {
    const page = await context.newPage();
    await page.goto(`${baseUrl}/short`);
    const tabId = await tabIdFor(extPage, `${baseUrl}/short`);

    await send(extPage, { target: 'background', type: 'recording/start', config: config({ mode: 'camera', resolution: '720p', controlBar: true }), tabId });
    await waitForPage(context, (u) => u.includes('/recorder.html'));
    await waitStatus(extPage, 'recording');
    await expect.poll(() => chunkCount(extPage), { timeout: 30_000 }).toBeGreaterThanOrEqual(1);

    // Markers from the background API (same path as the keyboard shortcut and page shortcut).
    await send(extPage, { target: 'background', type: 'recording/marker', name: 'Intro' });

    // The control bar adds markers and shows them.
    const bar = await waitForPage(context, (u) => u.includes('/controlbar.html'));
    await bar.getByRole('button', { name: 'Add marker' }).click();
    await bar.getByRole('button', { name: /^Tools/ }).click();
    await expect(bar.getByRole('tab', { name: /Markers \(2\)/ })).toHaveAttribute('aria-selected', 'true');
    await expect(bar.getByRole('textbox', { name: /Marker name at/ }).first()).toHaveValue('Intro');

    // Live effects are accepted and reflected in the state the control bar shows.
    await send(extPage, { target: 'background', type: 'recording/effect', effect: { kind: 'zoom', level: 2, center: null } });
    await send(extPage, { target: 'background', type: 'recording/effect', effect: { kind: 'spotlight', on: true } });
    await expect(bar.getByRole('button', { name: 'Spotlight off' })).toBeVisible();
    await send(extPage, {
      target: 'background', type: 'recording/effect', effect: {
        kind: 'teleprompter', state: {
          text: 'Hello from the teleprompter', fontFamily: 'sans-serif', fontSize: 40, color: '#fff', background: '#000', backgroundOpacity: 0.8,
          align: 'center', lineHeight: 1.5, widthPct: 0.8, position: 'bottom', speed: 30, offset: 0, since: Date.now(), playing: true,
        },
      },
    });

    // Draw on the page being recorded.
    await page.bringToFront();
    const before = await redPixels(page, await page.screenshot());
    await send(extPage, { target: 'background', type: 'recording/annotate', action: { kind: 'start' } });
    await send(extPage, { target: 'background', type: 'recording/annotate', action: { kind: 'style', color: '#E05252', width: 8 } });
    await page.mouse.move(200, 300);
    await page.mouse.down();
    await page.mouse.move(500, 320, { steps: 12 });
    await page.mouse.up();
    await expect.poll(async () => (await redPixels(page, await page.screenshot())) - before).toBeGreaterThan(500);
    expect((await recordingState(extPage) as unknown as { effects: { annotating: boolean } }).effects.annotating).toBe(true);
    // Undo removes it again.
    await page.keyboard.press('Control+z');
    await expect.poll(async () => (await redPixels(page, await page.screenshot())) - before).toBeLessThan(100);

    await send(extPage, { target: 'background', type: 'recording/command', command: 'stop' });
    const result = await waitForPage(context, (u) => u.includes('/video.html?id='));
    await expect.poll(async () => ((await readCaptures(extPage))[0]?.markers as unknown[] | undefined)?.length ?? 0).toBe(2);
    const [video] = await readCaptures(extPage);
    expect((video!.markers as Array<{ name: string }>).map((m) => m.name)).toEqual(['Intro', 'Marker 2']);

    // Chapters appear on the result page and on the timeline.
    await expect(result.getByRole('tab', { name: /Chapters \(2\)/ })).toHaveAttribute('aria-selected', 'true');
    await expect(result.getByRole('button', { name: /Chapter Intro at/ })).toBeVisible();
    await expect(result.getByRole('button', { name: 'Go to Intro' })).toBeVisible();
    // The drawing overlay was removed from the page when recording finished.
    await expect.poll(() => page.evaluate(() => document.querySelector('[data-glint-overlay]') === null), { timeout: 10_000 }).toBe(true);
  });

  test('result page: trim editor, chapters and a privacy mask burned into the export', async ({ context, extPage }) => {
    await send(extPage, { target: 'background', type: 'recording/start', config: config({ mode: 'camera', resolution: '720p' }), tabId: null });
    await waitForPage(context, (u) => u.includes('/recorder.html'));
    await waitStatus(extPage, 'recording');
    await expect.poll(() => chunkCount(extPage), { timeout: 30_000 }).toBeGreaterThanOrEqual(3);
    await send(extPage, { target: 'background', type: 'recording/command', command: 'stop' });
    const result = await waitForPage(context, (u) => u.includes('/video.html?id='));
    await result.setViewportSize({ width: 1400, height: 950 });
    await expect(result.getByRole('heading', { name: 'Recording details' })).toBeVisible();
    await expect.poll(() => result.locator('video').first().evaluate((v: HTMLVideoElement) => (Number.isFinite(v.duration) ? v.duration : 0))).toBeGreaterThan(1);

    // Trim editor: exact times and the selected duration.
    const start = result.getByRole('textbox', { name: 'Start time' });
    await start.fill('0.5');
    await start.press('Enter');
    await expect(start).toHaveValue('0:00.500');
    await expect(result.getByLabel('Selected duration')).not.toContainText('0:00.000');
    await expect(result.getByRole('button', { name: 'Export trimmed' })).toBeEnabled();
    await result.getByRole('button', { name: 'Reset', exact: true }).click();

    // Chapters: add, rename, persisted.
    await result.getByRole('tab', { name: /Chapters/ }).click();
    await result.getByRole('button', { name: /^Add at/ }).click();
    await result.getByRole('textbox', { name: 'Chapter name' }).fill('Opening');
    await expect.poll(async () => ((await readCaptures(extPage))[0]?.markers as Array<{ name: string }> | undefined)?.[0]?.name).toBe('Opening');

    // Privacy: draw a region over the video and make it a black mask.
    // Privacy is in the Annotate rail (Advanced Video Editor, on by default).
    await result.getByRole('navigation', { name: 'Annotate' }).getByRole('button', { name: /^Privacy/ }).click();
    await result.getByRole('button', { name: 'Add region' }).click();
    const vbox = (await result.locator('video').first().boundingBox())!;
    await result.mouse.move(vbox.x + vbox.width * 0.3, vbox.y + vbox.height * 0.3);
    await result.mouse.down();
    await result.mouse.move(vbox.x + vbox.width * 0.7, vbox.y + vbox.height * 0.7, { steps: 6 });
    await result.mouse.up();
    await result.getByRole('button', { name: 'Hide this area' }).click();
    await result.getByRole('radiogroup', { name: 'Region 1 style' }).getByRole('radio', { name: 'Mask' }).click();
    await expect.poll(async () => ((await readCaptures(extPage))[0]?.redactions as unknown[] | undefined)?.length ?? 0).toBe(1);

    // Export a copy (same format, re-encoded because of the mask).
    await result.getByRole('button', { name: 'Export / Convert' }).click();
    const dialog = result.getByRole('dialog', { name: 'Export recording' });
    await dialog.getByRole('radio', { name: 'WebM' }).click();
    await expect(dialog.getByRole('checkbox', { name: /Apply 1 privacy region/ })).toBeChecked();
    await dialog.getByRole('button', { name: /Export & keep copy/ }).click();
    await expect.poll(async () => (await readCaptures(extPage)).length, { timeout: 60_000 }).toBe(2);

    // The masked area is black in the exported video; outside it is not.
    const pixels = await extPage.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((res, rej) => { const r = indexedDB.open('glint-capture'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
      const all = await new Promise<Array<{ id: string; createdAt: number }>>((res) => { const g = db.transaction('captures').objectStore('captures').getAll(); g.onsuccess = () => res(g.result); });
      const newest = all.sort((a, b) => b.createdAt - a.createdAt)[0]!;
      const blob = await new Promise<Blob>((res) => { const g = db.transaction('blobs').objectStore('blobs').get(newest.id); g.onsuccess = () => res(g.result as Blob); });
      const v = document.createElement('video');
      v.muted = true;
      v.src = URL.createObjectURL(blob);
      await new Promise((r) => (v.onloadeddata = r));
      v.currentTime = 0.6;
      await new Promise((r) => (v.onseeked = r));
      const c = new OffscreenCanvas(v.videoWidth, v.videoHeight);
      const ctx = c.getContext('2d')!;
      ctx.drawImage(v, 0, 0);
      const at = (fx: number, fy: number) => Array.from(ctx.getImageData(Math.round(v.videoWidth * fx), Math.round(v.videoHeight * fy), 1, 1).data.slice(0, 3));
      // Outside: the brightest of several points (the camera's moving stripes can make one point dark).
      const outs = [at(0.1, 0.1), at(0.9, 0.1), at(0.1, 0.9), at(0.9, 0.9), at(0.5, 0.1)];
      return { inside: at(0.5, 0.5), outside: outs.reduce((m, p) => (Math.max(...p) > Math.max(...m) ? p : m)) };
    });
    expect(Math.max(...pixels.inside)).toBeLessThan(40);
    expect(Math.max(...pixels.outside)).toBeGreaterThan(40);
  });

  test('teleprompter: write, save and scroll a script', async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.setViewportSize({ width: 700, height: 520 });
    await page.goto(`chrome-extension://${extensionId}/teleprompter.html`);
    const text = page.getByRole('textbox', { name: 'Script text' });
    await text.fill(Array.from({ length: 40 }, (_, i) => `Line ${i + 1} of the script that we read while recording.`).join('\n'));
    await page.getByRole('textbox', { name: 'Script name' }).fill('Demo');
    await page.getByRole('slider', { name: 'Scroll speed' }).fill('200');
    await page.getByRole('button', { name: 'Start prompter' }).click();
    await expect(page.getByRole('toolbar', { name: 'Teleprompter controls' })).toBeVisible();
    await expect.poll(() => page.locator('[class*="scroller"]').evaluate((el) => el.scrollTop), { timeout: 5000 }).toBeGreaterThan(50);
    // Pause, speed up, restart.
    await page.keyboard.press('Space');
    const paused = await page.locator('[class*="scroller"]').evaluate((el) => el.scrollTop);
    await page.waitForTimeout(400);
    expect(Math.abs((await page.locator('[class*="scroller"]').evaluate((el) => el.scrollTop)) - paused)).toBeLessThan(3);
    await page.keyboard.press('ArrowUp');
    await expect(page.getByLabel('Speed')).toHaveText('205 px/s');
    await page.keyboard.press('r');
    await expect.poll(() => page.locator('[class*="scroller"]').evaluate((el) => el.scrollTop)).toBeLessThan(5);
    await page.keyboard.press('Escape');
    // Saved: a reload shows the script again.
    await page.reload();
    await expect(page.getByRole('textbox', { name: 'Script name' })).toHaveValue('Demo');
    await expect(page.getByRole('textbox', { name: 'Script text' })).toHaveValue(/Line 40 of the script/);
  });
});
