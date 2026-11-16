// Size helpers for video export (kept free of the media toolkit so pages can use them without loading it).

/** Common output sizes, named by their short side. */
export const RESOLUTIONS: Array<{ value: number; label: string }> = [
  { value: 4320, label: '8K (4320p)' },
  { value: 2160, label: '4K (2160p)' },
  { value: 1440, label: '2K (1440p)' },
  { value: 1080, label: '1080p (Full HD)' },
  { value: 720, label: '720p (HD)' },
  { value: 480, label: '480p (SD)' },
  { value: 360, label: '360p' },
  { value: 240, label: '240p' },
];

/**
 * Output size for a target short side, keeping the aspect ratio. Never upscales: a target larger
 * than the source keeps the source size. Dimensions are even (required by H.264).
 */
export function scaledSize(width: number, height: number, shortSide: number | null | undefined): { width: number; height: number; scaled: boolean } {
  const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
  const short = Math.min(width, height);
  if (!shortSide || !short || shortSide >= short) return { width, height, scaled: false };
  const k = shortSide / short;
  return { width: even(width * k), height: even(height * k), scaled: true };
}
