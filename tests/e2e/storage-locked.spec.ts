// Pixora when Chrome cannot open its storage ("Internal error opening backing store for indexedDB.open"):
// the database files are locked, as by a stuck Chrome process. Screenshots and recordings must still be
// saved (to Downloads) and a recording kept that way must not be reported as a failure.
import { chromium, expect, test } from '@playwright/test';
import { closeSync, mkdtempSync, openSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { buildRecordingConfig } from '../../src/recording/services/config';
import { DEFAULT_SETTINGS } from '../../src/shared/constants/defaults';
import { ensureFakeMedia } from './media-fixtures';

test.skip(process.platform !== 'win32', 'locks the database files with a Windows file lock');

test('screenshots and recordings are saved to Downloads when storage cannot be opened', async () => {
  test.setTimeout(240_000);
  const EXT = resolve('dist-e2e');
  const media = ensureFakeMedia();
  const dir = mkdtempSync(join(tmpdir(), 'pixora-broken-'));
  const args = [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
    `--use-file-for-fake-video-capture=${media.video}`, `--use-file-for-fake-audio-capture=${media.audio}`, '--autoplay-policy=no-user-gesture-required'];
  const launch = () => chromium.launchPersistentContext(dir, { channel: 'chromium', headless: false, viewport: { width: 1200, height: 800 }, acceptDownloads: true, args });
  const server = createServer((_, res) => { res.setHeader('content-type', 'text/html'); res.end('<h1 style="font:40px sans-serif">Hello page</h1>'); });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/`;

  let ctx = await launch();
  let sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker'));
  const id = sw.url().split('/')[2]!;
  let ext = await ctx.newPage();
  await ext.goto(`chrome-extension://${id}/options.html#history`);
  await ext.waitForTimeout(1500);
  await ctx.close();

  const idbRoot = join(dir, 'Default', 'IndexedDB');
  const folder = readdirSync(idbRoot).find((f) => f.includes(id) && f.endsWith('.leveldb'))!;
  const lockFile = join(idbRoot, folder, 'LOCK');
  const locker = spawn('powershell', ['-NoProfile', '-Command', `$f=[System.IO.File]::Open('${lockFile}','Open','ReadWrite','None'); Start-Sleep -Seconds 600`], { stdio: 'ignore' });
  // Wait until PowerShell really holds the lock (it can start slowly when the machine is busy).
  const locked = () => { try { closeSync(openSync(lockFile, 'r+')); return false; } catch { return true; } };
  for (let t = 0; t < 60 && !locked(); t++) await new Promise((r) => setTimeout(r, 500));
  expect(locked()).toBe(true);

  ctx = await launch();
  sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker'));
  sw.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log('sw:', m.type(), m.text().slice(0, 300)); });
  ext = await ctx.newPage();
  await ext.goto(`chrome-extension://${id}/options.html#general`);
  const opened = await ext.evaluate(() => new Promise((res) => { const r = indexedDB.open('glint-capture'); r.onsuccess = () => res('opened'); r.onerror = () => res('error: ' + r.error); }));
  expect(opened).toMatch(/backing store/);
  await sw.evaluate(() => {
    const g = self as unknown as { __notes: string[] };
    g.__notes = [];
    const o = chrome.notifications.create.bind(chrome.notifications) as (...a: unknown[]) => unknown;
    (chrome.notifications as unknown as { create: unknown }).create = (...a: unknown[]) => { g.__notes.push(JSON.stringify(a.slice(1))); return o(...a); };
  });
  const send = (m: object) => ext.evaluate((msg) => chrome.runtime.sendMessage(msg), m);
  const page = await ctx.newPage();
  await page.goto(url);
  await page.bringToFront();
  const tab = (await ext.evaluate(() => chrome.tabs.query({}))).find((t) => t.url === url)!;

  for (const mode of ['visible', 'full']) {
    console.log(`screenshot ${mode} ->`, JSON.stringify(await send({ target: 'background', type: 'screenshot/capture', mode, tabId: tab.id })));
    await page.waitForTimeout(1500);
  }

  // Camera recording with the default settings (Flow Capture on).
  const config = { ...buildRecordingConfig({ ...DEFAULT_SETTINGS.recording, mode: 'camera' }, {}, { experimental: false, flow: DEFAULT_SETTINGS.flow }), countdownSeconds: 0, controlBar: false };
  console.log('record start ->', JSON.stringify(await send({ target: 'background', type: 'recording/start', config, tabId: tab.id })).slice(0, 200));
  for (let i = 0; i < 30; i++) {
    const s = (await send({ target: 'background', type: 'recording/get-state' })) as { data: { status: string } };
    if (s.data.status === 'recording' || s.data.status === 'error' || s.data.status === 'idle') break;
    await page.waitForTimeout(1000);
  }
  await page.waitForTimeout(5000);
  console.log('record state ->', JSON.stringify(await send({ target: 'background', type: 'recording/get-state' })).slice(0, 300));
  console.log('stop ->', JSON.stringify(await send({ target: 'background', type: 'recording/command', command: 'stop' })).slice(0, 200));
  const t0 = Date.now();
  for (let i = 0; i < 40; i++) {
    const s = (await send({ target: 'background', type: 'recording/get-state' })) as { data: { status: string } };
    if (s.data.status === 'idle' || s.data.status === 'error') break;
    await page.waitForTimeout(500);
  }
  console.log('stop took', Date.now() - t0, 'ms');
  const st = await send({ target: 'background', type: 'recording/get-state' }) as { data: { status: string; error: unknown } };
  console.log('after stop ->', JSON.stringify({ status: st.data.status, error: st.data.error }));
  const rec = ctx.pages().find((p) => p.url().includes('recorder.html'));
  if (rec) console.log('recorder page says ->', (await rec.locator('h1').allInnerTexts()).join(' | '));

  console.log('notifications ->', JSON.stringify(await sw.evaluate(() => (self as unknown as { __notes: string[] }).__notes), null, 1));
  let dl = await ext.evaluate(() => chrome.downloads.search({}));
  for (let i = 0; i < 40 && dl.some((d) => d.state === 'in_progress'); i++) {
    await page.waitForTimeout(500);
    dl = await ext.evaluate(() => chrome.downloads.search({}));
  }
  expect(dl.every((d) => d.state === 'complete')).toBe(true);
  console.log('downloads ->', JSON.stringify(dl.map((d) => [d.mime, d.state, d.error, Math.round(d.fileSize / 1024) + 'KB'])));
  expect(dl.filter((d) => d.mime === 'image/png')).toHaveLength(2);
  expect(dl.filter((d) => d.mime.startsWith('video/'))).toHaveLength(1);
  // Kept in Downloads is a success: the recording is not shown as failed.
  expect(st.data.status).toBe('idle');
  const notes = await sw.evaluate(() => (self as unknown as { __notes: string[] }).__notes);
  expect(notes.join(' ')).not.toMatch(/Export failed|Something went wrong/);
  await ctx.close();
  locker.kill();
  server.close();
});
