import { useEffect, useState } from 'react';
import { formatKeys } from '@/shared/utils/keys';

/** The default shortcuts (manifest), used until Chrome says which ones are set. */
const DEFAULTS: Record<string, string> = {
  _execute_action: 'Alt+Shift+G',
  'capture-visible': 'Alt+Shift+V',
  'capture-full': 'Alt+Shift+F',
  'capture-area': 'Alt+Shift+A',
};

/**
 * The shortcuts as set in chrome://extensions/shortcuts (Chrome already writes them the Mac way on
 * a Mac, e.g. "⌥⇧V"). A command without a shortcut is ''.
 */
export function useShortcuts(): Record<string, string> {
  const [map, setMap] = useState<Record<string, string>>(() => Object.fromEntries(Object.entries(DEFAULTS).map(([k, v]) => [k, formatKeys(v)])));
  useEffect(() => {
    let live = true;
    Promise.resolve(typeof chrome !== 'undefined' ? chrome.commands?.getAll?.() : undefined)
      .then((all) => {
        if (!live || !Array.isArray(all)) return;
        setMap((m) => ({ ...m, ...Object.fromEntries(all.filter((c) => c.name).map((c) => [c.name!, c.shortcut ?? ''])) }));
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);
  return map;
}
