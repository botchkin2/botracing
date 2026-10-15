import assert from 'node:assert/strict';
import {test} from 'node:test';

import {lapCovered, lapStrikes, lapVerdict} from './analyze.mjs';
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
  // The file listed 5 strikes of his: 3 sit in laps, 1 it could not place, and
  // 1 fits a lap of his the recording has no segment for (a reset): 2 unplaced.
  assert.deepEqual(
    trackLimitsOf(laps, {unplaced: 1, strikes: new Array(4).fill(strike(0))}),
    {strikes: 3, points: 0.75, unplaced: 2, disagreements: 1},
  );
});

test('the analysis names the deleting rulings the reader has by code (4 Warning, 5 Invalid Cut, 6 Invalid Off)', () => {
  assert.deepEqual(
    [...DELETING_RESOLUTIONS].map(code => OUTCOMES[code]).sort(),
    [...DELETING_OUTCOMES].sort(),
  );
});

// His race, L14 (XML lap 14, the 14th lap of the file): the lap time reads
// untimed, not -1, while the results file has a Warning in it.
const warning = [strike(1759.8, 'warning', 0.5)];
const noAction = [strike(1900, 'none', 0)];

test('INV: the results file is the source where it covers the lap, and it wins where it disagrees with the lap time (L14: untimed lap, a Warning)', () => {
  assert.deepEqual(
    lapVerdict({
      covered: true,
      trackLimits: warning,
      pitlane: false,
      timeInvalid: false,
    }),
    {invalid: true, invalidFrom: 'results', invalidDisagrees: true},
  );
  // The lap time says -1 and so does the file: agreed.
  assert.deepEqual(
    lapVerdict({
      covered: true,
      trackLimits: warning,
      pitlane: false,
      timeInvalid: true,
    }),
    {invalid: true, invalidFrom: 'results', invalidDisagrees: false},
  );
  // The lap time says -1 and the file has only No Further Action: the file wins, and it is counted.
  assert.deepEqual(
    lapVerdict({
      covered: true,
      trackLimits: noAction,
      pitlane: false,
      timeInvalid: true,
    }),
    {invalid: false, invalidFrom: undefined, invalidDisagrees: true},
  );
  // No ruling at all, and a lap in the pit lane: not invalid, nothing to say.
  assert.deepEqual(
    lapVerdict({
      covered: true,
      trackLimits: [],
      pitlane: false,
      timeInvalid: false,
    }),
    {invalid: false, invalidFrom: undefined, invalidDisagrees: false},
  );
  assert.equal(
    lapVerdict({
      covered: true,
      trackLimits: warning,
      pitlane: true,
      timeInvalid: false,
    }).invalid,
    false,
  );
});

test("a lap the file cannot cover keeps the lap time's verdict: a Warning in his last lap must not turn the game's -1 into a partial lap (#620)", () => {
  const covers = {coveredFrom: 7.1, coveredTo: 3773.1};
  // The last lap starts at 3773.1 and has no end in the file.
  assert.equal(lapCovered(covers, {start: 3650, end: 3773.1}), true);
  assert.equal(lapCovered(covers, {start: 3773.1, end: 3900}), false);
  assert.equal(lapCovered(covers, {start: 0, end: 7.1}), false);
  assert.equal(
    lapCovered({coveredFrom: null, coveredTo: null}, {start: 1, end: 2}),
    false,
  );
  // Not covered: trackLimits is undefined for the lap and the lap time decides.
  assert.deepEqual(
    lapVerdict({
      covered: false,
      trackLimits: undefined,
      pitlane: false,
      timeInvalid: true,
    }),
    {invalid: true, invalidFrom: 'lapTime', invalidDisagrees: false},
  );
  assert.deepEqual(
    lapVerdict({
      covered: false,
      trackLimits: undefined,
      pitlane: false,
      timeInvalid: false,
    }),
    {invalid: false, invalidFrom: undefined, invalidDisagrees: false},
  );
});

test('a strike early in a lap is measured over the 5 s before it, including the end of the lap before', () => {
  // The lap before ends at t 100 on lap distance 5000 -> 5009; the excursion is
  // at t 98.0-98.5 in it, and the strike is ruled at 101 in this lap.
  const t = Array.from({length: 111}, (_, i) => 95 + i / 10);
  const wide = {
    t,
    path_lateral_m: t.map(x => (x >= 98 && x <= 98.5 ? 7.5 : 3.6)),
    track_edge_m: t.map(() => 5),
    lap_dist_m: t.map(x => (x < 100 ? 4950 + (x - 95) * 10 : (x - 100) * 10)),
  };
  const i0 = t.findIndex(x => x >= 100);
  const dist2 = Float64Array.from(t.slice(i0).map(x => (x - 100) * 10));
  const [k] = lapStrikes(
    {strikes: [strike(101, 'warning', 0.25)]},
    wide,
    {start: 100, end: 110},
    i0,
    t.length - 1,
    dist2,
  );
  assert.equal(k.widthM, 2.5);
  // In the lap before's own distance: 4950 + (98.0 - 95) * 10.
  assert.equal(k.atM, 4980);
});
