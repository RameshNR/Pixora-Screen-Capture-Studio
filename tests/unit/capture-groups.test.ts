import { describe, expect, it } from 'vitest';
import { addToGroup, newGroup, nextGroupName, pruneGroups, removeFromGroups, type CaptureGroup } from '@/history/capture-groups';

const g = (id: string, ids: string[], name = id): CaptureGroup => ({ id, name, ids, createdAt: 0 });

describe('capture groups', () => {
  it('names new groups with the first free number', () => {
    expect(nextGroupName([])).toBe('Group 1');
    expect(nextGroupName([g('a', [], 'Group 1'), g('b', [], 'Group 3')])).toBe('Group 2');
    expect(newGroup([], ['x', 'x', 'y']).ids).toEqual(['x', 'y']);
  });
  it('a capture is in one group at a time (moving takes it out of the other)', () => {
    const groups = [g('a', ['1', '2']), g('b', ['3'])];
    const next = addToGroup(groups, 'b', ['2', '4']);
    expect(next.find((x) => x.id === 'a')!.ids).toEqual(['1']);
    expect(next.find((x) => x.id === 'b')!.ids).toEqual(['3', '2', '4']);
  });
  it('removing and pruning', () => {
    const groups = [g('a', ['1', '2']), g('b', ['3'])];
    expect(removeFromGroups(groups, ['2', '3']).map((x) => x.ids)).toEqual([['1'], []]);
    expect(pruneGroups(groups, new Set(['1', '3'])).map((x) => x.ids)).toEqual([['1'], ['3']]);
  });
});
