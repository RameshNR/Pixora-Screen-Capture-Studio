import { describe, expect, it } from 'vitest';
import { CAPTURE_WINDOW_MS, captureWait } from '@/screenshot/services/visible-capture';

describe('screen captures within Chrome\'s two-per-second limit', () => {
  it('a click picture right after one automatic picture is taken at once', () => {
    // The scroll picture 200 ms ago used one of the two calls; the click gets the second now.
    expect(captureWait([1000], 1200, 'high')).toBe(0);
  });

  it('automatic pictures leave one call free for a click', () => {
    expect(captureWait([], 1000, 'low')).toBe(0);
    expect(captureWait([1000], 1200, 'low')).toBe(1000 + CAPTURE_WINDOW_MS - 1200);
  });

  it('a third picture within the second waits for the oldest call to leave the window', () => {
    expect(captureWait([1000, 1100], 1200, 'high')).toBe(1000 + CAPTURE_WINDOW_MS - 1200);
    expect(captureWait([1000, 1100], 1000 + CAPTURE_WINDOW_MS, 'high')).toBe(0);
    // Old calls don't count.
    expect(captureWait([0, 10], 5000, 'low')).toBe(0);
  });
});
