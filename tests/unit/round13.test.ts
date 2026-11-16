import { afterEach, describe, expect, it, vi } from 'vitest';
import { FlowTracker } from '@/content/flow-tracker';
import { buildRecordingConfig } from '@/recording/services/config';
import { isBackgroundMessage } from '@/shared/messaging/messages';
import { DEFAULT_SETTINGS } from '@/shared/constants/defaults';
import type { FlowConfig } from '@/shared/types';

describe('flow capture with recordings', () => {
  it('always takes step pictures automatically (there is no flow toolbar while recording)', () => {
    const flow = { ...DEFAULT_SETTINGS.flow, autoSteps: false, withRecording: true };
    const cfg = buildRecordingConfig({ ...DEFAULT_SETTINGS.recording, mode: 'desktop' }, {}, { flow });
    expect(cfg.flow?.autoSteps).toBe(true);
    expect(cfg.flow?.area).toBeNull();
  });
  it('takes click pictures at the moment of the click by default (v5)', () => {
    expect(DEFAULT_SETTINGS.flow.shotTiming).toBe('on-click');
  });
});

describe('capture-on-hover message', () => {
  it('accepts a CSS path and rejects anything else', () => {
    expect(isBackgroundMessage({ target: 'background', type: 'flow/hover', selector: 'main > button' })).toBe(true);
    expect(isBackgroundMessage({ target: 'background', type: 'flow/hover', selector: '' })).toBe(false);
    expect(isBackgroundMessage({ target: 'background', type: 'flow/hover', selector: 'x'.repeat(700) })).toBe(false);
    expect(isBackgroundMessage({ target: 'background', type: 'flow/hover' })).toBe(false);
  });
});

describe('flow tracker: capture on hover', () => {
  // jsdom has no CSS.escape (the page overlay runs in Chrome, which does).
  const g = globalThis as { CSS?: { escape?: (s: string) => string } };
  g.CSS ??= {};
  g.CSS.escape ??= (s: string) => s.replace(/[^\w-]/g, (c) => `\\${c}`);
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  const config = (shotTiming: FlowConfig['shotTiming']): FlowConfig => ({ ...DEFAULT_SETTINGS.flow, autoSteps: true, shotTiming, area: null });

  function hover(el: Element) {
    const ev = new Event('pointerover', { bubbles: true, composed: true }) as PointerEvent;
    Object.defineProperty(ev, 'pointerType', { value: 'mouse' });
    el.dispatchEvent(ev);
  }

  it('reports a control once the pointer rests on it, and again only after a click', () => {
    vi.useFakeTimers();
    document.body.innerHTML = '<main><button id="save">Save</button><p>text</p></main>';
    const hovers: string[] = [];
    const t = new FlowTracker(config('on-hover'), () => undefined, (s) => hovers.push(s));
    const btn = document.getElementById('save')!;
    hover(btn);
    vi.advanceTimersByTime(100);
    expect(hovers).toHaveLength(0);
    vi.advanceTimersByTime(300);
    expect(hovers).toHaveLength(1);
    expect(hovers[0]).toContain('save');
    // Leaving and coming back without clicking: no second picture of the same control.
    hover(document.querySelector('p')!);
    hover(btn);
    vi.advanceTimersByTime(400);
    expect(hovers).toHaveLength(1);
    t.stop();
  });

  it('does nothing when pictures are taken after the click', () => {
    vi.useFakeTimers();
    document.body.innerHTML = '<button>Go</button>';
    const hovers: string[] = [];
    const t = new FlowTracker(config('after-click'), () => undefined, (s) => hovers.push(s));
    hover(document.querySelector('button')!);
    vi.advanceTimersByTime(1000);
    expect(hovers).toHaveLength(0);
    t.stop();
  });

  it('ignores a pointer that only passes over a control', () => {
    vi.useFakeTimers();
    document.body.innerHTML = '<button id="a">A</button><div id="b">plain</div>';
    const hovers: string[] = [];
    const t = new FlowTracker(config('on-hover'), () => undefined, (s) => hovers.push(s));
    hover(document.getElementById('a')!);
    vi.advanceTimersByTime(120);
    hover(document.getElementById('b')!);
    vi.advanceTimersByTime(1000);
    expect(hovers).toHaveLength(0);
    t.stop();
  });
});

describe('flow tracker: keyboard clicks', () => {
  it('Enter or Space on a focused button is a click step; Space on a link is not', () => {
    document.body.innerHTML = '<button id="go">Continue</button><a id="l" href="#x">Help</a>';
    const events: Array<{ kind: string }> = [];
    const t = new FlowTracker({ ...DEFAULT_SETTINGS.flow, autoSteps: true, shotTiming: 'on-click', area: null }, (e) => events.push(e));
    const key = (el: Element, k: string) => el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
    key(document.getElementById('go')!, 'Enter');
    key(document.getElementById('go')!, ' ');
    key(document.getElementById('l')!, ' ');
    key(document.getElementById('l')!, 'Enter');
    expect(events.map((e) => e.kind)).toEqual(['click', 'click', 'click']);
    t.stop();
    document.body.innerHTML = '';
  });
});
