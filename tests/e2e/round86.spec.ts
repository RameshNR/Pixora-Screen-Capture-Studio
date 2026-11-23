import { expect, test } from './fixtures';

/** Share of green (#00B140-like) pixels in the camera preview video. */
async function greenShare(page: import('@playwright/test').Page): Promise<number> {
  return page.evaluate(() => {
    const v = document.querySelector('video[aria-label="Camera preview video"]') as HTMLVideoElement | null;
    if (!v || !v.videoWidth) return -1;
    const c = new OffscreenCanvas(v.videoWidth, v.videoHeight);
    const x = c.getContext('2d', { willReadFrequently: true })!;
    x.drawImage(v, 0, 0);
    const d = x.getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i]! < 60 && d[i + 1]! > 140 && d[i + 2]! < 110) n++;
    return n / (d.length / 4);
  });
}

test('camera background: the preview changes on this computer (colour), and back to none', async ({ context, extensionId, extPage }) => {
  test.setTimeout(120_000);
  await extPage.evaluate(async () => {
    const k = 'glint.settings';
    const cur = ((await chrome.storage.local.get(k))[k] ?? {}) as { recording?: Record<string, unknown> };
    await chrome.storage.local.set({ [k]: { ...cur, recording: { ...(cur.recording ?? {}), cameraBackground: { mode: 'none', blur: 14, color: '#00B140' } } } });
  });
  const settings = await context.newPage();
  await settings.setViewportSize({ width: 1280, height: 900 });
  await settings.goto(`chrome-extension://${extensionId}/options.html#recording`);
  const cam = settings.getByRole('region', { name: 'Camera settings' });
  // Chrome answers whether camera access is allowed after a moment.
  const granted = await cam.waitFor({ state: 'visible', timeout: 8000 }).then(() => true, () => false);
  test.skip(!granted, 'No camera access in this browser');
  await expect(cam.getByLabel('Camera preview', { exact: true })).toBeVisible();
  // The camera starts only when asked (Round 99).
  await cam.getByRole('button', { name: 'Start live test' }).click();
  await expect.poll(() => greenShare(settings), { timeout: 15_000 }).toBeGreaterThanOrEqual(0);
  expect(await greenShare(settings)).toBeLessThan(0.2);

  const bgGroup = cam.getByRole('radiogroup', { name: 'Camera background' });
  await bgGroup.getByRole('radio', { name: 'Colour' }).click();
  // The test camera shows no person: the segmenter replaces everything with the colour.
  await expect.poll(() => greenShare(settings), { timeout: 30_000, intervals: [500] }).toBeGreaterThan(0.8);
  await bgGroup.getByRole('radio', { name: 'None' }).click();
  await expect.poll(() => greenShare(settings), { timeout: 10_000 }).toBeLessThan(0.2);

  // Picture: a ready-made one is kept under its own key, not in the settings.
  await bgGroup.getByRole('radio', { name: 'Picture' }).click();
  await cam.getByRole('button', { name: 'Background: Lavender' }).click();
  await expect(cam.getByRole('img', { name: 'Current background picture' })).toBeVisible();
  const stored = await extPage.evaluate(async () => {
    const all = await chrome.storage.local.get(['glint.cameraBackgroundImage', 'glint.settings']);
    return { pic: String(all['glint.cameraBackgroundImage'] ?? '').slice(0, 23), inSettings: JSON.stringify(all['glint.settings']).includes('data:image') };
  });
  expect(stored).toEqual({ pic: 'data:image/jpeg;base64,', inSettings: false });
});

test('tooltips stay inside a small window', async ({ context, extensionId }) => {
  const popup = await context.newPage();
  await popup.setViewportSize({ width: 380, height: 600 });
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  await popup.getByRole('tab', { name: 'Record' }).click();
  for (const name of ['Desktop', 'Camera Only', 'This Tab', 'Custom Area']) {
    const card = popup.getByRole('radio', { name });
    await card.hover();
    const tip = popup.getByRole('tooltip');
    await expect(tip).toBeVisible();
    const r = (await tip.boundingBox())!;
    const c = (await card.boundingBox())!;
    expect(r.x, name).toBeGreaterThanOrEqual(0);
    expect(r.x + r.width, name).toBeLessThanOrEqual(380);
    // Wider than the card: left column starts where the card starts, right column ends where it
    // ends; narrower: centred under the card.
    if (r.width <= c.width) expect(Math.abs(r.x + r.width / 2 - (c.x + c.width / 2)), name).toBeLessThanOrEqual(1);
    else if (c.x < 190) expect(Math.abs(r.x - c.x), name).toBeLessThanOrEqual(1);
    else expect(Math.abs(r.x + r.width - (c.x + c.width)), name).toBeLessThanOrEqual(1);
    await popup.mouse.move(5, 590);
    await expect(tip).toHaveCount(0);
  }
});
