import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, type Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { drag, eraseTool, openStripes } from './redact-helpers';

async function makeVideo(): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), 'pixora-video-'));
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, recordVideo: { dir, size: { width: 1280, height: 720 } } });
  const page = await ctx.newPage();
  await page.setContent('<body style="margin:0;background:#3b82a6"></body>');
  await page.waitForTimeout(2000);
  const video = page.video()!;
  await ctx.close();
  const b64 = readFileSync(await video.path()).toString('base64');
  await browser.close();
  rmSync(dir, { recursive: true, force: true });
  return b64;
}

test('video editor: Delete, Cut and Crop on a marked area become annotations on the timeline', async ({ context, extPage, extensionId }) => {
  test.setTimeout(150_000);
  const b64 = await makeVideo();
  const hist = await context.newPage();
  await hist.goto(`chrome-extension://${extensionId}/options.html#history`);
  await expect.poll(() => hist.evaluate(async () => (await indexedDB.databases()).some((d) => d.name === 'glint-capture'))).toBe(true);
  await hist.close();
  await extPage.evaluate((b64) => new Promise<void>((resolve, reject) => {
    const blob = new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], { type: 'video/webm' });
    const req = indexedDB.open('glint-capture');
    req.onsuccess = () => {
      const tx = req.result.transaction(['captures', 'blobs'], 'readwrite');
      tx.objectStore('captures').put({ id: 'v_97', kind: 'video', name: 'Areas.webm', mimeType: 'video/webm', size: blob.size, width: 1280, height: 720, createdAt: Date.now(), updatedAt: Date.now(), durationMs: 2000 });
      tx.objectStore('blobs').put(blob, 'v_97');
      tx.oncomplete = () => { req.result.close(); resolve(); };
      tx.onerror = () => reject(tx.error);
    };
  }), b64);

  const page = await context.newPage();
  await page.setViewportSize({ width: 1500, height: 950 });
  await page.goto(`chrome-extension://${extensionId}/video.html?id=v_97`);
  await page.evaluate(() => { navigator.clipboard.write = async () => undefined; });
  await page.getByRole('button', { name: 'Select', exact: true }).click();
  const layer = page.getByRole('region', { name: 'Draw on the video' });
  await expect(layer).toBeVisible({ timeout: 30_000 });
  const canvas = layer.getByRole('img', { name: 'Screenshot canvas' });
  await expect(canvas).toBeVisible();
  const b = (await canvas.boundingBox())!;
  const cx = b.x + b.width / 2;
  const cy = b.y + b.height / 2;
  const bar = page.getByRole('toolbar', { name: 'Marked area' });
  const tracks = page.getByLabel('Annotation tracks');

  const mark = async (dx: number) => {
    await drag(page, cx + dx - 40, cy - 30, cx + dx + 40, cy + 30);
    await expect(bar).toBeVisible();
  };
  await mark(-200);
  await bar.getByRole('button', { name: 'Delete area (Del)' }).click();
  await expect(tracks.getByRole('button', { name: 'Deleted area', exact: true })).toBeVisible();
  await mark(0);
  await bar.getByRole('button', { name: 'Cut area (Ctrl+X)' }).click();
  await expect(tracks.getByRole('button', { name: 'Cut area', exact: true })).toBeVisible();
  // Crop from the right-click menu.
  await mark(200);
  await page.mouse.click(cx + 200, cy, { button: 'right' });
  await page.getByRole('menuitem', { name: /^Crop to area/ }).click();
  await expect(tracks.getByRole('button', { name: 'Crop', exact: true })).toBeVisible();
  // Each has a time bar on the timeline.
  for (const name of ['Deleted area', 'Cut area', 'Crop']) await expect(tracks.getByRole('slider', { name: `${name} time` })).toBeVisible();
  await page.close();
});

/** Collects Chrome's "willReadFrequently" warnings on a page. */
function readbackWarnings(page: Page): string[] {
  const found: string[] = [];
  page.on('console', (m) => { if (/willReadFrequently/.test(m.text())) found.push(m.text()); });
  return found;
}

test('no "willReadFrequently" warning from Remove object, Remove background, Filters (Sharpen) or Pixelate', async ({ context, extensionId }) => {
  test.setTimeout(150_000);
  const { editor, cx, cy } = await openStripes(context, extensionId);
  const warnings = readbackWarnings(editor);
  await eraseTool(editor, 'Object');
  await editor.getByRole('radio', { name: 'Brush', exact: true }).click();
  await drag(editor, cx - 40, cy, cx + 40, cy);
  await drag(editor, cx - 40, cy + 30, cx + 40, cy + 30);
  await editor.keyboard.press('Control+z');
  await editor.keyboard.press('Enter');
  await expect(editor.getByText('Rebuilding the background…')).toHaveCount(0, { timeout: 30_000 });
  await eraseTool(editor, 'Background');
  await expect(editor.getByText(/^Found the subject|No clear subject/)).toBeVisible({ timeout: 60_000 });
  await editor.getByRole('button', { name: 'Cancel' }).click();
  await editor.getByRole('button', { name: /^Filters/ }).click();
  await editor.getByRole('tab', { name: 'Effects' }).click();
  await editor.getByRole('slider', { name: 'Sharpen', exact: true }).focus();
  await editor.keyboard.press('End');
  await editor.waitForTimeout(800);
  await editor.keyboard.press('x');
  await drag(editor, cx - 100, cy - 100, cx, cy);
  await editor.waitForTimeout(800);
  expect(warnings).toEqual([]);
  await editor.close();
});

test('Remove object on a screenshot card: the hole takes the card colour, no copied text, nothing spills past the card edge', async ({ context, extensionId }) => {
  test.setTimeout(120_000);
  const editor = await context.newPage();
  await editor.setViewportSize({ width: 1500, height: 950 });
  await editor.goto(`chrome-extension://${extensionId}/editor.html?import=1`);
  // Dark page, a white card (300–1100 × 150–450), a speckled picture (330–530 × 180–420) at the
  // card's left, and a black "Follow" button with white text beside it.
  const png = Buffer.from(await editor.evaluate(async () => {
    const c = new OffscreenCanvas(1400, 700);
    const x = c.getContext('2d')!;
    x.fillStyle = '#14171c';
    x.fillRect(0, 0, 1400, 700);
    x.fillStyle = '#ffffff';
    x.fillRect(300, 150, 800, 300);
    for (let i = 0; i < 4000; i++) { x.fillStyle = `hsl(${(i * 47) % 360} 60% 50%)`; x.fillRect(330 + ((i * 37) % 200), 180 + ((i * 91) % 240), 6, 6); }
    x.fillStyle = '#111111';
    x.fillRect(560, 360, 160, 50);
    x.fillStyle = '#ffffff';
    x.font = 'bold 24px sans-serif';
    x.fillText('Follow', 600, 393);
    return Array.from(new Uint8Array(await (await c.convertToBlob({ type: 'image/png' })).arrayBuffer()));
  }));
  await editor.locator('input[type="file"]').first().setInputFiles({ name: 'card.png', mimeType: 'image/png', buffer: png });
  const canvas = editor.getByRole('img', { name: 'Screenshot canvas' });
  await expect(canvas).toBeVisible();
  const c = (await canvas.boundingBox())!;
  const k = Number((await editor.getByLabel('Zoom level').inputValue()).replace('%', '')) / 100;
  const at = (x: number, y: number) => [c.x + c.width / 2 + (x - 700) * k, c.y + c.height / 2 + (y - 350) * k] as const;
  await eraseTool(editor, 'Object');
  await editor.getByRole('radio', { name: 'Box', exact: true }).click();
  // A box a little bigger than the picture, reaching past the card's left edge onto the page.
  await drag(editor, ...at(285, 170), ...at(540, 430));
  await editor.keyboard.press('Enter');
  await expect(editor.getByText('Rebuilding the background…')).toHaveCount(0, { timeout: 30_000 });
  await editor.waitForTimeout(500);
  const shot = async (x: number, y: number, half: number) => {
    const s = await editor.screenshot({ clip: { x: x - half, y: y - half, width: half * 2, height: half * 2 } });
    return editor.evaluate(async (b64) => {
      const bmp = await createImageBitmap(new Blob([Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0))], { type: 'image/png' }));
      const cv = new OffscreenCanvas(bmp.width, bmp.height);
      const x2 = cv.getContext('2d')!;
      x2.drawImage(bmp, 0, 0);
      return Array.from(x2.getImageData(0, 0, cv.width, cv.height).data);
    }, s.toString('base64'));
  };
  const share = (d: number[], t: (r: number, g: number, b: number) => boolean) => { let n = 0; for (let i = 0; i < d.length; i += 4) if (t(d[i]!, d[i + 1]!, d[i + 2]!)) n++; return n / (d.length / 4); };
  // Where the picture was: plain white card (no colours, no copied dark text).
  for (const [x, y] of [[430, 300], [360, 200], [500, 400]] as const) {
    expect(share(await shot(...at(x, y), 10), (r, g, b) => r > 245 && g > 245 && b > 245), `${x},${y}`).toBeGreaterThan(0.97);
  }
  // Left of the card edge (the box reached there): still the dark page, no white spill.
  expect(share(await shot(...at(292, 300), 4), (r, g, b) => r < 40 && g < 40 && b < 50)).toBeGreaterThan(0.9);
  // The Follow button is untouched.
  expect(share(await shot(...at(570, 385), 6), (r, g, b) => r < 30 && g < 30 && b < 30)).toBeGreaterThan(0.9);
  await editor.close();
});
