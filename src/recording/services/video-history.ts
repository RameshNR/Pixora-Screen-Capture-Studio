import type { Marker, VideoRedaction } from '@/shared/types';
import type { Watermark } from '@/editor/types';
import { getBounds } from '@/editor/tools/annotations';
import { overlayName, type VideoOverlay } from './video-overlays';

/**
 * Undo / redo of the video page: drawings, watermark, chapters, privacy regions and the trim range.
 * Snapshots share unchanged objects, so a long history stays small.
 */
export interface VideoSnapshot {
  overlays: VideoOverlay[];
  watermark: Watermark | null;
  markers: Marker[];
  regions: VideoRedaction[];
  trim: { start: number; end: number } | null;
}

export interface VideoHistoryEntry {
  snapshot: VideoSnapshot;
  /** Shown in the History window ("Add arrow", "Trim video"…). */
  label: string;
  at: number;
}

export interface VideoHistory {
  past: VideoHistoryEntry[];
  present: VideoHistoryEntry;
  future: VideoHistoryEntry[];
}

export const VIDEO_HISTORY_LIMIT = 100;
/** Changes closer together than this (a drag, holding +) become one step. */
export const HISTORY_SETTLE_MS = 400;

export function createVideoHistory(snapshot: VideoSnapshot): VideoHistory {
  return { past: [], present: { snapshot, label: 'Opened video', at: Date.now() }, future: [] };
}

export function sameSnapshot(a: VideoSnapshot, b: VideoSnapshot): boolean {
  return a.overlays === b.overlays && a.watermark === b.watermark && a.markers === b.markers && a.regions === b.regions
    && (a.trim === b.trim || (a.trim?.start === b.trim?.start && a.trim?.end === b.trim?.end));
}

function overlayChange(before: VideoOverlay[], after: VideoOverlay[]): string {
  const was = new Map(before.map((o) => [o.id, o]));
  if (after.length > before.length) {
    const added = after.find((o) => !was.has(o.id));
    return `Add ${added ? overlayName(added.annotation) : 'drawing'}`;
  }
  if (after.length < before.length) {
    const kept = new Set(after.map((o) => o.id));
    const gone = before.find((o) => !kept.has(o.id));
    return `Delete ${gone ? overlayName(gone.annotation) : 'drawing'}`;
  }
  const changed = after.find((o) => was.get(o.id) !== o);
  if (!changed) return 'Change layer order';
  const name = overlayName(changed.annotation);
  const old = was.get(changed.id);
  if (!old) return `Edit ${name}`;
  if (old.start !== changed.start || old.end !== changed.end) return `Change timing of ${name}`;
  if (old.annotation === changed.annotation) return `Change animation of ${name}`;
  if (Boolean(old.annotation.hidden) !== Boolean(changed.annotation.hidden)) return `${changed.annotation.hidden ? 'Hide' : 'Show'} ${name}`;
  const a = getBounds(old.annotation);
  const b = getBounds(changed.annotation);
  return (a.w === b.w && a.h === b.h) && (a.x !== b.x || a.y !== b.y) ? `Move ${name}` : `Edit ${name}`;
}

const listChange = (before: unknown[], after: unknown[], noun: string) =>
  `${after.length > before.length ? 'Add' : after.length < before.length ? 'Delete' : 'Edit'} ${noun}`;

/** A short description of what changed between two snapshots. */
export function describeVideoChange(a: VideoSnapshot, b: VideoSnapshot): string {
  if (a.overlays !== b.overlays) return overlayChange(a.overlays, b.overlays);
  if (a.watermark !== b.watermark) return !a.watermark ? 'Add watermark' : !b.watermark ? 'Remove watermark' : 'Edit watermark';
  if (a.markers !== b.markers) return listChange(a.markers, b.markers, 'chapter');
  if (a.regions !== b.regions) return listChange(a.regions, b.regions, 'privacy region');
  return b.trim ? 'Trim video' : 'Clear trim';
}

export function commitVideoHistory(h: VideoHistory, snapshot: VideoSnapshot, label = describeVideoChange(h.present.snapshot, snapshot)): VideoHistory {
  if (sameSnapshot(h.present.snapshot, snapshot)) return h;
  return { past: [...h.past, h.present].slice(-VIDEO_HISTORY_LIMIT), present: { snapshot, label, at: Date.now() }, future: [] };
}

export function undoVideoHistory(h: VideoHistory): VideoHistory {
  const prev = h.past[h.past.length - 1];
  return prev ? { past: h.past.slice(0, -1), present: prev, future: [h.present, ...h.future] } : h;
}

export function redoVideoHistory(h: VideoHistory): VideoHistory {
  const next = h.future[0];
  return next ? { past: [...h.past, h.present], present: next, future: h.future.slice(1) } : h;
}

/** The video without edits: no drawings, watermark, privacy regions or trim. Chapters are kept. */
export function resetSnapshot(s: VideoSnapshot): VideoSnapshot {
  return { overlays: [], watermark: null, markers: s.markers, regions: [], trim: null };
}

export const canResetSnapshot = (s: VideoSnapshot): boolean => s.overlays.length > 0 || Boolean(s.watermark) || s.regions.length > 0 || Boolean(s.trim);

/** All steps, oldest first; the current one is at index `past.length`. */
export const videoTimeline = (h: VideoHistory): VideoHistoryEntry[] => [...h.past, h.present, ...h.future];

export function jumpVideoHistory(h: VideoHistory, index: number): VideoHistory {
  const all = videoTimeline(h);
  const target = all[index];
  if (!target || index === h.past.length) return h;
  return { past: all.slice(0, index), present: target, future: all.slice(index + 1) };
}
