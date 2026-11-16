/**
 * Tiny logger. Debug output is gated by Settings › Advanced › Debug logging, which every context
 * syncs via `setDebugLogging` once settings are loaded.
 */
let debugEnabled = false;

export function setDebugLogging(enabled: boolean): void {
  debugEnabled = enabled;
}

export const logger = {
  debug: (...args: unknown[]) => {
    if (debugEnabled) console.debug('[Pixora]', ...args);
  },
  info: (...args: unknown[]) => {
    if (debugEnabled) console.info('[Pixora]', ...args);
  },
  warn: (...args: unknown[]) => console.warn('[Pixora]', ...args),
  error: (...args: unknown[]) => console.error('[Pixora]', ...args),
};
