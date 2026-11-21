import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useShortcuts } from '@/shared/hooks/useShortcuts';
import { setMacForTests } from '@/shared/utils/keys';

afterEach(() => setMacForTests(null));

describe('useShortcuts (popup hints)', () => {
  it('starts with the defaults, written the Mac way on a Mac', () => {
    setMacForTests(true);
    (chrome.commands.getAll as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => new Promise(() => undefined));
    const { result } = renderHook(() => useShortcuts());
    expect(result.current['capture-visible']).toBe('⌥⇧V');
  });

  it('shows what Chrome has set, and nothing for a removed shortcut', async () => {
    (chrome.commands.getAll as unknown as ReturnType<typeof vi.fn>).mockResolvedValue([
      { name: 'capture-visible', shortcut: 'Ctrl+Shift+1' },
      { name: 'capture-full', shortcut: '' },
    ] as chrome.commands.Command[]);
    const { result } = renderHook(() => useShortcuts());
    await waitFor(() => expect(result.current['capture-visible']).toBe('Ctrl+Shift+1'));
    expect(result.current['capture-full']).toBe('');
    expect(result.current['capture-area']).toBe('Alt+Shift+A');
  });
});
