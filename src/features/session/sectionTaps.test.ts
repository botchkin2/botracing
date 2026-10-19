import {describe, expect, it} from '@jest/globals';

import type {SectionTable} from './model';
import {sectionCellHref, sectionHeadHref, sectionTapsOf} from './sectionTaps';

const table: SectionTable = {
  heads: ['S/F', 'T1', 'T2–5'],
  sections: [null, 1, 2],
  targets: [
    {corner: null, whole: false},
    {corner: 1, whole: false},
    {corner: 2, whole: true},
  ],
  footer: [],
};

describe('section taps', () => {
  it('open on the columns that are a section, not the start straight', () => {
    expect(sectionTapsOf(table)).toEqual([false, true, true]);
    expect(sectionTapsOf(null)).toEqual([]);
  });

  it('a cell in day view opens Corner on that section with the day set', () => {
    expect(
      sectionCellHref('s1', table, 2, 's1~L4', ['s1~L4'], 'day'),
    ).toMatchObject({
      pathname: '/session/[id]/corner/[n]',
      params: {id: 's1', n: '2', set: 'day', laps: 's1~L4', hl: 's1~L4'},
    });
    expect(sectionCellHref('s1', table, 0, 'x', [], 'day')).toBeNull();
  });

  it('a head in day view opens Compare on that section with the day set', () => {
    expect(sectionHeadHref('s1', table, 1, ['s1~L4'], 'day')).toMatchObject({
      pathname: '/session/[id]/compare',
      params: {id: 's1', set: 'day', laps: 's1~L4'},
    });
    expect(sectionHeadHref('s1', table, 0, [], 'day')).toBeNull();
  });
});
