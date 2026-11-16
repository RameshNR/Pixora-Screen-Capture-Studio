/**
 * How far the styled recording cursor moves towards the mouse in one animation step.
 *
 * Time-based (not per frame) so it feels the same at 30, 60 or 144 Hz, and short: at the default
 * smoothing (0.6) it closes 95% of the gap in about 45 ms — smooth on video, without the visible
 * trailing the old per-frame easing had (about 100 ms). Smoothing below 0.05 means no glide at all.
 */
export function glideAlpha(dtMs: number, smoothing: number): number {
  const s = Math.max(0, Math.min(0.9, smoothing));
  if (s < 0.05) return 1;
  const tauMs = s * 25;
  return 1 - Math.exp(-Math.max(0, dtMs) / tauMs);
}
