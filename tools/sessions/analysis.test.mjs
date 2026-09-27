// Tests for the shared analysis modules. Run: node --test tools/sessions/
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {
  analyzeConsistency,
  normalRacing,
  selectNormalRacing,
} from '../../src/analysis/consistency.ts';
import {findTrackCorners, segmentTimes} from '../../src/analysis/corners.ts';

// Deterministic noise, so a failure reproduces.
function noise(seed) {
  let x = seed;
  return () => {
    x = (x * 1103515245 + 12345) % 2147483648;
    return x / 2147483648 - 0.5;
  };
}

// A stint of laps over 5 corners, getting 0.05 s/lap faster.
function stint({laps = 20, stint = 1, slope = -0.05, jitter = 0.1, seed = 1}) {
  const rand = noise(seed);
  const shares = [0.15, 0.2, 0.25, 0.1, 0.3];
  return Array.from({length: laps}, (_, i) => {
    const base = 80 + slope * i;
    const segs = shares.map(s => s * base + rand() * jitter * 0.4);
    return lap({id: `${stint}-${i}`, lapNumber: i + 1, stint, stintLap: i, segs});
  });
}

function lap({id, lapNumber, stint, stintLap, segs, ...rest}) {
  return {
    id,
    lapNumber,
    stint,
    stintLap,
    lapTime: segs.reduce((a, b) => a + b, 0),
    timed: true,
    partial: false,
    pitIn: false,
    pitOut: false,
    start: false,
    newTyres: false,
    offtrack: false,
    offTrackSec: 0,
    impactMax: 0,
    tyreCarcassC: 80,
    courseYellowSec: 0,
    corners: segs.map(segTime => ({segTime, localYellowSec: 0})),
    ...rest,
  };
}

function addLoss(l, corner, seconds) {
  const corners = l.corners.map((c, k) =>
    k === corner - 1 ? {...c, segTime: c.segTime + seconds} : c,
  );
  return {...l, corners, lapTime: l.lapTime + seconds};
}

test('recovers the pace trend and keeps it out of the scatter', () => {
  const r = analyzeConsistency(stint({}));
  assert.ok(Math.abs(r.stints[0].trendPerLap + 0.05) < 0.01);
  assert.ok(r.summary.scatter < 0.1, `scatter ${r.summary.scatter}`);
  assert.ok(r.summary.rawSpread > 0.25, 'raw spread still has the trend');
});

test('a big loss in one corner is an off-pace lap with a mistake there', () => {
  const laps = stint({});
  laps[10] = addLoss(laps[10], 3, 0.8);
  const r = analyzeConsistency(laps);
  const lap = r.laps.find(x => x.id === laps[10].id);
  assert.equal(lap.offPace, true);
  assert.equal(lap.losses[0].corner, 3);
  assert.equal(lap.losses[0].mistake, true);
  assert.equal(r.summary.offPaceLaps, 1);
  assert.equal(r.corners[2].mistakes, 1);
});

test('a loss made back elsewhere is still a mistake, not an off-pace lap', () => {
  const laps = stint({});
  let l = addLoss(laps[8], 2, 0.6);
  l = addLoss(l, 5, -0.6);
  laps[8] = l;
  const r = analyzeConsistency(laps);
  const lap = r.laps.find(x => x.id === l.id);
  assert.equal(lap.offPace, false);
  assert.deepEqual(
    lap.losses.map(x => [x.corner, x.mistake]),
    [[2, true]],
  );
});

test('a noisy short stint gets no invented trend', () => {
  // Big lap-to-lap swings with no drift: a slope fitted to this is noise.
  const swing = [0.6, -0.5, 0.2, -0.7, 0.7, -0.3, 0.5, -0.6];
  const laps = swing.map((d, i) =>
    lap({
      id: `n${i}`,
      lapNumber: i + 1,
      stint: 1,
      stintLap: i,
      segs: [16, 16, 16, 16, 16 + d],
    }),
  );
  const r = analyzeConsistency(laps);
  assert.equal(r.stints[0].trendPerLap, 0);
});

test('normal racing leaves out laps by conditions, never by result', () => {
  const laps = stint({laps: 12});
  laps[0] = {...laps[0], start: true};
  laps[1] = {...laps[1], tyreCarcassC: 60};
  laps[5] = addLoss(laps[5], 2, 1.5); // a big mistake stays in
  laps[11] = {...laps[11], pitIn: true};
  const out = normalRacing(laps);
  assert.deepEqual(out.get(laps[0].id), ['start']);
  assert.deepEqual(out.get(laps[1].id), ['cold-tyres']);
  assert.deepEqual(out.get(laps[5].id), []);
  assert.deepEqual(out.get(laps[11].id), ['pit-in']);
});

test('slower laps after a wreck, until the stop, are possible damage', () => {
  const a = stint({laps: 14, slope: 0});
  a[5] = {...a[5], offTrackSec: 12, lapTime: a[5].lapTime + 20};
  for (let i = 6; i < 14; i++) a[i] = addLoss(a[i], 4, 0.9);
  const b = stint({laps: 6, stint: 2, slope: 0, seed: 3});
  const out = normalRacing([...a, ...b]);
  assert.deepEqual(out.get(a[5].id), ['far-off-pace']);
  for (let i = 6; i < 14; i++) assert.deepEqual(out.get(a[i].id), ['damage']);
  for (const l of b) assert.deepEqual(out.get(l.id), []);
  // The call comes with its evidence.
  const {damage} = selectNormalRacing([...a, ...b]);
  assert.equal(damage.length, 1);
  assert.equal(damage[0].incidentLap, 6);
  assert.deepEqual(damage[0].laps, [7, 8, 9, 10, 11, 12, 13, 14]);
  assert.ok(Math.abs(damage[0].slowerSec - 0.9) < 0.1);
  assert.equal(damage[0].flagged, true);
});

test('a spin with no lasting pace loss is not damage', () => {
  const a = stint({laps: 14, slope: 0});
  a[5] = {...a[5], offTrackSec: 6, lapTime: a[5].lapTime + 12};
  const out = normalRacing(a);
  for (let i = 6; i < 14; i++) assert.deepEqual(out.get(a[i].id), []);
});

// A track drawn from arcs and straights, sampled every 5 m.
function track(pieces) {
  const step = 5;
  const x = [0];
  const y = [0];
  let heading = 0;
  const speed = [200];
  const brake = [0];
  const throttle = [1];
  for (const p of pieces) {
    const n = Math.round(p.length / step);
    for (let i = 0; i < n; i++) {
      if (p.radius) heading += (p.left ? 1 : -1) * (step / p.radius);
      x.push(x[x.length - 1] + step * Math.cos(heading));
      y.push(y[y.length - 1] + step * Math.sin(heading));
      speed.push(p.radius ? 100 : 200);
      const braking = p.brakeLast && i >= n - p.brakeLast / step;
      brake.push(braking ? 0.8 : 0);
      throttle.push(p.radius || braking ? 0.3 : 1);
    }
  }
  return {stepM: step, speedKmh: speed, brake, throttle, x, y};
}

test('finds corners from the shape, and splits an ess', () => {
  const p = track([
    {length: 400, brakeLast: 80},
    {length: 120, radius: 60, left: true},
    {length: 300, brakeLast: 60},
    {length: 100, radius: 70, left: false},
    {length: 100, radius: 70, left: true},
    {length: 400},
  ]);
  const corners = findTrackCorners(p);
  assert.deepEqual(
    corners.map(c => c.direction),
    ['left', 'right', 'left'],
  );
  // The first corner's segment starts where the braking starts.
  assert.ok(Math.abs(corners[0].entryM - 320) <= 15, `${corners[0].entryM}`);
  // The ess shares a boundary at the change of direction.
  assert.ok(corners[2].entryM > corners[1].turnInM);
});

test('a long gentle kink is part of the straight', () => {
  const p = track([
    {length: 300},
    {length: 200, radius: 900, left: true},
    {length: 300},
  ]);
  assert.equal(findTrackCorners(p).length, 0);
});

test('segment times add up to the lap time', () => {
  const corners = [
    {entryM: 100},
    {entryM: 500},
    {entryM: 900},
  ];
  const timeAt = m => m / 50;
  const segs = segmentTimes(corners, 1200, timeAt);
  assert.equal(segs.reduce((a, b) => a + b, 0), 24);
  assert.equal(segs[2], (1200 - 900) / 50 + 100 / 50);
});
