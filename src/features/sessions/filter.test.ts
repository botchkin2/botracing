import {describe, expect, it} from '@jest/globals';
import {type SessionSummary} from '@/src/data/sessions';

import {applyFilter, effectiveFilter, filterOptions, NO_FILTER} from './filter';

const s = (id: string, sim: string, trackId: string, track: string) =>
  ({id, sim, trackId, track} as SessionSummary);

const all = [
  s('a', 'lmu', 'atlanta', 'Road Atlanta'),
  s('b', 'lmu', 'atlanta', 'Road Atlanta'),
  s('c', 'lmu', 'monza', 'Monza'),
  s('d', 'iracing', 'monza', 'Monza'),
  s('e', 'iracing', 'spa', 'Spa'),
];

describe('filterOptions', () => {
  it('offers every game and every track when nothing is picked', () => {
    const o = filterOptions(all, NO_FILTER);
    expect(o.games).toEqual([
      {key: 'iracing', label: 'iRacing', count: 2},
      {key: 'lmu', label: 'LMU', count: 3},
    ]);
    expect(o.tracks.map(t => [t.key, t.count])).toEqual([
      ['monza', 2],
      ['atlanta', 2],
      ['spa', 1],
    ]);
  });

  it("offers only the picked game's tracks, counted within it", () => {
    const o = filterOptions(all, {game: 'iracing', track: null});
    expect(o.tracks.map(t => [t.key, t.count])).toEqual([
      ['monza', 1],
      ['spa', 1],
    ]);
  });
});

describe('applyFilter', () => {
  it('passes everything with no filter', () => {
    expect(applyFilter(all, NO_FILTER)).toHaveLength(5);
  });
  it('filters by game, by track, and by both', () => {
    expect(applyFilter(all, {game: 'lmu', track: null}).map(x => x.id)).toEqual(
      ['a', 'b', 'c'],
    );
    expect(
      applyFilter(all, {game: null, track: 'monza'}).map(x => x.id),
    ).toEqual(['c', 'd']);
    expect(
      applyFilter(all, {game: 'iracing', track: 'monza'}).map(x => x.id),
    ).toEqual(['d']);
  });
});

describe('effectiveFilter', () => {
  it('keeps a filter that exists', () => {
    expect(effectiveFilter(all, {game: 'lmu', track: 'monza'})).toEqual({
      game: 'lmu',
      track: 'monza',
    });
  });
  it('drops a game or track no session has', () => {
    expect(effectiveFilter(all, {game: 'acc', track: 'nowhere'})).toEqual(
      NO_FILTER,
    );
  });
  it('drops a track that is not in the picked game', () => {
    expect(effectiveFilter(all, {game: 'lmu', track: 'spa'})).toEqual({
      game: 'lmu',
      track: null,
    });
  });
});
