import { useCallback, useEffect, useRef, useState } from 'react';
import { PanelTop, RotateCcw, X } from 'lucide-react';
import { captureDesktopFrame } from '@/screenshot/services/desktop-capture';
import { headerRect, type Pixels } from '@/screenshot/services/browser-header';
import { sendToBackground } from '@/shared/messaging/client';
import styles from './progress.module.css';

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function pixelsOf(blob: Blob): Promise<Pixels & { bitmap: ImageBitmap }> {
  const bitmap = await createImageBitmap(blob);
  const c = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(bitmap, 0, 0);
  return { bitmap, width: bitmap.width, height: bitmap.height, data: ctx.getImageData(0, 0, bitmap.width, bitmap.height).data };
}

async function toDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

class WrongWindow extends Error {}

/**
 * `progress.html?mode=header&win=<id>`: after a visible / full-page screenshot, asks Chrome for a
 * picture of browser window `win` and sends back its header strip (tabs, address bar, bookmarks).
 * Never in the picture itself: it minimises before the frame is taken.
 */
export function HeaderGrab({ windowId }: { windowId: number }) {
  const [status, setStatus] = useState<'picking' | 'working' | 'wrong' | 'failed'>('picking');
  const started = useRef(false);
  const done = useRef(false);

  const finish = useCallback(async (dataUrl: string | null) => {
    if (done.current) return;
    done.current = true;
    await sendToBackground({ target: 'background', type: 'screenshot/header', dataUrl }).catch(() => undefined);
    window.close();
  }, []);

  const run = useCallback(async () => {
    setStatus('picking');
    const me = await chrome.windows.getCurrent().catch(() => null);
    try {
      const shot = await captureDesktopFrame({
        source: 'window',
        beforeGrab: async () => {
          setStatus('working');
          // Out of the way: the browser window is pictured as it is, without this window over it.
          if (me?.id !== undefined) await chrome.windows.update(me.id, { state: 'minimized' }).catch(() => undefined);
          await chrome.windows.update(windowId, { focused: true }).catch(() => undefined);
          await delay(450);
        },
      });
      // The page as the tab shows it now: found inside the window picture, the header is what's above it.
      const ref = await pixelsOf(await (await fetch(await chrome.tabs.captureVisibleTab(windowId, { format: 'png' }))).blob());
      const frame = await pixelsOf(shot.blob);
      const rect = headerRect(frame, ref, (await looksLikeWindow(frame.width, ref.width, windowId)));
      ref.bitmap.close();
      if (!rect) throw new WrongWindow();
      const c = new OffscreenCanvas(rect.width, rect.height);
      c.getContext('2d')!.drawImage(frame.bitmap, rect.x, rect.y, rect.width, rect.height, 0, 0, rect.width, rect.height);
      frame.bitmap.close();
      await finish(await toDataUrl(await c.convertToBlob({ type: 'image/png' })));
    } catch (err) {
      const code = (err as { code?: string }).code;
      // Dialog cancelled: the screenshot is kept without the header.
      if (code === 'permission-denied-screen' || code === 'cancelled') {
        await finish(null);
        return;
      }
      if (me?.id !== undefined) await chrome.windows.update(me.id, { state: 'normal', focused: true }).catch(() => undefined);
      setStatus(err instanceof WrongWindow ? 'wrong' : 'failed');
    }
  }, [finish, windowId]);

  useEffect(() => {
    document.title = 'Browser header · Pixora';
    if (started.current) return;
    started.current = true;
    void run();
  }, [run]);

  return (
    <main className={styles.panel} aria-live="polite">
      <div className={styles.title}><PanelTop size={15} /> Include browser header</div>
      {status === 'picking' && (
        <div className={styles.meta}>In Chrome’s dialog, open the <b>Window</b> tab, pick the Chrome window with your page and click <b>Share</b>.</div>
      )}
      {status === 'working' && <div className={styles.meta}>Adding the tabs, address bar and bookmarks…</div>}
      {status === 'wrong' && <div className={styles.meta}>That window doesn’t show the page you captured. Pick the Chrome window with the page.</div>}
      {status === 'failed' && <div className={styles.meta}>The browser header couldn’t be captured.</div>}
      <div className={styles.row}>
        {(status === 'wrong' || status === 'failed') && (
          <button type="button" className={styles.cancel} onClick={() => void run()}><RotateCcw size={13} /> Try again</button>
        )}
        <button type="button" className={styles.cancel} onClick={() => void finish(null)}><X size={13} /> Skip header</button>
      </div>
    </main>
  );
}

/** The picture is about as wide as browser window `windowId` (so the usual layout can be assumed). */
async function looksLikeWindow(frameWidth: number, pageWidth: number, windowId: number): Promise<boolean> {
  const [win, tab] = await Promise.all([
    chrome.windows.get(windowId).catch(() => null),
    chrome.tabs.query({ active: true, windowId }).then((t) => t[0]).catch(() => undefined),
  ]);
  if (!win?.width || !tab?.width) return false;
  const dpr = pageWidth / tab.width;
  return Math.abs(frameWidth - win.width * dpr) <= win.width * dpr * 0.05;
}
