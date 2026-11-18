import { blobToDataUrl } from '@/shared/utils/misc';

/** Generates a small JPEG data URL from a video blob (first meaningful frame). DOM contexts only. */
export async function generateVideoThumbnail(blob: Blob, maxWidth = 360, timeoutMs = 6000): Promise<string | undefined> {
  const url = URL.createObjectURL(blob);
  const video = document.createElement('video');
  video.muted = true;
  video.preload = 'auto';
  video.playsInline = true;
  video.src = url;
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('thumbnail timeout')), timeoutMs);
      video.onloadeddata = () => {
        // Seek slightly in to skip a possible black first frame.
        const target = Number.isFinite(video.duration) ? Math.min(0.5, video.duration / 2) : 0.2;
        video.onseeked = () => { clearTimeout(timer); resolve(); };
        video.currentTime = target;
      };
      video.onerror = () => { clearTimeout(timer); reject(new Error('video decode failed')); };
    });
    const scale = Math.min(1, maxWidth / (video.videoWidth || maxWidth));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round((video.videoWidth || 16) * scale));
    canvas.height = Math.max(1, Math.round((video.videoHeight || 9) * scale));
    canvas.getContext('2d')?.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.75);
  } catch {
    return undefined;
  } finally {
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(url);
  }
}

/** Thumbnail from any image blob. Works in documents and workers (OffscreenCanvas). */
export async function generateImageThumbnail(source: Blob | OffscreenCanvas | ImageBitmap, maxWidth = 360): Promise<string | undefined> {
  try {
    // A canvas or bitmap is drawn directly; only a Blob needs decoding first.
    const owned = source instanceof Blob;
    const bitmap = owned ? await createImageBitmap(source) : source;
    const scale = Math.min(1, maxWidth / bitmap.width);
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(Math.min(bitmap.height * scale, maxWidth * 1.5)));
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext('2d');
    if (!ctx) return undefined;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(bitmap, 0, 0, bitmap.width, h / scale, 0, 0, w, h);
    if (owned) (bitmap as ImageBitmap).close();
    const out = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.75 });
    return blobToDataUrl(out);
  } catch {
    return undefined;
  }
}
