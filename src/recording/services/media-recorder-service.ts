import { RECORDER_TIMESLICE_MS } from '@/shared/constants/media';
import { ChunkWriter } from './chunk-store';

export interface RecorderOptions {
  mimeType: string;
  videoBitsPerSecond: number;
  audioBitsPerSecond?: number;
}

/**
 * Thin wrapper around MediaRecorder that streams every chunk to IndexedDB and exposes a promise for
 * the final `stop` event.
 */
export class ChunkedRecorder {
  private readonly recorder: MediaRecorder;
  private readonly writer: ChunkWriter;
  private stopPromise: Promise<void> | null = null;
  private resolveStop: (() => void) | null = null;
  private started = false;
  onError: ((err: unknown) => void) | null = null;

  constructor(stream: MediaStream, sessionId: string, options: RecorderOptions) {
    this.recorder = new MediaRecorder(stream, {
      mimeType: options.mimeType,
      videoBitsPerSecond: options.videoBitsPerSecond,
      ...(options.audioBitsPerSecond ? { audioBitsPerSecond: options.audioBitsPerSecond } : {}),
    });
    this.writer = new ChunkWriter(sessionId, (err) => this.onError?.(err));
    this.recorder.ondataavailable = (e) => this.writer.write(e.data);
    this.recorder.onerror = (e) => this.onError?.((e as unknown as { error?: unknown }).error ?? e);
    this.stopPromise = new Promise<void>((resolve) => {
      this.resolveStop = resolve;
    });
    this.recorder.onstop = () => this.resolveStop?.();
  }

  get state(): RecordingState {
    return this.recorder.state;
  }

  get mimeType(): string {
    return this.recorder.mimeType;
  }

  get bytesWritten(): number {
    return this.writer.bytesWritten;
  }

  get writeFailed(): boolean {
    return this.writer.failed;
  }

  start(): void {
    this.recorder.start(RECORDER_TIMESLICE_MS);
    this.started = true;
  }

  pause(): void {
    if (this.recorder.state === 'recording') this.recorder.pause();
  }

  resume(): void {
    if (this.recorder.state === 'paused') this.recorder.resume();
  }

  /** Stops recording and resolves after the final chunk has been committed to IndexedDB. */
  async stop(): Promise<void> {
    if (!this.started) return;
    if (this.recorder.state !== 'inactive') this.recorder.stop();
    await this.stopPromise;
    await this.writer.flush();
  }
}

type RecordingState = 'inactive' | 'recording' | 'paused';
