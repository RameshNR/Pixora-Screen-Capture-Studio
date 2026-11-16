import { describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useNow } from '@/shared/hooks/useRecordingState';

describe('useNow (countdown clock)', () => {
  it('uses the current time as soon as it becomes active, not the time the page opened', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const { result, rerender } = renderHook(({ active }) => useNow(active, 250), { initialProps: { active: false } });
    // The page stays open for 10 s before the countdown starts.
    vi.setSystemTime(1_010_000);
    rerender({ active: true });
    expect(result.current).toBe(1_010_000);
    // A 3 s countdown ending 3 s from now shows 3 straight away (not 13).
    expect(Math.ceil((1_013_000 - result.current) / 1000)).toBe(3);
    vi.useRealTimers();
  });
});
