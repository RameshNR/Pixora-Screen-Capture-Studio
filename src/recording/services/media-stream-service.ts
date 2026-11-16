import type { CameraConfig, MicConfig } from '@/shared/types';
import { CAMERA_RESOLUTIONS, type Dimensions } from '@/shared/constants/media';
import { AppError, toAppError } from '@/shared/utils/errors';

/**
 * All getUserMedia / desktopCapture access lives here so UI and orchestration code never touch
 * browser media APIs directly.
 */

export interface CaptureConstraints {
  box: Dimensions;
  fps: number;
  /** Ask for exactly this size (min = max), not only an upper limit. */
  exact?: boolean;
}

function legacyVideo(source: 'tab' | 'desktop', streamId: string, c: CaptureConstraints): ChromeLegacyTrackConstraints {
  return {
    mandatory: {
      chromeMediaSource: source,
      chromeMediaSourceId: streamId,
      maxWidth: c.box.width,
      maxHeight: c.box.height,
      ...(c.exact ? { minWidth: c.box.width, minHeight: c.box.height } : {}),
      maxFrameRate: c.fps,
    },
  };
}

function legacyAudio(source: 'tab' | 'desktop', streamId: string): ChromeLegacyTrackConstraints {
  return { mandatory: { chromeMediaSource: source, chromeMediaSourceId: streamId } };
}

/** Tab capture via a stream id from chrome.tabCapture.getMediaStreamId. */
export async function getTabStream(streamId: string, c: CaptureConstraints, withAudio: boolean): Promise<MediaStream> {
  try {
    return await navigator.mediaDevices.getUserMedia({
      video: legacyVideo('tab', streamId, c) as unknown as MediaTrackConstraints,
      audio: withAudio ? (legacyAudio('tab', streamId) as unknown as MediaTrackConstraints) : false,
    });
  } catch (err) {
    if (withAudio) {
      // Some tabs refuse audio capture; retry video-only rather than failing the recording.
      return getTabStream(streamId, c, false);
    }
    throw new AppError(toAppError(err, 'screen').code, String(err));
  }
}

export interface DesktopChoice {
  streamId: string;
  canRequestAudioTrack: boolean;
}

/** Shows Chrome's screen / window / tab picker. Must be called from an extension page. */
export function chooseDesktopMedia(withAudio: boolean, only?: 'screen' | 'window'): Promise<DesktopChoice> {
  return new Promise((resolve, reject) => {
    const T = chrome.desktopCapture.DesktopCaptureSourceType;
    const sources = only === 'screen' ? [T.SCREEN] : only === 'window' ? [T.WINDOW] : [T.SCREEN, T.WINDOW, T.TAB];
    if (withAudio) sources.push(T.AUDIO);
    chrome.desktopCapture.chooseDesktopMedia(sources, (streamId, options) => {
      if (!streamId) {
        reject(new AppError('permission-denied-screen', 'Picker dismissed'));
        return;
      }
      resolve({ streamId, canRequestAudioTrack: Boolean(options?.canRequestAudioTrack) });
    });
  });
}

export async function getDesktopStream(choice: DesktopChoice, c: CaptureConstraints, withAudio: boolean): Promise<MediaStream> {
  const audio = withAudio && choice.canRequestAudioTrack;
  try {
    return await navigator.mediaDevices.getUserMedia({
      video: legacyVideo('desktop', choice.streamId, c) as unknown as MediaTrackConstraints,
      audio: audio ? (legacyAudio('desktop', choice.streamId) as unknown as MediaTrackConstraints) : false,
    });
  } catch (err) {
    throw new AppError(toAppError(err, 'screen').code, String(err));
  }
}

export async function getMicStream(mic: MicConfig): Promise<MediaStream> {
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: mic.deviceId && mic.deviceId !== 'default' ? { exact: mic.deviceId } : undefined,
        noiseSuppression: mic.noiseSuppression,
        echoCancellation: mic.echoCancellation,
        autoGainControl: true,
      },
      video: false,
    });
  } catch (err) {
    // The saved device may have been unplugged: retry with the system default.
    if (mic.deviceId && mic.deviceId !== 'default' && err instanceof DOMException && (err.name === 'OverconstrainedError' || err.name === 'NotFoundError')) {
      return getMicStream({ ...mic, deviceId: 'default' });
    }
    throw new AppError(toAppError(err, 'microphone').code, String(err));
  }
}

export async function getCameraStream(camera: CameraConfig, override?: Dimensions, fps = 30): Promise<MediaStream> {
  const dims = override ?? CAMERA_RESOLUTIONS[camera.resolution];
  try {
    return await navigator.mediaDevices.getUserMedia({
      video: {
        deviceId: camera.deviceId && camera.deviceId !== 'default' ? { exact: camera.deviceId } : undefined,
        width: { ideal: dims.width },
        height: { ideal: dims.height },
        frameRate: { ideal: fps },
      },
      audio: false,
    });
  } catch (err) {
    if (camera.deviceId && camera.deviceId !== 'default' && err instanceof DOMException && (err.name === 'OverconstrainedError' || err.name === 'NotFoundError')) {
      return getCameraStream({ ...camera, deviceId: 'default' }, override, fps);
    }
    throw new AppError(toAppError(err, 'camera').code, String(err));
  }
}

export function stopStream(stream: MediaStream | null | undefined): void {
  stream?.getTracks().forEach((t) => t.stop());
}

export type PermissionStateLite = 'granted' | 'denied' | 'prompt' | 'unknown';

export async function queryMediaPermission(kind: 'camera' | 'microphone'): Promise<PermissionStateLite> {
  try {
    const status = await navigator.permissions.query({ name: kind as PermissionName });
    return status.state;
  } catch {
    return 'unknown';
  }
}

export interface MediaDeviceOption {
  deviceId: string;
  label: string;
}

export async function listDevices(kind: 'audioinput' | 'videoinput'): Promise<MediaDeviceOption[]> {
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices
    .filter((d) => d.kind === kind && d.deviceId)
    .map((d, i) => ({ deviceId: d.deviceId, label: d.label || `${kind === 'audioinput' ? 'Microphone' : 'Camera'} ${i + 1}` }));
}
