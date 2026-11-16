import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ScrollAreaChooser } from '@/popup/components/ScrollAreaChooser';

const report = {
  pageScrolls: true,
  pageScreens: 4,
  areas: [
    { index: 0, label: 'CONTENT 1 - VACATION PACKAGE RESULTS', detail: '25 packages', rect: { x: 0, y: 0, width: 900, height: 400 }, scrollHeight: 1200, clientHeight: 400, screens: 3 },
    { index: 1, label: 'CONTENT 2 - FLIGHT RESULTS', detail: '40 flights', rect: { x: 0, y: 500, width: 900, height: 400 }, scrollHeight: 1600, clientHeight: 400, screens: 4 },
  ],
};

describe('scrollable areas list', () => {
  it('says what ticking does, and only ticked panels are expanded', () => {
    const onCapture = vi.fn();
    render(<ScrollAreaChooser report={report} tabId={1} onCancel={() => undefined} onCapture={onCapture} />);
    expect(screen.getAllByText('Expanded: every row is captured')).toHaveLength(2);
    fireEvent.click(screen.getByRole('checkbox', { name: 'CONTENT 2 - FLIGHT RESULTS' }));
    expect(screen.getByText('Not expanded: only the rows visible now')).toBeTruthy();
    // Hovering a card does not move the page; the Show button does.
    const send = vi.spyOn(chrome.runtime, 'sendMessage');
    send.mockClear();
    fireEvent.mouseEnter(screen.getByRole('checkbox', { name: 'CONTENT 2 - FLIGHT RESULTS' }).closest('li')!);
    expect(send).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Show area 2 on the page' }));
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ type: 'screenshot/highlight-area', index: 1, show: true }));
    expect(screen.getByRole('button', { name: 'Show area 2 on the page' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: /Capture with 1 panel/ }));
    expect(onCapture).toHaveBeenCalledWith([{ index: 0, screens: 0 }]);
  });
});
