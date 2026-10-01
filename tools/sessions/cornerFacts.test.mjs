import assert from 'node:assert/strict';
import {test} from 'node:test';
import {windowsOf} from '../../src/analysis/cornerBoundaries.ts';
import {cornerFacts} from './cornerFacts.mjs';
import {LENGTH_M, makeLap, map} from './syntheticLap.mjs';
import {
  mapKeyOf,
  packState,
  sessionBoundaries,
  unpackState,
} from './layoutBoundaries.mjs';

const flags = {local: []};
const layoutOf = laps =>
  sessionBoundaries({
    laps: laps.map(l => l.lap),
    map,
    stored: null,
    sessionId: 's1',
    fold: {minLaps: 1, minSessions: 1},
  });
const factsOf = ({rec, lap}, layout, pits = []) =>
  cornerFacts({
    rec,
    lap,
    windows: layout.windows,
    sections: map.corners,
    flags,
    pits,
    lengthM: LENGTH_M,
    onsets: layout.onsets.get(lap),
  });

const laps = [makeLap(580, 1380), makeLap(590, 1390), makeLap(585, 1385)];
const layout = layoutOf(laps);

test("the windows tile the lap and a lap's sections add up to its lap time", () => {
  const {windows} = layout;
  assert.equal(windows[0].fromM, 0);
  assert.equal(windows.at(-1).toM, LENGTH_M);
  windows.slice(1).forEach((w, i) => assert.equal(w.fromM, windows[i].toM));
  for (const l of laps) {
    const {corners, startStraight} = factsOf(l, layout);
    const sum =
      corners.reduce((a, c) => a + c.segTime, 0) +
      (startStraight?.segTime ?? 0);
    assert.ok(
      Math.abs(sum - l.lap.lapTime) < 0.01,
      `${sum} vs ${l.lap.lapTime}`,
    );
  }
});

test('each window splits into run-in, corner and exit that add up to its time', () => {
  const {corners} = factsOf(laps[0], layout);
  for (const c of corners) {
    assert.ok(Math.abs(c.runInS + c.cornerS + c.exitS - c.segTime) < 0.005);
    assert.ok(c.runInS > 0 && c.cornerS > 0 && c.exitS > 0);
  }
  // Corner 1: the lap's own onset is its brake point, where the run-in ends.
  assert.ok(Math.abs(corners[0].onsetM - 580) <= 5);
});

test('four speeds tell the story: carried into it, the minimum, full throttle, the exit', () => {
  const [c1] = factsOf(laps[0], layout).corners;
  assert.ok(Math.abs(c1.onsetSpeedKmh - 180) < 1);
  assert.ok(Math.abs(c1.minSpeedKmh - 72) < 1);
  assert.equal(c1.minSpeedPart, 1);
  assert.ok(c1.fullThrottleSpeedKmh >= 72);
  assert.ok(Math.abs(c1.endSpeedKmh - 180) < 1);
});

test('brake applications are listed by the corner each is for', () => {
  const [c1, c2] = factsOf(laps[0], layout).corners;
  assert.deepEqual(
    c1.brakeApps.map(a => a.onsetM),
    [580],
  );
  assert.deepEqual(
    c2.brakeApps.map(a => a.onsetM),
    [1380],
  );
  // A single corner has no parts to name.
  assert.equal(c1.brakeApps[0].part, null);
  assert.equal(c1.brakeApps[0].peakPct, 80);
});

test('a lap through the pit lane marks only the windows it crosses', () => {
  // In the lane from the start of the lap to 14 s: the start straight and the
  // first window, not the second.
  const t0 = laps[0].rec.s.t[0];
  const {corners, startStraight} = factsOf(laps[0], layout, [
    [t0 - 5, t0 + 14],
  ]);
  assert.equal(startStraight.pit, true);
  assert.equal(corners[0].pit, true);
  assert.equal(corners[1].pit, false);
});

test('a lap with no onset in a section (taken flat) still gets a window and a split', () => {
  const flat = makeLap(null, 1380);
  const withFlat = layoutOf([...laps, flat]);
  const {corners} = factsOf(flat, withFlat);
  assert.equal(corners[0].onsetM, null);
  assert.equal(corners[0].runInS, 0);
  assert.ok(
    Math.abs(corners[0].cornerS + corners[0].exitS - corners[0].segTime) <
      0.005,
  );
});

test('boundaries pooled from comparable green laps only, and replaced on a resync', () => {
  const dirty = makeLap(300, 1380);
  dirty.lap.clean = false;
  const pit = makeLap(300, 1380, {pitFrom: 1});
  const base = sessionBoundaries({
    laps: [...laps.map(l => l.lap), dirty.lap, pit.lap],
    map,
    stored: null,
    sessionId: 's1',
    fold: {minLaps: 1, minSessions: 1},
  });
  // The off-pace laps' early brake at 300 m did not make the pool.
  assert.ok(base.state.startsM[0] > 500, String(base.state.startsM[0]));
  const again = sessionBoundaries({
    laps: [...laps.map(l => l.lap), dirty.lap, pit.lap],
    map,
    stored: base.state,
    sessionId: 's1',
    fold: {minLaps: 1, minSessions: 1},
  });
  assert.deepEqual(again.state.sessions, base.state.sessions);
  assert.equal(again.moved, false);
  assert.equal(again.state.rev, base.state.rev);
});

test('boundaries kept for another map are replaced, with a higher rev', () => {
  const base = layoutOf(laps).state;
  const other = {
    ...map,
    corners: map.corners.map(c => ({...c, turnInM: c.turnInM + 1})),
  };
  assert.notEqual(mapKeyOf(map.corners), mapKeyOf(other.corners));
  const next = sessionBoundaries({
    laps: laps.map(l => l.lap),
    map: other,
    stored: base,
    sessionId: 's1',
  });
  assert.equal(next.state.rev, base.rev + 1);
  assert.equal(next.state.mapKey, mapKeyOf(other.corners));
});

test('packed state has no array inside an array and unpacks to the same state', () => {
  const {state} = layoutOf(laps);
  const packed = packState(state);
  const nested = value => {
    if (Array.isArray(value)) {
      return value.some(v => Array.isArray(v)) || value.some(nested);
    }
    return value && typeof value === 'object'
      ? Object.values(value).some(nested)
      : false;
  };
  assert.equal(nested(packed), false);
  assert.deepEqual(unpackState(JSON.parse(JSON.stringify(packed))), state);
  assert.equal(unpackState(null), null);
});

test("windows come back as the model's own from the kept starts", () => {
  const {state, windows} = layout;
  assert.deepEqual(windows, windowsOf(state, map.corners, LENGTH_M));
});
