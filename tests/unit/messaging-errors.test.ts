import { describe, expect, it } from 'vitest';
import { isBackgroundMessage, isHostMessage, isOffscreenMessage } from '@/shared/messaging/messages';
import { AppError, makeErrorInfo, toAppError } from '@/shared/utils/errors';
import { fail, ok, RemoteError, sendToBackground } from '@/shared/messaging/client';
import { buildRecordingConfig } from '@/recording/services/config';
import { DEFAULT_SETTINGS } from '@/shared/constants/defaults';
import { normalizeOcrText } from '@/screenshot/services/ocr-service';
import { computeCameraRect, cropToPixels } from '@/recording/services/camera-service';
import { formatBytes, formatDuration, formatMediaTime } from '@/shared/utils/format';
import { mergeDeep } from '@/shared/utils/misc';

const config = buildRecordingConfig(DEFAULT_SETTINGS.recording);

describe('message validation', () => {
  it('accepts well-formed messages', () => {
    expect(isBackgroundMessage({ target: 'background', type: 'screenshot/capture', mode: 'full', tabId: 3 })).toBe(true);
    expect(isBackgroundMessage({ target: 'background', type: 'recording/start', config, tabId: null })).toBe(true);
    expect(isBackgroundMessage({ target: 'background', type: 'recording/command', command: 'toggle-pause' })).toBe(true);
    expect(isBackgroundMessage({ target: 'background', type: 'recording/area-selected', rect: { x: 0.1, y: 0.1, width: 0.5, height: 0.5 } })).toBe(true);
    expect(isHostMessage({ target: 'host', type: 'host/start', sessionId: 's', config, streamId: 'x', area: null, tabId: 1 })).toBe(true);
    expect(isOffscreenMessage({ target: 'offscreen', type: 'offscreen/revoke', url: 'blob:chrome-extension://x/y' })).toBe(true);
  });

  it('rejects malformed or foreign messages', () => {
    expect(isBackgroundMessage(null)).toBe(false);
    expect(isBackgroundMessage({ type: 'screenshot/capture' })).toBe(false);
    expect(isBackgroundMessage({ target: 'background', type: 'screenshot/capture', mode: 'evil', tabId: 1 })).toBe(false);
    expect(isBackgroundMessage({ target: 'background', type: 'screenshot/capture', mode: 'visible', tabId: 1, delaySeconds: 99999 })).toBe(false);
    expect(isBackgroundMessage({ target: 'background', type: 'recording/command', command: 'rm -rf' })).toBe(false);
    expect(isBackgroundMessage({ target: 'background', type: 'recording/area-selected', rect: { x: 2, y: 0, width: 1, height: 1 } })).toBe(false);
    expect(isBackgroundMessage({ target: 'background', type: 'recording/start', config: { mode: 'x' }, tabId: 1 })).toBe(false);
    expect(isBackgroundMessage({ target: 'background', type: 'unknown/type' })).toBe(false);
    expect(isOffscreenMessage({ target: 'offscreen', type: 'offscreen/revoke', url: 'https://evil' })).toBe(false);
  });

  it('round-trips typed responses and errors', async () => {
    chrome.runtime.sendMessage = (async () => ok({ a: 1 })) as typeof chrome.runtime.sendMessage;
    await expect(sendToBackground({ target: 'background', type: 'recording/get-state' })).resolves.toEqual({ a: 1 });
    chrome.runtime.sendMessage = (async () => fail(new AppError('tab-closed'))) as typeof chrome.runtime.sendMessage;
    await expect(sendToBackground({ target: 'background', type: 'recording/get-state' })).rejects.toBeInstanceOf(RemoteError);
  });
});

describe('error mapping', () => {
  it('maps DOMExceptions to actionable errors', () => {
    expect(toAppError(new DOMException('x', 'NotAllowedError'), 'camera').code).toBe('permission-denied-camera');
    expect(toAppError(new DOMException('x', 'NotAllowedError'), 'microphone').code).toBe('permission-denied-mic');
    expect(toAppError(new DOMException('x', 'NotFoundError'), 'camera').code).toBe('no-camera');
    expect(toAppError(new DOMException('x', 'NotReadableError')).code).toBe('device-busy');
    expect(toAppError(new DOMException('x', 'QuotaExceededError')).code).toBe('insufficient-storage');
    expect(toAppError(new Error('Cannot access a chrome:// URL')).code).toBe('restricted-page');
    expect(toAppError(new Error('boom'), 'fullpage').code).toBe('fullpage-failed');
  });

  it('never exposes raw messages as the user-facing text', () => {
    const info = toAppError(new Error('TypeError: x is undefined at foo.js:1'));
    expect(info.message).not.toMatch(/undefined/);
    expect(info.detail).toMatch(/undefined/);
    expect(makeErrorInfo('unsupported-codec').recovery).toBeTruthy();
  });
});

describe('helpers', () => {
  it('places the camera bubble and aligns crops to even pixels', () => {
    const r = computeCameraRect(1920, 1080, 16 / 9, 'bottom-right', 'medium', 'circle');
    expect(r.width).toBe(r.height);
    expect(r.x + r.width).toBeLessThan(1920);
    expect(r.y + r.height).toBeLessThan(1080);
    const c = cropToPixels({ x: 0.1, y: 0.1, width: 0.333, height: 0.5 }, 1921, 1081);
    expect([c.x, c.y, c.width, c.height].every((n) => n % 2 === 0)).toBe(true);
    expect(c.x + c.width).toBeLessThanOrEqual(1921);
  });

  it('formats values', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatDuration(65_000)).toBe('01:05');
    expect(formatDuration(3_725_000)).toBe('1:02:05');
    expect(formatMediaTime(12.34)).toBe('00:12.3');
  });

  it('normalises OCR text while preserving line breaks', () => {
    expect(normalizeOcrText('Line 1   \r\nLine 2\n\n\n\nLine 3  ')).toBe('Line 1\nLine 2\n\nLine 3');
  });

  it('deep-merges only known keys with matching types', () => {
    expect(mergeDeep({ a: 1, b: { c: 'x' } }, { a: '2', b: { c: 'y', d: 1 }, e: 3 })).toEqual({ a: 1, b: { c: 'y' } });
  });
});
