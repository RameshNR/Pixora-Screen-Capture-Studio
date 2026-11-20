import { describe, expect, it, vi } from 'vitest';
import type { CursorEffects, RecordingConfig } from '@/shared/types';
import { DEFAULT_SETTINGS } from '@/shared/constants/defaults';
import { clickEffectOf } from '@/shared/components/click-draw';
import { pageEffects } from '@/background/recording-manager';

vi.mock('@/recording/services/recording-session', () => ({ finalizeRecording: vi.fn() }));

const fx: CursorEffects = { ...DEFAULT_SETTINGS.recording.cursorEffects };
const config = (patch: Partial<RecordingConfig>) => ({ highlightClicks: true, highlightKeys: false, cursorEffects: fx, ...patch }) as RecordingConfig;

describe('click highlights on every page', () => {
  it('a tab recording gets the clicks, the styled cursor and the mouse position', () => {
    const m = pageEffects(config({ cursorEffects: { ...fx, pointer: true } }), 'tab')!;
    expect(m).toMatchObject({ type: 'overlay/effects', clicks: true, track: true });
    expect(m.cursor.pointer).toBe(true);
  });

  it('screen and window recordings get the clicks but never a page-drawn cursor', () => {
    const m = pageEffects(config({ cursorEffects: { ...fx, pointer: true, hideSystemCursor: true } }), 'desktop')!;
    expect(m.clicks).toBe(true);
    expect(m.cursor.pointer).toBe(false);
    expect(m.cursor.hideSystemCursor).toBe(false);
  });

  it('nothing for camera recordings', () => {
    expect(pageEffects(config({}), 'camera')).toBeNull();
  });
});

describe('click effect', () => {
  it("uses the image editor's effects, and older settings keep their effect", () => {
    expect(clickEffectOf({ ...fx, clickEffect: undefined, style: 'ripple' })).toBe('ripple');
    expect(clickEffectOf({ ...fx, style: 'ring', clickEffect: 'emphasis' })).toBe('emphasis');
  });
});
