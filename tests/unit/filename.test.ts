import { describe, expect, it } from 'vitest';
import { buildFilename, extensionForMime, replaceExtension, sanitizeFilename, sanitizeSubfolder, stripExtension } from '@/shared/utils/filename';

describe('filename generation', () => {
  const date = new Date(2026, 10, 11, 9, 5, 7);

  it('expands tokens', () => {
    expect(buildFilename('Pixora {type} {date} at {time}', { type: 'Screenshot', date, extension: 'png' })).toBe('Pixora Screenshot 2026-11-11 at 09.05.07.png');
    expect(buildFilename('{host}-{yyyy}{mm}{dd}', { type: 'Recording', date, url: 'https://www.example.com/a', extension: 'webm' })).toBe('example.com-20261111.webm');
    expect(buildFilename('{timestamp}', { type: 'Recording', date, extension: '.mp4' })).toBe(`${date.getTime()}.mp4`);
  });

  it('leaves unknown tokens and strips illegal characters', () => {
    expect(buildFilename('{nope} {title}', { type: 'Screenshot', date, title: 'A/B: "C"?', extension: 'png' })).toBe('{nope} A-B- -C--.png');
  });

  it('never produces an empty or reserved name', () => {
    expect(sanitizeFilename('   ')).toBe('capture');
    expect(sanitizeFilename('...hidden')).toBe('hidden');
    expect(sanitizeFilename('CON')).toBe('_CON');
    expect(sanitizeFilename('trailing. ')).toBe('trailing');
    expect(sanitizeFilename('x'.repeat(300)).length).toBe(120);
  });

  it('sanitises sub-folders (no traversal)', () => {
    expect(sanitizeSubfolder('../Pixora//Shots/./a:b')).toBe('Pixora/Shots/a-b');
    expect(sanitizeSubfolder('')).toBe('');
  });

  it('handles extensions', () => {
    expect(replaceExtension('shot.png', 'jpg')).toBe('shot.jpg');
    expect(replaceExtension('noext', '.webp')).toBe('noext.webp');
    expect(stripExtension('a.b.c')).toBe('a.b');
    expect(extensionForMime('video/webm;codecs=vp9')).toBe('webm');
    expect(extensionForMime('video/mp4')).toBe('mp4');
    expect(extensionForMime('image/jpeg')).toBe('jpg');
  });
});
