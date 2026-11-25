import { deleteOne, getOne, putOne } from '@/shared/storage/idb';
import type { CaptureRecord } from '@/shared/types';
import type { Annotation, EditorDoc } from '../types';

/**
 * The editable state of an image (its drawings, frame, watermark, filters…), kept in the database
 * under `work:<id>` while it is edited, so a reload (or a crash) of the editor page brings the
 * annotations back as objects that can still be moved and changed (saving an image only stores the
 * flattened picture).
 *
 * A draft belongs to the stored picture it was made on: `stamps` lists the pictures (size and
 * dimensions) it is valid for — the one it was opened from and the flattened versions saved from it.
 * When the picture was changed elsewhere (restored, framed by "Apply to all"), the draft is dropped.
 */
interface StoredDraft {
  v: 1;
  stamps: string[];
  base: Blob;
  width: number;
  height: number;
  annotations: Array<Annotation | (Omit<Annotation, 'bitmap'> & { bitmap: Blob })>;
  watermark: EditorDoc['watermark'];
  frame: EditorDoc['frame'];
  filters: EditorDoc['filters'] | null;
}

const key = (id: string) => `work:${id}`;

export function stampOf(record: Pick<CaptureRecord, 'size' | 'width' | 'height'>): string {
  return `${record.size}:${record.width}x${record.height}`;
}

/** Pictures already encoded (the opened picture's own file, or a crop / rotation made later). */
const encoded = new WeakMap<ImageBitmap, Promise<Blob>>();

/** The file a bitmap was decoded from (saved as is, no encoding). */
export function rememberFile(bitmap: ImageBitmap, blob: Blob): void {
  encoded.set(bitmap, Promise.resolve(blob));
}

function fileOf(bitmap: ImageBitmap): Promise<Blob> {
  let p = encoded.get(bitmap);
  if (!p) {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0);
    p = canvas.convertToBlob({ type: 'image/png' });
    encoded.set(bitmap, p);
  }
  return p;
}

type StoredAnnotation = StoredDraft['annotations'][number];

/** Annotations ready for the database (pictures as files). */
export function storeAnnotations(list: readonly Annotation[]): Promise<StoredAnnotation[]> {
  return Promise.all(list.map(async (a) => (a.type === 'image' ? { ...a, bitmap: await fileOf(a.bitmap) } : a)));
}

/** Annotations from the database (files back to pictures). */
export function restoreAnnotations(list: readonly StoredAnnotation[]): Promise<Annotation[]> {
  return Promise.all(
    list.map(async (a) => {
      if (a.type !== 'image' || !(a.bitmap instanceof Blob)) return a as Annotation;
      const bitmap = await createImageBitmap(a.bitmap);
      rememberFile(bitmap, a.bitmap);
      return { ...a, bitmap } as Annotation;
    }),
  );
}

/** Saves the editable state of image `id`, valid for the stored pictures `stamps` (added to the ones it had). */
export async function saveDraft(id: string, doc: EditorDoc, stamps: string[]): Promise<void> {
  const [base, annotations, old] = await Promise.all([
    fileOf(doc.base),
    Promise.all(doc.annotations.map(async (a) => (a.type === 'image' ? { ...a, bitmap: await fileOf(a.bitmap) } : a))),
    getOne<StoredDraft>('blobs', key(id)).catch(() => undefined),
  ]);
  const draft: StoredDraft = {
    v: 1,
    stamps: [...new Set([...(old?.stamps ?? []), ...stamps])].slice(-8),
    base,
    width: doc.width,
    height: doc.height,
    annotations,
    watermark: doc.watermark,
    frame: doc.frame,
    filters: doc.filters ?? null,
  };
  await putOne('blobs', draft, key(id));
}

export async function clearDraft(id: string): Promise<void> {
  await deleteOne('blobs', key(id));
}

/**
 * The image as it was left (its drawings editable), and the plain picture under them (Undo goes back
 * to it). Null when there is no draft for the picture stored now.
 */
export async function loadDraft(record: Pick<CaptureRecord, 'id' | 'size' | 'width' | 'height'>): Promise<{ plain: EditorDoc; doc: EditorDoc } | null> {
  const d = await getOne<StoredDraft>('blobs', key(record.id)).catch(() => undefined);
  if (!d || d.v !== 1) return null;
  if (!d.stamps.includes(stampOf(record))) {
    await clearDraft(record.id).catch(() => undefined);
    return null;
  }
  const base = await createImageBitmap(d.base);
  rememberFile(base, d.base);
  const annotations = await Promise.all(
    d.annotations.map(async (a) => {
      if (a.type !== 'image' || !(a.bitmap instanceof Blob)) return a as Annotation;
      const bitmap = await createImageBitmap(a.bitmap);
      rememberFile(bitmap, a.bitmap);
      return { ...a, bitmap } as Annotation;
    }),
  );
  const plain: EditorDoc = { base, width: d.width, height: d.height, annotations: [], watermark: null, frame: null };
  const doc: EditorDoc = { ...plain, annotations, watermark: d.watermark, frame: d.frame, ...(d.filters ? { filters: d.filters } : {}) };
  const empty = !annotations.length && !d.watermark && !d.frame && !d.filters;
  return empty ? null : { plain, doc };
}
