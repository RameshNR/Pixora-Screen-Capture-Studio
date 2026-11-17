import { useCallback, useEffect, useRef, useState } from 'react';
import { AppWindow, MousePointerClick, PanelTop, RotateCcw, Share2, X } from 'lucide-react';
import { captureWindowViaShareDialog } from '@/screenshot/services/desktop-capture';
import { headerRect, type Pixels } from '@/screenshot/services/browser-header';
import { sendToBackground } from '@/shared/messaging/client';
import { sameAsScreenshot } from '@/screenshot/services/header-capture';
import styles from './progress.module.css';

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** This window's title: shown in Chrome's window list too, so it is named clearly. */
export const HEADER_WINDOW_TITLE = 'Pixora – adding the browser header';

async function pixelsOf(blob: Blob, scale = 1): Promise<Pixels & { bitmap: ImageBitmap }> {
  const bitmap = await createImageBitmap(blob);
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const c = new OffscreenCanvas(w, h);
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, w, h);
  return { bitmap, width: w, height: h, data: ctx.getImageData(0, 0, w, h).data };
}

async function toDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

type Problem = { kind: 'self' | 'other' | 'failed' | 'size' | 'tab' | 'closed'; picked?: string; details?: string };
type Shot = { tabId?: number; width?: number; height?: number };

/**
 * `progress.html?mode=header&win=<id>`: after a visible / full-page screenshot, asks Chrome for a
 * picture of browser window `win` and sends back its header strip (tabs, address bar, bookmarks).
 * Uses Chrome's web share dialog (getDisplayMedia, on its Window tab, without "Entire screen");
 * Chrome may want a click first, so a "Choose window…" button is shown then. Opens at the browser
 * window's size and names the window to pick; minimises itself before the picture.
 */
export function HeaderGrab({ windowId, shot: screenshot = {} }: { windowId: number; shot?: Shot }) {
  const [status, setStatus] = useState<'picking' | 'ready' | 'working' | 'problem'>('picking');
  const [problem, setProblem] = useState<Problem | null>(null);
  const [pageTitle, setPageTitle] = useState('');
  const [nowSize, setNowSize] = useState<{ width?: number; height?: number }>({});
  const started = useRef(false);
  const done = useRef(false);

  const finish = useCallback(async (dataUrl: string | null) => {
    if (done.current) return;
    done.current = true;
    await sendToBackground({ target: 'background', type: 'screenshot/header', dataUrl }).catch(() => undefined);
    window.close();
  }, []);

  /** Attempts so far: only a dialog cancelled on the first one closes this window by itself. */
  const attempts = useRef(0);
  const run = useCallback(async () => {
    attempts.current++;
    setStatus('picking');
    setProblem(null);
    const me = await chrome.windows.getCurrent().catch(() => null);
    const tab = (await chrome.tabs.query({ active: true, windowId }).catch(() => []))[0];
    const captured = screenshot.tabId !== undefined ? await chrome.tabs.get(screenshot.tabId).catch(() => undefined) : tab;
    setPageTitle(captured?.title ?? tab?.title ?? '');
    // The header must match the screenshot: same tab, same page-area size (window not resized).
    const check = async () => {
      const now = (await chrome.tabs.query({ active: true, windowId }).catch(() => []))[0];
      const same = sameAsScreenshot(now, screenshot);
      if (same !== 'ok') {
        setNowSize({ width: now?.width, height: now?.height });
        throw Object.assign(new Error(same), { problem: { kind: same } satisfies Problem });
      }
    };
    try {
      await check();
      // Chrome's web share dialog, on its Window tab (no "Entire screen", not this window).
      const shot = await captureWindowViaShareDialog({
        beforeGrab: async () => {
          setStatus('working');
          // Out of the way: the browser window is pictured as it is, without this window over it.
          if (me?.id !== undefined) await chrome.windows.update(me.id, { state: 'minimized' }).catch(() => undefined);
          await chrome.windows.update(windowId, { focused: true }).catch(() => undefined);
          await delay(450);
          await check();
        },
      });
      if (shot.label.includes(HEADER_WINDOW_TITLE)) throw Object.assign(new Error('self'), { problem: { kind: 'self', picked: shot.label } satisfies Problem });
      if (shot.surface !== 'window') throw Object.assign(new Error('other'), { problem: { kind: 'other', details: `a ${shot.surface === 'monitor' ? 'whole screen' : 'tab'} was shared, not a window` } satisfies Problem });

      // The page as the tab shows it now: found inside the window picture, the header is what's above it.
      const refBlob = await (await fetch(await chrome.tabs.captureVisibleTab(windowId, { format: 'png' }))).blob();
      const frame = await pixelsOf(shot.blob);
      const win = await chrome.windows.get(windowId).catch(() => null);
      let ref = await pixelsOf(refBlob);
      const dpr = tab?.width ? ref.width / tab.width : 1;
      const windowPx = win?.width ? win.width * dpr : 0;
      // The window picture may come at another scale than the page screenshot (some screens / setups).
      const k = windowPx ? frame.width / windowPx : 1;
      const sizeOk = windowPx > 0 && Math.abs(k - 1) <= 0.06;
      let rect = headerRect(frame, ref, sizeOk);
      let scale = 1;
      if (!rect && windowPx && Math.abs(k - 1) > 0.06) {
        ref.bitmap.close();
        ref = await pixelsOf(refBlob, k);
        rect = headerRect(frame, ref, true);
        scale = 1 / k;
      }
      const details = `window picture ${frame.width}×${frame.height} · page ${ref.width}×${ref.height} · window ${win?.width ?? '?'}×${win?.height ?? '?'} at ${dpr.toFixed(2)}x`;
      ref.bitmap.close();
      if (!rect) {
        frame.bitmap.close();
        throw Object.assign(new Error('other'), { problem: { kind: 'other', picked: shot.label, details } satisfies Problem });
      }
      // Back at the page screenshot's scale.
      const outW = Math.round(rect.width * scale);
      const outH = Math.round(rect.height * scale);
      const c = new OffscreenCanvas(outW, outH);
      const ctx = c.getContext('2d')!;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(frame.bitmap, rect.x, rect.y, rect.width, rect.height, 0, 0, outW, outH);
      frame.bitmap.close();
      await finish(await toDataUrl(await c.convertToBlob({ type: 'image/png' })));
    } catch (err) {
      const code = (err as { code?: string }).code;
      // Chrome opens this dialog only after a click on the page: show the button for it.
      if (code === 'needs-click') {
        if (me?.id !== undefined) await chrome.windows.update(me.id, { state: 'normal', focused: true }).catch(() => undefined);
        setStatus('ready');
        return;
      }
      // Dialog cancelled: the screenshot is kept without the header.
      if (code === 'permission-denied-screen' || code === 'cancelled') {
        // First time: the user cancelled — keep the screenshot without the header. After “Try again”
        // the window stays, so it never disappears under the user's click.
        if (attempts.current <= 1) {
          await finish(null);
          return;
        }
        if (me?.id !== undefined) await chrome.windows.update(me.id, { state: 'normal', focused: true }).catch(() => undefined);
        setProblem({ kind: 'closed' });
        setStatus('problem');
        return;
      }
      if (me?.id !== undefined) await chrome.windows.update(me.id, { state: 'normal', focused: true }).catch(() => undefined);
      setProblem((err as { problem?: Problem }).problem ?? { kind: 'failed', details: String((err as Error)?.message ?? err) });
      setStatus('problem');
    }
  }, [finish, windowId, screenshot]);

  // Window resized / other tab: start again by itself once it matches the screenshot again.
  useEffect(() => {
    if (status !== 'problem' || (problem?.kind !== 'size' && problem?.kind !== 'tab')) return;
    const t = setInterval(async () => {
      const now = (await chrome.tabs.query({ active: true, windowId }).catch(() => []))[0];
      setNowSize({ width: now?.width, height: now?.height });
      if (sameAsScreenshot(now, screenshot) === 'ok') {
        clearInterval(t);
        void run();
      }
    }, 600);
    return () => clearInterval(t);
  }, [status, problem, windowId, screenshot, run]);

  useEffect(() => {
    document.title = HEADER_WINDOW_TITLE;
    if (started.current) return;
    started.current = true;
    void run();
  }, [run]);

  const windowName = `${pageTitle || 'your page'} - Google Chrome`;
  return (
    <main className={styles.headerPage} aria-live="polite">
      <section className={styles.headerCard}>
        <h1 className={styles.headerTitle}><PanelTop size={20} /> Add the browser header</h1>
        <p className={styles.headerLead}>Chrome’s screenshot only sees the page. To add your tabs, address bar and bookmarks, share the browser window once:</p>

        {status === 'working' ? (
          <p className={styles.headerLead}>Adding the tabs, address bar and bookmarks…</p>
        ) : (
          <ol className={styles.steps}>
            <li><AppWindow size={16} /> <span>{status === 'ready' ? <>Click <b>Choose window…</b> below. Chrome’s </> : <>In Chrome’s </>}<b>Choose what to share</b> dialog opens on <b>Window</b>.</span></li>
            <li>
              <MousePointerClick size={16} />
              <span>Choose the window named <span className={styles.windowName} title={windowName}>{windowName}</span> (not “{HEADER_WINDOW_TITLE}”).</span>
            </li>
            <li><Share2 size={16} /> <span>Click <b>Share</b>. This window gets out of the way and closes by itself.</span></li>
          </ol>
        )}

        {status === 'problem' && problem && (
          <div className={styles.problem} role="alert">
            {problem.kind === 'self' && <>You chose Pixora’s own window. Choose <b>{windowName}</b>.</>}
            {problem.kind === 'size' && (
              <>
                <b>The browser window changed size after the screenshot.</b> Small changes are fitted automatically, but this one is too big
                (page area {screenshot.width}×{screenshot.height} in the screenshot, {nowSize.width ?? '?'}×{nowSize.height ?? '?'} now), so the header
                wouldn’t match. Put the window back as it was — for example maximise it again — and this continues by itself. Or keep the
                screenshot without the header and take it again at the size you want.
              </>
            )}
            {problem.kind === 'tab' && (
              <>
                <b>Another tab is showing now.</b> Switch the browser window back to the tab you captured (“{pageTitle || 'your page'}”) and this continues by itself.
              </>
            )}
            {problem.kind === 'other' && (
              <>
                The chosen window doesn’t show the page you captured. Choose <b>{windowName}</b>.
                {problem.details && <div className={styles.problemDetails}>Details: {problem.details}</div>}
              </>
            )}
            {problem.kind === 'closed' && <>Chrome’s dialog closed without a window being shared. Click <b>Try again</b> and choose <b>{windowName}</b>, or keep the screenshot without the header.</>}
            {problem.kind === 'failed' && (
              <>
                The browser header couldn’t be added.
                {problem.details && <div className={styles.problemDetails}>Details: {problem.details}</div>}
              </>
            )}
          </div>
        )}

        <div className={styles.headerActions}>
          {status === 'ready' && (
            <button type="button" className={`${styles.cancel} ${styles.primary}`} onClick={() => void run()} autoFocus><AppWindow size={14} /> Choose window…</button>
          )}
          {status === 'problem' && (
            <button type="button" className={`${styles.cancel} ${styles.primary}`} onClick={() => void run()}><RotateCcw size={14} /> Try again</button>
          )}
          <button type="button" className={styles.cancel} onClick={() => void finish(null)}><X size={14} /> Keep screenshot without header</button>
        </div>
      </section>
    </main>
  );
}
