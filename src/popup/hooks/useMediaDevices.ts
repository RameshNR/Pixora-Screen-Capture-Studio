import { useCallback, useEffect, useState } from 'react';
import { listDevices, queryMediaPermission, type MediaDeviceOption, type PermissionStateLite } from '@/recording/services/media-stream-service';

export interface MediaDevicesState {
  cameras: MediaDeviceOption[];
  microphones: MediaDeviceOption[];
  cameraPermission: PermissionStateLite;
  micPermission: PermissionStateLite;
  refresh: () => void;
}

/** Device lists + permission states. Labels are only available once permission is granted. */
export function useMediaDevices(): MediaDevicesState {
  const [state, setState] = useState<Omit<MediaDevicesState, 'refresh'>>({
    cameras: [],
    microphones: [],
    cameraPermission: 'unknown',
    micPermission: 'unknown',
  });

  const refresh = useCallback(() => {
    void Promise.all([
      listDevices('videoinput').catch(() => []),
      listDevices('audioinput').catch(() => []),
      queryMediaPermission('camera'),
      queryMediaPermission('microphone'),
    ]).then(([cameras, microphones, cameraPermission, micPermission]) =>
      setState({ cameras, microphones, cameraPermission, micPermission }),
    );
  }, []);

  useEffect(() => {
    refresh();
    navigator.mediaDevices?.addEventListener('devicechange', refresh);
    return () => navigator.mediaDevices?.removeEventListener('devicechange', refresh);
  }, [refresh]);

  return { ...state, refresh };
}

/** Opens the permission page (extension popups cannot show Chrome's permission prompt reliably). */
export function openPermissionPage(kinds: Array<'camera' | 'microphone'>): void {
  void chrome.tabs.create({ url: chrome.runtime.getURL(`permissions.html?request=${kinds.join(',')}`) });
  window.close();
}
