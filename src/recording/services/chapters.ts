import type { Marker } from '@/shared/types';

function stamp(seconds: number, withMs = false): string {
  const t = Math.max(0, seconds);
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = Math.floor(t % 60);
  const ms = Math.round((t % 1) * 1000);
  const base = `${h ? `${String(h).padStart(2, '0')}:` : withMs ? '00:' : ''}${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return withMs ? `${base}.${String(ms).padStart(3, '0')}` : base;
}

/** Markers inside [start, end] shifted so the range starts at 0, sorted. */
export function chaptersInRange(markers: Marker[], start = 0, end = Infinity): Marker[] {
  return markers
    .filter((m) => m.timeMs / 1000 >= start - 1e-3 && m.timeMs / 1000 <= end + 1e-3)
    .map((m) => ({ ...m, timeMs: Math.max(0, m.timeMs - start * 1000) }))
    .sort((a, b) => a.timeMs - b.timeMs);
}

/**
 * Chapter list in the widely used "00:00 Title" format (YouTube descriptions, many players).
 * A 00:00 entry is added when the first marker starts later.
 */
export function chaptersText(markers: Marker[], start = 0, end = Infinity): string {
  const list = chaptersInRange(markers, start, end);
  if (!list.length) return '';
  const lines = list.map((m) => `${stamp(m.timeMs / 1000)} ${m.name}`);
  if (list[0]!.timeMs > 500) lines.unshift(`${stamp(0)} Start`);
  return lines.join('\n');
}

/** WebVTT chapters track (each chapter runs until the next one, the last until `durationSec`). */
export function chaptersVtt(markers: Marker[], durationSec: number): string {
  const list = [...markers].sort((a, b) => a.timeMs - b.timeMs);
  const cues = list.map((m, i) => {
    const from = m.timeMs / 1000;
    const to = Math.max(from + 0.5, i + 1 < list.length ? list[i + 1]!.timeMs / 1000 : durationSec);
    return `${i + 1}\n${stamp(from, true)} --> ${stamp(to, true)}\n${m.name}${m.description ? `\n${m.description}` : ''}`;
  });
  return `WEBVTT\n\n${cues.join('\n\n')}\n`;
}

/** Start / end (seconds) of the chapter that begins at `marker`. */
export function chapterRange(markers: Marker[], marker: Marker, durationSec: number): { start: number; end: number } {
  const sorted = [...markers].sort((a, b) => a.timeMs - b.timeMs);
  const i = sorted.findIndex((m) => m.id === marker.id);
  const next = sorted[i + 1];
  return { start: marker.timeMs / 1000, end: next ? next.timeMs / 1000 : durationSec };
}
