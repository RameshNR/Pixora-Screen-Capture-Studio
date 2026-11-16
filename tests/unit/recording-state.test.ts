import { describe, expect, it } from 'vitest';
import { INITIAL_RECORDING_STATE, elapsedMs, isBusy, recordingReducer, remainingMs } from '@/recording/services/recording-state';
import type { ActualRecordingInfo, RecordingEvent, RecordingState } from '@/shared/types';

const actual: ActualRecordingInfo = { width: 1920, height: 1080, fps: 30, mimeType: 'video/webm;codecs=vp9', sourceWidth: 1920, sourceHeight: 1080, videoBitrate: 8e6, hasMicrophone: true, hasSystemAudio: false };

function run(events: RecordingEvent[], start: RecordingState = INITIAL_RECORDING_STATE): RecordingState {
  return events.reduce(recordingReducer, start);
}

describe('recording state machine', () => {
  it('walks through a full session', () => {
    let s = run([{ type: 'PREPARE', sessionId: 's1', mode: 'tab', maxDurationMs: 0, targetTabId: 4 }]);
    expect(s.status).toBe('preparing');
    expect(isBusy(s)).toBe(true);
    s = run([{ type: 'HOST_ASSIGNED', host: 'offscreen', hostTabId: null }, { type: 'COUNTDOWN', endsAt: 1000 }], s);
    expect(s.status).toBe('countdown');
    s = recordingReducer(s, { type: 'STARTED', at: 1000, actual, micAvailable: true, cameraAvailable: false, warnings: ['w'] });
    expect(s.status).toBe('recording');
    expect(s.micOn).toBe(true);
    expect(s.cameraOn).toBe(false);
    expect(s.warnings).toEqual(['w']);
    s = recordingReducer(s, { type: 'STOPPING', at: 4000 });
    expect(s.status).toBe('stopping');
    expect(s.accumulatedMs).toBe(3000);
    s = recordingReducer(s, { type: 'RESET' });
    expect(s.status).toBe('idle');
    expect(isBusy(s)).toBe(false);
  });

  it('excludes paused time from the elapsed time', () => {
    let s = run([
      { type: 'PREPARE', sessionId: 's', mode: 'camera', maxDurationMs: 10_000, targetTabId: null },
      { type: 'STARTED', at: 0, actual, micAvailable: false, cameraAvailable: false, warnings: [] },
      { type: 'PAUSED', at: 2000 },
    ]);
    expect(elapsedMs(s, 9000)).toBe(2000);
    s = recordingReducer(s, { type: 'RESUMED', at: 5000 });
    expect(elapsedMs(s, 6000)).toBe(3000);
    expect(remainingMs(s, 6000)).toBe(7000);
  });

  it('prevents a second session from starting', () => {
    const s = run([{ type: 'PREPARE', sessionId: 'a', mode: 'tab', maxDurationMs: 0, targetTabId: 1 }]);
    const again = recordingReducer(s, { type: 'PREPARE', sessionId: 'b', mode: 'tab', maxDurationMs: 0, targetTabId: 1 });
    expect(again).toBe(s);
  });

  it('ignores invalid transitions', () => {
    const idle = INITIAL_RECORDING_STATE;
    expect(recordingReducer(idle, { type: 'PAUSED', at: 1 })).toBe(idle);
    expect(recordingReducer(idle, { type: 'STARTED', at: 1, actual, micAvailable: false, cameraAvailable: false, warnings: [] })).toBe(idle);
    const rec = run([{ type: 'PREPARE', sessionId: 'a', mode: 'tab', maxDurationMs: 0, targetTabId: 1 }, { type: 'STARTED', at: 0, actual, micAvailable: false, cameraAvailable: false, warnings: [] }]);
    expect(recordingReducer(rec, { type: 'RESUMED', at: 5 })).toBe(rec);
    expect(recordingReducer(rec, { type: 'MIC', on: true })).toBe(rec); // no microphone available
  });

  it('records errors and keeps the control bar window id for cleanup', () => {
    const s = run([
      { type: 'PREPARE', sessionId: 'a', mode: 'tab', maxDurationMs: 0, targetTabId: 1 },
      { type: 'CONTROL_BAR', windowId: 9 },
      { type: 'FAILED', error: { code: 'tab-closed', title: 't', message: 'm' } },
    ]);
    expect(s.status).toBe('error');
    expect(s.error?.code).toBe('tab-closed');
    expect(s.controlBarWindowId).toBe(9);
  });

  it('de-duplicates warnings', () => {
    const s = run([
      { type: 'PREPARE', sessionId: 'a', mode: 'tab', maxDurationMs: 0, targetTabId: 1 },
      { type: 'WARN', message: 'x' },
      { type: 'WARN', message: 'x' },
    ]);
    expect(s.warnings).toEqual(['x']);
  });
});
