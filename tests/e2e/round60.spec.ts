import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, type Page } from '@playwright/test';
import { expect, test } from './fixtures';

async function makeVideo(): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), 'pixora-video-'));
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, recordVideo: { dir, size: { width: 1280, height: 720 } } });
  const page = await ctx.newPage();
  await page.setContent('<body style="margin:0;background:#e5e7eb"></body>');
  await page.waitForTimeout(2000);
  const video = page.video()!;
  await ctx.close();
  const b64 = readFileSync(await video.path()).toString('base64');
  await browser.close();
  rmSync(dir, { recursive: true, force: true });
  return b64;
}

const callout = (id: string, patch: Record<string, unknown>) => ({
  id: `ov_${id}`, start: 0, end: 60, animIn: 'none', animOut: 'none', effect: 'none',
  annotation: { id, type: 'callout', y: 100, w: 400, h: 150, text: '', fill: 'transparent', stroke: '#ff8800', strokeWidth: 6, radius: 0, tail: 'speech', color: '#000000', fontFamily: 'Inter', fontSize: 18, bold: false, italic: false, align: 'left', opacity: 1, ...patch },
});

/** Is the orange line drawn at this point of the video (1280 × 720 coordinates)? */
const lineAt = (page: Page, x: number, y: number) =>
  page.evaluate(({ x, y }) => {
    const c = document.querySelector<HTMLCanvasElement>('canvas[class*="overlayCanvas"]')!;
    const k = c.width / 1280;
    const d = c.getContext('2d')!.getImageData(Math.round(x * k) - 1, Math.round(y * k) - 1, 3, 3).data;
    let hits = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i]! > 200 && d[i + 1]! > 90 && d[i + 2]! < 90 && d[i + 3]! > 170) hits++;
    return hits > 0;
  }, { x, y });

/** How many separate dots or dashes are drawn along a horizontal line of the video. */
const marksAlong = (page: Page, y: number, x0: number, x1: number) =>
  page.evaluate(({ y, x0, x1 }) => {
    const c = document.querySelector<HTMLCanvasElement>('canvas[class*="overlayCanvas"]')!;
    const k = c.width / 1280;
    const left = Math.round(x0 * k);
    const d = c.getContext('2d')!.getImageData(left, Math.round(y * k), Math.round((x1 - x0) * k), 1).data;
    let marks = 0;
    let on = false;
    for (let i = 0; i < d.length; i += 4) {
      const now = d[i + 3]! > 120;
      if (now && !on) marks++;
      on = now;
    }
    return marks;
  }, { y, x0, x1 });

test('dotted callout lines are drawn, open tails join the body, video reset, Recent arrow', async ({ context, extPage, extensionId }) => {
  test.setTimeout(120_000);
  const b64 = await makeVideo();
  const hist = await context.newPage();
  await hist.goto(`chrome-extension://${extensionId}/options.html#history`);
  await expect.poll(() => hist.evaluate(async () => (await indexedDB.databases()).some((d) => d.name === 'glint-capture'))).toBe(true);
  await hist.close();
  const overlays = [
    callout('classic', { x: 60, tailX: 260, tailY: 400, design: 'bubble' }),
    callout('recipe', { x: 700, tailX: 900, tailY: 400, design: 'soft' }),
    callout('dots', { x: 60, y: 480, h: 130, tail: 'leader', leaderEnd: 'none', tailX: 900, tailY: 545, design: 'bubble', dash: 'dotted' }),
  ];
  await extPage.evaluate(({ b64, overlays }) => new Promise<void>((resolve, reject) => {
    const blob = new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], { type: 'video/webm' });
    const req = indexedDB.open('glint-capture');
    req.onsuccess = () => {
      const tx = req.result.transaction(['captures', 'blobs'], 'readwrite');
      tx.objectStore('captures').put({ id: 'v_60', kind: 'video', name: 'Lines.webm', mimeType: 'video/webm', size: blob.size, width: 1280, height: 720, createdAt: Date.now(), updatedAt: Date.now(), durationMs: 2000, overlays });
      tx.objectStore('blobs').put(blob, 'v_60');
      tx.oncomplete = () => { req.result.close(); resolve(); };
      tx.onerror = () => reject(tx.error);
    };
  }), { b64, overlays });

  const page = await context.newPage();
  await page.setViewportSize({ width: 1500, height: 950 });
  await page.goto(`chrome-extension://${extensionId}/video.html?id=v_60`);
  await expect(page.locator('canvas[class*="overlayCanvas"]')).toBeVisible();
  await expect.poll(() => lineAt(page, 150, 250), { timeout: 15_000 }).toBe(true);

  // No background: the body's line is open where the tail starts; the tail's sides are drawn.
  for (const left of [60, 700]) {
    const middle = left + 200;
    expect(await lineAt(page, left + 60, 250)).toBe(true);
    expect(await lineAt(page, middle, 250)).toBe(false);
    expect(await lineAt(page, middle, 244)).toBe(false);
  }

  // Dotted: many separate dots along the outline and along the leader line.
  expect(await marksAlong(page, 610, 100, 420)).toBeGreaterThan(8);
  expect(await marksAlong(page, 545, 520, 860)).toBeGreaterThan(8);

  // The Recent arrow is centred with its text.
  const recent = page.getByRole('button', { name: 'Recent', exact: true });
  const offset = await recent.evaluate((b) => {
    const text = [...b.querySelectorAll('span')].find((s) => s.textContent === 'Recent' && !s.children.length)!;
    const arrow = [...b.querySelectorAll('svg')].at(-1)!;
    const range = document.createRange();
    range.selectNodeContents(text);
    const t = range.getBoundingClientRect();
    const a = arrow.getBoundingClientRect();
    return Math.abs(t.top + t.height / 2 - (a.top + a.height / 2));
  });
  expect(offset).toBeLessThanOrEqual(1);

  // Reset asks first, removes the drawings, and can be undone.
  const tracks = page.locator('[data-overlay-id]');
  await expect(tracks).toHaveCount(3);
  await page.getByRole('button', { name: 'Reset to original' }).click();
  const ask = page.getByRole('dialog', { name: /Reset to the original video/ });
  await ask.getByRole('button', { name: 'Cancel' }).click();
  await expect(tracks).toHaveCount(3);
  await page.getByRole('button', { name: 'Reset to original' }).click();
  await ask.getByRole('button', { name: 'Reset', exact: true }).click();
  await expect(tracks).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Reset to original' })).toBeDisabled();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(tracks).toHaveCount(3);
});
