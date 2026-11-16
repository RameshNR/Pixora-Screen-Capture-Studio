import type { RecordingCommand } from '@/shared/messaging/messages';
import type { AppErrorInfo, RecordingEvent } from '@/shared/types';
import { sendToBackground } from '@/shared/messaging/client';
import { logger } from '@/shared/utils/logger';
import type { RecordingSession, SessionHooks } from './recording-session';

/** Sends host events / completion to the service worker. Shared by both recording hosts. */
export function createSessionHooks(sessionId: string): SessionHooks {
  return {
    emit: (event: RecordingEvent) => {
      void sendToBackground({ target: 'background', type: 'recording/host-event', sessionId, event }).catch((err: unknown) =>
        logger.warn('event delivery failed', err),
      );
    },
    finished: (captureId: string | null, error?: AppErrorInfo) => {
      void sendToBackground({ target: 'background', type: 'recording/host-finished', sessionId, captureId, ...(error ? { error } : {}) }).catch(
        (err: unknown) => logger.warn('finish delivery failed', err),
      );
    },
  };
}

export function applyCommand(session: RecordingSession, command: RecordingCommand): void {
  switch (command) {
    case 'pause':
      session.pause();
      break;
    case 'resume':
      session.resume();
      break;
    case 'toggle-pause':
      session.togglePause();
      break;
    case 'stop':
      void session.stop('user');
      break;
    case 'cancel':
      void session.cancel();
      break;
    case 'toggle-mic':
      session.toggleMic();
      break;
    case 'toggle-camera':
      session.toggleCamera();
      break;
  }
}

