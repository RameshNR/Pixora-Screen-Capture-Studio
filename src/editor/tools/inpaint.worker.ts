import { inpaint } from './inpaint';

/** Runs the fill away from the page, so the editor stays responsive while it works. */
type Job = { id: number; data: Uint8ClampedArray; w: number; h: number; hole: Uint8Array };

self.onmessage = (e: MessageEvent<Job>) => {
  const { id, data, w, h, hole } = e.data;
  try {
    const out = inpaint(data, w, h, hole, { onProgress: (progress) => self.postMessage({ id, progress }) });
    (self as unknown as Worker).postMessage({ id, out }, [out.buffer]);
  } catch (err) {
    self.postMessage({ id, error: String(err) });
  }
};
