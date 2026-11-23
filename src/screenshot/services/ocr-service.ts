import { AppError } from '@/shared/utils/errors';

export interface OcrResult {
  text: string;
  confidence: number;
}

/**
 * On-device OCR with Tesseract (WASM). The worker, core and English model are bundled under /ocr,
 * so no code is fetched remotely and images never leave the device. Loaded lazily on first use.
 */
export async function recognizeText(image: Blob, onProgress?: (p: number, status: string) => void): Promise<OcrResult> {
  const { createWorker } = await import('tesseract.js');
  const base = chrome.runtime.getURL('ocr/');
  let worker: Awaited<ReturnType<typeof createWorker>> | null = null;
  try {
    worker = await createWorker('eng', 1, {
      workerPath: `${base}worker.min.js`,
      corePath: base,
      langPath: base,
      workerBlobURL: false,
      gzip: true,
      cacheMethod: 'none',
      logger: (m: { status: string; progress: number }) => onProgress?.(m.progress, m.status),
    });
    await quietOcr(worker as never);
    const { data } = await worker.recognize(image);
    return { text: normalizeOcrText(data.text), confidence: data.confidence };
  } catch (err) {
    throw new AppError('ocr-failed', String(err));
  } finally {
    await worker?.terminate().catch(() => undefined);
  }
}

/**
 * Screenshots carry no DPI, so Tesseract estimates one and prints "Estimating resolution as …",
 * which Chrome lists on the extension's Errors page. Its notes are sent nowhere instead; the
 * estimate itself (and so the text read) is unchanged.
 */
export async function quietOcr(worker: { setParameters: (p: Record<string, string>) => Promise<unknown> }): Promise<void> {
  await worker.setParameters({ debug_file: '/dev/null' }).catch(() => undefined);
}

/** Keeps line breaks, collapses runs of blank lines and trailing spaces. */
export function normalizeOcrText(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => l.replace(/[ \t]+$/g, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
