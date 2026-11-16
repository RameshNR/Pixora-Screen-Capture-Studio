import { useCallback, useEffect, useRef, useState } from 'react';
import { Monitor } from 'lucide-react';
import type { AppErrorInfo } from '@/shared/types';
import { Button } from '@/shared/components/Button';
import { Spinner } from '@/shared/components/Progress';
import { errorInfoOf } from '@/shared/messaging/client';
import { addCapture } from '@/history/history-service';
import { loadSettings } from '@/settings/settings-service';
import { buildFilename } from '@/shared/utils/filename';
import { generateImageThumbnail } from '../services/thumbnail';
import { captureDesktopFrame } from '@/screenshot/services/desktop-capture';
import { sendToBackground } from '@/shared/messaging/client';
import { getFlow, storeFlowImage } from '@/flow/flow-store';
import styles from './pages.module.css';
import { TopBar } from './TopBar';
import { COUNTDOWN_CHANNEL } from '@/progress/ProgressApp';
import { AppError } from '@/shared/utils/errors';

/**
 * Before the picture: back to the tab you were on (not this Pixora page) and a countdown window
 * with the seconds left; it closes itself just before the picture is taken. Cancel stops.
 */
async function countdown(seconds: number, me: chrome.tabs.Tab | undefined): Promise<void> {
  if (me?.windowId !== undefined) {
    const tabs = await chrome.tabs.query({ windowId: me.windowId }).catch(() => [] as chrome.tabs.Tab[]);
    const previous = tabs.filter((t) => t.id !== me.id).sort((a, b) => (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0))[0];
    if (previous?.id !== undefined) await chrome.tabs.update(previous.id, { active: true }).catch(() => undefined);
  }
  const channel = new BroadcastChannel(COUNTDOWN_CHANNEL);
  const result = new Promise<'done' | 'cancel'>((resolve) => {
    channel.onmessage = (e: MessageEvent<{ type?: string }>) => resolve(e.data?.type === 'cancel' ? 'cancel' : 'done');
  });
  const width = 240;
  const win = await chrome.windows.create({
    url: chrome.runtime.getURL(`progress.html?mode=countdown&s=${seconds}`), type: 'popup', width, height: 210, focused: true,
    left: Math.max(0, screen.availWidth - width - 24), top: 24,
  }).catch(() => null);
  // Without the window (blocked), still wait the seconds.
  const outcome = win ? await result : await new Promise<'done'>((r) => setTimeout(() => r('done'), seconds * 1000));
  channel.close();
  if (outcome === 'cancel') throw new AppError('cancelled', 'Screenshot cancelled');
  // Let the closed countdown window disappear from the screen before the picture.
  await new Promise((r) => setTimeout(r, 400));
}

/** "Entire Screen & App Window" screenshot flow. */
export function DesktopScreenshot() {
  const [status, setStatus] = useState<'picking' | 'saving' | 'cancelled' | 'error'>('picking');
  const [error, setError] = useState<AppErrorInfo | null>(null);
  const started = useRef(false);

  const run = useCallback(async () => {
    setStatus('picking');
    setError(null);
    try {
      const settings = await loadSettings();
      const qs = new URLSearchParams(location.search);
      const flowId = qs.get('flow');
      const source = qs.get('source') === 'window' ? 'window' : qs.get('source') === 'screen' ? 'screen' : undefined;
      const me = await chrome.tabs.getCurrent().catch(() => undefined);
      const shot = await captureDesktopFrame({
        excludeTaskbar: settings.screenshot.excludeTaskbar,
        source,
        beforeGrab: () => countdown(Math.max(3, settings.screenshot.desktopDelaySeconds ?? 3), me),
      });
      // Back to Pixora for the editor.
      if (me?.id !== undefined) await chrome.tabs.update(me.id, { active: true }).catch(() => undefined);
      if (me?.windowId !== undefined) await chrome.windows.update(me.windowId, { focused: true }).catch(() => undefined);
      setStatus('saving');
      if (flowId) {
        // Flow Capture: add the image to the session and close this helper tab.
        const flow = await getFlow(flowId);
        const item = await storeFlowImage(flowId, (flow?.items.length ?? 0) + 1, {
          blob: shot.blob, width: shot.width, height: shot.height, mode: source ?? 'screen', auto: false, url: '', pageTitle: shot.label,
        });
        await sendToBackground({ target: 'background', type: 'flow/page-image', item });
        window.close();
        return;
      }
      const record = await addCapture(
        {
          kind: 'screenshot',
          name: buildFilename(settings.general.filenamePattern, { type: 'Screenshot', title: shot.label, extension: 'png' }),
          mimeType: 'image/png',
          width: shot.width,
          height: shot.height,
          thumbnail: await generateImageThumbnail(shot.blob),
          sourceTitle: shot.label,
        },
        shot.blob,
      );
      const params = new URLSearchParams({ id: record.id, fresh: '1' });
      if (settings.screenshot.autoSave) params.set('autosave', '1');
      location.replace(chrome.runtime.getURL(`editor.html?${params.toString()}`));
    } catch (err) {
      const info = errorInfoOf(err);
      if (new URLSearchParams(location.search).get('flow')) void sendToBackground({ target: 'background', type: 'flow/page-image', item: null }).catch(() => undefined);
      if (info.code === 'permission-denied-screen' || info.code === 'cancelled') setStatus('cancelled');
      else {
        setError(info);
        setStatus('error');
      }
    }
  }, []);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void run();
  }, [run]);

  return (
    <div className={styles.page}>
      <TopBar />
      <main className={styles.main}>
        <section className={`${styles.panel} ${styles.center}`}>
          <span className={styles.heroIcon}>
            <Monitor size={30} />
          </span>
          {status === 'picking' && (
            <>
              <h1 className={styles.h1}>Choose a screen or window</h1>
              <p className={styles.lead}>Select your entire screen, an application window or a tab in Chrome’s dialog. The screenshot opens in the editor.</p>
              <Spinner size={22} />
            </>
          )}
          {status === 'saving' && (
            <>
              <h1 className={styles.h1}>Opening the editor…</h1>
              <Spinner size={22} />
            </>
          )}
          {(status === 'cancelled' || status === 'error') && (
            <>
              <h1 className={styles.h1}>{status === 'cancelled' ? 'Nothing was captured' : error?.title}</h1>
              <p className={styles.lead}>{status === 'cancelled' ? 'The sharing dialog was closed.' : [error?.message, error?.recovery].filter(Boolean).join(' ')}</p>
              <div className={styles.actions}>
                <Button onClick={() => window.close()}>Close</Button>
                <Button variant="primary" onClick={() => void run()}>
                  Try again
                </Button>
              </div>
            </>
          )}
        </section>
      </main>
    </div>
  );
}
