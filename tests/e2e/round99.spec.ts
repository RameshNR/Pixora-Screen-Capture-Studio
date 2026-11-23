import { expect, test } from './fixtures';
import { openStripes } from './redact-helpers';

test('Filters: each slider starts under its name; Full screen shows only the picture with Before / After, Split view and Exit full screen', async ({ context, extensionId }) => {
  const { editor } = await openStripes(context, extensionId);
  await editor.getByRole('button', { name: /^Filters/ }).click();
  await editor.getByRole('tab', { name: 'Adjust' }).click();
  const name = (await editor.getByText('Contrast', { exact: true }).boundingBox())!;
  const slider = (await editor.getByRole('slider', { name: 'Contrast', exact: true }).boundingBox())!;
  expect(Math.abs(slider.x - name.x)).toBeLessThan(3);

  // The test browser refuses real full screen: stand in for it, recording which element asked.
  await editor.evaluate(() => {
    let full: Element | null = null;
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => full });
    Element.prototype.requestFullscreen = function (this: Element) { full = this; document.dispatchEvent(new Event('fullscreenchange')); return Promise.resolve(); };
    document.exitFullscreen = () => { full = null; document.dispatchEvent(new Event('fullscreenchange')); return Promise.resolve(); };
  });
  const bar = editor.getByRole('group', { name: 'View' });
  await bar.getByRole('button', { name: 'Full screen' }).click();
  // The picture area alone goes full screen (not the whole page with its panels).
  await expect.poll(() => editor.evaluate(() => Boolean(document.fullscreenElement?.contains(document.querySelector('canvas')) && !document.fullscreenElement?.querySelector('[aria-label="Properties"]')))).toBe(true);
  // The bar is inside it.
  expect(await editor.evaluate(() => Boolean(document.fullscreenElement?.querySelector('[role="group"][aria-label="View"]')))).toBe(true);
  await expect(editor.getByRole('switch', { name: 'Before / After' })).toBeVisible();
  await expect(bar.getByRole('radio', { name: 'Slider' })).toBeVisible();
  await bar.getByRole('button', { name: 'Exit full screen' }).click();
  await expect.poll(() => editor.evaluate(() => document.fullscreenElement === null)).toBe(true);
  await expect(bar.getByRole('button', { name: 'Full screen' })).toBeVisible();
  await editor.close();
});

test('Settings › Camera: the camera is not turned on by opening the page, only by Start live test (and Stop test turns it off)', async ({ context, extensionId }) => {
  const page = await context.newPage();
  // Count camera requests made by the page.
  await page.addInitScript(() => {
    const w = window as unknown as { cameraCalls: number };
    w.cameraCalls = 0;
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = (c?: MediaStreamConstraints) => { if (c?.video) w.cameraCalls++; return original(c); };
  });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`chrome-extension://${extensionId}/options.html#recording`);
  const cam = page.getByRole('region', { name: 'Camera settings' });
  const granted = await cam.waitFor({ state: 'visible', timeout: 8000 }).then(() => true, () => false);
  test.skip(!granted, 'No camera access in this browser');
  await page.waitForTimeout(1500);
  expect(await page.evaluate(() => (window as unknown as { cameraCalls: number }).cameraCalls)).toBe(0);
  await cam.getByRole('button', { name: 'Start live test' }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { cameraCalls: number }).cameraCalls)).toBeGreaterThan(0);
  await expect.poll(() => page.evaluate(() => {
    const v = document.querySelector('video[aria-label="Camera preview video"]') as HTMLVideoElement | null;
    return Boolean(v?.srcObject && v.videoWidth > 0);
  }), { timeout: 15_000 }).toBe(true);
  await cam.getByRole('button', { name: 'Stop test' }).click();
  await expect(cam.getByRole('button', { name: 'Start live test' })).toBeVisible();
  await page.close();
});

test('the bar under the picture is there with every tool: Fit and Full screen always, Before / After and Split view once the picture has filters', async ({ context, extensionId }) => {
  const { editor } = await openStripes(context, extensionId);
  const bar = editor.getByRole('group', { name: 'View' });
  // Select tool, no filters yet.
  await expect(bar.getByRole('button', { name: 'Fit to screen' })).toBeVisible();
  await expect(bar.getByRole('button', { name: 'Full screen' })).toBeVisible();
  await expect(editor.getByRole('switch', { name: 'Before / After' })).toBeDisabled();
  // A filter, then another tool: the comparison stays offered.
  await editor.getByRole('button', { name: /^Filters/ }).click();
  await editor.getByRole('radiogroup', { name: 'Filter preset' }).getByRole('radio', { name: 'Noir', exact: true }).click();
  await editor.getByRole('button', { name: /^Pen/ }).click();
  await expect(editor.getByRole('switch', { name: 'Before / After' })).toBeVisible();
  await expect(bar.getByRole('radio', { name: 'Slider' })).toBeVisible();
  await expect(bar.getByRole('button', { name: 'Fit to screen' })).toBeVisible();
  await editor.close();
});

test('Before / After works for any change (here: erasing the picture), the Before side shows the picture as first opened', async ({ context, extensionId }) => {
  const { eraseTool, drag } = await import('./redact-helpers');
  const { editor, cx, cy } = await openStripes(context, extensionId);
  const blueAt = async (x: number, y: number) => {
    const shot = await editor.screenshot({ clip: { x: x - 15, y: y - 15, width: 30, height: 30 } });
    const d = await editor.evaluate(async (b64) => {
      const bmp = await createImageBitmap(new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], { type: 'image/png' }));
      const c = new OffscreenCanvas(bmp.width, bmp.height);
      const x2 = c.getContext('2d')!;
      x2.drawImage(bmp, 0, 0);
      return Array.from(x2.getImageData(0, 0, c.width, c.height).data);
    }, shot.toString('base64'));
    let n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i]! < 80 && d[i + 2]! > 160) n++;
    return n / (d.length / 4);
  };
  await expect(editor.getByRole('switch', { name: 'Before / After' })).toBeDisabled();
  // Erase a wide band in the middle to white.
  await eraseTool(editor, 'Image');
  await editor.getByRole('radiogroup', { name: 'Erase to' }).getByRole('radio', { name: 'White', exact: true }).click();
  await editor.getByRole('slider', { name: 'Brush size' }).fill('300');
  await drag(editor, cx - 150, cy, cx + 150, cy);
  await expect.poll(() => blueAt(cx - 60, cy)).toBeLessThan(0.02);
  // Compare: left of the divider is the original (stripes), right is now (white).
  await editor.getByRole('switch', { name: 'Before / After' }).click();
  await expect.poll(() => blueAt(cx - 60, cy)).toBeGreaterThan(0.2);
  expect(await blueAt(cx + 60, cy)).toBeLessThan(0.02);
  await editor.close();
});
