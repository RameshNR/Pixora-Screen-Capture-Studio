import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '@/shared/constants/defaults';
import { CURSOR_LOOKS } from '@/editor/tools/cursor';
import { clickCursorOf, isLookActive, lookToClickFx } from '@/shared/components/click-draw';
import { cursorAnimAt, type VideoOverlay } from '@/recording/services/video-overlays';
import type { CursorAnnotation } from '@/editor/types';

const fx = { ...DEFAULT_SETTINGS.recording.cursorEffects };
const look = (id: string) => CURSOR_LOOKS.find((l) => l.id === id)!.patch;

describe('quick looks in the click settings', () => {
  it('animated looks keep their own motion (ghost, bounce, wavy are different)', () => {
    expect(lookToClickFx(look('ghost')).clickTrail).toBe('ghost');
    expect(lookToClickFx(look('signal')).clickTrail).toBe('signal');
    expect(lookToClickFx(look('wavy')).clickTrail).toBe('wave');
    const ghost = clickCursorOf({ ...fx, ...lookToClickFx(look('ghost')) }, 0, 0, 'left');
    expect(ghost.trail).toBe('ghost');
  });

  it('exactly one look is highlighted after picking it', () => {
    for (const l of CURSOR_LOOKS) {
      const now = { ...fx, ...lookToClickFx(l.patch) };
      expect(isLookActive(now, l.patch)).toBe(true);
      const others = CURSOR_LOOKS.filter((o) => o.id !== l.id && isLookActive(now, o.patch));
      expect(others.map((o) => o.id)).toEqual([]);
    }
  });

  it('presentation keeps its spotlight; the click mark follows the look', () => {
    expect(lookToClickFx(look('presentation')).clickEffect).toBe('spotlight');
    expect(lookToClickFx(look('click-pink')).clickMark).toBe(true);
    expect(lookToClickFx(look('plain')).clickMark).toBe(false);
  });

  it('a double click shows the double-click mark; no mark when turned off', () => {
    const on = { ...fx, clickCursor: true, clickMark: true };
    expect(clickCursorOf(on, 0, 0, 'double').click).toBe('double');
    expect(clickCursorOf({ ...on, clickMark: false }, 0, 0, 'right').click).toBe('none');
    expect(clickCursorOf({ ...on, clickCursorSize: 60 }, 0, 0, 'left').size).toBe(60);
  });
});

describe('cursor animation in videos', () => {
  const cursor = { id: 'c', type: 'cursor', x: 0, y: 0, size: 30, design: 'arrow', color: '#fff', outline: '#000', click: 'left', clickColor: '#f00', effect: 'ripple', effectColor: '#f00', effectSize: 1, opacity: 1 } as CursorAnnotation;
  const ov = (a: Partial<CursorAnnotation>) => ({ id: 'o', annotation: { ...cursor, ...a }, start: 2, end: 9, animIn: 'none', animOut: 'none', effect: 'none' }) as VideoOverlay;
  it('still unless asked; once plays from the start; repeat starts again', () => {
    expect(cursorAnimAt(ov({}), 3)).toBeNull();
    expect(cursorAnimAt(ov({ anim: 'once', animMs: 1000 }), 2.5)).toBeCloseTo(0.5);
    expect(cursorAnimAt(ov({ anim: 'once', animMs: 1000 }), 6)).toBe(1);
    expect(cursorAnimAt(ov({ anim: 'loop', animMs: 1000 }), 2 + 1.45 + 0.25)).toBeCloseTo(0.25);
  });
});
