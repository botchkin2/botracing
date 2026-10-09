import assert from 'node:assert/strict';
import {test} from 'node:test';
import {DEFAULT_AGE_DAYS, foldFacets, listCutoff} from '../src/sessionQuery.ts';

const NOW = Date.parse('2026-10-09T00:00:00Z');
const daysAgo = n => new Date(NOW - n * 86400000).toISOString();

test('no age and no track reads the default window', () => {
  assert.equal(listCutoff({}, NOW), daysAgo(DEFAULT_AGE_DAYS));
  assert.equal(listCutoff({ageDays: 0}, NOW), daysAgo(DEFAULT_AGE_DAYS));
});

test('an age is honoured, with or without a track', () => {
  assert.equal(listCutoff({ageDays: 7}, NOW), daysAgo(7));
  assert.equal(listCutoff({ageDays: 3650, trackId: 'spa'}, NOW), daysAgo(3650));
});

test('a track with no age (or 0) reads its whole history: no cutoff', () => {
  assert.equal(listCutoff({trackId: 'spa'}, NOW), null);
  assert.equal(listCutoff({trackId: 'spa', ageDays: 0}, NOW), null);
});

test('facets count sessions per game and per track, a track once per game', () => {
  const f = foldFacets([
    {sim: 'lmu', trackId: 'atl', track: 'Road Atlanta'},
    {sim: 'lmu', trackId: 'atl', track: 'Road Atlanta'},
    {sim: 'lmu', trackId: 'spa', track: 'Spa'},
    {sim: 'iracing', trackId: 'spa', track: 'Spa'},
    {trackId: 'atl', track: 'Road Atlanta'}, // no sim: stored before the field, LMU
    {sim: 'lmu', track: 'No id'}, // counted for the game, no track chip
  ]);
  assert.deepEqual(f.games, [
    {sim: 'lmu', count: 5},
    {sim: 'iracing', count: 1},
  ]);
  assert.deepEqual(
    f.tracks.map(t => [t.sim, t.trackId, t.count]),
    [
      ['lmu', 'atl', 3],
      ['lmu', 'spa', 1],
      ['iracing', 'spa', 1],
    ],
  );
});
