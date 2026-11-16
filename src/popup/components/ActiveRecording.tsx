import { Camera, CameraOff, Flag, Focus, Highlighter, Mic, MicOff, Pause, Pen, Play, ScanSearch, ScrollText, Square, Trash2, X, ZoomIn, ZoomOut } from 'lucide-react';
import type { ReactNode } from 'react';
import type { LiveEffect } from '@/shared/types';
import type { RecordingState } from '@/shared/types';
import type { RecordingCommand } from '@/shared/messaging/messages';
import { sendToBackground } from '@/shared/messaging/client';
import { Button, IconButton } from '@/shared/components/Button';
import { ProgressIndicator } from '@/shared/components/Progress';
import { useNow } from '@/shared/hooks/useRecordingState';
import { elapsedMs, remainingMs } from '@/recording/services/recording-state';
import { describeMime } from '@/recording/services/codec-service';
import { formatDuration } from '@/shared/utils/format';
import styles from '../styles/popup.module.css';

const MODE_LABEL = { desktop: 'Desktop', camera: 'Camera', tab: 'This tab', area: 'Custom area' } as const;

const effect = (e: LiveEffect) => void sendToBackground({ target: 'background', type: 'recording/effect', effect: e }).catch(() => undefined);

/** A labelled tool tile of the popup's recording controller. */
function Tool({ label, icon, on, onClick, disabled }: { label: string; icon: ReactNode; on?: boolean; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" className={`${styles.liveTool} ${on ? styles.liveToolOn : ''}`} aria-pressed={on === undefined ? undefined : on} onClick={onClick} disabled={disabled}>
      {icon}
      <span>{label}</span>
    </button>
  );
}

export function command(cmd: RecordingCommand): void {
  void sendToBackground({ target: 'background', type: 'recording/command', command: cmd });
}

/** Live recording status shown in the popup in place of the Start button. */
export function ActiveRecording({ state }: { state: RecordingState }) {
  const live = state.status === 'recording' || state.status === 'paused';
  const now = useNow(state.status === 'recording' || state.status === 'countdown', 250);

  if (state.status === 'stopping') {
    return (
      <div className={styles.liveCard}>
        <div className={styles.liveHead}>Saving recording…</div>
        <ProgressIndicator value={null} />
      </div>
    );
  }

  if (!live) {
    const label =
      state.status === 'selecting'
        ? 'Select the area to record in the page…'
        : state.status === 'countdown'
          ? `Starting in ${Math.max(0, Math.ceil(((state.countdownEndsAt ?? now) - now) / 1000))}…`
          : state.mode === 'desktop'
            ? 'Choose what to share in the recorder tab…'
            : 'Preparing…';
    return (
      <div className={styles.liveCard}>
        <div className={styles.liveHead}>{label}</div>
        <ProgressIndicator value={null} />
        <Button variant="ghost" size="sm" icon={<X size={14} />} onClick={() => command('cancel')}>
          Cancel
        </Button>
      </div>
    );
  }

  const elapsed = elapsedMs(state, now);
  const remaining = remainingMs(state, now);
  const a = state.actual;
  const fx = state.effects;
  return (
    <div className={styles.liveCard} aria-live="polite">
      <div className={styles.liveHead}>
        <span className={`${styles.liveDot} ${state.status === 'paused' ? styles.pausedDot : ''}`} />
        {state.status === 'paused' ? 'Paused' : 'Recording'} · {state.mode ? MODE_LABEL[state.mode] : ''}
      </div>
      <div className={styles.timer}>{formatDuration(elapsed)}</div>
      <div className={styles.liveMeta}>
        {a && (
          <>
            {a.width} × {a.height} · {a.fps} fps · {describeMime(a.mimeType)}
            <br />
          </>
        )}
        {remaining !== null && <>Stops automatically in {formatDuration(remaining)}</>}
      </div>
      {state.warnings.length > 0 && (
        <div className={styles.warn}>
          {state.warnings.map((w) => (
            <div key={w}>{w}</div>
          ))}
        </div>
      )}
      <div className={styles.liveActions}>
        {state.status === 'paused' ? (
          <Button icon={<Play size={16} />} onClick={() => command('resume')}>
            Resume
          </Button>
        ) : (
          <Button icon={<Pause size={16} />} onClick={() => command('pause')}>
            Pause
          </Button>
        )}
        <Button variant="recording" icon={<Square size={14} fill="currentColor" />} onClick={() => command('stop')}>
          Stop
        </Button>
        <IconButton tone="danger" label="Discard recording (stop and delete it)" icon={<Trash2 size={17} />} onClick={() => command('cancel')} />
      </div>
      {/* Live tools: the controller lives here (the separate control window is optional, Settings). */}
      <div className={styles.liveToolsTitle}>Live tools</div>
      <div className={styles.liveTools} role="group" aria-label="Live tools">
        <Tool label={fx.zoom > 1 ? 'Zoom out' : 'Zoom in'} icon={fx.zoom > 1 ? <ZoomOut size={18} /> : <ZoomIn size={18} />} on={fx.zoom > 1}
          onClick={() => {
            if (fx.zoom > 1) { effect({ kind: 'zoom', level: 1, center: null }); return; }
            // Where to zoom: click a point on the screen (2×) or drag an area.
            void sendToBackground({ target: 'background', type: 'recording/region-select', purpose: 'zoom' }).catch(() => undefined);
            window.close();
          }} />
        <Tool label="Zoom to area" icon={<ScanSearch size={18} />}
          onClick={() => { void sendToBackground({ target: 'background', type: 'recording/region-select', purpose: 'zoom' }).catch(() => undefined); window.close(); }} />
        <Tool label={fx.highlight ? 'Clear highlight' : 'Highlight area'} icon={<Highlighter size={18} />} on={fx.highlight}
          onClick={() => {
            if (fx.highlight) effect({ kind: 'highlight', rect: null });
            else { void sendToBackground({ target: 'background', type: 'recording/region-select', purpose: 'highlight' }).catch(() => undefined); window.close(); }
          }} />
        <Tool label="Spotlight" icon={<Focus size={18} />} on={fx.spotlight} onClick={() => effect({ kind: 'spotlight', on: !fx.spotlight })} />
        <Tool label={fx.annotating ? 'Stop drawing' : 'Draw on screen'} icon={<Pen size={18} />} on={fx.annotating}
          onClick={() => { void sendToBackground({ target: 'background', type: 'recording/annotate', action: { kind: fx.annotating ? 'stop' : 'start' } }).catch(() => undefined); if (!fx.annotating) window.close(); }} />
        <Tool label={`Marker${state.markers.length ? ` (${state.markers.length})` : ''}`} icon={<Flag size={18} />} onClick={() => void sendToBackground({ target: 'background', type: 'recording/marker' }).catch(() => undefined)} />
        <Tool label="Teleprompter" icon={<ScrollText size={18} />} on={fx.teleprompter} onClick={() => void sendToBackground({ target: 'background', type: 'teleprompter/open' }).catch(() => undefined)} />
        <Tool label={state.micOn ? 'Mic on' : 'Mic off'} icon={state.micOn ? <Mic size={18} /> : <MicOff size={18} />} on={state.micOn} disabled={!state.micAvailable} onClick={() => command('toggle-mic')} />
        <Tool label={state.cameraOn ? 'Camera on' : 'Camera off'} icon={state.cameraOn ? <Camera size={18} /> : <CameraOff size={18} />} on={state.cameraOn} disabled={!state.cameraAvailable} onClick={() => command('toggle-camera')} />
      </div>
    </div>
  );
}
