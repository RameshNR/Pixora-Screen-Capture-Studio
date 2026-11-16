import { describe, expect, it } from 'vitest';
import { LiveEffects, cameraRect, ease, teleprompterOffset, zoomView } from '@/recording/services/live-effects';
import { chapterRange, chaptersInRange, chaptersText, chaptersVtt } from '@/recording/services/chapters';
import { activeRedactions, regionPixels } from '@/recording/services/redaction';
import { findSensitive, luhn, type OcrWord } from '@/screenshot/services/sensitive-detect';
import { INITIAL_RECORDING_STATE, recordingReducer } from '@/recording/services/recording-state';
import { zoomForRegion } from '@/background/live-tools';
import { formatPrecise, parseTime } from '@/recording/components/VideoTools';
import { hits } from '@/content/annotate-layer';
import { buildRecordingConfig, modeUsesTabCapture } from '@/recording/services/config';
import { DEFAULT_SETTINGS } from '@/shared/constants/defaults';
import { isBackgroundMessage } from '@/shared/messaging/messages';
import { textBlock, textBounds } from '@/editor/tools/text';
import type { CameraStyle, Marker, RecordingState, TeleprompterLive, VideoRedaction } from '@/shared/types';
import type { TextAnnotation } from '@/editor/types';
import { DEFAULT_FONT } from '@/editor/types';

const zoomSettings = { autoOnClick: true, level: 2, transitionMs: 100, holdMs: 200, easing: 'linear' as const };
const spot = { radius: 0.2, dim: 0.5 };

describe('zoom & spotlight', () => {
  it('eases between 0 and 1 for every curve', () => {
    for (const k of ['linear', 'ease-in-out', 'ease-out', 'spring'] as const) {
      expect(ease(0, k)).toBeCloseTo(0, 5);
      expect(ease(1, k)).toBeCloseTo(1, 5);
    }
    expect(ease(0.5, 'linear')).toBe(0.5);
    // Spring overshoots before settling.
    expect(Math.max(...[0.6, 0.7, 0.8, 0.9].map((t) => ease(t, 'spring')))).toBeGreaterThan(1);
  });

  it('keeps the zoomed view inside the (cropped) frame', () => {
    const crop = { x: 0, y: 0, w: 1920, h: 1080 };
    expect(zoomView(crop, 2, { x: 0.5, y: 0.5 }, 1920, 1080)).toEqual({ x: 480, y: 270, w: 960, h: 540 });
    // Near a corner the view is clamped, never leaving the picture.
    expect(zoomView(crop, 2, { x: 0, y: 1 }, 1920, 1080)).toEqual({ x: 0, y: 540, w: 960, h: 540 });
    const area = { x: 100, y: 100, w: 800, h: 400 };
    const v = zoomView(area, 4, { x: 0.9, y: 0.9 }, 1920, 1080);
    expect(v.x + v.w).toBeLessThanOrEqual(900);
    expect(v.y + v.h).toBeLessThanOrEqual(500);
  });

  it('zooms in on a click, follows the cursor and zooms back out after the hold time', () => {
    const fx = new LiveEffects(null, zoomSettings, spot, true);
    const crop = { x: 0, y: 0, w: 1000, h: 1000 };
    expect(fx.active(0)).toBe(false);
    fx.onCursor({ x: 0.25, y: 0.25, click: 'left' }, 0);
    expect(fx.active(150)).toBe(true);
    const v = fx.view(crop, 1000, 1000, 150);
    expect(v.w).toBeCloseTo(500, 0);
    // After transition + hold it animates back to 1×.
    fx.view(crop, 1000, 1000, 400);
    expect(fx.view(crop, 1000, 1000, 600).w).toBeCloseTo(1000, 0);
    expect(fx.active(600)).toBe(false);
  });

  it('ignores cursor reports when the recording is not of the page (desktop)', () => {
    const fx = new LiveEffects(null, zoomSettings, spot, false);
    fx.onCursor({ x: 0.1, y: 0.1, click: 'left' }, 0);
    expect(fx.active(50)).toBe(false);
  });

  it('applies manual zoom, spotlight, highlight and teleprompter effects', () => {
    const fx = new LiveEffects(null, zoomSettings, spot, true);
    fx.apply({ kind: 'spotlight', on: true }, 0);
    expect(fx.active(0)).toBe(true);
    fx.apply({ kind: 'spotlight', on: false }, 0);
    fx.apply({ kind: 'highlight', rect: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 } }, 0);
    expect(fx.active(0)).toBe(true);
    fx.apply({ kind: 'highlight', rect: null }, 0);
    fx.apply({ kind: 'zoom', level: 3, center: { x: 0.5, y: 0.5 } }, 0);
    expect(fx.view({ x: 0, y: 0, w: 900, h: 900 }, 900, 900, 1000).w).toBeCloseTo(300, 0);
  });

  it('places the webcam bubble by its centre, clamped inside the frame', () => {
    const style: CameraStyle = { shape: 'circle', sizePct: 20, opacity: 1, borderWidth: 2, borderColor: '#fff', mirror: true, x: 0.5, y: 0.5 };
    expect(cameraRect(style, 1920, 1080, 16 / 9)).toEqual({ x: 852, y: 432, width: 216, height: 216 });
    const corner = cameraRect({ ...style, x: 1, y: 1, shape: 'rounded' }, 1920, 1080, 16 / 9);
    expect(corner.x + corner.width).toBeLessThanOrEqual(1920);
    expect(corner.y + corner.height).toBeLessThanOrEqual(1080);
    expect(corner.width).toBeGreaterThan(corner.height);
  });

  it('scrolls the teleprompter from its play time', () => {
    const t: TeleprompterLive = {
      text: 'x', fontFamily: 'sans-serif', fontSize: 40, color: '#fff', background: '#000', backgroundOpacity: 1, align: 'center', lineHeight: 1.5,
      widthPct: 0.8, position: 'bottom', speed: 50, offset: 100, since: 1000, playing: true,
    };
    expect(teleprompterOffset(t, 3000)).toBe(200);
    expect(teleprompterOffset({ ...t, playing: false }, 3000)).toBe(100);
  });

  it('turns a selected region into a zoom level and centre', () => {
    expect(zoomForRegion({ x: 0.25, y: 0.25, width: 0.5, height: 0.25 })).toEqual({ level: 2, center: { x: 0.5, y: 0.375 } });
    expect(zoomForRegion({ x: 0, y: 0, width: 0.01, height: 0.01 }).level).toBe(4);
  });
});

describe('chapters & markers', () => {
  const markers: Marker[] = [
    { id: 'b', timeMs: 65_000, name: 'Setup' },
    { id: 'a', timeMs: 5_000, name: 'Intro', description: 'Hello' },
    { id: 'c', timeMs: 3_725_000, name: 'Wrap up' },
  ];

  it('writes a "00:00 Title" chapter list', () => {
    expect(chaptersText(markers)).toBe('00:00 Start\n00:05 Intro\n01:05 Setup\n01:02:05 Wrap up');
    // Relative to a trimmed range.
    expect(chaptersText(markers, 60, 120)).toBe('00:00 Start\n00:05 Setup');
    expect(chaptersInRange(markers, 60, 120)).toEqual([{ id: 'b', timeMs: 5000, name: 'Setup' }]);
  });

  it('writes WebVTT chapters and chapter ranges', () => {
    const vtt = chaptersVtt(markers, 4000);
    expect(vtt.startsWith('WEBVTT')).toBe(true);
    expect(vtt).toContain('00:00:05.000 --> 00:01:05.000\nIntro\nHello');
    expect(vtt).toContain('01:02:05.000 --> 01:06:40.000\nWrap up');
    expect(chapterRange(markers, markers[1]!, 4000)).toEqual({ start: 5, end: 65 });
    expect(chapterRange(markers, markers[2]!, 4000)).toEqual({ start: 3725, end: 4000 });
  });

  it('adds, renames and deletes markers in the recording state', () => {
    let s: RecordingState = { ...INITIAL_RECORDING_STATE, status: 'recording', sessionId: 's' };
    s = recordingReducer(s, { type: 'MARKER_ADD', marker: { id: 'm2', timeMs: 2000, name: 'B' } });
    s = recordingReducer(s, { type: 'MARKER_ADD', marker: { id: 'm1', timeMs: 1000, name: 'A' } });
    expect(s.markers.map((m) => m.id)).toEqual(['m1', 'm2']);
    s = recordingReducer(s, { type: 'MARKER_UPDATE', id: 'm1', patch: { name: 'Intro', description: 'x' } });
    expect(s.markers[0]).toMatchObject({ name: 'Intro', description: 'x' });
    s = recordingReducer(s, { type: 'MARKER_DELETE', id: 'm2' });
    expect(s.markers).toHaveLength(1);
    // Ignored when not recording.
    expect(recordingReducer(INITIAL_RECORDING_STATE, { type: 'MARKER_ADD', marker: { id: 'x', timeMs: 0, name: 'x' } }).markers).toEqual([]);
  });

  it('tracks live effects for the control bar', () => {
    let s: RecordingState = { ...INITIAL_RECORDING_STATE, status: 'recording', sessionId: 's' };
    s = recordingReducer(s, { type: 'EFFECT', effect: { kind: 'zoom', level: 2, center: null } });
    s = recordingReducer(s, { type: 'EFFECT', effect: { kind: 'spotlight', on: true } });
    s = recordingReducer(s, { type: 'EFFECT', effect: { kind: 'camera', patch: { sizePct: 30, x: 0.2, y: 0.2 } } });
    s = recordingReducer(s, { type: 'ANNOTATING', on: true });
    expect(s.effects).toMatchObject({ zoom: 2, spotlight: true, annotating: true, camera: { sizePct: 30 } });
    expect(recordingReducer(s, { type: 'RESET' }).effects.zoom).toBe(1);
  });

  it('validates the new messages', () => {
    expect(isBackgroundMessage({ target: 'background', type: 'recording/marker', name: 'Intro' })).toBe(true);
    expect(isBackgroundMessage({ target: 'background', type: 'recording/marker', name: 5 })).toBe(false);
    expect(isBackgroundMessage({ target: 'background', type: 'recording/effect', effect: { kind: 'zoom', level: 2, center: null } })).toBe(true);
    expect(isBackgroundMessage({ target: 'background', type: 'recording/effect', effect: { kind: 'evil' } })).toBe(false);
    expect(isBackgroundMessage({ target: 'background', type: 'recording/annotate', action: { kind: 'tool', tool: 'pen' } })).toBe(true);
    expect(isBackgroundMessage({ target: 'background', type: 'recording/region-selected', purpose: 'zoom', rect: { x: 0.1, y: 0.1, width: 2, height: 0.1 } })).toBe(false);
  });
});

describe('custom area for screens', () => {
  it('records a screen region as a desktop recording with area selection', () => {
    const rec = { ...DEFAULT_SETTINGS.recording, mode: 'area' as const, areaSource: 'screen' as const };
    const cfg = buildRecordingConfig(rec);
    expect(cfg.mode).toBe('desktop');
    expect(cfg.selectArea).toBe(true);
    expect(modeUsesTabCapture('area', 'screen')).toBe(false);
    expect(modeUsesTabCapture('area', 'tab')).toBe(true);
    const tab = buildRecordingConfig({ ...rec, areaSource: 'tab' });
    expect(tab.mode).toBe('area');
    expect(tab.selectArea).toBe(false);
  });
});

describe('privacy', () => {
  const r: VideoRedaction = { id: 'r', rect: { x: 0.1, y: 0.2, width: 0.5, height: 0.25 }, kind: 'mask', strength: 0.02, color: '#000', start: 2, end: 4 };

  it('applies regions only inside their time range', () => {
    expect(activeRedactions([r], 1)).toEqual([]);
    expect(activeRedactions([r], 3)).toEqual([r]);
    expect(activeRedactions([{ ...r, start: null, end: null }], 100)).toHaveLength(1);
    expect(regionPixels(r, 1000, 500)).toEqual({ x: 100, y: 100, w: 500, h: 125 });
  });

  it('finds emails, cards, phones, keys and passwords and maps them to word boxes', () => {
    const word = (text: string, x: number, y = 0): OcrWord => ({ text, x0: x, y0: y, x1: x + text.length * 10, y1: y + 20 });
    const lines: OcrWord[][] = [
      [word('Contact:', 0), word('jane.doe@example.com', 100)],
      [word('Card', 0, 30), word('4111', 60, 30), word('1111', 110, 30), word('1111', 160, 30), word('1111', 210, 30)],
      [word('Password:', 0, 60), word('hunter2', 100, 60)],
      [word('Phone', 0, 90), word('+1', 70, 90), word('415-555-0100', 100, 90)],
      [word('token', 0, 120), word(['sk', 'live', 'FAKEtestKEY0000000000000000'].join('_'), 70, 120)],
      [word('Order', 0, 150), word('#12', 70, 150), word('total', 120, 150)],
    ];
    const found = findSensitive(lines);
    const kinds = found.map((f) => f.kind);
    expect(kinds).toEqual(expect.arrayContaining(['email', 'card', 'password', 'phone', 'secret']));
    const card = found.find((f) => f.kind === 'card')!;
    // The card number spans four words; the box covers all of them (but not the label).
    expect(card.box).toEqual({ x: 60, y: 30, w: 190, h: 20 });
    expect(found.find((f) => f.kind === 'password')!.text).toBe('hunter2');
    expect(found.some((f) => f.text.includes('#12'))).toBe(false);
    expect(luhn('4111111111111111')).toBe(true);
    expect(luhn('4111111111111112')).toBe(false);
  });
});

describe('video tools helpers', () => {
  it('formats and parses precise times', () => {
    expect(formatPrecise(62.5)).toBe('1:02.500');
    expect(parseTime('1:02.5')).toBe(62.5);
    expect(parseTime('62.25')).toBe(62.25);
    expect(parseTime('00:01:02.500')).toBe(62.5);
    expect(parseTime('abc')).toBeNull();
    expect(parseTime('1::2')).toBeNull();
  });
});

describe('live annotation', () => {
  const style = { color: '#f00', width: 4, opacity: 1, fontSize: 20 };
  it('hit-tests drawn shapes for the eraser', () => {
    expect(hits({ kind: 'line', x1: 0, y1: 0, x2: 100, y2: 0, style }, 50, 5, 4)).toBe(true);
    expect(hits({ kind: 'line', x1: 0, y1: 0, x2: 100, y2: 0, style }, 50, 30, 4)).toBe(false);
    expect(hits({ kind: 'rect', x1: 0, y1: 0, x2: 100, y2: 100, style }, 50, 50, 4)).toBe(false);
    expect(hits({ kind: 'rect', x1: 0, y1: 0, x2: 100, y2: 100, style }, 100, 50, 4)).toBe(true);
    expect(hits({ kind: 'circle', x1: 0, y1: 0, x2: 100, y2: 100, style }, 100, 50, 4)).toBe(true);
    expect(hits({ kind: 'pen', pts: [[0, 0], [10, 10]], style }, 5, 5, 2)).toBe(true);
    expect(hits({ kind: 'text', x: 0, y: 0, text: 'Hello', style }, 20, 10, 2)).toBe(true);
  });
});

describe('text section backgrounds', () => {
  it('pads each section with a background and widens the bounds', () => {
    const t: TextAnnotation = {
      id: 't', type: 'text', x: 100, y: 100, text: 'Body', fontFamily: DEFAULT_FONT, fontSize: 20, bold: false, italic: false, color: '#000', align: 'left',
      background: 'transparent', borderColor: '#000', borderWidth: 0, borderStyle: 'solid', borderRadius: 0, opacity: 1,
      header: { text: 'Title', fontFamily: DEFAULT_FONT, fontSize: 30, bold: true, italic: false, color: '#fff', align: 'left', sectionBg: '#202938', sectionPad: 10 },
    };
    const plain = textBlock({ ...t, header: { ...t.header!, sectionBg: undefined } });
    const padded = textBlock(t);
    expect(padded.parts[0]!.pad).toBe(10);
    expect(padded.height - plain.height).toBeCloseTo(20, 5);
    expect(textBounds(t).x).toBe(90);
  });
});
