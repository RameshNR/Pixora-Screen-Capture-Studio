import type { PixelRect } from '@/shared/types';
import { delay } from '@/shared/utils/misc';
import { cropBitmap } from './image-stitching';
import { captureVisibleTabRaw, type RawCapture } from './visible-capture';

/**
 * Captures the viewport and crops the user's selection. The overlay removes itself before sending
 * the selection, and we wait a frame so it is never part of the image.
 */
export async function captureArea(
  tab: chrome.tabs.Tab,
  rect: PixelRect,
  viewport: { width: number; height: number },
  scale: 'device' | 'css',
): Promise<RawCapture> {
  await delay(80);
  const bitmap = await captureVisibleTabRaw(tab.windowId);
  try {
    const ratio = bitmap.width / viewport.width;
    const userScale = scale === 'css' && ratio > 1 ? 1 / ratio : 1;
    const canvas = await cropBitmap(bitmap, rect, viewport.width, userScale);
    return { canvas, title: tab.title ?? '', url: tab.url ?? '', notes: [] };
  } finally {
    bitmap.close();
  }
}
