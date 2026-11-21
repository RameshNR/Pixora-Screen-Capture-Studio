/*
 * Keyboard shortcuts on Mac and Windows / Linux / ChromeOS.
 *
 * Shortcuts are written once the Windows way ("Ctrl+Z", "Alt+Shift+V") and shown the Mac way on a
 * Mac ("⌘Z", "⌥⇧V"); the key handlers accept both Ctrl and ⌘ (and ⇧⌘Z for redo).
 */

let forced: boolean | null = null;

/** Tests: pretend to be (or not to be) on a Mac. `null` goes back to detecting it. */
export function setMacForTests(mac: boolean | null): void {
  forced = mac;
}

export function isMac(): boolean {
  if (forced !== null) return forced;
  if (typeof navigator === 'undefined') return false;
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  const platform = nav.userAgentData?.platform || nav.platform || nav.userAgent || '';
  return /mac/i.test(platform);
}

/** Mac order of modifier symbols: Control, Option, Shift, Command. */
const ORDER: Record<string, number> = { Ctrl: 3, Cmd: 3, Alt: 1, Shift: 2, MacCtrl: 0 };
const SYMBOL: Record<string, string> = { Ctrl: '⌘', Cmd: '⌘', Alt: '⌥', Shift: '⇧', MacCtrl: '⌃' };

/**
 * Turns shortcuts in a text into the Mac way when `mac` is true:
 * "Ctrl+Z / Ctrl+Y" → "⌘Z / ⇧⌘Z", "Alt+Shift+V" → "⌥⇧V", "Ctrl + click" → "⌘ + click".
 * Other text is kept; nothing changes on other systems.
 */
export function formatKeys(text: string, mac: boolean = isMac()): string {
  if (!mac || !text) return text;
  // Redo on a Mac is ⇧⌘Z.
  let s = text.replace(/\bCtrl\s*\+\s*Y\b/g, 'Ctrl+Shift+Z');
  s = s.replace(/\b((?:(?:Ctrl|Cmd|Alt|Shift)\s*\+\s*)+)(?=\S)/g, (mods: string) => {
    const names = mods.split('+').map((m) => m.trim()).filter(Boolean);
    const symbols = [...new Set(names)].sort((a, b) => (ORDER[a] ?? 9) - (ORDER[b] ?? 9)).map((m) => SYMBOL[m] ?? m).join('');
    // "Ctrl + click": keep the words apart; "Ctrl+Z": symbols right before the key, the Mac way.
    return /\s/.test(mods) ? `${symbols} + ` : symbols;
  });
  // A lone "Ctrl" / "Alt" in a sentence ("hold Ctrl").
  return s.replace(/\bCtrl\b/g, '⌘').replace(/\bAlt\b/g, '⌥ Option');
}

/** The modifier word for this system: "Ctrl" or "⌘". */
export function modKey(mac: boolean = isMac()): string {
  return mac ? '⌘' : 'Ctrl';
}

/**
 * The key pressed, as a letter or digit even when Option (Alt) changes the character on a Mac
 * (Option+Shift+D types "Î"): uses the physical key.
 */
export function keyOf(e: Pick<KeyboardEvent, 'key' | 'code' | 'altKey'>): string {
  if (e.altKey && /^Key[A-Z]$/.test(e.code)) return e.code.slice(3).toLowerCase();
  if (e.altKey && /^Digit\d$/.test(e.code)) return e.code.slice(5);
  return e.key.toLowerCase();
}

/** How a key combination pressed now is written for people to read (recordings' key overlay). */
export function describeKeys(e: Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey'>, mac: boolean = isMac()): string {
  const name = e.key.length === 1 ? (e.altKey && /^Key[A-Z]$/.test(e.code) ? e.code.slice(3) : e.key.toUpperCase()) : e.key.replace('Arrow', '');
  if (mac) {
    const mods = [e.ctrlKey && '⌃', e.altKey && '⌥', e.shiftKey && '⇧', e.metaKey && '⌘'].filter(Boolean) as string[];
    const pretty: Record<string, string> = { Enter: '↩', Backspace: '⌫', Delete: '⌦', Escape: 'esc', Tab: '⇥', Up: '↑', Down: '↓', Left: '←', Right: '→' };
    return mods.join('') + (pretty[name] ?? name);
  }
  const mods = [e.ctrlKey && 'Ctrl', e.metaKey && 'Win', e.altKey && 'Alt', e.shiftKey && 'Shift'].filter(Boolean) as string[];
  return [...mods, name].join(' + ');
}
