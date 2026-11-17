import { describe, expect, it } from 'vitest';
import { headerLayout, headerRect, locatePage, type Pixels } from '@/screenshot/services/browser-header';
import { isBackgroundMessage } from '@/shared/messaging/messages';
import { normalizeSettings } from '@/settings/settings-service';
import { DEFAULT_SETTINGS } from '@/shared/constants/defaults';

/** A page-like picture: blocks of colour with text-like detail, different for each `seed`. */
function picture(width: number, height: number, seed: number): Pixels {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const h = Math.imul((x >> 3) * 73856093 ^ (y >> 3) * 19349663 ^ seed * 83492791, 2654435761) >>> 0;
      data[i] = h & 255;
      data[i + 1] = (h >> 8) & 255;
      data[i + 2] = (h >> 16) & 255;
      data[i + 3] = 255;
    }
  }
  return { data, width, height };
}

/** A window picture: `header` rows of browser UI, the page at (border, header), and `right` px of DevTools. */
function windowShot(page: Pixels, opts: { header: number; border: number; right?: number }): Pixels {
  const width = page.width + 2 * opts.border + (opts.right ?? 0);
  const height = page.height + opts.header + opts.border;
  const out = picture(width, height, 999); // browser UI / DevTools everywhere …
  for (let y = 0; y < page.height; y++) {
    // … and the page where it sits.
    const from = y * page.width * 4;
    out.data.set(page.data.subarray(from, from + page.width * 4), ((y + opts.header) * width + opts.border) * 4);
  }
  return out;
}

describe('browser header: finding the page in the window picture', () => {
  const page = picture(400, 300, 1);

  it('finds the page under the header, inside the window border', () => {
    const frame = windowShot(page, { header: 87, border: 8 });
    expect(locatePage(frame, page)).toMatchObject({ x: 8, y: 87 });
    expect(headerRect(frame, page)).toEqual({ x: 8, y: 0, width: 400, height: 87 });
  });

  it('maximised window (no border): the header is the full width above the page', () => {
    const frame = windowShot(page, { header: 120, border: 0 });
    expect(headerRect(frame, page)).toEqual({ x: 0, y: 0, width: 400, height: 120 });
  });

  it('DevTools docked on the right: the header still spans the whole window', () => {
    const frame = windowShot(page, { header: 90, border: 0, right: 250 });
    expect(headerRect(frame, page)).toEqual({ x: 0, y: 0, width: 650, height: 90 });
  });

  it('small differences (colour, a changed corner) still match', () => {
    const frame = windowShot(page, { header: 70, border: 1 });
    for (let i = 0; i < frame.data.length; i += 4) frame.data[i] = Math.min(255, frame.data[i]! + 4);
    // A part of the page changed between the two pictures (an animation): 10% of the width.
    for (let y = 70; y < 370; y++) frame.data.fill(0, (y * frame.width + 1) * 4, (y * frame.width + 41) * 4);
    expect(headerRect(frame, page)).toEqual({ x: 1, y: 0, width: 400, height: 70 });
  });

  it('another window (page not in it): no header — unless the picture is the browser window\'s size', () => {
    const other = picture(416, 395, 5);
    expect(locatePage(other, page)).toBeNull();
    expect(headerRect(other, page)).toBeNull();
    // Same size as the browser window: the usual layout (border 8 all round, header on top).
    expect(headerRect(other, page, true)).toEqual({ x: 8, y: 0, width: 400, height: 87 });
  });

  it('a page that starts with plain rows: the header ends where the page starts, not lower', () => {
    const flat = picture(400, 300, 3);
    flat.data.fill(255, 0, 400 * 40 * 4); // 40 white rows at the top of the page
    const frame = windowShot(flat, { header: 80, border: 0 });
    frame.data.fill(255, 0, frame.width * 79 * 4); // a white toolbar too, with a grey line under it
    for (let x = 0; x < frame.width; x++) frame.data.set([200, 200, 200, 255], (79 * frame.width + x) * 4);
    expect(headerRect(frame, flat)).toEqual({ x: 0, y: 0, width: 400, height: 80 });
  });

  it("the toolbar's shadow over the page's first rows: the header still ends where the page starts", () => {
    const frame = windowShot(page, { header: 90, border: 0 });
    for (let y = 90; y < 94; y++) {
      for (let x = 0; x < frame.width; x++) {
        const i = (y * frame.width + x) * 4;
        for (let k = 0; k < 3; k++) frame.data[i + k] = Math.round(frame.data[i + k]! * 0.4 + 61 * 0.6);
      }
    }
    expect(headerRect(frame, page)).toEqual({ x: 0, y: 0, width: 400, height: 90 });
  });

  it('the page picture a pixel wider than the window picture (125% scaling, window not maximised)', () => {
    // Seen on a real window: window picture 1294 px wide, page 1295 px.
    const frame = windowShot(page, { header: 100, border: 0 });
    const narrow: Pixels = { width: frame.width - 1, height: frame.height, data: new Uint8ClampedArray((frame.width - 1) * frame.height * 4) };
    for (let y = 0; y < frame.height; y++) narrow.data.set(frame.data.subarray(y * frame.width * 4, (y * frame.width + frame.width - 1) * 4), y * narrow.width * 4);
    expect(headerRect(narrow, page)).toEqual({ x: 0, y: 0, width: 399, height: 100 });
  });

  it('no header (full-screen window): nothing to add', () => {
    expect(headerRect(windowShot(page, { header: 0, border: 0 }), page)).toBeNull();
    expect(headerRect(windowShot(page, { header: 4, border: 0 }), page)).toBeNull();
  });
});

describe('browser header: size above the screenshot', () => {
  it('stretched to the screenshot width when within 6% (scrollbar, border, slightly resized window)', () => {
    expect(headerLayout({ width: 1060, height: 100 }, 1000, 1)).toEqual({ width: 1000, height: 94, canvasWidth: 1000 });
    expect(headerLayout({ width: 1000, height: 100 }, 985, 1)).toEqual({ width: 985, height: 99, canvasWidth: 985 });
  });
  it('a much wider header (DevTools docked) keeps its size and widens the result', () => {
    expect(headerLayout({ width: 1400, height: 100 }, 1000, 1)).toEqual({ width: 1400, height: 100, canvasWidth: 1400 });
  });
  it('a narrower image (part of the page) keeps the header size', () => {
    expect(headerLayout({ width: 1000, height: 100 }, 600, 1)).toEqual({ width: 1000, height: 100, canvasWidth: 1000 });
  });
  it('CSS-pixel screenshots scale the header too', () => {
    expect(headerLayout({ width: 2000, height: 180 }, 1000, 0.5)).toEqual({ width: 1000, height: 90, canvasWidth: 1000 });
  });
});

describe('browser header: setting and message', () => {
  it('is off by default and kept when switched on', () => {
    expect(DEFAULT_SETTINGS.screenshot.browserHeader).toBe(false);
    expect(normalizeSettings({}).screenshot.browserHeader).toBe(false);
    expect(normalizeSettings({ version: 7, screenshot: { browserHeader: true } }).screenshot.browserHeader).toBe(true);
  });
  it('accepts only a PNG data URL or null', () => {
    const msg = (dataUrl: unknown) => ({ target: 'background', type: 'screenshot/header', dataUrl });
    expect(isBackgroundMessage(msg(null))).toBe(true);
    expect(isBackgroundMessage(msg('data:image/png;base64,AAAA'))).toBe(true);
    expect(isBackgroundMessage(msg('https://example.com/a.png'))).toBe(false);
    expect(isBackgroundMessage(msg('data:text/html;base64,AAAA'))).toBe(false);
    expect(isBackgroundMessage(msg(42))).toBe(false);
  });
});

describe('browser header: the window must match the screenshot', async () => {
  const { headerWindowQuery, sameAsScreenshot } = await import('@/screenshot/services/header-capture');
  it('passes the tab and page-area size to the header window', () => {
    expect(headerWindowQuery(7, { tabId: 12, width: 1536, height: 744 })).toBe('mode=header&win=7&tab=12&vw=1536&vh=744');
    expect(headerWindowQuery(7, {})).toBe('mode=header&win=7');
  });
  it('same tab and size: ok; resized window or another tab: not', () => {
    const shot = { tabId: 12, width: 1536, height: 744 };
    expect(sameAsScreenshot({ id: 12, width: 1536, height: 744 }, shot)).toBe('ok');
    expect(sameAsScreenshot({ id: 12, width: 1537, height: 743 }, shot)).toBe('ok'); // rounding
    expect(sameAsScreenshot({ id: 12, width: 1500, height: 744 }, shot)).toBe('ok'); // slightly smaller: fitted
    expect(sameAsScreenshot({ id: 12, width: 1536, height: 714 }, shot)).toBe('ok'); // bookmarks bar shown
    expect(sameAsScreenshot({ id: 12, width: 1280, height: 744 }, shot)).toBe('size'); // no longer maximised
    expect(sameAsScreenshot({ id: 12, width: 1536, height: 600 }, shot)).toBe('size');
    expect(sameAsScreenshot({ id: 13, width: 1536, height: 744 }, shot)).toBe('tab');
    expect(sameAsScreenshot(undefined, shot)).toBe('tab');
  });
});
