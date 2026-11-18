import { describe, expect, it, vi } from 'vitest';
import { seeThroughFill, setCalloutDash } from '@/editor/tools/callout-recipes';
import { canResetSnapshot, commitVideoHistory, createVideoHistory, resetSnapshot, undoVideoHistory, type VideoSnapshot } from '@/recording/services/video-history';
import type { Marker } from '@/shared/types';
import type { VideoOverlay } from '@/recording/services/video-overlays';

describe('callout line styles', () => {
  it('dotted lines get the round ends that make the dots visible', () => {
    const ctx = { lineCap: 'butt', setLineDash: vi.fn() } as unknown as CanvasRenderingContext2D;
    setCalloutDash(ctx, { dash: 'dotted' }, 6);
    expect(ctx.lineCap).toBe('round');
    expect(ctx.setLineDash).toHaveBeenCalledWith([0.01, 12]);
  });

  it('other styles keep their square ends', () => {
    const ctx = { lineCap: 'butt', setLineDash: vi.fn() } as unknown as CanvasRenderingContext2D;
    setCalloutDash(ctx, { dash: 'dashed' }, 4);
    expect(ctx.lineCap).toBe('butt');
  });

  it.each([
    ['transparent', true], ['#FFFFFF00', true], ['#FFFFFFCC', true], ['#FFFC', true], ['rgba(255,255,255,0.5)', true],
    ['#FFFFFF', false], ['#FFFFFFFF', false], ['#FFF', false], ['rgba(0,0,0,1)', false], ['rgb(1,2,3)', false],
  ])('knows whether %s shows what is behind it', (fill, expected) => {
    expect(seeThroughFill(fill)).toBe(expected);
  });
});

describe('video reset', () => {
  const markers = [{ id: 'm', name: 'Intro', timeMs: 0 }] as unknown as Marker[];
  const edited: VideoSnapshot = { overlays: [{ id: 'o' } as VideoOverlay], watermark: null, markers, regions: [], trim: { start: 1, end: 2 } };

  it('removes the edits, keeps the chapters, and can be undone', () => {
    const clean = resetSnapshot(edited);
    expect(clean).toMatchObject({ overlays: [], watermark: null, regions: [], trim: null });
    expect(clean.markers).toBe(markers);
    expect(canResetSnapshot(edited)).toBe(true);
    expect(canResetSnapshot(clean)).toBe(false);
    const h = commitVideoHistory(createVideoHistory(edited), clean, 'Reset to original');
    expect(h.present.label).toBe('Reset to original');
    expect(undoVideoHistory(h).present.snapshot).toBe(edited);
  });
});
