import { SCREENSHOT_CEILING } from '@/shared/constants/media';
import { AppError } from '@/shared/utils/errors';
import { chooseDesktopMedia, getDesktopStream, stopStream } from '@/recording/services/media-stream-service';
import { workAreaCrop } from '@/recording/services/display-service';

/**
 * "Entire Screen & App Window" screenshot: Chrome's picker → one full-resolution frame.
 * Runs in an extension page (needs DOM + desktopCapture).
 */
export async function captureDesktopFrame(opts: { excludeTaskbar?: boolean; source?: 'screen' | 'window'; beforeGrab?: () => Promise<void>; onChosen?: () => void } = {}): Promise<{ blob: Blob; width: number; height: number; label: string }> {
  const choice = await chooseDesktopMedia(false, opts.source);
  // The screen / window is chosen: starting it takes a moment before the countdown (say so).
  opts.onChosen?.();
  const stream = await getDesktopStream(choice, { box: SCREENSHOT_CEILING, fps: 5 }, false);
  return frameFromStream(stream, opts);
}

/**
 * One frame of an application window chosen in Chrome's web share dialog (getDisplayMedia; opened
 * on its Window tab, without "Entire screen" or Pixora's own window). Rejects with code
 * `cancelled` when the dialog is closed, `needs-click` when Chrome wants a click on the page first.
 * `surface` is what was shared ('window' unless the user picked something else).
 */
export async function captureWindowViaShareDialog(opts: { beforeGrab?: () => Promise<void> } = {}): Promise<{ blob: Blob; width: number; height: number; label: string; surface: string }> {
  const started = Date.now();
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: { displaySurface: 'window', width: { max: SCREENSHOT_CEILING.width }, height: { max: SCREENSHOT_CEILING.height }, frameRate: { max: 5 } },
      audio: false,
      selfBrowserSurface: 'exclude',
      surfaceSwitching: 'exclude',
      monitorTypeSurfaces: 'exclude',
      preferCurrentTab: false,
    } as DisplayMediaStreamOptions);
  } catch (err) {
    const name = (err as DOMException)?.name;
    // Refused at once (no dialog shown): Chrome wants a click on the page first.
    if (name === 'InvalidStateError' || (name === 'NotAllowedError' && Date.now() - started < 400)) throw Object.assign(new Error('Chrome wants a click first'), { code: 'needs-click' });
    if (name === 'NotAllowedError' || name === 'AbortError') throw new AppError('cancelled', 'Share dialog closed');
    throw new AppError('source-unavailable', String(err));
  }
  const surface = String((stream.getVideoTracks()[0]?.getSettings() as { displaySurface?: string })?.displaySurface ?? 'window');
  const frame = await frameFromStream(stream, opts);
  return { ...frame, surface };
}

/** Plays `stream`, waits for a real frame (after `beforeGrab`), returns it as PNG and stops the stream. */
async function frameFromStream(stream: MediaStream, opts: { excludeTaskbar?: boolean; beforeGrab?: () => Promise<void> }): Promise<{ blob: Blob; width: number; height: number; label: string }> {
  const track = stream.getVideoTracks()[0];
  const video = document.createElement('video');
  video.muted = true;
  video.srcObject = stream;
  try {
    await video.play();
    // Wait for a real frame (the first one can be black while the capturer warms up).
    await new Promise<void>((resolve) => {
      let frames = 0;
      const next = () => {
        frames++;
        if (frames >= 3) resolve();
        else video.requestVideoFrameCallback(next);
      };
      video.requestVideoFrameCallback(next);
      setTimeout(resolve, 1500);
    });
    // Countdown (the screen is arranged meanwhile); then a frame from after it.
    if (opts.beforeGrab) await opts.beforeGrab();
    const fresh = opts.beforeGrab && track ? await latestFrame(track) : null;
    const fullW = fresh?.displayWidth ?? video.videoWidth;
    const fullH = fresh?.displayHeight ?? video.videoHeight;
    if (!fullW || !fullH) throw new AppError('source-unavailable', 'No frame received');
    // Optionally leave out the taskbar / dock (whole-screen captures only).
    const area = opts.excludeTaskbar ? await workAreaCrop(track) : null;
    const sx = area ? Math.round(area.x * fullW) : 0;
    const sy = area ? Math.round(area.y * fullH) : 0;
    const width = area ? Math.round(area.width * fullW) : fullW;
    const height = area ? Math.round(area.height * fullH) : fullH;
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new AppError('image-processing');
    ctx.drawImage(fresh ?? video, sx, sy, width, height, 0, 0, width, height);
    fresh?.close();
    const blob = await canvas.convertToBlob({ type: 'image/png' });
    return { blob, width, height, label: track?.label || 'Screen' };
  } finally {
    video.srcObject = null;
    stopStream(stream);
  }
}

/**
 * A frame taken now from the stream. Reads the track directly (works while this page is a
 * background tab, when a <video> element may stop updating).
 */
async function latestFrame(track: MediaStreamTrack): Promise<VideoFrame | null> {
  if (typeof MediaStreamTrackProcessor === 'undefined') return null;
  const clone = track.clone();
  try {
    const reader = new MediaStreamTrackProcessor({ track: clone as MediaStreamVideoTrack, maxBufferSize: 1 }).readable.getReader();
    const timeout = new Promise<null>((r) => setTimeout(() => r(null), 3000));
    const res = await Promise.race([reader.read(), timeout]);
    void reader.cancel().catch(() => undefined);
    return res && 'value' in res && res.value ? res.value : null;
  } catch {
    return null;
  } finally {
    clone.stop();
  }
}
