// Export progress helpers (kept free of the media toolkit so pages can use them without loading it).

/** Share of the bar used by encoding: the rest is writing the file, so 100% is never shown early. */
export const ENCODE_SHARE = 0.96;

export type ExportStage = 'encoding' | 'finishing';

/** Bar position for the seconds of video encoded so far, measured against the real length. */
export function encodeProgress(doneSec: number, totalSec: number): number {
  if (!(totalSec > 0) || !Number.isFinite(doneSec)) return 0;
  return Math.max(0, Math.min(1, doneSec / totalSec)) * ENCODE_SHARE;
}

/** "about 2 min" / "about 40 s" left, or null until there is enough to go on. */
export function timeLeftLabel(progress: number, elapsedMs: number): string | null {
  const done = progress / ENCODE_SHARE;
  if (done < 0.03 || done >= 1 || elapsedMs < 3000) return null;
  const seconds = (elapsedMs * (1 - done)) / done / 1000;
  if (seconds < 60) return `about ${Math.max(5, Math.ceil(seconds / 5) * 5)} s`;
  return `about ${Math.ceil(seconds / 60)} min`;
}
