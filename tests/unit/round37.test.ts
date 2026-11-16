import { describe, expect, it } from 'vitest';
import { nameFromUrl, parseImageUrl } from '@/shared/utils/image-url';
import { rulerTicks } from '@/recording/components/VideoTools';
import { formatBytes } from '@/collage/render';

describe('picture from a web address', () => {
  it('accepts http(s) and data: pictures only', () => {
    expect('url' in parseImageUrl('https://example.com/a.png')).toBe(true);
    expect((parseImageUrl('example.com/pic.jpg') as { url: URL }).url.href).toBe('https://example.com/pic.jpg');
    expect('url' in parseImageUrl('data:image/png;base64,AAAA')).toBe(true);
    expect(parseImageUrl('data:text/html;base64,AAAA')).toEqual({ error: 'That data address is not a picture.' });
    expect(parseImageUrl('javascript:alert(1)')).toEqual({ error: 'Only http and https addresses can be used.' });
    expect(parseImageUrl('file:///C:/secret.png')).toEqual({ error: 'Only http and https addresses can be used.' });
    expect(parseImageUrl('chrome://settings')).toEqual({ error: 'Only http and https addresses can be used.' });
    expect(parseImageUrl('  ')).toEqual({ error: 'Type or paste the address of a picture.' });
  });

  it('names the picture after the file or the site', () => {
    expect(nameFromUrl(new URL('https://cdn.example.com/img/hotel%20pool.jpg?w=800'), 'image/jpeg')).toBe('hotel pool.jpg');
    expect(nameFromUrl(new URL('https://www.example.com/render?id=5'), 'image/webp')).toBe('example.com.webp');
  });
});

describe('video timeline ruler and collage size', () => {
  it('puts about ten round labels across the timeline', () => {
    expect(rulerTicks(9.5)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(rulerTicks(115.9).slice(0, 3)).toEqual([0, 10, 20]);
    expect(rulerTicks(0)).toEqual([]);
  });

  it('formats file sizes', () => {
    expect(formatBytes(900)).toBe('900 B');
    expect(formatBytes(840 * 1024)).toBe('840 KB');
    expect(formatBytes(2.44 * 1024 * 1024)).toBe('2.4 MB');
  });
});
