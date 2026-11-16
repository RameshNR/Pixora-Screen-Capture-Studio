/**
 * The offscreen document hosts tab recordings (MediaRecorder is unavailable in service workers)
 * and creates blob: URLs for downloads started by the service worker.
 */
const OFFSCREEN_URL = 'offscreen.html';
let creating: Promise<void> | null = null;

export async function hasOffscreenDocument(): Promise<boolean> {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
    documentUrls: [chrome.runtime.getURL(OFFSCREEN_URL)],
  });
  return contexts.length > 0;
}

export async function ensureOffscreenDocument(): Promise<void> {
  if (await hasOffscreenDocument()) return;
  if (!creating) {
    creating = chrome.offscreen
      .createDocument({
        url: OFFSCREEN_URL,
        reasons: [chrome.offscreen.Reason.USER_MEDIA, chrome.offscreen.Reason.BLOBS],
        justification: 'Record browser tabs with MediaRecorder and prepare captured files for download.',
      })
      .catch((err: unknown) => {
        // A concurrent caller may have created it first.
        if (!String(err).includes('Only a single offscreen')) throw err;
      })
      .finally(() => {
        creating = null;
      });
  }
  await creating;
}

export async function closeOffscreenDocument(): Promise<void> {
  if (await hasOffscreenDocument()) await chrome.offscreen.closeDocument().catch(() => undefined);
}
