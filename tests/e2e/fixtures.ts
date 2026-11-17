import { test as base, chromium, type BrowserContext, type Page, type Worker } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AddressInfo } from 'node:net';
import { ensureFakeMedia } from './media-fixtures';

const EXT_PATH = resolve(dirname(fileURLToPath(import.meta.url)), '../../dist-e2e');

const PAGES: Record<string, string> = {
  '/panels': `<!doctype html><html><head><title>Panels</title><style>
    html,body{margin:0;height:100%;overflow:hidden;font:16px sans-serif}
    .app{display:flex;height:100vh}
    .side{width:260px;overflow-y:auto;background:#eef2ff}
    .main{flex:1;overflow-y:auto}
    .row{height:120px;border-bottom:1px solid #ccd;display:flex;align-items:center;padding:0 16px}
  </style></head><body><div class="app">
    <nav class="side" aria-label="Sidebar">${Array.from({ length: 30 }, (_, i) => `<div class="row">Item ${i + 1}</div>`).join('')}</nav>
    <main class="main" aria-label="Main content">${Array.from({ length: 40 }, (_, i) => `<div class="row" style="background:hsl(${i * 9},70%,90%)">Row ${i + 1}</div>`).join('')}</main>
  </div></body></html>`,
  '/form': `<!doctype html><html><head><title>Sign up</title><style>body{font:16px sans-serif;margin:40px}label{display:block;margin:12px 0}</style></head><body>
    <h1>Create account</h1>
    <form id="signup" onsubmit="event.preventDefault();history.pushState({}, '', '/form/done');document.title='Welcome';document.querySelector('h1').textContent='Welcome!'">
      <label>Email <input id="email" name="email" type="email"></label>
      <label>Password <input id="password" name="password" type="password"></label>
      <label>Country <select id="country" name="country"><option>India</option><option>Japan</option></select></label>
      <label><input id="terms" type="checkbox"> I accept the terms</label>
      <button id="go" type="submit">Create account</button>
    </form>
    <div style="height:2000px"></div>
  </body></html>`,
  '/menu': `<!doctype html><html><head><title>Menu page</title><style>
    body{margin:0;font:16px sans-serif;background:#fff}
    #open{margin:40px;padding:8px 14px}
    #list{position:absolute;left:40px;top:90px;width:260px;transform-origin:top;transform:scaleY(0);transition:transform 600ms linear}
    #list.open{transform:scaleY(1)}
    #list div{height:40px;line-height:40px;padding:0 12px;background:#e8eefc}
    #list div.last{background:#ffd400}
  </style></head><body>
    <button id="open" aria-haspopup="listbox" aria-expanded="false" onclick="this.setAttribute('aria-expanded','true');document.getElementById('list').classList.add('open')">Choose plan</button>
    <div id="list" role="listbox"><div>Free</div><div>Team</div><div>Business</div><div class="last">Enterprise</div></div>
    <label style="position:absolute;top:400px;left:40px"><input id="agree" type="checkbox"> Agree</label>
  </body></html>`,
  '/loader': `<!doctype html><html><head><title>Loader page</title><style>
    body{margin:0;font:16px sans-serif;background:#fff}
    #go{margin:40px;padding:8px 14px}
    .page-loader{position:fixed;inset:0;display:none;place-items:center;background:#d0d5dd;font-size:28px}
    #content{display:none;position:fixed;inset:80px 0 0 0;background:#2e9e5b;color:#fff;font-size:28px;padding:40px}
  </style></head><body>
    <button id="go" onclick="const l=document.querySelector('.page-loader');l.style.display='grid';setTimeout(()=>{l.style.display='none';document.getElementById('content').style.display='block'},1500)">Open dashboard</button>
    <div class="page-loader" role="progressbar" aria-busy="true">Loading…</div>
    <div id="content">Dashboard ready</div>
  </body></html>`,
  '/short': `<!doctype html><html><head><title>Short page</title></head><body style="margin:0;background:#fdfdfd;font:16px sans-serif">
    <h1 style="margin:40px">Pixora test page</h1><p style="margin:40px">Visible capture fixture</p></body></html>`,
  '/long': `<!doctype html><html><head><title>Long page</title><style>
    body{margin:0;font:16px sans-serif} header{position:sticky;top:0;height:60px;background:#4f8df7;color:#fff}
    .band{height:500px;display:flex;align-items:center;justify-content:center;font-size:40px}
  </style></head><body><header>Sticky header</header>
  ${Array.from({ length: 8 }, (_, i) => `<div class="band" style="background:hsl(${i * 45},70%,85%)">Section ${i + 1}</div>`).join('')}
  </body></html>`,
  // Header that only becomes a (white) fixed bar after scrolling — like many real sites.
  '/sticky-js': `<!doctype html><html><head><title>Sticky on scroll</title><style>
    body{margin:0;background:#e9e9e9;font:16px sans-serif}
    #bar{height:50px;background:#203060}
    #bar.fixed{position:fixed;top:0;left:0;right:0;height:8px;background:#ffffff;z-index:10}
    .s{height:560px;margin:0 24px 16px;display:flex;align-items:center;justify-content:center;font-size:32px}
  </style></head><body><div id="bar"></div>
  ${Array.from({ length: 7 }, (_, i) => `<div class="s" style="background:hsl(${i * 50},60%,75%)">Block ${i + 1}</div>`).join('')}
  <script>addEventListener('scroll', () => document.getElementById('bar').classList.toggle('fixed', scrollY > 100));</script>
  </body></html>`,
};

export interface Fixtures {
  /** Media encoding (MediaRecorder) produces no data in headless Chromium, so recording specs run headed. */
  headed: boolean;
  /** Extra Chrome switches (a test's own `--auto-select-desktop-capture-source` replaces the default). */
  chromeArgs: string[];
  /** The window's real size instead of an emulated 1280×800 view (emulation rescales the page in the window). */
  realViewport: boolean;
  context: BrowserContext;
  extensionId: string;
  serviceWorker: Worker;
  baseUrl: string;
  extPage: Page;
}

let server: Server | null = null;
let baseUrl = '';

async function ensureServer(): Promise<string> {
  if (server) return baseUrl;
  server = createServer((req, res) => {
    const body = PAGES[req.url ?? ''] ?? '<!doctype html><title>404</title>';
    res.writeHead(PAGES[req.url ?? ''] ? 200 : 404, { 'content-type': 'text/html' });
    res.end(body);
  });
  await new Promise<void>((r) => server!.listen(0, '127.0.0.1', r));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return baseUrl;
}

export const test = base.extend<Fixtures>({
  headed: [process.env.HEADED === '1', { option: true }],
  chromeArgs: [[], { option: true }],
  realViewport: [false, { option: true }],
  context: async ({ headed, chromeArgs, realViewport }, use) => {
    const userDataDir = mkdtempSync(join(tmpdir(), 'glint-e2e-'));
    const media = ensureFakeMedia();
    const context = await chromium.launchPersistentContext(userDataDir, {
      channel: 'chromium',
      headless: !headed,
      viewport: realViewport ? null : { width: 1280, height: 800 },
      ...(process.env.E2E_DPR ? { deviceScaleFactor: Number(process.env.E2E_DPR) } : {}),
      acceptDownloads: true,
      args: [
        `--disable-extensions-except=${EXT_PATH}`,
        `--load-extension=${EXT_PATH}`,
        '--use-fake-ui-for-media-stream',
        '--use-fake-device-for-media-stream',
        `--use-file-for-fake-video-capture=${media.video}`,
        `--use-file-for-fake-audio-capture=${media.audio}`,
        // A test's own source choice replaces this default.
        ...(chromeArgs.some((a) => a.startsWith('--auto-select-desktop-capture-source=')) ? [] : ['--auto-select-desktop-capture-source=Entire screen']),
        ...chromeArgs,
        '--autoplay-policy=no-user-gesture-required',
      ],
    });
    await use(context);
    await context.close();
    rmSync(userDataDir, { recursive: true, force: true });
  },
  serviceWorker: async ({ context }, use) => {
    let [sw] = context.serviceWorkers();
    if (!sw) sw = await context.waitForEvent('serviceworker');
    await use(sw);
  },
  extensionId: async ({ serviceWorker }, use) => {
    await use(serviceWorker.url().split('/')[2]!);
  },
  baseUrl: async ({}, use) => {
    await use(await ensureServer());
  },
  /** An extension page used to talk to the service worker like the popup does. */
  extPage: async ({ context, extensionId }, use) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html#general`);
    await use(page);
  },
});

export const expect = test.expect;

/** Sends a runtime message from an extension page and returns the typed response. */
export async function send<T = unknown>(extPage: Page, message: Record<string, unknown>): Promise<T> {
  const res = (await extPage.evaluate((m) => chrome.runtime.sendMessage(m), message)) as { ok: boolean; data: T; error?: { code: string; message: string } };
  if (!res?.ok) throw new Error(`Message failed: ${JSON.stringify(res?.error)}`);
  return res.data;
}

export async function tabIdFor(extPage: Page, urlPattern: string): Promise<number> {
  const id = await extPage.evaluate(async (pattern) => (await chrome.tabs.query({ url: pattern }))[0]?.id, urlPattern);
  if (id === undefined) throw new Error(`No tab matches ${urlPattern}`);
  return id;
}

/** Reads a capture record from the extension's IndexedDB. */
export async function readCaptures(extPage: Page): Promise<Array<Record<string, unknown>>> {
  return extPage.evaluate(
    () =>
      new Promise<Array<Record<string, unknown>>>((resolve, reject) => {
        const req = indexedDB.open('glint-capture');
        req.onsuccess = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains('captures')) {
            // Nothing captured yet: don't leave an empty database behind.
            db.close();
            indexedDB.deleteDatabase('glint-capture');
            resolve([]);
            return;
          }
          const tx = db.transaction('captures', 'readonly');
          const all = tx.objectStore('captures').getAll();
          all.onsuccess = () => {
            const rows = (all.result as Array<Record<string, unknown>>).map(({ thumbnail: _t, ...rest }) => rest);
            db.close();
            resolve(rows.sort((a, b) => (b.createdAt as number) - (a.createdAt as number)));
          };
          all.onerror = () => reject(all.error);
        };
        req.onerror = () => reject(req.error);
      }),
  );
}

/** Resolves with the first page whose URL matches — new tabs *and* tabs that navigate (e.g. the
 * recorder tab turning into the result page). */
export async function waitForPage(context: BrowserContext, match: (url: string) => boolean, timeout = 30_000): Promise<Page> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const page = context.pages().find((p) => match(p.url()));
    if (page) {
      await page.waitForLoadState('domcontentloaded').catch(() => undefined);
      return page;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`Timed out waiting for a page; open: ${context.pages().map((p) => p.url()).join(', ')}`);
}

export async function recordingState(extPage: Page): Promise<{ status: string; actual: { width: number; height: number } | null; sessionId: string | null }> {
  return send(extPage, { target: 'background', type: 'recording/get-state' });
}

/** Number of recording chunks persisted so far (proves the encoder is producing data). */
export async function chunkCount(extPage: Page): Promise<number> {
  return extPage.evaluate(
    () =>
      new Promise<number>((resolve) => {
        const req = indexedDB.open('glint-capture');
        req.onsuccess = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains('chunks')) {
            db.close();
            resolve(0);
            return;
          }
          const c = db.transaction('chunks', 'readonly').objectStore('chunks').count();
          c.onsuccess = () => {
            db.close();
            resolve(c.result);
          };
        };
        req.onerror = () => resolve(0);
      }),
  );
}

/** Counts rows in the newest screenshot whose sampled pixels are all pure white. */
export async function whiteRowsInLatestCapture(extPage: Page): Promise<{ rows: number; height: number }> {
  return extPage.evaluate(async () => {
    const db: IDBDatabase = await new Promise((res, rej) => {
      const r = indexedDB.open('glint-capture');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    const get = <T,>(store: string, mode: 'getAll' | 'get', key?: string) =>
      new Promise<T>((res) => {
        const req = mode === 'getAll' ? db.transaction(store).objectStore(store).getAll() : db.transaction(store).objectStore(store).get(key!);
        req.onsuccess = () => res(req.result as T);
      });
    const caps = await get<Array<{ id: string; createdAt: number }>>('captures', 'getAll');
    const latest = caps.sort((a, b) => b.createdAt - a.createdAt)[0]!;
    const blob = await get<Blob>('blobs', 'get', latest.id);
    db.close();
    const bmp = await createImageBitmap(blob);
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    const ctx = c.getContext('2d')!;
    ctx.drawImage(bmp, 0, 0);
    const data = ctx.getImageData(0, 0, bmp.width, bmp.height).data;
    let rows = 0;
    for (let y = 0; y < bmp.height; y++) {
      let white = true;
      for (let x = 0; x < bmp.width; x += 7) {
        const i = (y * bmp.width + x) * 4;
        if (data[i]! < 250 || data[i + 1]! < 250 || data[i + 2]! < 250) { white = false; break; }
      }
      if (white) rows++;
    }
    return { rows, height: bmp.height };
  });
}
