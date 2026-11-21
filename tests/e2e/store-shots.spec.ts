import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, type Page } from '@playwright/test';
import { expect, test } from './fixtures';

/*
 * Chrome Web Store screenshots: Pixora's own pages only (no backdrop or frame around them), 1280 × 800,
 * in the light Purple Lavender theme. Headless. Run with:  STORE_SHOTS=1 npx playwright test store-shots
 * The demo picture is made up (an invented travel desk), not a real company or person.
 */
test.skip(!process.env.STORE_SHOTS, 'Only when making store screenshots (STORE_SHOTS=1).');

const W = 1280;
const H = 800;
const OUT = 'store-assets';

const DEMO = `<!doctype html><html><head><style>
  body { margin: 0; font: 15px/1.4 Inter, 'Segoe UI', system-ui, sans-serif; color: #1f2333; background: #f7f7fb; }
  header { display: flex; align-items: center; gap: 28px; padding: 18px 40px; background: #fff; border-bottom: 1px solid #e6e6ef; }
  header b { color: #6d28d9; font-size: 19px; } header span { color: #555; }
  main { padding: 28px 40px; }
  h1 { margin: 0 0 4px; font-size: 26px; } .sub { color: #6b6f80; margin-bottom: 22px; }
  .cards { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin-bottom: 22px; }
  .card { background: #fff; border: 1px solid #e6e6ef; border-radius: 12px; padding: 16px 18px; }
  .card small { color: #6b6f80; } .card div { font-size: 26px; font-weight: 700; margin-top: 4px; }
  .up { color: #16a34a; font-size: 13px; } .down { color: #dc2626; font-size: 13px; }
  .row { display: grid; grid-template-columns: 2fr 1fr; gap: 16px; }
  .chart { background: #fff; border: 1px solid #e6e6ef; border-radius: 12px; padding: 18px; height: 250px; display: flex; align-items: flex-end; gap: 14px; }
  .bar { flex: 1; border-radius: 6px 6px 0 0; background: linear-gradient(#a78bfa, #7c3aed); }
  .form { background: #fff; border: 1px solid #e6e6ef; border-radius: 12px; padding: 18px; display: grid; gap: 10px; align-content: start; }
  .field { border: 1px solid #d8d8e4; border-radius: 8px; padding: 9px 11px; color: #333; }
  .btn { background: #7c3aed; color: #fff; border-radius: 8px; padding: 10px; text-align: center; font-weight: 600; }
  table { width: 100%; margin-top: 18px; background: #fff; border: 1px solid #e6e6ef; border-radius: 12px; border-collapse: separate; border-spacing: 0; }
  td, th { padding: 10px 16px; text-align: left; border-bottom: 1px solid #f0f0f5; } th { color: #6b6f80; font-weight: 600; font-size: 13px; }
  .tag { padding: 2px 8px; border-radius: 99px; font-size: 12px; background: #dcfce7; color: #166534; } .tag.p { background: #ede9fe; color: #5b21b6; }
</style></head><body>
  <header><b>Lumen Travel Desk</b><span>Dashboard</span><span>Bookings</span><span>Customers</span><span>Reports</span></header>
  <main>
    <h1>Bookings overview</h1><div class="sub">Demo data for the Pixora screenshots — not a real company.</div>
    <div class="cards">
      <div class="card"><small>Bookings this week</small><div>1,284</div><span class="up">▲ 12.4%</span></div>
      <div class="card"><small>Revenue</small><div>$86,420</div><span class="up">▲ 8.1%</span></div>
      <div class="card"><small>Cancellations</small><div>37</div><span class="down">▼ 2.3%</span></div>
      <div class="card"><small>Rating</small><div>4.8</div><span class="up">▲ 0.2</span></div>
    </div>
    <div class="row">
      <div class="chart">${[42, 58, 51, 72, 66, 88, 80, 63, 70, 92, 97, 84].map((h) => `<div class="bar" style="height:${h}%"></div>`).join('')}</div>
      <div class="form"><b>New booking</b><div class="field">Ana Sousa</div><div class="field">Lisbon → Orlando</div><div class="field">12 Feb 2027</div><div class="field">Card •••• 4242</div><div class="btn">Book trip</div></div>
    </div>
    <table><tr><th>Reference</th><th>Customer</th><th>Trip</th><th>Status</th></tr>
      <tr><td>LT-20481</td><td>Ana Sousa</td><td>Lisbon → Orlando</td><td><span class="tag">Confirmed</span></td></tr>
      <tr><td>LT-20480</td><td>Kenji Mori</td><td>Osaka → Vancouver</td><td><span class="tag p">Pending</span></td></tr>
      <tr><td>LT-20479</td><td>Lea Martin</td><td>Paris → Montreal</td><td><span class="tag">Confirmed</span></td></tr>
    </table>
  </main>
</body></html>`;

/** The demo page as a picture, and as a short video (a pointer moving over it). */
async function demoMedia(): Promise<{ png: Buffer; webm: string }> {
  const dir = mkdtempSync(join(tmpdir(), 'pixora-store-'));
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, recordVideo: { dir, size: { width: 1280, height: 720 } } });
  const page = await ctx.newPage();
  await page.setContent(DEMO);
  const png = await page.screenshot();
  await page.evaluate(() => {
    const dot = document.createElement('div');
    dot.style.cssText = 'position:fixed;width:22px;height:22px;border-radius:50%;background:rgba(124,58,237,.35);border:3px solid #7c3aed;left:200px;top:300px;transition:all 2.5s ease-in-out';
    document.body.appendChild(dot);
    requestAnimationFrame(() => { dot.style.left = '1000px'; dot.style.top = '420px'; });
  });
  await page.waitForTimeout(3200);
  const video = page.video()!;
  await ctx.close();
  const webm = readFileSync(await video.path()).toString('base64');
  await browser.close();
  rmSync(dir, { recursive: true, force: true });
  return { png, webm };
}

async function useLavender(extPage: Page): Promise<void> {
  await extPage.evaluate(async () => {
    const k = 'glint.settings';
    const cur = ((await chrome.storage.local.get(k))[k] ?? {}) as { general?: Record<string, unknown> };
    await chrome.storage.local.set({ [k]: { ...cur, general: { ...(cur.general ?? {}), theme: 'purple-lavender' } } });
  });
}

async function drag(page: Page, x1: number, y1: number, x2: number, y2: number): Promise<void> {
  await page.mouse.move(x1, y1);
  await page.mouse.down();
  await page.mouse.move(x2, y2, { steps: 8 });
  await page.mouse.up();
}

test('store screenshots (Pixora pages only, Purple Lavender)', async ({ context, extPage, extensionId }) => {
  test.setTimeout(240_000);
  await useLavender(extPage);
  const { png, webm } = await demoMedia();
  const base = `chrome-extension://${extensionId}`;

  // ---- 1. Image editor: a capture with an arrow, a highlight box, a numbered marker and a blurred card number.
  const editor = await context.newPage();
  await editor.setViewportSize({ width: W, height: H });
  await editor.goto(`${base}/editor.html?import=1`);
  await editor.locator('input[type="file"]').first().setInputFiles({ name: 'Lumen dashboard.png', mimeType: 'image/png', buffer: png });
  const canvas = editor.getByRole('img', { name: 'Screenshot canvas' });
  await expect(canvas).toBeVisible();
  // More room for the picture: the image list folded away, fitted again.
  await editor.getByRole('button', { name: 'Hide image panel' }).click();
  await editor.waitForTimeout(400);
  await editor.keyboard.press('Escape');
  // Focus on the page (the file picker had it), so the tool keys reach the editor.
  const b0 = (await canvas.boundingBox())!;
  await editor.mouse.click(b0.x + 8, b0.y + 8);
  await editor.keyboard.press('Control+0');
  await editor.waitForTimeout(600);
  // The picture is centred in the workspace at the zoom shown in the toolbar.
  const b = (await canvas.boundingBox())!;
  const zoom = parseFloat(await editor.getByLabel('Zoom level').inputValue()) / 100;
  const px = (x: number, y: number) => [b.x + b.width / 2 + (x - 640) * zoom, b.y + b.height / 2 + (y - 360) * zoom] as const;
  await editor.keyboard.press('r');
  await drag(editor, ...px(30, 150), ...px(640, 250));
  await editor.keyboard.press('Escape');
  await editor.keyboard.press('a');
  await drag(editor, ...px(560, 560), ...px(380, 450));
  await editor.keyboard.press('Escape');
  await editor.keyboard.press('b');
  await drag(editor, ...px(880, 430), ...px(1230, 470));
  await editor.keyboard.press('Escape');
  await editor.keyboard.press('n');
  await editor.mouse.click(...px(1180, 330));
  await editor.keyboard.press('Escape');
  await editor.keyboard.press('a');
  await editor.waitForTimeout(600);
  await expect(editor.getByRole('tab', { name: /Layers\s*4/ })).toBeVisible();
  await editor.screenshot({ path: `${OUT}/screenshot-1-editor.png` });

  // ---- 2. Video editor: the demo recording with a highlight box and an arrow on it.
  await extPage.evaluate(
    ({ webm, png64 }) =>
      new Promise<void>((resolve, reject) => {
        const video = new Blob([Uint8Array.from(atob(webm), (c) => c.charCodeAt(0))], { type: 'video/webm' });
        const pic = new Blob([Uint8Array.from(atob(png64), (c) => c.charCodeAt(0))], { type: 'image/png' });
        const req = indexedDB.open('glint-capture');
        req.onsuccess = async () => {
          const thumb = async (blob: Blob, crop = 0) => {
            const bmp = await createImageBitmap(blob);
            const c = new OffscreenCanvas(320, 180);
            c.getContext('2d')!.drawImage(bmp, crop, 0, bmp.width - crop, bmp.height, 0, 0, 320, 180);
            const r = new FileReader();
            return new Promise<string>((ok) => { r.onload = () => ok(r.result as string); c.convertToBlob({ type: 'image/jpeg', quality: 0.85 }).then((x) => r.readAsDataURL(x)); });
          };
          const pthumb = await thumb(pic);
          const now = Date.now();
          const tx = req.result.transaction(['captures', 'blobs'], 'readwrite');
          const caps = tx.objectStore('captures');
          const blobs = tx.objectStore('blobs');
          caps.put({
            id: 'v_store', kind: 'video', name: 'Booking walkthrough.webm', mimeType: 'video/webm', size: video.size, width: 1280, height: 720, createdAt: now, updatedAt: now, durationMs: 3000, thumbnail: pthumb,
            overlays: [
              { id: 'ov1', annotation: { id: 'a1', type: 'rect', x: 30, y: 150, w: 610, h: 100, stroke: '#8B5CF6', fill: 'transparent', width: 6, opacity: 1, radius: 12 }, start: 0, end: 60, animIn: 'none', animOut: 'none', effect: 'none' },
              { id: 'ov2', annotation: { id: 'a2', type: 'arrow', x1: 1000, y1: 620, x2: 1120, y2: 470, color: '#8B5CF6', width: 8, opacity: 1, headStart: 'none', headEnd: 'triangle', bends: [], body: 'line' }, start: 0, end: 60, animIn: 'none', animOut: 'none', effect: 'none' },
            ],
          });
          blobs.put(video, 'v_store');
          const names = ['Bookings overview.png', 'Customer list.png', 'Monthly report.png', 'Checkout form.png', 'Lisbon offer.png'];
          names.forEach((name, i) => {
            const id = `s_store_${i}`;
            caps.put({ id, kind: 'screenshot', name, mimeType: 'image/png', size: pic.size, width: 1280, height: 720, createdAt: now - (i + 1) * 3_600_000, updatedAt: now - (i + 1) * 3_600_000, thumbnail: pthumb, sourceTitle: 'Lumen Travel Desk' });
            blobs.put(pic, id);
          });
          tx.oncomplete = () => { req.result.close(); resolve(); };
          tx.onerror = () => reject(tx.error);
        };
        req.onerror = () => reject(req.error);
      }),
    { webm, png64: png.toString('base64') },
  );
  const video = await context.newPage();
  await video.setViewportSize({ width: W, height: H });
  await video.goto(`${base}/video.html?id=v_store`);
  await expect(video.getByRole('button', { name: 'Undo', exact: true })).toBeVisible();
  // Let the timeline pictures finish loading.
  await video.waitForTimeout(9000);
  await video.screenshot({ path: `${OUT}/screenshot-2-video.png` });

  // ---- 3. Settings › Recording › Highlight mouse clicks.
  const settings = await context.newPage();
  await settings.setViewportSize({ width: W, height: H });
  await settings.goto(`${base}/options.html#recording`);
  const toggle = settings.getByRole('switch', { name: 'Highlight clicks' });
  await expect(toggle).toBeVisible();
  if ((await toggle.getAttribute('aria-checked')) !== 'true') await toggle.click();
  const preview = settings.getByRole('img', { name: /Click effect preview/ });
  await expect(preview).toBeVisible();
  // The click-highlight cards fill the page (the row's switch just above them).
  await toggle.evaluate((el) => el.scrollIntoView({ block: 'start' }));
  await settings.mouse.wheel(0, -30);
  await settings.waitForTimeout(1600);
  await settings.screenshot({ path: `${OUT}/screenshot-3-clicks.png` });

  // ---- 4. Recent captures.
  const history = await context.newPage();
  await history.setViewportSize({ width: W, height: H });
  await history.goto(`${base}/options.html#history`);
  await expect(history.getByText('Booking walkthrough.webm').first()).toBeVisible();
  await history.waitForTimeout(800);
  await history.screenshot({ path: `${OUT}/screenshot-4-captures.png` });

  // ---- 5. Themes (Settings › General).
  await history.goto(`${base}/options.html#general`);
  const theme = history.getByText('Purple Lavender').first();
  await expect(theme).toBeVisible();
  await theme.evaluate((el) => el.closest('section')?.scrollIntoView({ block: 'start' }));
  await history.waitForTimeout(600);
  await history.screenshot({ path: `${OUT}/screenshot-5-themes.png` });
});
