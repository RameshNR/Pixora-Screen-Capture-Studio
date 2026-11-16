import type { ContentMessage } from '@/shared/messaging/messages';
import { sendToTab } from '@/shared/messaging/client';
import { AppError, toAppError } from '@/shared/utils/errors';

/**
 * Injects the overlay content script on demand (activeTab + scripting). Nothing is injected into
 * pages unless the user starts an action that needs it.
 */
export async function injectOverlay(tabId: number): Promise<void> {
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content/overlay.js'] });
  } catch (err) {
    throw new AppError(toAppError(err).code === 'tab-closed' ? 'tab-closed' : 'restricted-page', String(err));
  }
}

export async function sendOverlay(tabId: number, message: ContentMessage): Promise<void> {
  await sendToTab(tabId, message);
}

/** Best effort: the tab may be gone or navigated. */
export function sendOverlaySafe(tabId: number | null, message: ContentMessage): void {
  if (tabId === null) return;
  sendToTab(tabId, message).catch(() => undefined);
}
