import { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, CameraOff, Mic, MicOff, Monitor, Pause, Play, Square, Trash2, AlertTriangle, CheckCircle2 } from 'lucide-react';
import type { AppErrorInfo, RecordingConfig, RelativeRect } from '@/shared/types';
import { RegionPicker } from '../components/RegionPicker';
import { errorInfoOf, sendToBackground } from '@/shared/messaging/client';
import { isHostMessage } from '@/shared/messaging/messages';
import { Button, IconButton } from '@/shared/components/Button';
import { ProgressIndicator, Spinner } from '@/shared/components/Progress';
import { InlineNotice } from '@/shared/components/Settings';
import { ConfirmationDialog } from '@/shared/components/Modal';
import { useNow, useRecordingState } from '@/shared/hooks/useRecordingState';
import { useSettings } from '@/shared/hooks/useSettings';
import { useTheme } from '@/shared/hooks/useTheme';
import { RESOLUTION_PRESETS } from '@/shared/constants/media';
import { makeErrorInfo } from '@/shared/utils/errors';
import { formatDuration } from '@/shared/utils/format';
import { RecordingSession } from '../services/recording-session';
import { applyCommand, createSessionHooks } from '../services/session-bridge';
import { chooseDesktopMedia, getCameraStream, getDesktopStream, stopStream } from '../services/media-stream-service';
import { surfaceInfo, workAreaCrop } from '../services/display-service';
import { isPageGeometry, pageRectToSurface, pageToSurface, type SurfaceInfo } from '../services/screen-map';
import { livePageInFront, shootPageInFront } from '../services/page-under-bar';
import { LivePage } from '../services/live-page';
import { describeMime, targetDimensions } from '../services/codec-service';
import { elapsedMs, remainingMs } from '../services/recording-state';
import type { PendingRecording } from '@/background/recording-manager';
import { DesktopScreenshot } from './DesktopScreenshot';
import { TopBar } from './TopBar';
import styles from './pages.module.css';

export function RecorderApp() {
  const { settings } = useSettings();
  useTheme(settings?.general.theme);
  const params = new URLSearchParams(location.search);
  if (params.get('intent') === 'screenshot') return <DesktopScreenshot />;
  return <RecordingWorkspace sessionId={params.get('session') ?? ''} />;
}

type Phase = 'loading' | 'choosing' | 'picker-cancelled' | 'starting' | 'area' | 'live' | 'saving' | 'ended' | 'error';
type PickPurpose = 'area' | 'highlight' | 'zoom';

function cameraDims(config: RecordingConfig) {
  return config.resolution === 'original' ? { width: 3840, height: 2160 } : RESOLUTION_PRESETS[config.resolution];
}

/** Hosts desktop and camera recordings. Stays open (in the background) while recording. */
function RecordingWorkspace({ sessionId }: { sessionId: string }) {
  const state = useRecordingState();
  const [phase, setPhase] = useState<Phase>('loading');
  const [error, setError] = useState<AppErrorInfo | null>(null);
  const [config, setConfig] = useState<RecordingConfig | null>(null);
  const [preview, setPreview] = useState<MediaStream | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [level, setLevel] = useState(0);
  const [picking, setPicking] = useState<PickPurpose | null>(null);
  const areaResolver = useRef<((rect: RelativeRect | null) => void) | null>(null);
  const sessionRef = useRef<RecordingSession | null>(null);
  /** What the desktop recording captures, to place page areas and the mouse on it. */
  const surface = useRef<Promise<SurfaceInfo | null> | null>(null);
  /** The recorded screen / window track, to read the monitors and frame size again when they change. */
  const surfaceTrack = useRef<MediaStreamTrack | null>(null);
  /** Live video of the page in front, for painting out Chrome's sharing bar (screen / window recordings). */
  const livePage = useRef<LivePage | null>(null);
  const [pickNote, setPickNote] = useState<string | null>(null);
  /** The recording was paused for choosing a zoom / highlight area on the preview (resumed after). */
  const pausedForPick = useRef(false);
  /**
   * Choosing an area on the live preview of the screen being recorded would put the recorder page —
   * a picture of the screen inside the screen — into the video. The recording pauses meanwhile and
   * the preview shows a still frame.
   */
  const beginPick = useCallback((purpose: PickPurpose) => {
    const session = sessionRef.current;
    if (session && !session.isPaused && purpose !== 'area') {
      applyCommand(session, 'pause');
      pausedForPick.current = true;
    }
    videoRef.current?.pause();
    setPicking(purpose);
  }, []);
  const endPick = useCallback(() => {
    setPicking(null);
    void videoRef.current?.play().catch(() => undefined);
    if (pausedForPick.current && sessionRef.current) applyCommand(sessionRef.current, 'resume');
    pausedForPick.current = false;
  }, []);
  const videoRef = useRef<HTMLVideoElement>(null);
  const hooks = useRef(createSessionHooks(sessionId));
  const live = state.sessionId === sessionId && (state.status === 'recording' || state.status === 'paused');
  const now = useNow(state.status === 'recording' || state.status === 'countdown', 250);

  const begin = useCallback(async (cfg: RecordingConfig) => {
    setError(null);
    let stream: MediaStream | null = null;
    try {
      if (cfg.mode === 'desktop') {
        setPhase('choosing');
        let choice;
        try {
          choice = await chooseDesktopMedia(cfg.systemAudio);
        } catch {
          setPhase('picker-cancelled');
          return;
        }
        setPhase('starting');
        stream = await getDesktopStream(choice, { box: targetDimensions(cfg.resolution), fps: cfg.fps }, cfg.systemAudio);
      } else {
        setPhase('starting');
        stream = await getCameraStream(cfg.camera, cameraDims(cfg), cfg.fps);
      }
      setPreview(stream);
      // Custom area of a screen: pick the region on the live preview before recording starts.
      let pickedArea: RelativeRect | null = null;
      if (cfg.mode === 'desktop' && cfg.selectArea) {
        setPhase('area');
        pickedArea = await new Promise<RelativeRect | null>((resolve) => {
          areaResolver.current = resolve;
          setPicking('area');
        });
        areaResolver.current = null;
        setPicking(null);
        if (!pickedArea) {
          stopStream(stream);
          setPreview(null);
          setPhase('ended');
          hooks.current.finished(null, makeErrorInfo('cancelled'));
          return;
        }
        setPhase('starting');
      }
      const session = new RecordingSession(sessionId, cfg, {
        emit: hooks.current.emit,
        finished: (captureId, err) => {
          setPhase(captureId ? 'ended' : err && err.code !== 'cancelled' ? 'error' : 'ended');
          if (err && err.code !== 'cancelled') setError(err);
          sessionRef.current = null;
          livePage.current?.stop();
          livePage.current = null;
          hooks.current.finished(captureId, err);
        },
      });
      sessionRef.current = session;
      const label = stream.getVideoTracks()[0]?.label;
      // "Without taskbar": crop full-screen captures to the display's work area.
      const area = pickedArea ?? (cfg.mode === 'desktop' && cfg.excludeTaskbar ? await workAreaCrop(stream.getVideoTracks()[0]).catch(() => null) : null);
      await session.prepare({ stream, monitorAudio: false, area, title: cfg.mode === 'desktop' ? label || 'Desktop' : 'Camera' });
      surfaceTrack.current = cfg.mode === 'desktop' ? stream.getVideoTracks()[0] ?? null : null;
      surface.current = surfaceTrack.current ? surfaceInfo(surfaceTrack.current).catch(() => null) : null;
      // Chrome's "is sharing your screen" bar is replaced with the page under it: from a live video of
      // that page where Chrome allows it (keeps up with scrolling), else from still pictures of it.
      if (surfaceTrack.current) {
        livePage.current?.stop();
        const live = (livePage.current = new LivePage(cfg.fps));
        session.setPageShooter(async (fw, fh) => {
          const info = await surface.current;
          if (!info) return null;
          return (await livePageInFront(info, fw, fh, live).catch(() => null)) ?? shootPageInFront(info, fw, fh);
        });
      }
      setPhase('live');
      void session.start();
    } catch (err) {
      stopStream(stream);
      sessionRef.current?.releaseMedia();
      sessionRef.current = null;
      livePage.current?.stop();
      livePage.current = null;
      const info = errorInfoOf(err);
      setError(info);
      setPhase('error');
      hooks.current.finished(null, info);
    }
  }, [sessionId]);

  useEffect(() => () => livePage.current?.stop(), []);

  // Load the pending session config from the service worker, then start.
  useEffect(() => {
    let cancelled = false;
    sendToBackground<PendingRecording>({ target: 'background', type: 'recording/get-pending', sessionId })
      .then((pending) => {
        if (cancelled) return;
        setConfig(pending.config);
        void begin(pending.config);
      })
      .catch(() => {
        if (!cancelled) {
          setError(makeErrorInfo('cancelled'));
          setPhase('ended');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId, begin]);

  // Commands from the popup, control bar and keyboard shortcuts (routed by the service worker).
  useEffect(() => {
    const listener = (msg: unknown, sender: chrome.runtime.MessageSender, sendResponse: (r: unknown) => void) => {
      if (sender.id !== chrome.runtime.id || !isHostMessage(msg) || msg.type === 'host/start' || msg.type === 'host/ping' || msg.sessionId !== sessionId) return false;
      if (msg.type === 'host/effect') {
        sessionRef.current?.applyEffect(msg.effect);
        sendResponse({ ok: true, data: null });
        return false;
      }
      if (msg.type === 'host/region-select') {
        setPickNote(null);
        beginPick(msg.purpose);
        sendResponse({ ok: true, data: null });
        return false;
      }
      if (msg.type === 'host/page-region') {
        // An area chosen on the page you work on: place it on the recorded screen / window.
        const { purpose, rect, page } = msg;
        void (async () => {
          const info = await surface.current;
          const mapped = info ? pageRectToSurface(rect, page, info) : null;
          if (mapped) {
            await sendToBackground({ target: 'background', type: 'recording/region-selected', purpose, rect: mapped }).catch(() => undefined);
            return;
          }
          // That page isn't in the recording (another window or monitor): choose on the preview here.
          setPickNote('That page is not part of what is being recorded — choose the area on the preview instead (recording paused).');
          beginPick(purpose);
          const me = await chrome.tabs.getCurrent().catch(() => undefined);
          if (me?.id !== undefined) await chrome.tabs.update(me.id, { active: true }).catch(() => undefined);
          if (me?.windowId !== undefined) await chrome.windows.update(me.windowId, { focused: true }).catch(() => undefined);
        })();
        sendResponse({ ok: true, data: null });
        return false;
      }
      if (sessionRef.current) applyCommand(sessionRef.current, msg.command);
      else if (msg.command === 'cancel' || msg.command === 'stop') hooks.current.finished(null, makeErrorInfo('cancelled'));
      sendResponse({ ok: true, data: null });
      return false;
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, [sessionId]);

  // Desktop recordings: the page being worked on reports the mouse; placed on the recorded frames,
  // it lets zoom follow the cursor (and auto zoom on click) like in tab recordings.
  useEffect(() => {
    const onConnect = (port: chrome.runtime.Port) => {
      if (port.name !== 'glint-cursor' || port.sender?.id !== chrome.runtime.id || !port.sender.tab) return;
      const tabId = port.sender.tab.id;
      // The tab's page zoom, straight from Chrome (kept up to date while it changes).
      let zoom: number | undefined;
      if (tabId !== undefined) void chrome.tabs.getZoom(tabId).then((z) => { zoom = z; }).catch(() => undefined);
      const onZoom = (e: chrome.tabs.OnZoomChangeInfo) => { if (e.tabId === tabId) zoom = e.newZoomFactor; };
      chrome.tabs.onZoomChange.addListener(onZoom);
      port.onDisconnect.addListener(() => chrome.tabs.onZoomChange.removeListener(onZoom));
      port.onMessage.addListener((msg: unknown) => {
        const session = sessionRef.current;
        if (!session || !surface.current || !msg || typeof msg !== 'object') return;
        const m = msg as { x?: unknown; y?: unknown; click?: unknown; page?: unknown };
        if (typeof m.x !== 'number' || typeof m.y !== 'number' || !Number.isFinite(m.x) || !Number.isFinite(m.y) || !isPageGeometry(m.page)) return;
        const page = { ...m.page, ...(zoom ? { zoom } : {}) };
        const at = { x: Math.max(0, Math.min(1, m.x)), y: Math.max(0, Math.min(1, m.y)) };
        const click: { click?: 'left' | 'right' } = m.click === 'left' || m.click === 'right' ? { click: m.click } : {};
        // Always the latest screen info: it is read again when the monitors change (see below).
        void surface.current.then((i) => {
          const map = i ? pageToSurface(page, i) : null;
          if (map) session.onCursor({ ...map(at), ...click });
        });
      });
    };
    chrome.runtime.onConnect.addListener(onConnect);
    // A remote desktop window resized or made full screen (RDP changes the remote screen's size and
    // scale), a monitor added or its scaling changed: read the monitors and the frame size again, so
    // the mouse isn't placed with the old screen's size.
    const onDisplays = () => {
      if (surfaceTrack.current) surface.current = surfaceInfo(surfaceTrack.current).catch(() => null);
    };
    chrome.system?.display?.onDisplayChanged.addListener(onDisplays);
    return () => {
      chrome.runtime.onConnect.removeListener(onConnect);
      chrome.system?.display?.onDisplayChanged.removeListener(onDisplays);
    };
  }, []);

  // Preview + warn before closing the tab while recording.
  useEffect(() => {
    if (videoRef.current && preview) videoRef.current.srcObject = preview;
  }, [preview, phase]);

  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (sessionRef.current) e.preventDefault();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);

  useEffect(() => {
    if (!live) return;
    let raf = 0;
    const loop = () => {
      setLevel(sessionRef.current?.micLevel() ?? 0);
      raf = requestAnimationFrame(loop);
    };
    loop();
    return () => cancelAnimationFrame(raf);
  }, [live]);

  useEffect(() => {
    if (state.status === 'stopping' && state.sessionId === sessionId) setPhase('saving');
  }, [state.status, state.sessionId, sessionId]);

  const cmd = (c: Parameters<typeof applyCommand>[1]) => sessionRef.current && applyCommand(sessionRef.current, c);
  const cancelPending = () => hooks.current.finished(null, makeErrorInfo('cancelled'));

  /* ---------------------------------- views --------------------------------- */
  if (phase === 'loading' || phase === 'starting' || phase === 'choosing') {
    return (
      <Shell>
        <section className={`${styles.panel} ${styles.center}`}>
          <span className={styles.heroIcon}>{config?.mode === 'camera' ? <Camera size={30} /> : <Monitor size={30} />}</span>
          <h1 className={styles.h1}>{phase === 'choosing' ? 'Choose what to share' : 'Getting ready…'}</h1>
          <p className={styles.lead}>
            {phase === 'choosing'
              ? 'Pick your entire screen, an application window or a tab in Chrome’s dialog. To include sound, turn on “Share system audio” (Windows / ChromeOS) or “Share tab audio”.'
              : 'Connecting to your devices.'}
          </p>
          <Spinner size={22} />
          <Button variant="ghost" onClick={cancelPending}>
            Cancel
          </Button>
        </section>
      </Shell>
    );
  }

  if (phase === 'picker-cancelled') {
    return (
      <Shell>
        <section className={`${styles.panel} ${styles.center}`}>
          <span className={styles.heroIcon}>
            <Monitor size={30} />
          </span>
          <h1 className={styles.h1}>Sharing was cancelled</h1>
          <p className={styles.lead}>Nothing is being recorded. Choose a screen or window to start, or cancel the recording.</p>
          <div className={styles.actions}>
            <Button variant="ghost" onClick={cancelPending}>
              Cancel recording
            </Button>
            <Button variant="primary" onClick={() => config && void begin(config)}>
              Choose again
            </Button>
          </div>
        </section>
      </Shell>
    );
  }

  if (phase === 'error' || phase === 'ended') {
    const info = error ?? makeErrorInfo('cancelled');
    return (
      <Shell>
        <section className={`${styles.panel} ${styles.center}`}>
          {info.code === 'saved-to-downloads' ? (
            <span className={styles.heroIcon} style={{ background: 'var(--c-success-soft, #DCFCE7)', color: 'var(--c-success, #16A34A)' }}>
              <CheckCircle2 size={30} />
            </span>
          ) : (
            <span className={styles.heroIcon} style={{ background: 'var(--c-error-soft)', color: 'var(--c-error)' }}>
              <AlertTriangle size={30} />
            </span>
          )}
          <h1 className={styles.h1}>{phase === 'ended' && !error ? 'Recording finished' : info.title}</h1>
          <p className={styles.lead}>{phase === 'ended' && !error ? 'Opening your recording…' : [info.message, info.recovery].filter(Boolean).join(' ')}</p>
          {phase === 'error' && info.detail && (
            // What Chrome actually reported, so a failure can be understood and reported.
            <details className={styles.errorDetail}>
              <summary>Technical details</summary>
              <code>{info.code}: {info.detail}</code>
              <Button size="sm" variant="secondary" onClick={() => void navigator.clipboard.writeText(`${info.title} (${info.code}): ${info.detail}`).catch(() => undefined)}>Copy details</Button>
            </details>
          )}
          <div className={styles.actions}>
            <Button onClick={() => window.close()}>Close tab</Button>
            {(info.code === 'storage-unavailable' || info.code === 'saved-to-downloads') ? (
              <Button variant="primary" onClick={() => void chrome.tabs.create({ url: chrome.runtime.getURL('options.html#advanced') })}>
                Repair storage
              </Button>
            ) : (
              <Button variant="primary" onClick={() => void chrome.tabs.create({ url: chrome.runtime.getURL('options.html#history') })}>
                Recent captures
              </Button>
            )}
          </div>
        </section>
      </Shell>
    );
  }

  const a = state.actual;
  const elapsed = elapsedMs(state, now);
  const remaining = remainingMs(state, now);
  const counting = state.status === 'countdown' && state.countdownEndsAt;

  return (
    <Shell>
      <section className={styles.panel}>
        <div className={styles.previewWrap}>
          <video ref={videoRef} autoPlay muted playsInline aria-label="Recording preview" style={config?.mode === 'camera' ? { transform: 'scaleX(-1)' } : undefined} />
          {live && (
            <span className={styles.liveBadge}>
              <span className={`${styles.dot} ${state.status === 'paused' ? styles.dotPaused : ''}`} />
              {state.status === 'paused' ? 'Paused' : 'Recording'}
            </span>
          )}
          {counting && <div className={styles.countOverlay}>{Math.max(1, Math.ceil(((state.countdownEndsAt ?? now) - now) / 1000))}</div>}
        </div>

        {phase === 'saving' ? (
          <ProgressIndicator value={null} label="Saving your recording…" />
        ) : (
          <div className={styles.statusRow}>
            <div>
              <div className={styles.timer}>{formatDuration(elapsed)}</div>
              <div className={styles.sub}>
                {remaining !== null ? `Stops automatically in ${formatDuration(remaining)} · ` : ''}
                You can switch to other windows — recording continues in the background.
              </div>
            </div>
            <div className={styles.controls}>
              {state.micAvailable && (
                <div className={styles.meter} aria-label="Microphone level">
                  <div style={{ width: `${level * 100}%` }} />
                </div>
              )}
              <IconButton label={state.micOn ? 'Mute microphone' : 'Unmute microphone'} icon={state.micOn ? <Mic size={18} /> : <MicOff size={18} />} active={state.micOn} disabled={!state.micAvailable} onClick={() => cmd('toggle-mic')} />
              {config?.mode !== 'camera' && (
                <IconButton label={state.cameraOn ? 'Hide camera' : 'Show camera'} icon={state.cameraOn ? <Camera size={18} /> : <CameraOff size={18} />} active={state.cameraOn} disabled={!state.cameraAvailable} onClick={() => cmd('toggle-camera')} />
              )}
              <IconButton label="Discard recording" icon={<Trash2 size={18} />} tone="danger" disabled={!live} onClick={() => setConfirmDiscard(true)} />
              {state.status === 'paused' ? (
                <Button icon={<Play size={16} />} onClick={() => cmd('resume')} disabled={!live}>
                  Resume
                </Button>
              ) : (
                <Button icon={<Pause size={16} />} onClick={() => cmd('pause')} disabled={!live}>
                  Pause
                </Button>
              )}
              <Button variant="recording" icon={<Square size={14} fill="currentColor" />} onClick={() => cmd('stop')}>
                Stop
              </Button>
            </div>
          </div>
        )}

        {a && (
          <dl className={styles.facts}>
            <div className={styles.fact}>
              <dt>Recording resolution</dt>
              <dd>{a.width} × {a.height}</dd>
            </div>
            <div className={styles.fact}>
              <dt>Source</dt>
              <dd>{a.sourceWidth} × {a.sourceHeight}</dd>
            </div>
            <div className={styles.fact}>
              <dt>Frame rate</dt>
              <dd>{a.fps} fps</dd>
            </div>
            <div className={styles.fact}>
              <dt>Format</dt>
              <dd>{describeMime(a.mimeType)}</dd>
            </div>
            <div className={styles.fact}>
              <dt>Video bitrate</dt>
              <dd>{(a.videoBitrate / 1_000_000).toFixed(1)} Mbps</dd>
            </div>
            <div className={styles.fact}>
              <dt>Audio</dt>
              <dd>{[a.hasMicrophone && 'Microphone', a.hasSystemAudio && 'System'].filter(Boolean).join(' + ') || 'None'}</dd>
            </div>
          </dl>
        )}
        {state.warnings.length > 0 && (
          <div className={styles.notes}>
            {state.warnings.map((w) => (
              <InlineNotice key={w} tone="warning">
                {w}
              </InlineNotice>
            ))}
          </div>
        )}
      </section>
      {picking && (
        <RegionPicker
          video={videoRef.current}
          clickToZoom={picking === 'zoom'}
          title={(picking === 'area' ? 'Drag over the part of the screen to record' : picking === 'zoom' ? 'Click where to zoom in, or drag over an area' : 'Drag over the area to highlight') + (pickNote && picking !== 'area' ? ` · ${pickNote}` : '')}
          confirmLabel={picking === 'area' ? 'Record this area' : picking === 'zoom' ? 'Zoom here' : 'Highlight'}
          onCancel={() => {
            if (picking === 'area') { areaResolver.current?.(null); setPicking(null); }
            else {
              endPick();
              void sendToBackground({ target: 'background', type: 'recording/region-cancelled' }).catch(() => undefined);
            }
          }}
          onConfirm={(rect) => {
            if (picking === 'area') { areaResolver.current?.(rect); setPicking(null); return; }
            void sendToBackground({ target: 'background', type: 'recording/region-selected', purpose: picking, rect }).catch(() => undefined);
            endPick();
          }}
        />
      )}
      <ConfirmationDialog
        open={confirmDiscard}
        title="Discard this recording?"
        message="Everything recorded so far will be deleted. This can’t be undone."
        confirmLabel="Discard"
        danger
        onCancel={() => setConfirmDiscard(false)}
        onConfirm={() => {
          setConfirmDiscard(false);
          cmd('cancel');
        }}
      />
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className={styles.page}>
      <TopBar />
      <main className={styles.main}>{children}</main>
    </div>
  );
}
