export function createId(prefix = ''): string {
  const random = crypto.getRandomValues(new Uint32Array(2));
  return `${prefix}${Date.now().toString(36)}${random[0]!.toString(36)}${random[1]!.toString(36)}`;
}

export const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Deep-merges `patch` into `base`, only keeping keys that exist in `base` (schema-safe). */
export function mergeDeep<T>(base: T, patch: unknown): T {
  if (!isPlainObject(base) || !isPlainObject(patch)) return base;
  const out: Record<string, unknown> = { ...base };
  for (const key of Object.keys(base)) {
    if (!(key in patch)) continue;
    const baseVal = (base as Record<string, unknown>)[key];
    const patchVal = patch[key];
    if (isPlainObject(baseVal)) {
      out[key] = mergeDeep(baseVal, patchVal);
    } else if (patchVal !== undefined && (baseVal === null || typeof patchVal === typeof baseVal)) {
      out[key] = patchVal;
    }
  }
  return out as T;
}

export async function blobToDataUrl(blob: Blob): Promise<string> {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < buf.length; i += chunk) {
    binary += String.fromCharCode(...buf.subarray(i, i + chunk));
  }
  return `data:${blob.type || 'application/octet-stream'};base64,${btoa(binary)}`;
}

export async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  const res = await fetch(dataUrl);
  return res.blob();
}

export function withTimeout<T>(promise: Promise<T>, ms: number, onTimeout: () => Error): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(onTimeout()), ms);
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e: unknown) => { clearTimeout(timer); reject(e); },
    );
  });
}
