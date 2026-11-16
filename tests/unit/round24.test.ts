import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '@/shared/constants/defaults';
import { intervalLabel, SHOT_DELAY_OPTIONS } from '@/flow/components/FlowAutoOptions';

describe('flow capture timing (screenshot flows and recordings share it)', () => {
  it('waits automatically by default and offers no delay', () => {
    expect(DEFAULT_SETTINGS.flow.shotDelayMs).toBe(-1);
    expect(SHOT_DELAY_OPTIONS[0]).toMatchObject({ value: -1, label: 'Automatic' });
    expect(SHOT_DELAY_OPTIONS.find((o) => o.value === 0)?.label).toBe('No delay');
  });

  it('labels the minimum time between pictures, down to no delay', () => {
    expect(intervalLabel(0)).toBe('No delay (every step)');
    expect(intervalLabel(50)).toBe('0.05 s');
    expect(intervalLabel(600)).toBe('0.6 s');
    expect(intervalLabel(2000)).toBe('2 s');
  });
});

import { captureBox } from '@/offscreen/recording-processor';

describe('tab recording size', () => {
  it('asks Chrome for the tab at its exact pixel size (no rescaling)', () => {
    expect(captureBox({ width: 7680, height: 7680 }, { width: 2576, height: 1250 })).toEqual({ box: { width: 2576, height: 1250 }, exact: true });
    // Odd sizes round up to even, so the page is never scaled down by a pixel.
    expect(captureBox({ width: 7680, height: 7680 }, { width: 2576, height: 1251 })).toEqual({ box: { width: 2576, height: 1252 }, exact: true });
  });

  it('keeps the shape when a smaller preset is chosen, and falls back to a limit when the size is unknown', () => {
    expect(captureBox({ width: 1920, height: 1080 }, { width: 2576, height: 1250 })).toEqual({ box: { width: 1920, height: 930 }, exact: true });
    expect(captureBox({ width: 1920, height: 1080 })).toEqual({ box: { width: 1920, height: 1080 } });
  });
});

import { normalizeSettings } from '@/settings/settings-service';
import { DEFAULT_SETTINGS as D } from '@/shared/constants/defaults';

describe('flow capture defaults (v5)', () => {
  it('records the flow with step screenshots, no minimum gap, pictures on click', () => {
    expect(D.flow.withRecording).toBe(true);
    expect(D.flow.autoSteps).toBe(true);
    expect(D.flow.minShotIntervalMs).toBe(0);
    expect(D.flow.shotTiming).toBe('on-click');
  });

  it('moves older settings that still had the old defaults', () => {
    const old = { version: 4, flow: { ...D.flow, withRecording: false, autoSteps: false, minShotIntervalMs: 600, shotTiming: 'after-click' } };
    const s = normalizeSettings(old);
    expect(s.flow).toMatchObject({ withRecording: true, autoSteps: true, minShotIntervalMs: 0, shotTiming: 'on-click' });
    // A gap the user chose themselves is kept.
    expect(normalizeSettings({ ...old, flow: { ...old.flow, minShotIntervalMs: 1500 } }).flow.minShotIntervalMs).toBe(1500);
  });
});
