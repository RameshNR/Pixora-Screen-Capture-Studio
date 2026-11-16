import { describe, expect, it } from 'vitest';
import { autoFrameFor } from '@/editor/pages/EditorApp';
import { normalizeAngle } from '@/editor/components/RotationControl';
import { markerAutoColors } from '@/editor/tools/shapes';
import { DEFAULT_TOOL_STYLES, EMPTY_FRAME } from '@/editor/types';
import { DEFAULT_SETTINGS } from '@/shared/constants/defaults';

describe('automatic frames for new screenshots', () => {
  const rec = { sourceUrl: 'https://shop.example/cart', sourceTitle: 'Cart' };
  it('is off by default', () => {
    expect(DEFAULT_SETTINGS.screenshot.autoFrame).toEqual({ browser: false, background: false, border: false });
    expect(autoFrameFor(DEFAULT_SETTINGS.screenshot.autoFrame, null, rec)).toBeNull();
  });
  it('adds a browser window with the page address and title', () => {
    const f = autoFrameFor({ browser: true, background: false, border: false }, null, rec)!;
    expect(f.browser).toMatchObject({ url: 'https://shop.example/cart', title: 'Cart', position: 'top' });
    expect(f.padding).toBe(0);
    expect(f.borderWidth).toBe(0);
  });
  it('uses the last background and border chosen in the editor', () => {
    const last = { ...EMPTY_FRAME, padding: 20, background: '#000000', radius: 4, shadow: false, borderWidth: 9, borderColor: '#ff0000' };
    const f = autoFrameFor({ browser: false, background: true, border: true }, last, rec)!;
    expect(f).toMatchObject({ padding: 20, background: '#000000', borderWidth: 9, borderColor: '#ff0000', browser: null });
  });
});

describe('numbered markers', () => {
  it('start at 50px', () => {
    expect(DEFAULT_TOOL_STYLES.marker.size).toBe(50);
  });
  it('know their automatic colours (used when custom colours are switched on)', () => {
    expect(markerAutoColors({ color: '#E05252', style: 'filled' })).toEqual({ fill: '#E05252', text: '#FFFFFF', border: '#FFFFFF' });
    expect(markerAutoColors({ color: '#E05252', style: 'outline' })).toEqual({ fill: '#FFFFFF', text: '#E05252', border: '#E05252' });
  });
});

describe('rotation control', () => {
  it('wraps angles into -180…180', () => {
    expect(normalizeAngle(190)).toBe(-170);
    expect(normalizeAngle(-190)).toBe(170);
    expect(normalizeAngle(360)).toBe(0);
    expect(normalizeAngle(-90)).toBe(-90);
  });
});

describe('resize cursors', () => {
  it('point the way each handle drags, turned with the object', async () => {
    const { resizeCursor } = await import('@/editor/components/CanvasWorkspace');
    expect(resizeCursor('e', 0)).toBe('ew-resize');
    expect(resizeCursor('n', 0)).toBe('ns-resize');
    expect(resizeCursor('se', 0)).toBe('nwse-resize');
    expect(resizeCursor('ne', 0)).toBe('nesw-resize');
    expect(resizeCursor('e', 90)).toBe('ns-resize');
    expect(resizeCursor('n', 45)).toBe('nesw-resize');
  });
});
