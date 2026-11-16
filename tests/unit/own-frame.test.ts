import { describe, expect, it } from 'vitest';
import { ownFrame } from '@/flow/own-frame';
import type { Frame } from '@/editor/types';

const base: Frame = { padding: 24, background: '#fff', radius: 8, shadow: true, borderWidth: 0, borderColor: '#000', browser: null };

describe('Apply to all: browser frame per page', () => {
  it("uses each page's own address and tab title", () => {
    const designed: Frame = { ...base, browser: { style: 'mac', position: 'top', theme: 'light', url: 'https://a.example/login', title: 'Login' } };
    const f = ownFrame(designed, { url: 'https://b.example/cart', pageTitle: 'Your cart', description: '' });
    expect(f?.browser).toMatchObject({ url: 'https://b.example/cart', title: 'Your cart', style: 'mac', theme: 'light' });
    expect(f?.padding).toBe(24);
    expect(designed.browser?.url).toBe('https://a.example/login'); // the source frame is untouched
  });

  it('leaves frames without a browser window (and no frame) as they are', () => {
    expect(ownFrame(base, { url: 'x', pageTitle: 'y', description: '' })).toBe(base);
    expect(ownFrame(null, { url: 'x', pageTitle: 'y', description: '' })).toBeNull();
  });

  it('falls back to the description, never to another page', () => {
    const designed: Frame = { ...base, browser: { style: 'windows', position: 'top', theme: 'dark', url: 'https://a.example', title: 'A' } };
    expect(ownFrame(designed, { url: '', pageTitle: '', description: 'Step 3' })?.browser).toMatchObject({ url: '', title: 'Step 3' });
  });
});
