import { getOne, putOne } from '@/shared/storage/idb';
import type { Annotation } from '../types';
import { getBounds, translate } from '../tools/annotations';
import { restoreAnnotations, storeAnnotations } from './drafts';

/**
 * Copied annotations, shared by every image: copy on one image, switch to another (or to another
 * Pixora tab: screenshot editor, Flow Editor) and paste there. Kept in the database too, so other
 * tabs see it.
 *
 * `one`: a single copied object (Ctrl+C on a selection); `many`: several objects copied together.
 * On another image they are pasted where they were (moved inside the picture when it is smaller).
 */
interface Clip {
  one: Annotation | null;
  many: Annotation[];
  /** The image they were copied on (or last pasted on). */
  from: string | null;
  at: number;
}

const KEY = 'clip:annotations';
const PASTE_STEP = 24;

const clip: Clip = { one: null, many: [], from: null, at: 0 };
/** The image open in this page's editor. */
let image: { id: string; width: number; height: number } | null = null;
let saveTimer: ReturnType<typeof setTimeout> | undefined;

function changed(): void {
  clip.at = Date.now();
  clip.from = image?.id ?? clip.from;
  clearTimeout(saveTimer);
  const snapshot = { ...clip, many: [...clip.many] };
  saveTimer = setTimeout(() => {
    void (async () => {
      const [one, many] = await Promise.all([snapshot.one ? storeAnnotations([snapshot.one]) : Promise.resolve([]), storeAnnotations(snapshot.many)]);
      await putOne('blobs', { at: snapshot.at, from: snapshot.from, one: one[0] ?? null, many }, KEY);
    })().catch(() => undefined);
  }, 250);
}

/** The single copied object (read / write like a ref). */
export const clipOne = {
  get current(): Annotation | null {
    return clip.one;
  },
  set current(a: Annotation | null) {
    clip.one = a;
    changed();
  },
};

/** Several objects copied together (read / write like a ref). */
export const clipMany = {
  get current(): Annotation[] {
    return clip.many;
  },
  set current(list: Annotation[]) {
    clip.many = list;
    changed();
  },
};

export function hasClip(): boolean {
  return Boolean(clip.one) || clip.many.length > 0;
}

/** Moves objects so the group lies inside a `w` × `h` picture (when it can). */
function fitInside(list: Annotation[], w: number, h: number): Annotation[] {
  if (!list.length) return list;
  const boxes = list.map((a) => getBounds(a));
  const x0 = Math.min(...boxes.map((b) => b.x));
  const y0 = Math.min(...boxes.map((b) => b.y));
  const x1 = Math.max(...boxes.map((b) => b.x + b.w));
  const y1 = Math.max(...boxes.map((b) => b.y + b.h));
  const dx = x1 > w ? Math.max(-x0, w - x1) : x0 < 0 ? -x0 : 0;
  const dy = y1 > h ? Math.max(-y0, h - y1) : y0 < 0 ? -y0 : 0;
  return dx || dy ? list.map((a) => translate(a, dx, dy)) : list;
}

/**
 * The editor shows image `id` now: what was copied on another image is pasted there in the same
 * place (pastes step 24 px from the copy; this sets them up so the first lands exactly in place).
 */
export function clipForImage(id: string, width: number, height: number): void {
  image = { id, width, height };
  if (!hasClip() || clip.from === id) return;
  if (clip.one) clip.one = translate(fitInside([clip.one], width, height)[0]!, -PASTE_STEP, -PASTE_STEP);
  clip.many = fitInside(clip.many, width, height).map((a) => translate(a, -PASTE_STEP, -PASTE_STEP));
  clip.from = id;
}

/** Takes objects copied in another Pixora tab (when newer than ours). True when there is something to paste. */
export async function refreshClip(): Promise<boolean> {
  try {
    const s = await getOne<{ at: number; from: string | null; one: unknown; many: unknown[] }>('blobs', KEY);
    if (s && s.at > clip.at) {
      const [one, many] = await Promise.all([
        s.one ? restoreAnnotations([s.one as never]) : Promise.resolve([]),
        restoreAnnotations(s.many as never[]),
      ]);
      clip.one = one[0] ?? null;
      clip.many = many;
      clip.from = s.from;
      clip.at = s.at;
      if (image) clipForImage(image.id, image.width, image.height);
    }
  } catch {
    /* keep what this page has */
  }
  return hasClip();
}
