import { describe, expect, it } from 'vitest';
import { cutBand, mapAcrossCut } from '@/editor/tools/crop';
import { displayTitle } from '@/popup/components/ScrollAreaChooser';

describe('cut out & join', () => {
  it('clamps and orders the band, refuses to remove (almost) everything', () => {
    expect(cutBand(300, 200, 100)).toEqual({ start: 100, end: 200 });
    expect(cutBand(300, -20, 50.4)).toEqual({ start: 0, end: 50 });
    expect(cutBand(300, 10, 10)).toBeNull();
    expect(cutBand(300, 0, 299)).toBeNull();
    expect(cutBand(300, 0, 298)).toEqual({ start: 0, end: 298 });
  });

  it('moves coordinates after the band back and squeezes the band onto the join', () => {
    expect(mapAcrossCut(50, 100, 200)).toBe(50);
    expect(mapAcrossCut(150, 100, 200)).toBe(100);
    expect(mapAcrossCut(250, 100, 200)).toBe(150);
    expect(mapAcrossCut(200, 100, 200)).toBe(100);
  });
});

describe('scroll-area titles', () => {
  it('turns all-caps titles into sentence case and leaves others alone', () => {
    expect(displayTitle('CONTENT 1 - VACATION PACKAGE RESULTS')).toBe('Content 1 - vacation package results');
    expect(displayTitle('Main content')).toBe('Main content');
    expect(displayTitle('div#list (left)')).toBe('div#list (left)');
    expect(displayTitle('FAQ')).toBe('FAQ');
  });
});
