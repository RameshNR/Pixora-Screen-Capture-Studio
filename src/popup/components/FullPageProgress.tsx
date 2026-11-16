import { useEffect, useState } from 'react';
import { Square } from 'lucide-react';
import { FULLPAGE_STATE_KEY, type FullPageProgress } from '@/shared/constants/fullpage';
import { sendToBackground } from '@/shared/messaging/client';
import { Button } from '@/shared/components/Button';
import styles from '../styles/popup.module.css';

/**
 * The running full-page capture (published by the service worker), or null; `undefined` until
 * checked (so the popup doesn't first draw its normal, taller view and then shrink).
 */
export function useFullPageProgress(): FullPageProgress | null | undefined {
  const [state, setState] = useState<FullPageProgress | null | undefined>(undefined);
  useEffect(() => {
    void chrome.storage.session.get(FULLPAGE_STATE_KEY)
      .then((r) => setState((r[FULLPAGE_STATE_KEY] as FullPageProgress | undefined) ?? null))
      .catch(() => setState(null));
    const onChange = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area !== 'session' || !(FULLPAGE_STATE_KEY in changes)) return;
      setState((changes[FULLPAGE_STATE_KEY]!.newValue as FullPageProgress | undefined) ?? null);
    };
    chrome.storage.onChanged.addListener(onChange);
    return () => chrome.storage.onChanged.removeListener(onChange);
  }, []);
  if (state === undefined) return undefined;
  return state?.running ? state : null;
}

/**
 * The whole popup while a full-page capture runs (Pixora opens the popup by its toolbar icon):
 * progress, tips and Stop (keeps what is captured so far). Closes itself when the capture ends.
 */
export function FullPageProgressView({ state }: { state: FullPageProgress }) {
  const [stopping, setStopping] = useState(false);
  const pct = Math.round(state.progress * 100);
  return (
    <section className={styles.fullPage} aria-label="Full-page capture" role="status" aria-live="polite">
      <h1 className={styles.fullPageHeading}>Full page capturing…</h1>
      {state.title && <div className={styles.fullPageTitle}>{state.title}</div>}
      <div className={styles.fullPageBar} role="progressbar" aria-label="Captured" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
        <div style={{ width: `${pct}%` }} />
        <span>{pct}%</span>
      </div>
      <p>
        Please <strong>do not scroll</strong> or move your mouse pointer while capturing, to get the best result.
      </p>
      <p>
        For very long or endless pages, end the capture yourself with <strong>Stop</strong> — what is captured so far opens in the editor.
      </p>
      <Button variant="recording" icon={<Square size={13} fill="currentColor" />} loading={stopping} onClick={() => {
        setStopping(true);
        void sendToBackground({ target: 'background', type: 'screenshot/stop-full' }).catch(() => undefined);
      }}>
        Stop
      </Button>
    </section>
  );
}
