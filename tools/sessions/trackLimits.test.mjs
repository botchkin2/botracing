import assert from 'node:assert/strict';
import {test} from 'node:test';

import {lapStrikes} from './analyze.mjs';
import {trackLimitsOf} from './analyzeFromArchive.mjs';
import {DELETING_OUTCOMES} from './resultsInput.mjs';
import {DELETING_RESOLUTIONS, OUTCOMES} from './lmuResults.mjs';

// One lap of 10 ticks a second from t = 100 to 110, 1 m per tick on the lap
// distance; the path is 0.4 m inside the edge except for a run 2 m past it
// at t 102.0-102.5.
const ticks = Array.from({length: 101}, (_, i) => 100 + i / 10);
const s = {
  t: ticks,
  path_lateral_m: ticks.map(t => (t >= 102 && t <= 102.5 ? 7 : 3.6)),
  track_edge_m: ticks.map(() => 5),
};
const dist = Float64Array.from(ticks.map((_, i) => i));
const seg = {start: 100, end: 110};
const strike = (et, outcome = 'warning', points = 0.25) => ({
  et,
  lapNumber: 4,
  points,
  outcome,
  ruling: outcome,
});

test('a strike is measured over the 5 s before it: where the path was furthest past the edge, and by how much', () => {
  const [k] = lapStrikes({strikes: [strike(105.5)]}, s, seg, 0, 100, dist);
  // The game rules a moment after the excursion: 102.0-102.5 lies in [100.5, 105.5].
  assert.deepEqual(k, {
    et: 105.5,
    atM: 20,
    widthM: 2,
    points: 0.25,
    outcome: 'warning',
    ruling: 'warning',
  });
  // A strike whose 5 s window holds no excursion reads inside the edge (negative), not zero.
  const [late] = lapStrikes(
    {strikes: [strike(109.9, 'none', 0)]},
    s,
    seg,
    0,
    100,
    dist,
  );
  assert.equal(late.widthM, -1.4);
});

test('only the strikes inside the lap are its own; a lap with none gets an empty list', () => {
  const results = {strikes: [strike(99.9), strike(104), strike(110)]};
  assert.deepEqual(
    lapStrikes(results, s, seg, 0, 100, dist).map(k => k.et),
    [104],
  );
  assert.deepEqual(lapStrikes({strikes: []}, s, seg, 0, 100, dist), []);
});

test('without the path and edge channels a strike keeps its ruling and has no place or width (iRacing)', () => {
  const [k] = lapStrikes(
    {strikes: [strike(104)]},
    {t: ticks},
    seg,
    0,
    100,
    dist,
  );
  assert.equal(k.atM, null);
  assert.equal(k.widthM, null);
  assert.equal(k.outcome, 'warning');
});

test("the session's totals: strikes, points, the ones that fit no lap of his, and the laps the file and the lap time disagree on", () => {
  const laps = [
    {trackLimits: [strike(1), strike(2, 'none', 0)], invalidDisagrees: false},
    {trackLimits: [strike(3, 'invalidCut', 0.5)], invalidDisagrees: true},
    {trackLimits: [], invalidDisagrees: false},
    {invalidDisagrees: false},
  ];
  assert.deepEqual(trackLimitsOf(laps, {unplaced: 3}), {
    strikes: 3,
    points: 0.75,
    unplaced: 3,
    disagreements: 1,
  });
});

test('the analysis names the deleting rulings the reader has by code (4 Warning, 5 Invalid Cut, 6 Invalid Off)', () => {
  assert.deepEqual(
    [...DELETING_RESOLUTIONS].map(code => OUTCOMES[code]).sort(),
    [...DELETING_OUTCOMES].sort(),
  );
});
