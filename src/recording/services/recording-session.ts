import type {
  ActualRecordingInfo, AppErrorInfo, CursorReport, LiveEffect, RecordingConfig, RecordingEvent, RelativeRect,
} from '@/shared/types';
import { broadcast } from '@/shared/messaging/client';
import { LiveEffects } from './live-effects';
import { RESOLUTION_PRESETS } from '@/shared/constants/media';
import { AppError, isStorageUnavailable, makeErrorInfo, toAppError } from '@/shared/utils/errors';
import { buildFilename, extensionForMime } from '@/shared/utils/filename';
import { logger } from '@/shared/utils/logger';
import { addCapture } from '@/history/history-service';
import { AudioMixer } from './audio-service';
import { assembleChunks, deleteSession, dropMemoryChunks, saveSessionMeta, updateSessionActiveMs, type SessionMeta } from './chunk-store';
import { downloadBlob } from '@/shared/utils/download';
import { sendToBackground } from '@/shared/messaging/client';
import { describeMime, planEncoding, resolveVideoBitrate, selectMimeType } from './codec-service';
import { ChunkedRecorder } from './media-recorder-service';
import { getCameraStream, getMicStream, stopStream } from './media-stream-service';
import { generateVideoThumbnail } from './thumbnail';
import { VideoCompositor, isCompositorSupported } from './video-compositor';
import { fixWebmDuration } from './webm-duration';
import type { PageShot } from './page-under-bar';

export interface SessionHooks {
  emit: (event: RecordingEvent) => void;
  finished: (captureId: string | null, error?: AppErrorInfo) => void;
}

export interface SessionSource {
  /** Screen / tab / camera stream. Its audio tracks (if any) are system or tab audio. */
  stream: MediaStream;
  /** Route system audio to the speakers while recording (needed for tab capture, which mutes the tab). */
  monitorAudio: boolean;
  area: RelativeRect | null;
  title?: string;
  url?: string;
}

/**
 * One recording from start to saved file. Runs in whichever document hosts the recording
 * (offscreen document for tab capture, recorder tab for desktop and camera), and is the only place
 * that owns MediaStreams, so cleanup is centralised.
 */
export class RecordingSession {
  private source: SessionSource | null = null;
  private micStream: MediaStream | null = null;
  private cameraStream: MediaStream | null = null;
  private mixer: AudioMixer | null = null;
  private compositor: VideoCompositor | null = null;
  private recorder: ChunkedRecorder | null = null;
  private meta: SessionMeta | null = null;
  private warnings: string[] = [];
  private notes: string[] = [];
  private accumulatedMs = 0;
  private resumedAt: number | null = null;
  private ticker: ReturnType<typeof setInterval> | null = null;
  private countdownTimer: ReturnType<typeof setTimeout> | null = null;
  private finishing = false;
  private paused = false;
  /** True while the recording is paused. */
  get isPaused(): boolean {
    return this.paused;
  }
  private micOn = false;
  private cameraOn = false;
  private actual: ActualRecordingInfo | null = null;
  private lastPersist = 0;
  private effects: LiveEffects | null = null;
  private micSilentMs = 0;
  private lastLevelAt = 0;

  constructor(
    readonly sessionId: string,
    private readonly config: RecordingConfig,
    private readonly hooks: SessionHooks,
  ) {}

  get elapsedMs(): number {
    return this.accumulatedMs + (this.resumedAt !== null ? Date.now() - this.resumedAt : 0);
  }

  /** See prepare(): returns the codec to prefer; may lower the capture size (resolution "Original" only). */
  private async chooseEfficientEncoding(track: MediaStreamTrack, videoCodec: RecordingConfig['videoCodec']): Promise<RecordingConfig['videoCodec']> {
    const caps = (navigator as Navigator & { mediaCapabilities?: MediaCapabilities }).mediaCapabilities;
    const src = track.getSettings();
    if (!caps?.encodingInfo || !src.width || !src.height) return videoCodec;
    const { config } = this;
    try {
      const plan = await planEncoding(
        { width: src.width, height: src.height },
        { container: config.container, videoPref: videoCodec, fps: config.fps, bitrateKbps: config.videoBitrateKbps, mayShrink: config.resolution === 'original' },
        (m) => MediaRecorder.isTypeSupported(m),
        (q) => caps.encodingInfo({ type: 'record', video: q }),
      );
      if (!plan.efficient) {
        this.notes.push(`This computer has no hardware encoder for ${src.width}×${src.height} video, so it is encoded on the processor, which can slow the computer (and the mouse) while recording. If it does, choose 1080p or 1440p in Settings › Recording › Resolution.`);
        return videoCodec;
      }
      if (plan.size.width < src.width) {
        try {
          await track.applyConstraints({ width: { max: plan.size.width }, height: { max: plan.size.height } });
          this.notes.push(`Recorded at ${plan.size.width}×${plan.size.height} instead of ${src.width}×${src.height}: the graphics card can't encode the full size, and encoding it on the processor would slow the computer (and the mouse). Choose a resolution in Settings › Recording to record at another size.`);
        } catch {
          this.notes.push(`This computer can't hardware-encode ${src.width}×${src.height} video, which can slow it while recording. If it does, choose 1080p or 1440p in Settings › Recording › Resolution.`);
          return videoCodec;
        }
      }
      return plan.videoCodec;
    } catch {
      return videoCodec;
    }
  }

  /** Acquires microphone / camera, builds the pipeline and the MediaRecorder. */
  async prepare(source: SessionSource): Promise<ActualRecordingInfo> {
    this.source = source;
    const { config } = this;
    const primaryVideo = source.stream.getVideoTracks()[0];
    if (!primaryVideo) throw new AppError('source-unavailable', 'Source stream has no video track');

    // A format the graphics card can encode: encoding a large screen (4K) on the processor slows the
    // whole computer, mouse included. With resolution "Original" a smaller size is used when only
    // that is hardware-encoded; otherwise the user is told.
    let videoCodec = config.videoCodec;
    if (config.mode !== 'camera') videoCodec = await this.chooseEfficientEncoding(primaryVideo, videoCodec);

    // Microphone
    if (config.mic.enabled) {
      try {
        this.micStream = await getMicStream(config.mic);
      } catch (err) {
        const info = toAppError(err, 'microphone');
        this.warnings.push(`${info.title}. Recording continues without microphone audio.`);
      }
    }

    // Camera overlay (camera-only mode uses the camera as the primary source instead)
    if (config.camera.enabled && config.mode !== 'camera') {
      if (!isCompositorSupported()) {
        this.warnings.push('Camera overlay needs Chrome 94+ media processing APIs; recording without camera.');
      } else {
        try {
          this.cameraStream = await getCameraStream(config.camera);
        } catch (err) {
          const info = toAppError(err, 'camera');
          this.warnings.push(`${info.title}. Recording continues without the camera overlay.`);
        }
      }
    }

    // Video pipeline. The compositor is always used when available so zoom, spotlight, region
    // highlight, the teleprompter and webcam changes can be switched on during the recording; frames
    // pass through untouched (zero copy) while no effect is visible.
    let videoTrack: MediaStreamTrack = primaryVideo;
    const needsCrop = source.area !== null;
    const cameraTrack = this.cameraStream?.getVideoTracks()[0] ?? null;
    if (isCompositorSupported()) {
      this.effects = new LiveEffects(
        cameraTrack && config.cameraStyle ? { ...config.cameraStyle } : null,
        config.zoom ?? { autoOnClick: false, level: 2, transitionMs: 600, holdMs: 1800, easing: 'ease-in-out' },
        config.spotlight ?? { radius: 0.18, dim: 0.6 },
        // Desktop recordings get positions from the page being worked on, placed on the screen.
        config.mode !== 'camera',
      );
      this.compositor = new VideoCompositor(primaryVideo, {
        crop: source.area,
        camera: cameraTrack
          ? { track: cameraTrack, position: config.camera.position, size: config.camera.size, shape: config.camera.shape }
          : null,
        effects: this.effects,
        fps: config.fps,
        // Screen and window recordings show Chrome's "… is sharing your screen" bar: paint it out.
        removeShareBar: config.mode === 'desktop',
      });
      this.compositor.start();
      await this.compositor.waitForFirstFrame();
      videoTrack = this.compositor.track;
    } else if (needsCrop) {
      this.warnings.push('Custom-area cropping is not supported in this Chrome version; the full tab is recorded.');
    }

    // Audio
    const systemTracks = config.systemAudio ? source.stream.getAudioTracks() : [];
    if (config.systemAudio && config.mode !== 'camera' && systemTracks.length === 0) {
      this.notes.push(config.mode === 'desktop'
        ? 'System audio was not shared. On Windows/ChromeOS tick “Share system audio” (or “Share tab audio”) in the picker.'
        : 'This tab did not provide audio.');
    }
    if (!config.systemAudio) source.stream.getAudioTracks().forEach((t) => t.stop());
    if (systemTracks.length || this.micStream) {
      this.mixer = new AudioMixer();
      if (systemTracks.length) this.mixer.addSystemAudio(new MediaStream(systemTracks), source.monitorAudio);
      if (this.micStream) this.mixer.addMicrophone(this.micStream, config.mic.volume);
      await this.mixer.resume();
    }
    const audioTrack = this.mixer?.track ?? null;

    // Codec / container
    const selection = selectMimeType(config.container, videoCodec, config.audioCodec, audioTrack !== null, (m) => MediaRecorder.isTypeSupported(m));
    if (!selection) throw new AppError('unsupported-codec', 'No MediaRecorder MIME type supported');
    this.warnings.push(...selection.warnings);

    const settings = videoTrack.getSettings();
    const primarySettings = primaryVideo.getSettings();
    const width = this.compositor?.outputWidth || settings.width || primarySettings.width || 0;
    const height = this.compositor?.outputHeight || settings.height || primarySettings.height || 0;
    const fps = Math.round(primarySettings.frameRate || config.fps);
    const videoBitsPerSecond = resolveVideoBitrate(config.videoBitrateKbps, width, height, Math.min(fps, config.fps));

    this.describeResolution(width, height, primarySettings.width ?? width, primarySettings.height ?? height);

    const stream = new MediaStream(audioTrack ? [videoTrack, audioTrack] : [videoTrack]);
    this.recorder = new ChunkedRecorder(stream, this.sessionId, {
      mimeType: selection.mimeType,
      videoBitsPerSecond,
      audioBitsPerSecond: audioTrack ? config.audioBitrateKbps * 1000 : undefined,
    });
    this.recorder.onError = (err) => this.handleRecorderError(err);

    this.actual = {
      width,
      height,
      fps,
      mimeType: selection.mimeType,
      sourceWidth: primarySettings.width ?? width,
      sourceHeight: primarySettings.height ?? height,
      videoBitrate: videoBitsPerSecond,
      hasMicrophone: Boolean(this.mixer?.hasMicrophone),
      hasSystemAudio: systemTracks.length > 0,
    };

    this.meta = {
      sessionId: this.sessionId,
      mode: config.mode,
      mimeType: selection.mimeType,
      startedAt: Date.now(),
      activeMs: 0,
      width,
      height,
      fps,
      config,
      sourceTitle: source.title,
      sourceUrl: source.url,
      notes: this.notes,
      hasMicrophone: this.actual.hasMicrophone,
      hasSystemAudio: this.actual.hasSystemAudio,
    };
    try {
      await saveSessionMeta(this.meta);
    } catch (err) {
      // Pixora's storage cannot be opened: record anyway (kept in memory, saved to Downloads).
      if (!isStorageUnavailable(err)) throw err;
      logger.warn('storage unavailable: recording to memory', err);
      this.warnings.push('Pixora’s storage could not be opened, so this recording will be saved to your Downloads folder.');
    }

    // Interruption handling
    primaryVideo.addEventListener('ended', () => {
      logger.info('source track ended');
      if (!this.finishing) void this.stop('source-ended');
    });
    this.micStream?.getAudioTracks()[0]?.addEventListener('ended', () => {
      this.hooks.emit({ type: 'WARN', message: 'Microphone disconnected. Recording continues without it.' });
      this.hooks.emit({ type: 'MIC', on: false });
    });
    cameraTrack?.addEventListener('ended', () => {
      this.compositor?.setCameraVisible(false);
      this.hooks.emit({ type: 'WARN', message: 'Camera disconnected. Recording continues without it.' });
      this.hooks.emit({ type: 'CAMERA', on: false });
    });

    return this.actual;
  }

  private describeResolution(width: number, height: number, srcW: number, srcH: number): void {
    const preset = this.config.resolution;
    if (preset === 'original') {
      this.notes.push(`Recorded at the source's native resolution (${width} × ${height}).`);
      return;
    }
    const target = RESOLUTION_PRESETS[preset];
    const long = Math.max(width, height);
    const short = Math.min(width, height);
    if (long + 8 < target.width && short + 8 < target.height && !this.source?.area) {
      this.notes.push(
        `Requested ${preset === '2160p' ? '4K' : preset === '4320p' ? '8K' : preset}, but the source provides ${srcW} × ${srcH}. ` +
          'Pixora records the real source pixels and never upscales.',
      );
    }
  }

  /** Runs the countdown (if any) then starts MediaRecorder. */
  start(): Promise<void> {
    if (!this.recorder || !this.actual) throw new AppError('unknown', 'prepare() was not called');
    const seconds = this.config.countdownSeconds;
    return new Promise<void>((resolve) => {
      const begin = () => {
        if (this.finishing || !this.recorder || !this.actual) return resolve();
        this.recorder.start();
        const now = Date.now();
        this.resumedAt = now;
        this.micOn = Boolean(this.mixer?.hasMicrophone);
        this.cameraOn = Boolean(this.compositor && this.cameraStream);
        this.hooks.emit({
          type: 'STARTED',
          at: now,
          actual: this.actual,
          micAvailable: this.micOn,
          cameraAvailable: this.cameraOn,
          warnings: [...this.warnings],
        });
        this.ticker = setInterval(() => this.tick(), 250);
        resolve();
      };
      if (seconds > 0) {
        this.hooks.emit({ type: 'COUNTDOWN', endsAt: Date.now() + seconds * 1000 });
        this.countdownTimer = setTimeout(begin, seconds * 1000);
      } else {
        begin();
      }
    });
  }

  private tick(): void {
    const elapsed = this.elapsedMs;
    if (this.config.maxDurationMs > 0 && elapsed >= this.config.maxDurationMs && !this.finishing) {
      void this.stop('max-duration');
      return;
    }
    if (this.compositor && this.actual && this.compositor.measuredFps) this.actual.fps = this.compositor.measuredFps;
    this.reportLevels();
    if (Date.now() - this.lastPersist > 5000) {
      this.lastPersist = Date.now();
      void updateSessionActiveMs(this.sessionId, elapsed).catch(() => undefined);
    }
  }

  pause(): void {
    if (this.paused || this.resumedAt === null || !this.recorder) return;
    this.recorder.pause();
    const now = Date.now();
    this.accumulatedMs += now - this.resumedAt;
    this.resumedAt = null;
    this.paused = true;
    this.hooks.emit({ type: 'PAUSED', at: now });
  }

  resume(): void {
    if (!this.paused || !this.recorder) return;
    this.recorder.resume();
    const now = Date.now();
    this.resumedAt = now;
    this.paused = false;
    this.hooks.emit({ type: 'RESUMED', at: now });
  }

  togglePause(): void {
    if (this.paused) this.resume();
    else this.pause();
  }

  toggleMic(): void {
    if (!this.mixer?.hasMicrophone) return;
    this.micOn = !this.micOn;
    this.mixer.setMicMuted(!this.micOn);
    this.hooks.emit({ type: 'MIC', on: this.micOn });
  }

  toggleCamera(): void {
    if (!this.compositor || !this.cameraStream) return;
    this.cameraOn = !this.cameraOn;
    this.compositor.setCameraVisible(this.cameraOn);
    this.hooks.emit({ type: 'CAMERA', on: this.cameraOn });
  }

  micLevel(): number {
    return this.micOn ? (this.mixer?.micLevel() ?? 0) : 0;
  }

  /** Live zoom / spotlight / highlight / teleprompter / webcam changes. */
  applyEffect(effect: LiveEffect): void {
    this.effects?.apply(effect);
  }

  /** Screen / window recordings: how to take a picture of the page in front (to replace Chrome's sharing bar). */
  setPageShooter(fn: ((fw: number, fh: number) => Promise<PageShot | null>) | null): void {
    this.compositor?.setPageShooter(fn);
  }

  /** Cursor positions and clicks from the recorded page (tab recordings). */
  onCursor(report: CursorReport): void {
    this.effects?.onCursor(report);
  }

  /** Broadcasts audio levels for the control bar meters and warnings (about 4× per second). */
  private reportLevels(): void {
    const now = Date.now();
    const dt = this.lastLevelAt ? now - this.lastLevelAt : 0;
    this.lastLevelAt = now;
    const hasMic = Boolean(this.mixer?.hasMicrophone);
    const mic = hasMic ? this.mixer!.micLevel() : null;
    const micTrack = this.micStream?.getAudioTracks()[0];
    const micMuted = !this.micOn || Boolean(micTrack?.muted) || micTrack?.readyState === 'ended';
    if (hasMic && !micMuted && (mic ?? 0) < 0.015) this.micSilentMs += dt;
    else this.micSilentMs = 0;
    const system = this.mixer?.hasSystemAudio ? this.mixer.systemLevel() : null;
    broadcast({ target: 'broadcast', type: 'recording/levels', mic, system, micMuted: hasMic && micMuted, micSilentMs: this.micSilentMs });
  }

  private handleRecorderError(err: unknown): void {
    const info = toAppError(err);
    logger.error('recorder error', err);
    if (info.code === 'insufficient-storage') {
      this.hooks.emit({ type: 'WARN', message: 'Storage is full. The recording was stopped and saved up to this point.' });
    }
    if (!this.finishing) void this.stop('error');
  }

  /** Stops, assembles the recording, saves it to history and reports the capture id. */
  async stop(reason: 'user' | 'source-ended' | 'max-duration' | 'error' = 'user'): Promise<void> {
    if (this.finishing) return;
    this.finishing = true;
    if (this.countdownTimer) clearTimeout(this.countdownTimer);
    const neverStarted = this.resumedAt === null && this.accumulatedMs === 0 && !this.paused;
    this.hooks.emit({ type: 'STOPPING', at: Date.now() });
    const durationMs = this.elapsedMs;
    this.accumulatedMs = durationMs;
    this.resumedAt = null;
    if (this.ticker) clearInterval(this.ticker);

    try {
      if (this.recorder && !neverStarted) await this.recorder.stop();
    } catch (err) {
      logger.warn('recorder stop failed', err);
    }
    const perf = performanceNote(this.compositor?.loadStats() ?? null, this.config.fps);
    if (perf && this.meta) this.meta.notes = [...this.meta.notes, perf];
    this.releaseMedia();

    if (neverStarted || !this.meta) {
      await deleteSession(this.sessionId).catch(() => undefined);
      this.hooks.finished(null, reason === 'user' ? undefined : makeErrorInfo('cancelled'));
      return;
    }

    try {
      const captureId = await finalizeRecording(this.meta, durationMs, {
        reason,
        thumbnail: true,
      });
      if (captureId) {
        this.hooks.finished(captureId);
      } else {
        // Nothing was written (e.g. the source ended before the first frame was encoded).
        this.hooks.finished(null, makeErrorInfo(reason === 'source-ended' ? 'source-unavailable' : 'recording-empty', `no data (${reason})`));
      }
    } catch (err) {
      this.hooks.finished(null, toAppError(err));
    }
  }

  /** Discards everything recorded so far. */
  async cancel(): Promise<void> {
    if (this.finishing) return;
    this.finishing = true;
    if (this.countdownTimer) clearTimeout(this.countdownTimer);
    if (this.ticker) clearInterval(this.ticker);
    this.hooks.emit({ type: 'STOPPING', at: Date.now() });
    try {
      await this.recorder?.stop();
    } catch {
      /* ignore */
    }
    this.releaseMedia();
    await deleteSession(this.sessionId).catch(() => undefined);
    this.hooks.finished(null, makeErrorInfo('cancelled'));
  }

  /** Releases every track, the audio graph and the compositor. Safe to call repeatedly. */
  releaseMedia(): void {
    this.compositor?.stop();
    this.compositor = null;
    this.effects = null;
    void this.mixer?.close().catch(() => undefined);
    this.mixer = null;
    stopStream(this.micStream);
    stopStream(this.cameraStream);
    stopStream(this.source?.stream);
    this.micStream = null;
    this.cameraStream = null;
  }
}

/**
 * Turns persisted chunks into a finished capture. Also used by the service worker to recover a
 * recording whose host crashed or was closed (it runs without DOM, so no thumbnail there).
 */
/**
 * A note for the recording when the computer could not keep up: frames that take longer than one
 * frame's time to process are skipped, so motion — the mouse above all — looks jumpy. Null when fine.
 */
export function performanceNote(stats: { frames: number; slowShare: number; avgMs: number; budgetMs: number } | null, fps: number): string | null {
  if (!stats || stats.frames < fps * 3 || stats.slowShare < 0.15) return null;
  const pct = Math.round(stats.slowShare * 100);
  return `This computer could not keep up with ${fps} frames per second: ${pct}% of the frames took longer than ${Math.round(stats.budgetMs)} ms to process (average ${Math.round(stats.avgMs)} ms), so some were skipped and motion such as the mouse may look jumpy. Record at a lower resolution or frame rate (Settings › Recording), turn off the camera bubble or live effects, or close other heavy programs.`;
}

export async function finalizeRecording(
  meta: SessionMeta,
  durationMs: number,
  opts: { reason: string; thumbnail: boolean },
): Promise<string | null> {
  let blob = await assembleChunks(meta.sessionId, meta.mimeType);
  if (blob.size === 0) {
    await deleteSession(meta.sessionId).catch(() => undefined);
    return null;
  }
  if (meta.mimeType.includes('webm')) {
    const fixed = await fixWebmDuration(blob, durationMs);
    blob = fixed.blob;
  }
  const notes = [...meta.notes];
  if (opts.reason === 'max-duration') notes.push('Stopped automatically at the maximum recording duration.');
  if (opts.reason === 'source-ended') notes.push('Stopped because the shared source ended (tab closed or sharing stopped).');
  if (opts.reason === 'recovered') notes.push('Recovered after the recording window closed unexpectedly.');

  const thumbnail = opts.thumbnail && typeof document !== 'undefined' ? await generateVideoThumbnail(blob) : undefined;
  const fileName = buildFilename(meta.config.filenamePattern, {
    type: 'Recording',
    date: new Date(meta.startedAt),
    title: meta.sourceTitle,
    url: meta.sourceUrl,
    extension: extensionForMime(meta.mimeType),
  });
  let record;
  try {
    record = await addCapture(
    {
      kind: 'video',
      name: buildFilename(meta.config.filenamePattern, {
        type: 'Recording',
        date: new Date(meta.startedAt),
        title: meta.sourceTitle,
        url: meta.sourceUrl,
        extension: extensionForMime(meta.mimeType),
      }),
      mimeType: meta.mimeType.split(';')[0] ?? meta.mimeType,
      width: meta.width,
      height: meta.height,
      durationMs,
      fps: meta.fps,
      videoCodec: describeMime(meta.mimeType),
      audio: { microphone: meta.hasMicrophone, system: meta.hasSystemAudio },
      notes,
      thumbnail,
      sourceTitle: meta.sourceTitle,
      sourceUrl: meta.sourceUrl,
    },
    blob,
  );
  } catch (err) {
    if (!isStorageUnavailable(err)) throw err;
    // Storage cannot be opened: the recording goes straight to the Downloads folder instead.
    await saveToDownloads(blob, fileName);
    dropMemoryChunks(meta.sessionId);
    throw new AppError('saved-to-downloads', `Saved as ${fileName} (${String(err)})`);
  }
  await deleteSession(meta.sessionId).catch(() => undefined);
  return record.id;
}

/** Saves a finished recording to Downloads (pages use the downloads API; the offscreen document asks the service worker). */
async function saveToDownloads(blob: Blob, fileName: string): Promise<void> {
  const api = (globalThis as { chrome?: { downloads?: { download?: unknown } } }).chrome;
  if (typeof api?.downloads?.download === 'function') {
    await downloadBlob(blob, fileName);
    return;
  }
  const url = URL.createObjectURL(blob);
  await sendToBackground({ target: 'background', type: 'recording/save-file', url, filename: fileName });
  // The download reads the blob URL; keep it alive long enough.
  setTimeout(() => URL.revokeObjectURL(url), 10 * 60_000);
}
