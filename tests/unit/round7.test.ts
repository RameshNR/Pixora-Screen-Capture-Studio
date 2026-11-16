import { describe, expect, it } from 'vitest';
import { excludeHidden, findSensitive, mergeOcrLines, type OcrWord, type SensitiveMatch } from '@/screenshot/services/sensitive-detect';
import { markerBounds } from '@/editor/tools/shapes';
import { calloutLayout, fitCallout } from '@/editor/tools/callouts';
import type { CalloutAnnotation, MarkerAnnotation } from '@/editor/types';
import { isBackgroundMessage } from '@/shared/messaging/messages';
import { findDuplicate, getFlow, putFlow, restoreFlowImages, softDeleteFlowImages } from '@/flow/flow-store';
import { buildDocx, fitImageEmu, xmlEscape } from '@/shared/utils/docx';
import { describeEvent, shotKindOf, wantsScreenshot } from '@/flow/flow-engine';
import { DEFAULT_SETTINGS } from '@/shared/constants/defaults';
import type { FlowItem } from '@/shared/types';

const match = (x: number, y: number): SensitiveMatch => ({ kind: 'email', text: 'a@b.test', box: { x, y, w: 100, h: 20 } });

describe('find sensitive info after hiding', () => {
  it('leaves out text already covered by a blur / pixelate / mask', () => {
    const found = [match(10, 10), match(10, 100)];
    const r = excludeHidden(found, [{ x: 6, y: 6, w: 108, h: 28 }]);
    expect(r.hidden).toBe(1);
    expect(r.visible).toEqual([found[1]]);
  });

  it('keeps text that is only partly covered', () => {
    const r = excludeHidden([match(10, 10)], [{ x: 10, y: 10, w: 40, h: 20 }]);
    expect(r).toEqual({ visible: [match(10, 10)], hidden: 0 });
  });
});

describe('heart marker', () => {
  it('has bounds around both lobes and the point', () => {
    const m = { id: 'm', type: 'marker', x: 100, y: 100, n: 1, color: '#f00', size: 40, shape: 'heart', opacity: 1 } as MarkerAnnotation;
    const b = markerBounds(m);
    expect(b.x).toBeLessThan(100 - 20);
    expect(b.y + b.h).toBeGreaterThanOrEqual(100 + 20 * 1.2);
  });
});

describe('callout spacing', () => {
  it('the step circle fits inside the box and its label inside the circle', () => {
    const c = fitCallout({
      id: 'c', type: 'callout', x: 0, y: 0, w: 300, h: 40, text: 'Click Save', title: 'Title', design: 'step', fontSize: 18, fontFamily: 'Inter', color: '#000', fill: '#fff', stroke: '#000', strokeWidth: 1, tailX: 0, tailY: 0, opacity: 1,
    } as unknown as CalloutAnnotation, true);
    const L = calloutLayout(c);
    expect(L.band!.y + L.band!.h).toBeLessThanOrEqual(c.y + c.h);
    expect(L.title!.w).toBeLessThan(L.band!.w);
  });
});

describe('flow start after the access prompt', () => {
  it('accepts arm and start-armed messages', () => {
    expect(isBackgroundMessage({ target: 'background', type: 'flow/start-armed' })).toBe(true);
    expect(isBackgroundMessage({ target: 'background', type: 'flow/arm', tabId: 3, config: { screenshots: 'auto', values: 'never' } })).toBe(true);
    expect(isBackgroundMessage({ target: 'background', type: 'flow/arm', tabId: 'x', config: {} })).toBe(false);
  });
});

describe('duplicate images in a flow', () => {
  const item = (id: string, digest?: string) => ({ id, digest }) as FlowItem;
  it('finds an image with the same picture anywhere in the flow', () => {
    const items = [item('a', 'd1'), item('b', 'd2'), item('c')];
    expect(findDuplicate(items, 'd1')).toBe(0);
    expect(findDuplicate(items, 'd2')).toBe(1);
    expect(findDuplicate(items, 'd3')).toBe(-1);
    expect(findDuplicate(items, undefined)).toBe(-1);
    // The image itself is not its own duplicate.
    expect(findDuplicate(items, 'd2', 'b')).toBe(-1);
  });
});

describe('flow capture options', () => {
  const config = { ...DEFAULT_SETTINGS.flow, autoSteps: true, area: null };
  it('describes opening a dropdown as its own step', () => {
    const d = describeEvent({ kind: 'click', element: { tag: 'button', selector: '#plan', text: 'Choose plan', popup: true }, x: 0.1, y: 0.1, button: 'left' }, 'never');
    expect(d).toMatchObject({ action: 'open', title: 'Open the “Choose plan” dropdown' });
    expect(describeEvent({ kind: 'click', element: { tag: 'button', selector: '#go', text: 'Go' }, x: 0, y: 0, button: 'left' }, 'never').action).toBe('click');
  });

  it('takes screenshots only for the chosen interactions', () => {
    expect(shotKindOf('select')).toBe('dropdown');
    expect(shotKindOf('uncheck')).toBe('checkbox');
    const noDropdowns = { ...config, captureOn: { ...config.captureOn, dropdown: false } };
    expect(wantsScreenshot('open', noDropdowns, false)).toBe(false);
    expect(wantsScreenshot('select', noDropdowns, false)).toBe(false);
    expect(wantsScreenshot('click', noDropdowns, false)).toBe(true);
    expect(wantsScreenshot('type', { ...config, captureOn: { ...config.captureOn, input: false } }, false)).toBe(false);
    // Older saved settings without the option still take screenshots.
    expect(wantsScreenshot('check', { ...config, captureOn: undefined as never }, false)).toBe(true);
  });
});

/** Reads the (stored, uncompressed) entries of a ZIP built by buildZip. */
function unzip(bytes: Uint8Array): Record<string, Uint8Array> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out: Record<string, Uint8Array> = {};
  let p = 0;
  while (view.getUint32(p, true) === 0x04034b50) {
    const size = view.getUint32(p + 18, true);
    const nameLen = view.getUint16(p + 26, true);
    const extra = view.getUint16(p + 28, true);
    const name = new TextDecoder().decode(bytes.subarray(p + 30, p + 30 + nameLen));
    const start = p + 30 + nameLen + extra;
    out[name] = bytes.subarray(start, start + size);
    p = start + size;
  }
  return out;
}

describe('Word export', () => {
  it('writes a well-formed .docx with headings, bullets and images', () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const bytes = buildDocx([
      { kind: 'title', text: 'Sign-up flow' },
      { kind: 'heading', text: 'Step 1 — Open <Pricing> & "Plans"' },
      { kind: 'image', data: png, type: 'png', width: 1600, height: 900 },
      { kind: 'bullet', text: 'Click “Start”' },
      { kind: 'pageBreak' },
      { kind: 'image', data: png, type: 'png', width: 400, height: 300 },
    ], { paper: 'a4', orientation: 'landscape', margin: 36, title: 'Sign-up flow' });
    const files = unzip(bytes);
    for (const name of ['[Content_Types].xml', '_rels/.rels', 'word/document.xml', 'word/styles.xml', 'word/numbering.xml', 'word/_rels/document.xml.rels', 'docProps/core.xml', 'word/media/image1.png', 'word/media/image2.png']) {
      expect(files[name], name).toBeDefined();
    }
    for (const [name, data] of Object.entries(files)) {
      if (!name.endsWith('.xml') && !name.endsWith('.rels')) continue;
      const xml = new DOMParser().parseFromString(new TextDecoder().decode(data), 'application/xml');
      expect(xml.getElementsByTagName('parsererror'), name).toHaveLength(0);
    }
    const docXml = new TextDecoder().decode(files['word/document.xml']);
    expect(docXml).toContain('Open &lt;Pricing&gt; &amp; &quot;Plans&quot;');
    expect(docXml).toContain('w:orient="landscape"');
    expect(docXml).toContain('r:embed="rIdImg2"');
    expect(new TextDecoder().decode(files['word/_rels/document.xml.rels'])).toContain('Target="media/image2.png"');
  });

  it('fits images to the page without enlarging small ones', () => {
    const big = fitImageEmu(3000, 1000, 6_000_000, 8_000_000);
    expect(big.cx).toBe(6_000_000);
    expect(big.cy).toBe(2_000_000);
    expect(fitImageEmu(100, 50, 6_000_000, 8_000_000)).toEqual({ cx: 952_500, cy: 476_250 });
    expect(xmlEscape('ab')).toBe('ab');
  });
});

describe('sensitive text in sign-in forms', () => {
  const w = (text: string, x: number, y: number): OcrWord => ({ text, x0: x, y0: y, x1: x + text.length * 9, y1: y + 18 });
  const line = (y: number, x: number, ...words: string[]) => words.map((t, i) => w(t, x + i * 90, y));

  it('reads values typed under a field label (label above the box)', () => {
    const found = findSensitive([
      line(240, 240, 'Email', 'Address'),
      line(262, 240, 'sridhevi2006@gmail.com'),
      line(310, 240, 'Password'),
      // The box border is read as "|" and starts above the value.
      [w('|', 220, 318), w('fdsfsdfsd', 236, 340), w('|', 960, 318)],
    ]);
    expect(found.find((f) => f.kind === 'email')?.text).toBe('sridhevi2006@gmail.com');
    expect(found.find((f) => f.kind === 'password')?.text).toBe('fdsfsdfsd');
  });

  it('does not flag ordinary words after "private" or "password."', () => {
    expect(findSensitive([line(500, 220, 'Check', 'this', 'box', 'only', 'when', 'on', 'a', 'private', 'device.')])).toEqual([]);
    expect(findSensitive([line(150, 230, 'You', 'can', 'sign', 'in', 'using', 'your', 'email', 'and', 'password.', 'Learn', 'more')])).toEqual([]);
    expect(findSensitive([line(380, 250, 'Forgot', 'Password?')])).toEqual([]);
    // Real keys are still found.
    const fakeKey = ['sk', 'live', '51abcDEF123'].join('_'); // built at runtime: not a real key, keeps secret scanners quiet
    expect(findSensitive([line(10, 10, 'API', 'key:', fakeKey)])[0]).toMatchObject({ kind: 'secret', text: fakeKey });
    expect(findSensitive([line(10, 10, 'Password:', 'hunter2')])[0]).toMatchObject({ kind: 'password', text: 'hunter2' });
  });

  it('merges a second OCR pass without repeating lines', () => {
    const a = [line(10, 10, 'Sign', 'In')];
    const b = [line(10, 10, 'Sign', 'In'), line(262, 240, 'sridhevi2006@gmail.com')];
    expect(mergeOcrLines(a, b)).toHaveLength(2);
  });
});

describe('deleting and restoring flow images', () => {
  it('removes an image with its steps and restores both in place', async () => {
    const it = (id: string) => ({ id, mode: 'visible', auto: false, at: 1, url: '', pageTitle: '', width: 10, height: 10, description: id }) as FlowItem;
    const st = (id: string, itemId?: string) => ({ id, action: 'click', title: id, url: '', pageTitle: '', at: 1, elapsedMs: 0, ...(itemId ? { itemId } : {}) }) as never;
    await putFlow({ id: 'fdel', name: 'f', config: { ...DEFAULT_SETTINGS.flow, area: null }, items: [it('a'), it('b'), it('c')], steps: [st('s1', 'a'), st('s2', 'b'), st('s3', 'b'), st('s4'), st('s5', 'c')], startedAt: 1 });
    const after = await softDeleteFlowImages('fdel', ['b']);
    expect(after.items.map((i) => i.id)).toEqual(['a', 'c']);
    expect(after.steps.map((s) => s.id)).toEqual(['s1', 's4', 's5']);
    expect(after.deleted?.[0]?.steps?.map((s) => s.id)).toEqual(['s2', 's3']);
    const back = await restoreFlowImages('fdel', ['b']);
    expect(back.items.map((i) => i.id)).toEqual(['a', 'b', 'c']);
    expect(back.steps.map((s) => s.id)).toEqual(['s1', 's2', 's3', 's4', 's5']);
    expect(back.steps.every((s) => !('index' in s))).toBe(true);
    expect((await getFlow('fdel'))?.deleted).toEqual([]);
  });
});
