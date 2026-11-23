/*
 * MediaPipe's engine prints its own start-up notes ("INFO: Created TensorFlow Lite XNNPACK
 * delegate for CPU.", "W1122 … OpenGL error checking is disabled") through console.error /
 * console.warn, and Chrome lists those on the extension's Errors page. They are not errors:
 * this sends them to console.debug instead. Real errors still go through unchanged.
 * Installed before the engine loads (it keeps the console functions it finds then).
 */

/** Its info (I…) and warning (W…) log lines; its error lines (E…, F…) still show. */
const NOTE = /^(INFO: |[IW]\d{4} \d\d:\d\d:\d\d\.\d+ +\d+ [\w.]+:\d+\] )/;
let installed = false;

export function isMediapipeNote(first: unknown): boolean {
  return typeof first === 'string' && NOTE.test(first);
}

export function quietMediapipe(): void {
  if (installed) return;
  installed = true;
  for (const level of ['error', 'warn'] as const) {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      if (isMediapipeNote(args[0])) console.debug(...args);
      else original(...args);
    };
  }
}
