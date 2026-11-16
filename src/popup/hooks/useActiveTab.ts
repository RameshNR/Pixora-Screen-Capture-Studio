import { useEffect, useState } from 'react';

export interface ActiveTabInfo {
  tab: chrome.tabs.Tab | null;
  /** False on pages Chrome does not let extensions capture or script (chrome://, Web Store, …). */
  capturable: boolean;
  loading: boolean;
}

const RESTRICTED = [/^chrome:\/\//, /^chrome-extension:\/\//, /^edge:\/\//, /^about:/, /^view-source:/, /^devtools:\/\//, /^https:\/\/chromewebstore\.google\.com/, /^https:\/\/chrome\.google\.com\/webstore/];

export function isRestrictedUrl(url: string | undefined): boolean {
  if (!url) return false; // URL hidden → we cannot know; let the capture try and report errors.
  return RESTRICTED.some((r) => r.test(url));
}

export function useActiveTab(): ActiveTabInfo {
  const [info, setInfo] = useState<ActiveTabInfo>({ tab: null, capturable: true, loading: true });
  useEffect(() => {
    void chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
      setInfo({ tab: tab ?? null, capturable: Boolean(tab) && !isRestrictedUrl(tab?.url), loading: false });
    });
  }, []);
  return info;
}
