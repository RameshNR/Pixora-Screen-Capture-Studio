import { describe, expect, it } from 'vitest';
import { computeFrameDestinations, computeOutputScale, planFullPageCapture } from '@/screenshot/services/image-stitching';

describe('full-page capture planning', () => {
  it('steps one viewport at a time and clamps the last step to the bottom', () => {
    const plan = planFullPageCapture(2500, 1000, 30000);
    expect(plan.positions).toEqual([0, 1000, 1500]);
    expect(plan.captureHeight).toBe(2500);
    expect(plan.truncated).toBe(false);
  });

  it('handles pages shorter than the viewport', () => {
    expect(planFullPageCapture(600, 1000, 30000).positions).toEqual([0]);
  });

  it('truncates exceptionally long pages', () => {
    const plan = planFullPageCapture(100_000, 1000, 30000);
    expect(plan.captureHeight).toBe(30000);
    expect(plan.truncated).toBe(true);
    expect(plan.positions.at(-1)).toBe(29000);
  });

  it('places overlapping frames at their actual offsets (no duplicated rows)', () => {
    const dests = computeFrameDestinations(
      [
        { scrollTop: 0, imageWidth: 2000 },
        { scrollTop: 1000, imageWidth: 2000 },
        { scrollTop: 1500, imageWidth: 2000 },
      ],
      { x: 0, y: 0, width: 1000, height: 1000 },
      1000,
      2500,
    );
    expect(dests.map((d) => d.destY)).toEqual([0, 1000, 1500]);
    // Device pixel ratio 2 → source rects are doubled.
    expect(dests[0]!.src).toEqual({ x: 0, y: 0, width: 2000, height: 2000 });
    // The last frame overlaps the previous one; it is drawn at 1500 and covers exactly to the end.
    expect(dests[2]!.destY + dests[2]!.destHeight).toBe(2500);
  });

  it('crops each frame to the scrolling region for inner scrollers', () => {
    const [d] = computeFrameDestinations([{ scrollTop: 0, imageWidth: 1200 }], { x: 200, y: 64, width: 1000, height: 700 }, 1200, 700);
    expect(d!.src).toEqual({ x: 200, y: 64, width: 1000, height: 700 });
  });
});

describe('canvas limits', () => {
  it('keeps normal captures at native scale', () => {
    expect(computeOutputScale(1920, 20000)).toBe(1);
  });

  it('scales down beyond the max dimension and area', () => {
    const s = computeOutputScale(3840, 60000);
    expect(60000 * s).toBeLessThanOrEqual(32767);
    expect(3840 * 60000 * s * s).toBeLessThanOrEqual(268_435_456 + 1);
  });
});
