import { useEffect, useMemo, useState } from 'react';
import { Camera, X } from 'lucide-react';
import { applyTheme } from '@/shared/hooks/useTheme';
import styles from './progress.module.css';
import { HeaderGrab } from './HeaderGrab';

/** Channel between the countdown window and the "Entire Screen & App Window" screenshot page. */
export const COUNTDOWN_CHANNEL = 'pixora-desktop-countdown';

/**
 * A small window of its own (never part of a capture):
 *  - `?mode=countdown&s=3`: seconds left before an "Entire Screen & App Window" screenshot.
 *  - `?mode=header&win=<id>`: the browser header (tabs, address bar, bookmarks) for a screenshot.
 */
export function ProgressApp() {
  const params = useMemo(() => new URLSearchParams(location.search), []);
  useEffect(() => applyTheme('dark'), []);
  if (params.get('mode') === 'header') {
    const num = (k: string) => (params.get(k) ? Number(params.get(k)) : undefined);
    return <HeaderGrab windowId={Number(params.get('win'))} shot={{ tabId: num('tab'), width: num('vw'), height: num('vh') }} />;
  }
  return <Countdown seconds={Math.max(3, Math.min(60, Number(params.get('s')) || 3))} />;
}

function Countdown({ seconds }: { seconds: number }) {
  const [left, setLeft] = useState(seconds);
  useEffect(() => {
    document.title = `Screenshot in ${left} s · Pixora`;
  }, [left]);
  useEffect(() => {
    const channel = new BroadcastChannel(COUNTDOWN_CHANNEL);
    const end = Date.now() + seconds * 1000;
    const t = setInterval(() => {
      const ms = end - Date.now();
      if (ms <= 0) {
        clearInterval(t);
        // The window closes first: it must not be in the screenshot.
        channel.postMessage({ type: 'done' });
        window.close();
        return;
      }
      setLeft(Math.ceil(ms / 1000));
    }, 100);
    return () => { clearInterval(t); channel.close(); };
  }, [seconds]);
  const cancel = () => {
    const channel = new BroadcastChannel(COUNTDOWN_CHANNEL);
    channel.postMessage({ type: 'cancel' });
    channel.close();
    window.close();
  };
  return (
    <main className={styles.panel} role="timer" aria-live="assertive" aria-label={`Screenshot in ${left} seconds`}>
      <div className={styles.title}><Camera size={15} /> Screenshot in</div>
      <div className={styles.count}>{left}</div>
      <div className={styles.meta}>Arrange your screen — this window closes before the picture.</div>
      <button type="button" className={styles.cancel} onClick={cancel}><X size={13} /> Cancel</button>
    </main>
  );
}
