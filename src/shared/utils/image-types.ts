/**
 * Picture formats Pixora can open. SVG is not supported (vector files are not decoded as pictures
 * in extension pages), so it is not offered in file pickers and is refused when dropped / pasted.
 */
export const IMAGE_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/bmp', 'image/avif'] as const;

/** `accept` for <input type="file">: the types and their extensions (Windows filters by extension). */
export const IMAGE_ACCEPT = [...IMAGE_MIME_TYPES, '.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.avif'].join(',');

export const UNSUPPORTED_IMAGE_MESSAGE = 'Choose a PNG, JPEG, WebP, GIF, BMP or AVIF picture (SVG files are not supported).';

/** True for a picture Pixora can open (by type, or by extension when the type is missing). */
export function isSupportedImage(file: { type: string; name?: string }): boolean {
  const type = file.type.split(';')[0]!.trim().toLowerCase();
  if (type) return (IMAGE_MIME_TYPES as readonly string[]).includes(type) || type === 'image/jpg';
  return /\.(png|jpe?g|webp|gif|bmp|avif)$/i.test(file.name ?? '');
}
