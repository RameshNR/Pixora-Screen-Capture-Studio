import { useEffect, useState } from 'react';
import type { RecordingState } from '../types';
import { onBroadcast, sendToBackground } from '../messaging/client';
import { INITIAL_RECORDING_STATE } from '@/recording/services/recording-state';

/** Live recording state from the service worker (initial fetch + broadcasts). */
export function useRecordingState(): RecordingState {
  const [state, setState] = useState<RecordingState>(INITIAL_RECORDING_STATE);
  useEffect(() => {
    let alive = true;
    sendToBackground<RecordingState>({ target: 'background', type: 'recording/get-state' })
      .then((s) => alive && setState(s))
      .catch(() => undefined);
    const off = onBroadcast((msg) => {
      if (msg.type === 'recording/state') setState(msg.state);
    });
    return () => {
      alive = false;
      off();
    };
  }, []);
  return state;
}

/** Re-renders every `ms` while `active` (for timers). */
export function useNow(active: boolean, ms = 250): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [active, ms]);
  // While active, always the current time: the stored value can be from long before (the page
  // opened earlier), which made a countdown start on a too-high number for its first moment.
  return active ? Math.max(now, Date.now()) : now;
}
