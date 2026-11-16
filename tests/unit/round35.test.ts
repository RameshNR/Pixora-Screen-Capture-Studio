import { describe, expect, it } from 'vitest';
import { isPageGeometry, pageRectToSurface, pageToSurface, type PageGeometry, type SurfaceInfo } from '@/recording/services/screen-map';
import { findSensitive, type OcrWord } from '@/screenshot/services/sensitive-detect';
import { isBackgroundMessage, isHostMessage } from '@/shared/messaging/messages';

/** A maximised Chrome window on a 1920×1080 screen: 80 px of tabs + toolbar above the page. */
const page: PageGeometry = { screenX: 0, screenY: 0, outerWidth: 1920, outerHeight: 1040, innerWidth: 1920, innerHeight: 960, dpr: 1 };
const monitor = { isPrimary: true, bounds: { left: 0, top: 0, width: 1920, height: 1080 }, workArea: { left: 0, top: 0, width: 1920, height: 1040 } };
const screen: SurfaceInfo = { kind: 'screen', frameWidth: 1920, frameHeight: 1080, displays: [monitor], hostDpr: 1 };

describe('placing a page area on a desktop recording', () => {
  it('maps the page viewport onto the recorded screen', () => {
    const map = pageToSurface(page, screen)!;
    expect(map({ x: 0, y: 0 }).y).toBeCloseTo(80 / 1080, 3); // top of the page is below the toolbar
    expect(map({ x: 1, y: 1 }).y).toBeCloseTo(1040 / 1080, 3);
    expect(map({ x: 0.5, y: 0.5 }).x).toBeCloseTo(0.5, 3);
  });

  it('accounts for page zoom and screen scaling (125%)', () => {
    // 125% Windows scaling, page zoom 100%: DIP 1536×864 screen, page dpr 1.25 = host dpr.
    const g: PageGeometry = { screenX: 0, screenY: 0, outerWidth: 1536, outerHeight: 824, innerWidth: 1536, innerHeight: 760, dpr: 1.25 };
    const s: SurfaceInfo = { ...screen, displays: [{ ...monitor, bounds: { left: 0, top: 0, width: 1536, height: 864 } }], hostDpr: 1.25 };
    expect(pageToSurface(g, s)!({ x: 0, y: 0 }).y).toBeCloseTo(64 / 864, 3);
    // Page zoomed to 150%: its CSS px are 1.5 DIP each (innerWidth shrinks, dpr grows).
    const z: PageGeometry = { ...page, innerWidth: 1280, innerHeight: 640, dpr: 1.5 };
    const mz = pageToSurface(z, screen)!;
    expect(mz({ x: 1, y: 1 }).x).toBeCloseTo(1, 2);
    expect(mz({ x: 0, y: 0 }).y).toBeCloseTo(80 / 1080, 2);
  });

  it('a second monitor and a recorded window', () => {
    const right = { isPrimary: false, bounds: { left: 1920, top: 0, width: 2560, height: 1600 }, workArea: { left: 1920, top: 0, width: 2560, height: 1560 } };
    const onRight: PageGeometry = { ...page, screenX: 1920, outerWidth: 2560, outerHeight: 1560, innerWidth: 2560, innerHeight: 1480 };
    const s: SurfaceInfo = { ...screen, frameWidth: 2560, frameHeight: 1600, displays: [monitor, right] };
    expect(pageToSurface(onRight, s)!({ x: 0, y: 0 }).x).toBeCloseTo(0, 3);
    // Recording the 16:9 monitor while the page is on the 16:10 one: cannot be placed.
    expect(pageToSurface(onRight, { ...screen, displays: [monitor, right] })).toBeNull();
    // A page outside every known monitor is not placed either.
    expect(pageToSurface(onRight, screen)).toBeNull();
    const win: SurfaceInfo = { kind: 'window', frameWidth: 1200, frameHeight: 800, displays: [monitor], hostDpr: 1 };
    const g: PageGeometry = { screenX: 300, screenY: 100, outerWidth: 1200, outerHeight: 800, innerWidth: 1184, innerHeight: 712, dpr: 1 };
    const r = pageRectToSurface({ x: 0, y: 0, width: 1, height: 1 }, g, win)!;
    expect(r.y).toBeCloseTo((800 - 712 - 8) / 800, 3);
    expect(r.x).toBeCloseTo(8 / 1200, 3);
    // A different window (other shape) is refused.
    expect(pageToSurface({ ...g, outerWidth: 600 }, win)).toBeNull();
  });

  it('validates page geometry in messages', () => {
    expect(isPageGeometry(page)).toBe(true);
    expect(isPageGeometry({ ...page, dpr: 0 })).toBe(false);
    expect(isPageGeometry({ ...page, innerWidth: 'x' })).toBe(false);
    const rect = { x: 0.1, y: 0.1, width: 0.2, height: 0.2 };
    expect(isBackgroundMessage({ target: 'background', type: 'recording/region-selected', purpose: 'zoom', rect, page })).toBe(true);
    expect(isBackgroundMessage({ target: 'background', type: 'recording/region-selected', purpose: 'zoom', rect, page: { screenX: 1 } })).toBe(false);
    expect(isHostMessage({ target: 'host', type: 'host/page-region', sessionId: 's', purpose: 'highlight', rect, page })).toBe(true);
    expect(isHostMessage({ target: 'host', type: 'host/page-region', sessionId: 's', purpose: 'highlight', rect })).toBe(false);
  });
});

const line = (text: string, y = 0): OcrWord[] => {
  let x = 0;
  return text.split(' ').map((t) => { const w = { text: t, x0: x, y0: y, x1: x + t.length * 8, y1: y + 14 }; x += t.length * 8 + 6; return w; });
};

describe('sensitive text: no false "account numbers"', () => {
  it('ignores "Sort by:" and other label-like words without data', () => {
    expect(findSensitive([line('Sort by: A | 4 Package Includes:')])).toEqual([]);
    expect(findSensitive([line('Account settings and 2 more')])).toEqual([]);
    expect(findSensitive([line('ID 7 days left')])).toEqual([]);
  });

  it('still finds real account numbers, sort codes and bank codes', () => {
    const acct = findSensitive([line('Account number: 12-345-678 Status active')]);
    expect(acct.map((m) => [m.kind, m.text])).toEqual([['account', '12-345-678']]);
    expect(findSensitive([line('Sort code 12-34-56')]).map((m) => m.text)).toEqual(['12-34-56']);
    expect(findSensitive([line('SWIFT: BOFAUS3N')]).map((m) => m.text)).toEqual(['BOFAUS3N']);
    expect(findSensitive([line('Account 1234 5678 9012 opened')]).map((m) => m.text)).toEqual(['1234 5678 9012']);
    expect(findSensitive([line('Phone: 866-921-7925')]).map((m) => m.kind)).toEqual(['phone']);
  });
});
