import 'fake-indexeddb/auto';
import { Blob as NodeBlob } from 'node:buffer';
import { vi, beforeEach } from 'vitest';

// jsdom's Blob lacks arrayBuffer()/text(); use Node's spec-compliant implementation.
globalThis.Blob = NodeBlob as unknown as typeof Blob;

/**
 * Minimal in-memory `chrome` API for unit/integration tests. Individual tests override the
 * pieces they exercise with vi.fn().
 */
type Listener = (...args: unknown[]) => unknown;

function makeEvent() {
  const listeners = new Set<Listener>();
  return {
    addListener: (l: Listener) => listeners.add(l),
    removeListener: (l: Listener) => listeners.delete(l),
    hasListener: (l: Listener) => listeners.has(l),
    emit: (...args: unknown[]) => listeners.forEach((l) => l(...args)),
    listeners,
  };
}

function makeStorageArea(areaName: string, onChanged: ReturnType<typeof makeEvent>) {
  let data: Record<string, unknown> = {};
  return {
    get: vi.fn(async (keys?: string | string[] | null) => {
      if (keys == null) return structuredClone(data);
      const list = Array.isArray(keys) ? keys : [keys];
      const out: Record<string, unknown> = {};
      for (const k of list) if (k in data) out[k] = structuredClone(data[k]);
      return out;
    }),
    set: vi.fn(async (items: Record<string, unknown>) => {
      const changes: Record<string, { oldValue?: unknown; newValue?: unknown }> = {};
      for (const [k, v] of Object.entries(items)) {
        changes[k] = { oldValue: data[k], newValue: structuredClone(v) };
        data[k] = structuredClone(v);
      }
      onChanged.emit(changes, areaName);
    }),
    remove: vi.fn(async (keys: string | string[]) => {
      for (const k of Array.isArray(keys) ? keys : [keys]) delete data[k];
    }),
    clear: vi.fn(async () => {
      data = {};
    }),
    _reset: () => {
      data = {};
    },
  };
}

export function installChromeMock() {
  const storageChanged = makeEvent();
  const chromeMock = {
    runtime: {
      id: 'test-extension-id',
      sendMessage: vi.fn(async () => ({ ok: true, data: null })),
      onMessage: makeEvent(),
      getURL: (p: string) => `chrome-extension://test-extension-id/${p}`,
      getManifest: () => ({ version: '1.0.0' }),
      getContexts: vi.fn(async () => []),
      ContextType: { OFFSCREEN_DOCUMENT: 'OFFSCREEN_DOCUMENT' },
      lastError: undefined,
    },
    storage: {
      local: makeStorageArea('local', storageChanged),
      session: makeStorageArea('session', storageChanged),
      onChanged: storageChanged,
    },
    tabs: {
      create: vi.fn(async (opts: { url: string }) => ({ id: 900, ...opts })),
      update: vi.fn(async (id: number, opts: object) => ({ id, ...opts })),
      get: vi.fn(async (id: number) => ({ id, windowId: 1, index: 0, title: 'Example', url: 'https://example.com/' })),
      query: vi.fn(async () => [{ id: 1, windowId: 1, index: 0, title: 'Example', url: 'https://example.com/' }]),
      remove: vi.fn(async () => undefined),
      sendMessage: vi.fn(async () => ({ ok: true, data: null })),
      captureVisibleTab: vi.fn(),
      onRemoved: makeEvent(),
    },
    windows: {
      create: vi.fn(async () => ({ id: 77 })),
      update: vi.fn(async () => ({})),
      remove: vi.fn(async () => undefined),
      getLastFocused: vi.fn(async () => ({ left: 0, top: 0, width: 1600, height: 900 })),
      onRemoved: makeEvent(),
    },
    scripting: { executeScript: vi.fn(async () => [{ result: null }]) },
    tabCapture: { getMediaStreamId: vi.fn(async () => 'stream-id-123') },
    offscreen: {
      createDocument: vi.fn(async () => undefined),
      closeDocument: vi.fn(async () => undefined),
      Reason: { USER_MEDIA: 'USER_MEDIA', BLOBS: 'BLOBS' },
    },
    action: {
      setBadgeText: vi.fn(async () => undefined),
      setBadgeBackgroundColor: vi.fn(async () => undefined),
      setBadgeTextColor: vi.fn(async () => undefined),
      setTitle: vi.fn(async () => undefined),
    },
    notifications: { create: vi.fn(async () => 'n'), clear: vi.fn(async () => true), onClicked: makeEvent() },
    downloads: { download: vi.fn(async () => 1), onChanged: makeEvent(), onErased: makeEvent(), search: vi.fn(async () => []), show: vi.fn() },
    alarms: { create: vi.fn(async () => undefined), clear: vi.fn(async () => true), onAlarm: makeEvent() },
    commands: { getAll: vi.fn(async () => []), onCommand: makeEvent() },
    desktopCapture: { chooseDesktopMedia: vi.fn(), DesktopCaptureSourceType: { SCREEN: 'screen', WINDOW: 'window', TAB: 'tab', AUDIO: 'audio' } },
  };
  (globalThis as unknown as { chrome: typeof chromeMock }).chrome = chromeMock;
  return chromeMock;
}

export type ChromeMock = ReturnType<typeof installChromeMock>;

installChromeMock();

beforeEach(() => {
  installChromeMock();
});
