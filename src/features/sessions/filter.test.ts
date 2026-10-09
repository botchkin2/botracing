import {describe, expect, it} from '@jest/globals';
import {type SessionFacets, type SessionSummary} from '@/src/data/sessions';

import {applyGame, effectiveFilter, filterOptions, NO_FILTER} from './filter';

const facets: SessionFacets = {
  games: [
    {sim: 'lmu', count: 5},
    {sim: 'iracing', count: 2},
  ],
  tracks: [
    {trackId: 'atlanta', track: 'Road Atlanta', sim: 'lmu', count: 2},
    {trackId: 'monza', track: 'Monza', sim: 'lmu', count: 2},
    {trackId: 'spa', track: 'Spa', sim: 'lmu', count: 1},
    {trackId: 'monza', track: 'Monza', sim: 'iracing', count: 1},
    {trackId: 'zandvoort', track: 'Zandvoort', sim: 'iracing', count: 1},
  ],
};

describe('filterOptions', () => {
  it('offers every game and every track when nothing is picked; a track in two games is one chip', () => {
    const o = filterOptions(facets, NO_FILTER);
    expect(o.games).toEqual([
      {key: 'iracing', label: 'iRacing', count: 2},
      {key: 'lmu', label: 'LMU', count: 5},
    ]);
    expect(o.tracks.map(t => [t.key, t.count])).toEqual([
      ['monza', 3],
      ['atlanta', 2],
      ['spa', 1],
      ['zandvoort', 1],
    ]);
  });

  it("offers only the picked game's tracks, counted within it", () => {
    const o = filterOptions(facets, {game: 'iracing', track: null});
    expect(o.tracks.map(t => [t.key, t.count])).toEqual([
      ['monza', 1],
      ['zandvoort', 1],
    ]);
  });
});

describe('applyGame', () => {
  const s = (id: string, sim: string) => ({id, sim} as SessionSummary);
  const list = [s('a', 'lmu'), s('b', 'iracing'), s('c', 'lmu')];
  it('keeps everything with no game, and only the game otherwise', () => {
    expect(applyGame(list, NO_FILTER)).toHaveLength(3);
    expect(applyGame(list, {game: 'lmu', track: null}).map(x => x.id)).toEqual([
      'a',
      'c',
    ]);
  });
});

describe('effectiveFilter', () => {
  it('keeps a filter that exists, including a track only old sessions have', () => {
    expect(effectiveFilter(facets, {game: 'lmu', track: 'spa'})).toEqual({
      game: 'lmu',
      track: 'spa',
    });
  });
  it('drops a game or track nothing was driven in', () => {
    expect(effectiveFilter(facets, {game: 'acc', track: 'nowhere'})).toEqual(
      NO_FILTER,
    );
  });
  it('drops a track that is not in the picked game', () => {
    expect(effectiveFilter(facets, {game: 'iracing', track: 'spa'})).toEqual({
      game: 'iracing',
      track: null,
    });
  });
});
