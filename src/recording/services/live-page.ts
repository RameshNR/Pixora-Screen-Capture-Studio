import { logger } from '@/shared/utils/logger';
import { getTabStream, stopStream } from './media-stream-service';

/**
 * A live video of the web page in front, from Chrome's tab capture, for screen / window recordings.
 *
 * Chrome's "… is sharing your screen" bar sits on top of the screen, not in the page, so the tab's own
 * video never contains it. Unlike a still picture of the page (Chrome allows two a second), it keeps up
 * with scrolling: when the page scrolls down, what comes up under the bar is in it straight away.
 *
 * Video only (the tab's sound is left alone). Chrome refuses some tabs (pages the extension wasn't
 * opened on and has no access to, Chrome's own pages, a tab another capture holds), and a stream that
 * never lines up with the recording is given up; those tabs use still pictures.
 */
export class LivePage {
  /** The tab streamed now. */
  tabId: number | null = null;
  private stream: MediaStream | null = null;
  private reader: ReadableStreamDefaultReader<VideoFrame> | null = null;
  private latest: VideoFrame | null = null;
  private readonly refused = new Set<number>();
  private opening: Promise<boolean> | null = null;
  private openingTab: number | null = null;
  private stopped = false;

  constructor(private readonly fps: number) {}

  /** The newest frame of tab `tabId`, or null when that tab isn't streamed (yet). */
  frame(tabId: number): VideoFrame | null {
    return this.tabId === tabId ? this.latest : null;
  }

  /**
   * Streams tab `tabId` at `size` (its page in physical pixels: Chrome otherwise scales the page into
   * whatever size is asked for), switching from another tab when needed, and waits for its first
   * frame. False when Chrome refuses that tab or the stream doesn't start.
   */
  follow(tabId: number, size: { width: number; height: number }): Promise<boolean> {
    if (this.stopped || this.refused.has(tabId)) return Promise.resolve(false);
    if (this.tabId === tabId && this.latest && this.stream?.getVideoTracks()[0]?.readyState === 'live') return Promise.resolve(true);
    if (this.opening && this.openingTab === tabId) return this.opening;
    this.openingTab = tabId;
    this.opening = this.open(tabId, size).finally(() => {
      if (this.openingTab === tabId) {
        this.opening = null;
        this.openingTab = null;
      }
    });
    return this.opening;
  }

  /** Stops streaming tab `tabId` for good (its video doesn't line up with the recording). */
  giveUp(tabId: number): void {
    this.refused.add(tabId);
    if (this.tabId === tabId) this.close();
  }

  private async open(tabId: number, size: { width: number; height: number }): Promise<boolean> {
    this.close();
    let stream: MediaStream;
    try {
      const id = await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId });
      stream = await getTabStream(id, { box: size, fps: this.fps, exact: true }, false);
    } catch (err) {
      this.refused.add(tabId);
      logger.info('live page stream unavailable for this tab; using still pictures', err);
      return false;
    }
    const track = stream.getVideoTracks()[0];
    if (this.stopped || !track) {
      stopStream(stream);
      return false;
    }
    this.stream = stream;
    this.tabId = tabId;
    const reader = new MediaStreamTrackProcessor({ track: track as MediaStreamVideoTrack, maxBufferSize: 1 }).readable.getReader();
    this.reader = reader;
    const first = new Promise<boolean>((resolve) => {
      void (async () => {
        try {
          for (;;) {
            const { value, done } = await reader.read();
            if (done || !value) break;
            if (this.reader !== reader) {
              value.close();
              break;
            }
            this.latest?.close();
            this.latest = value;
            resolve(true);
          }
        } catch {
          // Stream ended (tab closed, capture stopped).
        }
        resolve(false);
        if (this.reader === reader) this.close();
      })();
    });
    const timeout = new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 1500));
    return Promise.race([first, timeout]);
  }

  private close(): void {
    const reader = this.reader;
    this.reader = null;
    void reader?.cancel().catch(() => undefined);
    stopStream(this.stream);
    this.stream = null;
    this.latest?.close();
    this.latest = null;
    this.tabId = null;
  }

  stop(): void {
    this.stopped = true;
    this.close();
  }
}
