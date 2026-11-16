/** Largest picture accepted from a web address. */
export const MAX_URL_IMAGE_BYTES = 50 * 1024 * 1024;

/**
 * Checks a web address the user typed for a picture: http(s) or a data: image only (no
 * javascript:, file:, chrome: …). Returns the normalised URL or an error message.
 */
export function parseImageUrl(input: string): { url: URL } | { error: string } {
  const text = input.trim();
  if (!text) return { error: 'Type or paste the address of a picture.' };
  if (/^data:/i.test(text)) {
    return /^data:image\/(png|jpe?g|webp|gif|bmp|avif);/i.test(text) ? { url: new URL(text) } : { error: 'That data address is not a picture.' };
  }
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`);
  } catch {
    return { error: 'That is not a web address.' };
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return { error: 'Only http and https addresses can be used.' };
  return { url };
}

/** A file name for a picture from a web address ("photo.jpg", else the site name). */
export function nameFromUrl(url: URL, type: string): string {
  if (url.protocol === 'data:') return `Pasted image.${type.split('/')[1]?.replace('+xml', '') ?? 'png'}`;
  const last = decodeURIComponent(url.pathname.split('/').filter(Boolean).pop() ?? '');
  if (/\.[a-z0-9]{2,5}$/i.test(last)) return last.slice(0, 80);
  return `${url.hostname.replace(/^www\./, '')}.${type.split('/')[1]?.replace('+xml', '') ?? 'png'}`;
}

/**
 * Downloads a picture from a web address to this computer. Chrome asks the user once for access to
 * that one site (Pixora has no access to websites by default); the picture is only read, never
 * sent anywhere.
 */
export async function fetchImageFromUrl(url: URL): Promise<{ blob: Blob; name: string }> {
  if (url.protocol !== 'data:' && chrome.permissions) {
    const origins = [`${url.origin}/*`];
    const has = await chrome.permissions.contains({ origins }).catch(() => false);
    if (!has) {
      const granted = await chrome.permissions.request({ origins }).catch(() => false);
      if (!granted) throw new Error(`Pixora needs your permission to read pictures from ${url.hostname}.`);
    }
  }
  const res = await fetch(url.href, { credentials: 'omit', redirect: 'follow', cache: 'no-store' });
  if (!res.ok) throw new Error(`The site answered ${res.status} ${res.statusText}`.trim());
  const size = Number(res.headers.get('content-length') ?? 0);
  if (size > MAX_URL_IMAGE_BYTES) throw new Error('That picture is larger than 50 MB.');
  const blob = await res.blob();
  if (blob.size > MAX_URL_IMAGE_BYTES) throw new Error('That picture is larger than 50 MB.');
  const type = blob.type.split(';')[0]!.trim();
  if (type === 'image/svg+xml') throw new Error('SVG pictures are not supported. Use a PNG, JPEG, WebP, GIF, BMP or AVIF picture.');
  if (!type.startsWith('image/')) throw new Error('That address is a web page, not a picture. Right-click the picture and choose “Copy image address”.');
  // Make sure it really decodes as a picture.
  const bmp = await createImageBitmap(blob).catch(() => null);
  if (!bmp) throw new Error('That file could not be opened as a picture.');
  bmp.close();
  return { blob, name: nameFromUrl(url, type) };
}
