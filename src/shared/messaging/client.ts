import type { AppErrorInfo } from '../types';
import { AppError, isAppErrorInfo, makeErrorInfo } from '../utils/errors';
import type {
  BackgroundMessage, BroadcastMessage, ContentMessage, HostMessage, MessageResponse, OffscreenMessage,
} from './messages';
import { isBroadcastMessage } from './messages';

/** Thrown on the caller side when the receiver answered `{ ok: false }`. */
export class RemoteError extends Error {
  readonly info: AppErrorInfo;
  constructor(info: AppErrorInfo) {
    super(info.message);
    this.name = 'RemoteError';
    this.info = info;
  }
}

async function unwrap<T>(promise: Promise<unknown>): Promise<T> {
  let res: unknown;
  try {
    res = await promise;
  } catch (err) {
    // "Receiving end does not exist" etc.
    throw new RemoteError(makeErrorInfo('unknown', err instanceof Error ? err.message : String(err)));
  }
  if (res && typeof res === 'object' && 'ok' in res) {
    const r = res as MessageResponse<T>;
    if (r.ok) return r.data;
    throw new RemoteError(r.error);
  }
  return res as T;
}

/** Send a message to the service worker and await its typed response. */
export function sendToBackground<T = unknown>(message: BackgroundMessage): Promise<T> {
  return unwrap<T>(chrome.runtime.sendMessage(message));
}

/** Send to the recording host (offscreen document or recorder tab). */
export function sendToHost<T = unknown>(message: HostMessage): Promise<T> {
  return unwrap<T>(chrome.runtime.sendMessage(message));
}

export function sendToOffscreen<T = unknown>(message: OffscreenMessage): Promise<T> {
  return unwrap<T>(chrome.runtime.sendMessage(message));
}

/** Fire-and-forget broadcast to every open extension page. Missing receivers are not an error. */
export function broadcast(message: BroadcastMessage): void {
  chrome.runtime.sendMessage(message).catch(() => undefined);
}

export function sendToTab<T = unknown>(tabId: number, message: ContentMessage): Promise<T> {
  return unwrap<T>(chrome.tabs.sendMessage(tabId, message));
}

export function onBroadcast(listener: (msg: BroadcastMessage) => void): () => void {
  const handler = (msg: unknown, sender: chrome.runtime.MessageSender) => {
    if (sender.id !== chrome.runtime.id) return;
    if (isBroadcastMessage(msg)) listener(msg);
  };
  chrome.runtime.onMessage.addListener(handler);
  return () => chrome.runtime.onMessage.removeListener(handler);
}

export function ok<T>(data: T): MessageResponse<T> {
  return { ok: true, data };
}

export function fail(err: unknown): MessageResponse<never> {
  return { ok: false, error: errorInfoOf(err) };
}

export function errorInfoOf(err: unknown): AppErrorInfo {
  if (err instanceof RemoteError) return err.info;
  if (err instanceof AppError) return err.toInfo();
  if (isAppErrorInfo(err)) return err;
  return makeErrorInfo('unknown', err instanceof Error ? err.message : String(err));
}
