import type { RecordingCommand } from '@/shared/messaging/messages';
import type { CursorReport, LiveEffect, RecordingConfig, RelativeRect } from '@/shared/types';
import { RecordingSession } from '@/recording/services/recording-session';
import { applyCommand, createSessionHooks } from '@/recording/services/session-bridge';
import { getTabStream } from '@/recording/services/media-stream-service';
import { fitWithin, targetDimensions } from '@/recording/services/codec-service';
import type { Dimensions } from '@/shared/constants/media';
import { AppError } from '@/shared/utils/errors';

/** Tab / custom-area recording inside the offscreen document. */
/**
 * Capture size for a tab. Knowing the tab's pixel size, Chrome is asked for exactly that size
 * (or the preset's size, keeping the shape) so the page is captured 1:1: with only an upper limit
 * Chrome picks its own frame size and rescales the page into it, which softens text.
 */
export function captureBox(preset: Dimensions, source?: { width: number; height: number }): { box: Dimensions; exact?: boolean } {
  if (!source) return { box: preset };
  const fitted = fitWithin(source, preset);
  if (fitted.width < source.width - 1 || fitted.height < source.height - 1) return { box: fitted, exact: true };
  // Full size: round up to even (encoders need it). Chrome keeps the shape, so an even source is
  // captured pixel for pixel and an odd one gets at most a 1 px bar (trimmed from saved frames).
  const up = (n: number) => Math.ceil(n / 2) * 2;
  return { box: { width: up(source.width), height: up(source.height) }, exact: true };
}

export class TabRecordingHost {
  private session: RecordingSession | null = null;

  get activeSessionId(): string | null {
    return this.session?.sessionId ?? null;
  }

  async start(args: {
    sessionId: string;
    config: RecordingConfig;
    streamId: string;
    area: RelativeRect | null;
    sourceTitle?: string;
    sourceUrl?: string;
    sourceSize?: { width: number; height: number };
  }): Promise<void> {
    if (this.session) throw new AppError('already-recording');
    const hooks = createSessionHooks(args.sessionId);
    const session = new RecordingSession(args.sessionId, args.config, {
      emit: hooks.emit,
      finished: (id, err) => {
        if (this.session === session) this.session = null;
        hooks.finished(id, err);
      },
    });
    this.session = session;
    try {
      // For custom areas we capture the full tab at the requested ceiling, then crop; the crop
      // keeps real pixels (no upscaling).
      const stream = await getTabStream(
        args.streamId,
        { ...captureBox(targetDimensions(args.config.resolution), args.sourceSize), fps: args.config.fps },
        args.config.systemAudio,
      );
      await session.prepare({ stream, monitorAudio: true, area: args.area, title: args.sourceTitle, url: args.sourceUrl });
    } catch (err) {
      session.releaseMedia();
      this.session = null;
      throw err;
    }
    void session.start();
  }

  effect(effect: LiveEffect): void {
    this.session?.applyEffect(effect);
  }

  cursor(report: CursorReport): void {
    this.session?.onCursor(report);
  }

  command(sessionId: string, command: RecordingCommand): void {
    if (this.session && this.session.sessionId === sessionId) applyCommand(this.session, command);
  }
}
