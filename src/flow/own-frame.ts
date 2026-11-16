import type { Frame } from '@/editor/types';
import type { FlowItem } from '@/shared/types';

/**
 * The frame for one page of a flow when a frame is applied to every image: a browser window shows
 * that page's own address and tab title (not the ones of the image it was designed on).
 */
export function ownFrame(frame: Frame | null, item: Pick<FlowItem, 'url' | 'pageTitle' | 'description'>): Frame | null {
  if (!frame?.browser) return frame;
  return { ...frame, browser: { ...frame.browser, url: item.url || '', title: item.pageTitle || item.description || '' } };
}
