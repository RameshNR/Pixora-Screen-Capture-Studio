import { describe, expect, it } from 'vitest';
import { applyEvent, averageHash, describeEvent, hashDistance, isSensitiveField, MASK, normalizeUrl, wantsScreenshot } from '@/flow/flow-engine';
import { exportName } from '@/flow/flow-export';
import { buildZip, crc32 } from '@/shared/utils/zip';
import { buildMultiPagePdf, buildPdf, pdfLayout } from '@/shared/utils/pdf';
import { findSensitive, type OcrWord } from '@/screenshot/services/sensitive-detect';
import { isFlowEvent } from '@/shared/messaging/messages';
import type { FlowConfig, FlowElement, FlowItem, FlowStep } from '@/shared/types';
import { DEFAULT_SETTINGS } from '@/shared/constants/defaults';

const config: FlowConfig = { ...DEFAULT_SETTINGS.flow, autoSteps: true, area: null };
const el = (over: Partial<FlowElement> = {}): FlowElement => ({ tag: 'input', selector: '#email', label: 'Email', ...over });
const step = (over: Partial<FlowStep>): FlowStep => ({ id: 's', action: 'click', title: '', url: 'https://a.test/', pageTitle: '', at: 1000, elapsedMs: 0, ...over });
const ctx = (now = 1500) => ({ now, currentUrl: 'https://a.test/', config });

describe('flow privacy', () => {
  it('always treats passwords, one-time codes and payment fields as sensitive', () => {
    expect(isSensitiveField({ type: 'password' })).toBe(true);
    expect(isSensitiveField({ autocomplete: 'one-time-code' })).toBe(true);
    expect(isSensitiveField({ autocomplete: 'cc-number' })).toBe(true);
    expect(isSensitiveField({ name: 'otp' })).toBe(true);
    expect(isSensitiveField({ label: 'CVV' })).toBe(true);
    expect(isSensitiveField({ id: 'account-number' })).toBe(true);
    expect(isSensitiveField({ type: 'email', name: 'email', label: 'Email' })).toBe(false);
  });

  it('masks sensitive values and honours the "never keep values" policy', () => {
    expect(describeEvent({ kind: 'type', element: el({ label: 'Password', type: 'password' }), value: '', sensitive: true }, 'non-sensitive')).toMatchObject({ value: MASK, masked: true });
    expect(describeEvent({ kind: 'type', element: el(), value: 'jane@x.test', sensitive: false }, 'non-sensitive')).toMatchObject({ title: 'Type “jane@x.test” in the “Email” field', value: 'jane@x.test' });
    const never = describeEvent({ kind: 'type', element: el(), value: '•', sensitive: false }, 'never');
    expect(never.value).toBeUndefined();
    expect(never.title).toBe('Fill in the “Email” field');
    expect(describeEvent({ kind: 'select', element: el({ label: 'Country', tag: 'select' }), value: 'India', sensitive: false }, 'never').value).toBeUndefined();
  });
});

describe('flow step grouping and dedup', () => {
  it('describes clicks, links, checkboxes, scrolling and navigation', () => {
    expect(describeEvent({ kind: 'click', element: el({ tag: 'a', text: 'Pricing', label: undefined }), x: 0.5, y: 0.5, button: 'left' }, 'never').title).toBe('Click the “Pricing” link');
    expect(describeEvent({ kind: 'check', element: el({ label: 'Remember me' }), checked: false }, 'never')).toMatchObject({ action: 'uncheck', title: 'Uncheck “Remember me”' });
    expect(describeEvent({ kind: 'scroll', dy: 1200, scrollY: 1200, pageHeight: 4000 }, 'never').title).toBe('Scroll down 1,200 px');
    expect(describeEvent({ kind: 'navigate', url: 'https://a.test/b', title: 'Billing', via: 'spa' }, 'never').title).toBe('Go to “Billing”');
  });

  it('keeps one step per field edit (final value) and skips unchanged values', () => {
    const typed = step({ action: 'type', element: el(), value: 'ja', title: 'Type “ja” in the “Email” field', at: 1000 });
    const r = applyEvent([typed], { kind: 'type', element: el(), value: 'jane@x.test', sensitive: false }, ctx(3000));
    expect(r).toMatchObject({ kind: 'update', index: 0, patch: { value: 'jane@x.test' } });
    const same = applyEvent([{ ...typed, value: 'jane@x.test', title: 'Type “jane@x.test” in the “Email” field' }], { kind: 'type', element: el(), value: 'jane@x.test', sensitive: false }, ctx(3000));
    expect(same.kind).toBe('skip');
  });

  it('ignores double clicks, repeated submits, non-action keys, small scrolls and the same page', () => {
    const click = step({ action: 'click', element: el({ selector: '#go' }), at: 1000 });
    expect(applyEvent([click], { kind: 'click', element: el({ selector: '#go' }), x: 0, y: 0, button: 'left' }, ctx(1300)).kind).toBe('skip');
    expect(applyEvent([click], { kind: 'click', element: el({ selector: '#go' }), x: 0, y: 0, button: 'left' }, ctx(2500)).kind).toBe('add');
    expect(applyEvent([], { kind: 'key', element: null, key: 'a' }, ctx()).kind).toBe('skip');
    expect(applyEvent([], { kind: 'key', element: null, key: 'Enter' }, ctx()).kind).toBe('add');
    expect(applyEvent([], { kind: 'scroll', dy: 50, scrollY: 50, pageHeight: 3000 }, ctx()).kind).toBe('skip');
    expect(applyEvent([], { kind: 'navigate', url: 'https://a.test', title: '', via: 'spa' }, ctx()).kind).toBe('skip');
    expect(applyEvent([], { kind: 'navigate', url: 'https://a.test/next', title: '', via: 'spa' }, ctx()).kind).toBe('add');
    const submit = step({ action: 'submit', element: el({ selector: 'form' }), at: 1000 });
    expect(applyEvent([submit], { kind: 'submit', element: el({ selector: 'form' }) }, ctx(1500)).kind).toBe('skip');
  });

  it('merges a continuing scroll into one step', () => {
    const s = step({ action: 'scroll', scrollPx: 600, title: 'Scroll down 600 px', at: 1000 });
    const r = applyEvent([s], { kind: 'scroll', dy: 500, scrollY: 1100, pageHeight: 4000 }, ctx(3000));
    expect(r).toMatchObject({ kind: 'update', patch: { scrollPx: 1100, title: 'Scroll down 1,100 px' } });
  });

  it('decides when auto screenshots are taken', () => {
    expect(wantsScreenshot('click', config, false)).toBe(true);
    expect(wantsScreenshot('click', { ...config, screenshotWhen: 'page-change' }, false)).toBe(false);
    expect(wantsScreenshot('navigate', { ...config, screenshotWhen: 'page-change' }, true)).toBe(true);
    expect(wantsScreenshot('click', { ...config, screenshots: 'none' }, true)).toBe(false);
    expect(normalizeUrl('https://a.test/x/')).toBe('https://a.test/x');
  });

  it('hashes screens so unchanged ones can be skipped', () => {
    const flat = Array.from({ length: 64 }, (_, i) => (i < 32 ? 10 : 200));
    const other = Array.from({ length: 64 }, (_, i) => (i % 2 ? 10 : 200));
    const h = averageHash(flat);
    expect(h).toHaveLength(16);
    expect(hashDistance(h, h)).toBe(0);
    expect(hashDistance(h, averageHash(other))).toBeGreaterThan(10);
  });

  it('validates events reported by pages', () => {
    expect(isFlowEvent({ kind: 'click', element: { tag: 'a', selector: 'a' }, x: 0.1, y: 0.2, button: 'left' })).toBe(true);
    expect(isFlowEvent({ kind: 'evil' })).toBe(false);
    expect(isFlowEvent({ kind: 'type', element: { tag: 'input', selector: 'x'.repeat(700) }, value: 'a', sensitive: false })).toBe(false);
  });
});

describe('flow exports', () => {
  it('numbers files in order with safe names', () => {
    const item = { description: 'Sign in: step / 1?', pageTitle: 'x' } as FlowItem;
    expect(exportName(3, item, 'png')).toBe('03 - Sign in step 1.png');
    expect(exportName(12, { description: '', pageTitle: '' } as FlowItem, 'jpg', ' (original)')).toBe('12 - image (original).jpg');
  });

  it('writes valid ZIP archives', () => {
    expect(crc32(new TextEncoder().encode('hello'))).toBe(0x3610a686);
    const zip = buildZip([{ name: 'a.txt', data: 'hello' }, { name: 'b/c.txt', data: new Uint8Array([1, 2, 3]) }]);
    const view = new DataView(zip.buffer);
    expect(view.getUint32(0, true)).toBe(0x04034b50);
    const end = zip.length - 22;
    expect(view.getUint32(end, true)).toBe(0x06054b50);
    expect(view.getUint16(end + 10, true)).toBe(2);
    expect(new TextDecoder().decode(zip.subarray(30, 35))).toBe('a.txt');
  });

  it('writes PDFs with one page per screenshot and captions', () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
    const pdf = new TextDecoder('latin1').decode(buildMultiPagePdf([
      { image: { jpeg, width: 1600, height: 900 }, lines: [{ text: 'Step 1 — Sign in', bold: true }] },
      { image: { jpeg, width: 400, height: 900 } },
    ], { paper: 'a4', orientation: 'auto', margin: 36, fit: 'contain' }));
    expect(pdf.startsWith('%PDF-1.4')).toBe(true);
    expect(pdf).toContain('/Count 2');
    expect(pdf).toContain('(Step 1 - Sign in) Tj');
    // Landscape for the wide image, portrait for the tall one.
    expect(pdf).toContain('/MediaBox [0 0 841.89 595.28]');
    expect(pdf).toContain('/MediaBox [0 0 595.28 841.89]');
    expect(pdf.trimEnd().endsWith('%%EOF')).toBe(true);
    expect(new TextDecoder('latin1').decode(buildPdf(jpeg, 100, 50, { page: 'image' }))).toContain('/Count 1');
    expect(pdfLayout(2000, 1000, { page: 'a4' }).pageW).toBeCloseTo(841.89);
  });
});

describe('sensitive text labels', () => {
  const word = (text: string, x: number): OcrWord => ({ text, x0: x, y0: 0, x1: x + text.length * 10, y1: 20 });
  it('hides labelled values and stops at the next label', () => {
    const found = findSensitive([[word('Username:', 0), word('jdoe42', 100), word('Mobile', 170), word('98765', 240), word('43210', 300)]]);
    expect(found.find((f) => f.kind === 'personal')?.text).toBe('jdoe42');
    expect(found.some((f) => f.kind === 'phone')).toBe(true);
    const acct = findSensitive([[word('Account', 0), word('number:', 80), word('0012-3456-78', 160)]]);
    expect(acct[0]).toMatchObject({ kind: 'account', text: '0012-3456-78' });
    expect(findSensitive([[word('https://x.test/cb?token=abcdef123456', 0)]])[0]?.kind).toBe('url-token');
  });
});
