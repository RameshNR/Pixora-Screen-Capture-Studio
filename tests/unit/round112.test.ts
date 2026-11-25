import { describe, expect, it } from 'vitest';
import { pageToSurface, type PageGeometry, type SurfaceInfo } from '@/recording/services/screen-map';

/** A 1920×1080 monitor at 150% scaling: 1280×720 DIP. A maximised window, 80 DIP of tabs and toolbar. */
const monitor = { isPrimary: true, bounds: { left: 0, top: 0, width: 1280, height: 720 }, workArea: { left: 0, top: 0, width: 1280, height: 690 } };
const page: PageGeometry = { screenX: 0, screenY: 0, outerWidth: 1280, outerHeight: 690, innerWidth: 1280, innerHeight: 610, dpr: 1.5 };

describe('mouse on a desktop recording: page zoom from Chrome, not from two pages’ scales', () => {
  it('same scale everywhere: unchanged results with or without the exact zoom', () => {
    const s: SurfaceInfo = { kind: 'screen', frameWidth: 1920, frameHeight: 1080, displays: [monitor], hostDpr: 1.5 };
    const a = pageToSurface(page, s)!({ x: 0.5, y: 0.5 });
    const b = pageToSurface({ ...page, zoom: 1 }, s)!({ x: 0.5, y: 0.5 });
    expect(b.x).toBeCloseTo(a.x, 6);
    expect(b.y).toBeCloseTo(a.y, 6);
  });

  it('the recorder page sees another scale (remote desktop changed it, or another monitor): the exact zoom keeps the mouse in place', () => {
    // Pixora's recorder page reports 1.0 while the recorded page is at 1.5 (both at 100% page zoom).
    const s: SurfaceInfo = { kind: 'screen', frameWidth: 1920, frameHeight: 1080, displays: [monitor], hostDpr: 1 };
    // Old way: zoom = 1.5 / 1 → the page counted 1.5× too big, so the mouse ran 1.5× too far.
    const old = pageToSurface(page, s)!({ x: 0.5, y: 0.5 });
    expect(old.x).toBeGreaterThan(0.7);
    // With Chrome's zoom (100%): the middle of the page is the middle of the screen.
    const fixed = pageToSurface({ ...page, zoom: 1 }, s)!({ x: 0.5, y: 0.5 });
    expect(fixed.x).toBeCloseTo(0.5, 3);
    expect(fixed.y).toBeCloseTo((80 + 305) / 720, 3);
    // Corners stay corners: a movement across the page is the same size on the recording.
    const m = pageToSurface({ ...page, zoom: 1 }, s)!;
    expect(m({ x: 1, y: 0.5 }).x - m({ x: 0, y: 0.5 }).x).toBeCloseTo(1, 3);
  });

  it('a zoomed page (125%) on a 150% screen', () => {
    const s: SurfaceInfo = { kind: 'screen', frameWidth: 1920, frameHeight: 1080, displays: [monitor], hostDpr: 1.5 };
    const z: PageGeometry = { ...page, innerWidth: 1024, innerHeight: 488, dpr: 1.875, zoom: 1.25 };
    const m = pageToSurface(z, s)!;
    expect(m({ x: 1, y: 1 }).x).toBeCloseTo(1, 2);
    expect(m({ x: 0, y: 0 }).y).toBeCloseTo(80 / 720, 2);
  });
});
