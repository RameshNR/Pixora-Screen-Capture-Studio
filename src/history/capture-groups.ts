import { createId } from '@/shared/utils/misc';

/** A group in Recent captures: any captures (screenshots, flows, videos) kept together under a name. */
export interface CaptureGroup {
  id: string;
  name: string;
  /** Capture ids, in the order they were added. */
  ids: string[];
  createdAt: number;
}

const KEY = 'pixora.captureGroups';

export async function loadGroups(): Promise<CaptureGroup[]> {
  const got = await chrome.storage.local.get(KEY).catch(() => ({} as Record<string, unknown>));
  const list = (got as Record<string, unknown>)[KEY];
  return Array.isArray(list) ? (list as CaptureGroup[]).filter((g) => g && typeof g.id === 'string' && Array.isArray(g.ids)) : [];
}

export async function saveGroups(groups: CaptureGroup[]): Promise<void> {
  await chrome.storage.local.set({ [KEY]: groups });
}

/** "Group 3": the first free number. */
export function nextGroupName(groups: CaptureGroup[]): string {
  let n = 1;
  while (groups.some((g) => g.name === `Group ${n}`)) n++;
  return `Group ${n}`;
}

export function newGroup(groups: CaptureGroup[], ids: string[] = [], name?: string): CaptureGroup {
  return { id: createId('g_'), name: name ?? nextGroupName(groups), ids: [...new Set(ids)], createdAt: Date.now() };
}

/** Moves captures into a group (out of any other group). */
export function addToGroup(groups: CaptureGroup[], groupId: string, ids: string[]): CaptureGroup[] {
  const moving = new Set(ids);
  return groups.map((g) => (g.id === groupId
    ? { ...g, ids: [...g.ids.filter((x) => !moving.has(x)), ...ids.filter((x) => !g.ids.includes(x) || moving.has(x))].filter((x, i, a) => a.indexOf(x) === i) }
    : { ...g, ids: g.ids.filter((x) => !moving.has(x)) }));
}

/** Takes captures out of every group. */
export function removeFromGroups(groups: CaptureGroup[], ids: string[]): CaptureGroup[] {
  const out = new Set(ids);
  return groups.map((g) => ({ ...g, ids: g.ids.filter((x) => !out.has(x)) }));
}

/** Forgets captures that no longer exist. */
export function pruneGroups(groups: CaptureGroup[], existing: ReadonlySet<string>): CaptureGroup[] {
  return groups.map((g) => ({ ...g, ids: g.ids.filter((x) => existing.has(x)) }));
}
