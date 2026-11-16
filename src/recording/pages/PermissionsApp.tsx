import { useEffect, useState } from 'react';
import { Camera, CheckCircle2, Mic, ShieldCheck } from 'lucide-react';
import { Button } from '@/shared/components/Button';
import { InlineNotice } from '@/shared/components/Settings';
import { useSettings } from '@/shared/hooks/useSettings';
import { useTheme } from '@/shared/hooks/useTheme';
import { toAppError } from '@/shared/utils/errors';
import { queryMediaPermission, stopStream, type PermissionStateLite } from '../services/media-stream-service';
import { TopBar } from './TopBar';
import styles from './pages.module.css';

type Kind = 'camera' | 'microphone';

/**
 * Chrome cannot show camera / microphone prompts inside an extension popup or offscreen document,
 * so access is granted once on this page; afterwards every extension context can use the devices.
 */
export function PermissionsApp() {
  const { settings, update } = useSettings();
  useTheme(settings?.general.theme);
  const requested = (new URLSearchParams(location.search).get('request') ?? 'camera,microphone').split(',').filter((k): k is Kind => k === 'camera' || k === 'microphone');
  const [states, setStates] = useState<Record<Kind, PermissionStateLite>>({ camera: 'unknown', microphone: 'unknown' });
  const [message, setMessage] = useState<string | null>(null);

  const refresh = () =>
    void Promise.all([queryMediaPermission('camera'), queryMediaPermission('microphone')]).then(([camera, microphone]) => setStates({ camera, microphone }));

  useEffect(refresh, []);

  const allGranted = requested.every((k) => states[k] === 'granted');

  async function request() {
    setMessage(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: requested.includes('camera'), audio: requested.includes('microphone') });
      stopStream(stream);
      // Turn the feature on now that access exists.
      await update({ recording: { ...(requested.includes('camera') ? { cameraEnabled: true } : {}), ...(requested.includes('microphone') ? { micEnabled: true } : {}) } });
    } catch (err) {
      const info = toAppError(err, requested.includes('camera') ? 'camera' : 'microphone');
      setMessage(`${info.title}. ${info.recovery ?? ''}`);
    }
    refresh();
  }

  return (
    <div className={styles.page}>
      <TopBar />
      <main className={styles.main}>
        <section className={`${styles.panel} ${styles.center}`} style={{ maxWidth: 560 }}>
          <span className={styles.heroIcon}>{allGranted ? <CheckCircle2 size={30} /> : <ShieldCheck size={30} />}</span>
          <h1 className={styles.h1}>{allGranted ? 'You’re all set' : `Allow ${requested.join(' & ')} access`}</h1>
          <p className={styles.lead}>
            {allGranted
              ? 'Pixora can now use your devices. Open the extension again and press Start Recording.'
              : 'Pixora uses your devices only while you record. Nothing is uploaded — recordings stay on this computer.'}
          </p>
          <div className={styles.actions}>
            {requested.map((k) => (
              <span key={k} className={styles.fact} style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
                {k === 'camera' ? <Camera size={16} /> : <Mic size={16} />}
                {k === 'camera' ? 'Camera' : 'Microphone'}: <strong>{states[k] === 'granted' ? 'Allowed' : states[k] === 'denied' ? 'Blocked' : 'Not yet allowed'}</strong>
              </span>
            ))}
          </div>
          {message && <InlineNotice tone="error">{message}</InlineNotice>}
          {requested.some((k) => states[k] === 'denied') && (
            <InlineNotice tone="warning">
              Access was blocked earlier. Click the icon at the left of the address bar, set Camera / Microphone to “Allow”, then reload this page.
            </InlineNotice>
          )}
          <div className={styles.actions}>
            {allGranted ? (
              <Button variant="primary" onClick={() => window.close()}>
                Close
              </Button>
            ) : (
              <Button variant="primary" onClick={() => void request()}>
                Allow access
              </Button>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
