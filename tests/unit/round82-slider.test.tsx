import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { Slider } from '@/shared/components/FormControls';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** A setting saved slowly (like chrome.storage): the stored value arrives 120 ms after each change. */
function SlowSetting({ saves }: { saves: number[] }) {
  const [stored, setStored] = useState(10);
  return (
    <Slider label="Effect size" min={10} max={200} value={stored} onChange={(v) => {
      saves.push(v);
      setTimeout(() => setStored(v), 120);
    }} />
  );
}

describe('Slider while dragging a slowly saved setting', () => {
  it('follows the pointer, never jumps back to an older saved value, saves once per frame and the last value on release', () => {
    vi.useFakeTimers();
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(() => cb(performance.now()), 16) as unknown as number);
    vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id));
    const saves: number[] = [];
    render(<SlowSetting saves={saves} />);
    const input = screen.getByRole('slider', { name: 'Effect size' }) as HTMLInputElement;

    fireEvent.pointerDown(input);
    // Many moves within one frame: shown at once, saved once.
    for (const v of [20, 30, 40, 50]) fireEvent.change(input, { target: { value: String(v) } });
    expect(input.value).toBe('50');
    act(() => { vi.advanceTimersByTime(20); });
    expect(saves).toEqual([50]);
    // Back and forth; older saves arriving late do not move the thumb.
    fireEvent.change(input, { target: { value: '60' } });
    act(() => { vi.advanceTimersByTime(20); });
    fireEvent.change(input, { target: { value: '45' } });
    for (let t = 0; t < 10; t++) {
      act(() => { vi.advanceTimersByTime(20); });
      expect(input.value).toBe('45');
    }
    // Released: the last value is saved and stays.
    fireEvent.change(input, { target: { value: '47' } });
    fireEvent.pointerUp(window);
    expect(saves[saves.length - 1]).toBe(47);
    act(() => { vi.advanceTimersByTime(2000); });
    expect(input.value).toBe('47');
    expect(screen.getByText('47')).toBeTruthy();
  });

  it('saves keyboard changes at once', () => {
    const onChange = vi.fn();
    render(<Slider label="Opacity" min={0} max={1} step={0.1} value={0.5} onChange={onChange} />);
    fireEvent.change(screen.getByRole('slider', { name: 'Opacity' }), { target: { value: '0.6' } });
    expect(onChange).toHaveBeenCalledWith(0.6);
  });
});
