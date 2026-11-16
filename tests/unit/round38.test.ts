import { describe, expect, it } from 'vitest';
import { IMAGE_ACCEPT, isSupportedImage } from '@/shared/utils/image-types';
import { parseImageUrl } from '@/shared/utils/image-url';
import { activeOverlays, overlayName, overlayState, type VideoOverlay } from '@/recording/services/video-overlays';
import type { Annotation } from '@/editor/types';

describe('SVG is not offered or accepted', () => {
  it('file pickers list only supported formats', () => {
    expect(IMAGE_ACCEPT).not.toMatch(/svg|image\/\*/);
    expect(IMAGE_ACCEPT).toContain('.png');
  });

  it('rejects SVG by type or extension, accepts the rest', () => {
    expect(isSupportedImage({ type: 'image/svg+xml', name: 'logo.svg' })).toBe(false);
    expect(isSupportedImage({ type: '', name: 'logo.svg' })).toBe(false);
    expect(isSupportedImage({ type: 'image/png' })).toBe(true);
    expect(isSupportedImage({ type: '', name: 'photo.JPG' })).toBe(true);
    expect(parseImageUrl('data:image/svg+xml;base64,PHN2Zz4=')).toEqual({ error: 'That data address is not a picture.' });
  });
});

const box = { id: 'a1', type: 'rect', x: 100, y: 100, w: 200, h: 100, stroke: '#f00', fill: 'transparent', width: 4, opacity: 1, radius: 0, dash: 'solid' } as unknown as Annotation;
const ov = (patch: Partial<VideoOverlay> = {}): VideoOverlay => ({ id: 'o1', annotation: box, start: 2, end: 6, animIn: 'none', animOut: 'none', effect: 'none', ...patch });

describe('video overlays: timing, animations and effects', () => {
  it('shows an overlay only inside its time range', () => {
    expect(activeOverlays([ov()], 1.9)).toHaveLength(0);
    expect(activeOverlays([ov()], 2)).toHaveLength(1);
    expect(activeOverlays([ov()], 6.01)).toHaveLength(0);
  });

  it('fades / pops in and out at the ends, full in the middle', () => {
    expect(overlayState(ov({ animIn: 'fade' }), 2, 720).alpha).toBe(0);
    expect(overlayState(ov({ animIn: 'fade' }), 4, 720).alpha).toBe(1);
    expect(overlayState(ov({ animOut: 'fade' }), 6, 720).alpha).toBe(0);
    expect(overlayState(ov({ animIn: 'pop' }), 2, 720).scale).toBeCloseTo(0.5);
    expect(overlayState(ov({ animIn: 'slide-up' }), 2, 720).dy).toBeGreaterThan(0);
    expect(overlayState(ov({ animIn: 'wipe' }), 2.1, 720).clip.r).toBeLessThan(1);
    expect(overlayState(ov({ animIn: 'reveal' }), 2.3, 720).reveal).toBeLessThan(1);
  });

  it('effects move the overlay while it is visible', () => {
    const scales = [3, 3.2, 3.4].map((t) => overlayState(ov({ effect: 'pulse' }), t, 720).scale);
    expect(new Set(scales.map((x) => x.toFixed(3))).size).toBeGreaterThan(1);
    expect(overlayState(ov({ effect: 'glow' }), 3, 720).glow).toBeGreaterThan(0);
    expect(overlayName(box)).toBe('Shape');
  });
});
