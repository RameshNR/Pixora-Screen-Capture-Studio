import type { CaptureRecord, FlowCaptureMode, FlowDoc, FlowItem, FlowStep } from '@/shared/types';
import { DEFAULT_SETTINGS } from '@/shared/constants/defaults';
import { createId } from '@/shared/utils/misc';
import { getOne, promisify, putOne, withStores } from '@/shared/storage/idb';
import { addCapture, getCaptureBlob, updateCapture } from '@/history/history-service';
import { generateImageThumbnail } from '@/recording/services/thumbnail';
import { averageHash } from './flow-engine';

/**
 * Flow persistence shared by the service worker and extension pages. A flow is a FlowDoc in the
 * `flows` store; each of its images is an ordinary screenshot capture (with `flowId`), so the
 * existing editor, export and storage code work on it unchanged.
 */

export async function getFlow(id: string): Promise<FlowDoc | undefined> {
  return getOne<FlowDoc>('flows', id);
}

export async function putFlow(doc: FlowDoc): Promise<void> {
  await putOne('flows', doc);
}

/** Read-modify-write of a flow inside one transaction (safe against concurrent updates). */
export async function updateFlow(id: string, fn: (doc: FlowDoc) => FlowDoc): Promise<FlowDoc> {
  return withStores('flows', 'readwrite', async (tx) => {
    const store = tx.objectStore('flows');
    const doc = await promisify(store.get(id) as IDBRequest<FlowDoc | undefined>);
    if (!doc) throw new Error(`Flow ${id} not found`);
    const next = fn(doc);
    store.put(next);
    return next;
  });
}

/** 8×8 average hash of an image (for skipping unchanged screens). */
export async function imageHash(source: ImageBitmap | OffscreenCanvas): Promise<string> {
  const c = new OffscreenCanvas(8, 8);
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(source, 0, 0, 8, 8);
  const d = ctx.getImageData(0, 0, 8, 8).data;
  const gray: number[] = [];
  for (let i = 0; i < d.length; i += 4) gray.push(0.299 * d[i]! + 0.587 * d[i + 1]! + 0.114 * d[i + 2]!);
  return averageHash(gray);
}

/**
 * Fingerprint of the picture itself: SHA-256 of the image scaled to at most 480 px wide, in grey
 * levels reduced to 32 steps. Identical screens (re-captured, re-encoded) give the same value;
 * any visible change (typed text, a new row, another page) gives a different one.
 */
export async function imageDigest(source: Blob | ImageBitmap | OffscreenCanvas): Promise<string> {
  const bmp = source instanceof Blob ? await createImageBitmap(source) : source;
  try {
    const scale = Math.min(1, 480 / bmp.width);
    const w = Math.max(1, Math.round(bmp.width * scale));
    const h = Math.max(1, Math.round(bmp.height * scale));
    const c = new OffscreenCanvas(w, h);
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(bmp, 0, 0, w, h);
    const d = ctx.getImageData(0, 0, w, h).data;
    const q = new Uint8Array(w * h + 8);
    for (let i = 0, j = 0; i < d.length; i += 4, j++) q[j] = (0.299 * d[i]! + 0.587 * d[i + 1]! + 0.114 * d[i + 2]!) >> 3;
    // Size is part of the fingerprint.
    new DataView(q.buffer).setUint32(w * h, bmp.width);
    new DataView(q.buffer).setUint32(w * h + 4, bmp.height);
    const sum = new Uint8Array(await crypto.subtle.digest('SHA-256', q));
    return Array.from(sum.subarray(0, 16), (b) => b.toString(16).padStart(2, '0')).join('');
  } finally {
    if (source instanceof Blob) (bmp as ImageBitmap).close();
  }
}

/** Index of an image in `items` that shows exactly the same picture, or -1. */
export function findDuplicate(items: FlowItem[], digest: string | undefined, exceptId?: string): number {
  if (!digest) return -1;
  return items.findIndex((i) => i.id !== exceptId && i.digest === digest);
}

/** Moves images to the flow's "Deleted" list (restorable). */
export async function softDeleteFlowImages(flowId: string, ids: string[]): Promise<FlowDoc> {
  const now = Date.now();
  return updateFlow(flowId, (d) => {
    // Each image takes its own workflow steps with it.
    const stepsOf = (id: string) => d.steps.map((s, index) => ({ ...s, index })).filter((s) => s.itemId === id);
    const removed = d.items
      .map((it, index) => ({ it, index }))
      .filter(({ it }) => ids.includes(it.id))
      .map(({ it, index }) => ({ ...it, deletedAt: now, index, steps: stepsOf(it.id) }));
    return {
      ...d,
      items: d.items.filter((i) => !ids.includes(i.id)),
      steps: d.steps.filter((s) => !(s.itemId && ids.includes(s.itemId))),
      deleted: [...(d.deleted ?? []), ...removed],
    };
  });
}

/** Puts deleted images back at (or near) their old positions. */
export async function restoreFlowImages(flowId: string, ids: string[]): Promise<FlowDoc> {
  return updateFlow(flowId, (d) => {
    const back = (d.deleted ?? []).filter((x) => ids.includes(x.id)).sort((a, b) => a.index - b.index);
    const items = [...d.items];
    const steps = [...d.steps];
    const returning = back.flatMap((b) => b.steps ?? []).sort((a, b) => a.index - b.index);
    for (const { deletedAt: _t, index, steps: _s, ...item } of back) items.splice(Math.min(index, items.length), 0, item);
    // Steps go back to their old places in the workflow.
    for (const { index, ...step } of returning) steps.splice(Math.min(index, steps.length), 0, step);
    return { ...d, items, steps, deleted: (d.deleted ?? []).filter((x) => !ids.includes(x.id)) };
  });
}

/** Deletes images from the "Deleted" list for good (files included). */
export async function purgeFlowImages(flowId: string, ids: string[]): Promise<FlowDoc> {
  const doc = await updateFlow(flowId, (d) => ({
    ...d,
    deleted: (d.deleted ?? []).filter((x) => !ids.includes(x.id)),
    steps: d.steps.map((s) => (s.itemId && ids.includes(s.itemId) ? { ...s, itemId: undefined } : s)),
  }));
  await withStores(['captures', 'blobs'], 'readwrite', (tx) => {
    for (const id of ids) {
      tx.objectStore('captures').delete(id);
      tx.objectStore('blobs').delete(id);
      tx.objectStore('blobs').delete(`orig:${id}`);
    }
  });
  return doc;
}

export interface NewFlowImage {
  blob: Blob;
  width: number;
  height: number;
  mode: FlowCaptureMode;
  auto: boolean;
  url: string;
  pageTitle: string;
  description?: string;
  point?: FlowItem['point'];
  highlight?: FlowItem['highlight'];
  hash?: string;
  digest?: string;
  /** File name (an added picture keeps its own; captures are "Flow step 03.png"). */
  name?: string;
}

/** Stores an image as a screenshot capture belonging to the flow and returns its flow item. */
export async function storeFlowImage(flowId: string, seq: number, img: NewFlowImage): Promise<FlowItem> {
  const record = await addCapture(
    {
      kind: 'screenshot',
      flowId,
      name: img.name || `Flow step ${String(seq).padStart(2, '0')}.png`,
      mimeType: img.blob.type || 'image/png',
      width: img.width,
      height: img.height,
      thumbnail: await generateImageThumbnail(img.blob),
      sourceTitle: img.pageTitle,
      sourceUrl: img.url,
    },
    img.blob,
  );
  return {
    id: record.id,
    mode: img.mode,
    auto: img.auto,
    at: record.createdAt,
    url: img.url,
    pageTitle: img.pageTitle,
    width: img.width,
    height: img.height,
    description: img.description ?? '',
    ...(img.point ? { point: img.point } : {}),
    ...(img.highlight ? { highlight: img.highlight } : {}),
    ...(img.hash ? { hash: img.hash } : {}),
    digest: img.digest ?? (await imageDigest(img.blob).catch(() => undefined)),
  };
}

/** Keeps the untouched capture under `orig:<id>` before the first edit is saved. */
export async function keepOriginal(id: string): Promise<void> {
  const original = await getOne<Blob>('blobs', `orig:${id}`);
  if (original) return;
  const current = await getCaptureBlob(id);
  if (current) await putOne('blobs', current, `orig:${id}`);
}

/** Saves an edited version of a flow image (the original is kept). */
export async function saveEditedImage(id: string, blob: Blob, width: number, height: number): Promise<CaptureRecord> {
  await keepOriginal(id);
  return updateCapture(id, { width, height, edited: true, mimeType: 'image/png', thumbnail: await generateImageThumbnail(blob) }, blob);
}

/** The untouched capture (the current image when it was never edited). */
export async function getOriginalImage(id: string): Promise<Blob | undefined> {
  return (await getOne<Blob>('blobs', `orig:${id}`)) ?? getCaptureBlob(id);
}

/** Brings back the original image (the edited version is replaced; undo in the editor still works). */
export async function restoreOriginalImage(id: string): Promise<CaptureRecord | undefined> {
  const original = await getOne<Blob>('blobs', `orig:${id}`);
  if (!original) return undefined;
  const bmp = await createImageBitmap(original);
  const rec = await updateCapture(id, { width: bmp.width, height: bmp.height, edited: false, thumbnail: await generateImageThumbnail(original) }, original);
  bmp.close();
  return rec;
}

/** Copies an image (with a new id) right after the original in the flow. */
export async function duplicateFlowImage(flowId: string, itemId: string): Promise<FlowDoc> {
  const flow = await getFlow(flowId);
  const item = flow?.items.find((i) => i.id === itemId);
  const blob = await getCaptureBlob(itemId);
  if (!flow || !item || !blob) throw new Error('Image not found');
  const copy = await storeFlowImage(flowId, flow.items.length + 1, { ...item, blob, description: item.description ? `${item.description} (copy)` : '' });
  return updateFlow(flowId, (d) => {
    const i = d.items.findIndex((x) => x.id === itemId);
    const items = [...d.items];
    items.splice(i + 1, 0, copy);
    return { ...d, items };
  });
}

/** Video time (ms) of a flow image: from its first step that has one. */
export function itemVideoMs(doc: FlowDoc, itemId: string): number | null {
  const ms = doc.steps.find((st) => st.itemId === itemId && typeof st.videoMs === 'number')?.videoMs;
  return typeof ms === 'number' ? ms : null;
}

/**
 * Adds a video frame to the flow recorded with that video, in time order among the recorded steps
 * (the image goes before the first image that comes later in the video; its step likewise).
 */
export async function insertVideoFrame(flowId: string, frame: { blob: Blob; width: number; height: number; videoMs: number; description: string; digest?: string; pageTitle?: string }): Promise<{ doc: FlowDoc; item: FlowItem }> {
  const current = await getFlow(flowId);
  if (!current) throw new Error('Flow not found');
  const item = await storeFlowImage(flowId, current.items.length + 1, {
    blob: frame.blob, width: frame.width, height: frame.height, mode: 'visible', auto: false, url: '', pageTitle: frame.pageTitle ?? '', description: frame.description, ...(frame.digest ? { digest: frame.digest } : {}),
  });
  const doc = await updateFlow(flowId, (d) => {
    const later = d.items.findIndex((it) => (itemVideoMs(d, it.id) ?? -1) > frame.videoMs);
    const items = [...d.items];
    items.splice(later < 0 ? items.length : later, 0, item);
    const step: FlowStep = { id: createId('s_'), action: 'note', title: frame.description || 'Video frame', url: '', pageTitle: frame.pageTitle ?? '', at: Date.now(), elapsedMs: frame.videoMs, videoMs: frame.videoMs, itemId: item.id };
    const laterStep = d.steps.findIndex((st) => typeof st.videoMs === 'number' && st.videoMs > frame.videoMs);
    const steps = [...d.steps];
    steps.splice(laterStep < 0 ? steps.length : laterStep, 0, step);
    return { ...d, items, steps };
  });
  return { doc, item };
}

export interface FlowFromImagesInput {
  name: string;
  images: Array<{ blob: Blob; width: number; height: number; description: string; videoMs?: number }>;
  /** The video the frames come from. */
  recordingId?: string;
  sourceTitle?: string;
}

/**
 * Creates a finished flow from images chosen by hand (e.g. video frames): the flow document, one
 * image capture per frame, a step per frame (with its video time) and the flow entry shown in
 * Recent captures. Returns the flow id.
 */
export async function createFlowFromImages(input: FlowFromImagesInput): Promise<string> {
  const id = createId('f_');
  const now = Date.now();
  await putFlow({ id, name: input.name, config: { ...DEFAULT_SETTINGS.flow, area: null }, items: [], steps: [], startedAt: now, endedAt: now, ...(input.recordingId ? { recordingId: input.recordingId } : {}) });
  const items: FlowItem[] = [];
  const steps: FlowStep[] = [];
  let size = 0;
  for (const [i, img] of input.images.entries()) {
    const item = await storeFlowImage(id, i + 1, { blob: img.blob, width: img.width, height: img.height, mode: 'visible', auto: false, url: '', pageTitle: input.sourceTitle ?? '', description: img.description });
    items.push(item);
    size += img.blob.size;
    steps.push({ id: createId('s_'), action: 'note', title: img.description || `Frame ${i + 1}`, url: '', pageTitle: input.sourceTitle ?? '', at: now, elapsedMs: img.videoMs ?? 0, itemId: item.id, ...(img.videoMs !== undefined ? { videoMs: img.videoMs } : {}) });
  }
  await updateFlow(id, (d) => ({ ...d, items, steps }));
  const first = input.images[0];
  const summary = new Blob([JSON.stringify({ items: items.length, steps: steps.length })], { type: 'application/json' });
  await addCapture(
    {
      id,
      kind: 'flow',
      name: input.name,
      mimeType: 'application/vnd.glint.flow+json',
      width: first?.width ?? 0,
      height: first?.height ?? 0,
      thumbnail: first ? await generateImageThumbnail(first.blob) : undefined,
      sourceTitle: `${items.length} image${items.length === 1 ? '' : 's'} · from a video`,
    },
    summary,
  );
  await updateCapture(id, { size: size + summary.size }).catch(() => undefined);
  return id;
}

/**
 * Puts images and flows together into one flow (Recent captures: Make flow, drag and drop; editor:
 * several images added at once). Nothing is copied: the image captures join the flow (`flowId`),
 * a flow dropped in gives up its images and its own entry. Videos are left out.
 * `into`: an existing flow to add to; otherwise a new flow is made. Returns the flow id.
 */
export async function groupIntoFlow(ids: string[], opts: { into?: string; name?: string } = {}): Promise<string> {
  const records = (await Promise.all(ids.map((id) => getOne<CaptureRecord>('captures', id)))).filter((r): r is CaptureRecord => !!r && r.kind !== 'video' && r.id !== opts.into);
  const items: FlowItem[] = [];
  const steps: FlowStep[] = [];
  const deleted: NonNullable<FlowDoc['deleted']> = [];
  const absorbed: string[] = [];
  const now = Date.now();
  for (const r of records) {
    if (r.kind === 'flow') {
      const doc = await getFlow(r.id);
      if (!doc) continue;
      items.push(...doc.items);
      steps.push(...doc.steps);
      deleted.push(...(doc.deleted ?? []));
      absorbed.push(r.id);
    } else if (!r.flowId) {
      const item: FlowItem = { id: r.id, mode: 'visible', auto: false, at: r.createdAt, url: r.sourceUrl ?? '', pageTitle: r.sourceTitle ?? '', width: r.width, height: r.height, description: '' };
      items.push(item);
      steps.push({ id: createId('s_'), action: 'note', title: r.name.replace(/\.[a-z0-9]+$/i, ''), url: item.url, pageTitle: item.pageTitle, at: r.createdAt, elapsedMs: 0, itemId: r.id });
    }
  }
  let flowId = opts.into;
  if (!flowId) {
    if (!items.length) throw new Error('Nothing to put into a flow: choose images or flows (not videos).');
    flowId = createId('f_');
    const name = opts.name ?? flowDateName(now);
    await putFlow({ id: flowId, name, config: { ...DEFAULT_SETTINGS.flow, area: null }, items: [], steps: [], startedAt: now, endedAt: now });
    const first = records[0]!;
    const summary = new Blob([JSON.stringify({ items: items.length })], { type: 'application/json' });
    await addCapture({ id: flowId, kind: 'flow', name, mimeType: 'application/vnd.glint.flow+json', width: items[0]!.width, height: items[0]!.height, thumbnail: first.thumbnail, sourceTitle: '' }, summary);
  }
  const target = flowId;
  const doc = await updateFlow(target, (d) => ({ ...d, items: [...d.items, ...items], steps: [...d.steps, ...steps], ...(deleted.length ? { deleted: [...(d.deleted ?? []), ...deleted] } : {}) }));
  // The images join the flow; flows dropped in lose their own entry (not their images).
  await withStores(['captures', 'blobs', 'flows'], 'readwrite', async (tx) => {
    const caps = tx.objectStore('captures');
    for (const it of [...items, ...deleted]) {
      const rec = await promisify(caps.get(it.id) as IDBRequest<CaptureRecord | undefined>);
      if (rec) caps.put({ ...rec, flowId: target, updatedAt: now });
    }
    for (const id of absorbed) {
      caps.delete(id);
      tx.objectStore('blobs').delete(id);
      tx.objectStore('flows').delete(id);
    }
  });
  // The flow entry: image count, size, first picture.
  const recs = await Promise.all(doc.items.map((it) => getOne<CaptureRecord>('captures', it.id)));
  const size = recs.reduce((n, r) => n + (r?.size ?? 0), 0);
  const firstRec = recs.find((r) => r?.thumbnail);
  const count = `${doc.items.length} image${doc.items.length === 1 ? '' : 's'}`;
  const old = (await getOne<CaptureRecord>('captures', target))?.sourceTitle ?? '';
  // "3 images · 5 steps" → "6 images · 5 steps" (the rest of the subtitle is kept).
  const sourceTitle = /^\d+ images?/.test(old) ? old.replace(/^\d+ images?/, count) : count;
  const flowName = (await getFlow(target))?.name ?? '';
  // An old count name ("Flow · 2 images") is replaced by the date name (a count would go stale again).
  const rename = COUNT_NAME.test(flowName) ? flowDateName((await getOne<CaptureRecord>('captures', target))?.createdAt ?? now) : null;
  if (rename) await updateFlow(target, (d) => ({ ...d, name: rename }));
  await updateCapture(target, { size, sourceTitle, ...(rename ? { name: rename } : {}), ...(firstRec ? { thumbnail: firstRec.thumbnail, width: firstRec.width, height: firstRec.height } : {}) });
  return target;
}

/** "Flow · 2 images": a name made from a count (which goes stale as images are added). */
export const COUNT_NAME = /^Flow · \d+ images?$/;
/** The name new flows get: "Flow · Nov 23, 2026, 10:28 AM". */
export function flowDateName(at: number): string {
  return `Flow · ${new Date(at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}`;
}

/**
 * Flows named by an old count ("Flow · 2 images" while it has 15) are renamed by their date, like
 * new flows. Names typed by the user are left alone. Returns the renamed records.
 */
export async function renameCountNamedFlows(records: CaptureRecord[]): Promise<CaptureRecord[]> {
  const stale = records.filter((r) => r.kind === 'flow' && COUNT_NAME.test(r.name));
  const out: CaptureRecord[] = [];
  for (const r of stale) {
    const name = flowDateName(r.createdAt);
    await updateFlow(r.id, (d) => ({ ...d, name })).catch(() => undefined);
    out.push(await updateCapture(r.id, { name }));
  }
  return out;
}
