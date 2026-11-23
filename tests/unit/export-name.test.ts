import { describe, expect, it } from 'vitest';
import { exportName, extFor } from '@/flow/flow-export';
import type { FlowItem } from '@/shared/types';

const item = (description: string, pageTitle = ''): FlowItem => ({ id: 'i', mode: 'visible', auto: false, at: 0, url: '', pageTitle, width: 1, height: 1, description });

describe('flow export file names', () => {
  it('keeps the picture name without a second ending ("photo.jpeg" → "photo.jpg", not "photo.jpeg.jpg")', () => {
    expect(exportName(3, item(''), 'jpg', '', { name: 'pexels-photo-1525060.jpeg' })).toBe('03 - pexels-photo-1525060.jpg');
    expect(exportName(3, item('pexels-photo-1525060.jpeg'), 'png')).toBe('03 - pexels-photo-1525060.png');
  });
  it('numbering can be turned off', () => {
    expect(exportName(12, item(''), 'webp', '', { name: 'Holiday.webp', numbered: false })).toBe('Holiday.webp');
  });
  it('falls back to the description, then the page title', () => {
    expect(exportName(1, item('Sign in'), 'png')).toBe('01 - Sign in.png');
    expect(exportName(1, item('', 'Dashboard'), 'png')).toBe('01 - Dashboard.png');
  });
  it('file endings from picture types', () => {
    expect(extFor('image/jpeg')).toBe('jpg');
    expect(extFor('image/webp')).toBe('webp');
    expect(extFor('image/png')).toBe('png');
  });
});
