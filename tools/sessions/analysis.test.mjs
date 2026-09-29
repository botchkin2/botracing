// Tests for the shared analysis modules. Run: node --test tools/sessions/
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {
  analyzeConsistency,
  normalRacing,
  selectNormalRacing,
} from '../../src/analysis/consistency.ts';
import {
  findTrackCorners,
  findTrackSections,
  segmentTimes,
} from '../../src/analysis/corners.ts';

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
    return lap({
      id: `${stint}-${i}`,
      lapNumber: i + 1,
      stint,
      stintLap: i,
      segs,
    });
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
      // A corner is taken at 100 km/h with a lift, or flat out at 200.
      const slow = p.radius && !p.flat;
      speed.push(slow ? 100 : 200);
      const braking = p.brakeLast && i >= n - p.brakeLast / step;
      brake.push(braking ? 0.8 : 0);
      throttle.push(slow || braking ? 0.3 : 1);
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
  const corners = [{entryM: 100}, {entryM: 500}, {entryM: 900}];
  const timeAt = m => m / 50;
  const segs = segmentTimes(corners, 1200, timeAt);
  assert.equal(
    segs.reduce((a, b) => a + b, 0),
    24,
  );
  assert.equal(segs[2], (1200 - 900) / 50 + 100 / 50);
});

test('a harmless early spin rejoins the reference for a later wreck', () => {
  const a = stint({laps: 16, slope: 0});
  a[2] = {...a[2], offTrackSec: 4}; // spin, no lasting loss
  a[9] = {...a[9], offTrackSec: 10, lapTime: a[9].lapTime + 15};
  for (let i = 10; i < 16; i++) a[i] = addLoss(a[i], 2, 0.8);
  const {reasons, damage} = selectNormalRacing(a);
  assert.deepEqual(
    damage.map(d => [d.incidentLap, d.flagged, d.reference]),
    [
      [3, false, 'same-stint'],
      [10, true, 'same-stint'],
    ],
  );
  for (let i = 3; i < 9; i++) assert.deepEqual(reasons.get(a[i].id), []);
  for (let i = 10; i < 16; i++) {
    assert.deepEqual(reasons.get(a[i].id), ['damage']);
  }
});

test('a damaged car alternating around the far-off-pace cut stays one stretch', () => {
  const a = stint({laps: 16, slope: 0});
  a[4] = {...a[4], offTrackSec: 12, lapTime: a[4].lapTime + 20};
  for (let i = 5; i < 16; i++) a[i] = addLoss(a[i], 3, i % 2 ? 7 : 0.8);
  const {reasons, damage} = selectNormalRacing(a);
  assert.equal(damage.length, 1);
  assert.equal(damage[0].flagged, true);
  for (let i = 5; i < 16; i++) {
    assert.deepEqual(
      reasons.get(a[i].id),
      i % 2 ? ['far-off-pace'] : ['damage'],
    );
  }
});

test('a switch to wets in the rain is conditions, not cold tyres, damage or far off pace', () => {
  const dry = stint({laps: 12, slope: 0}).map(l => ({...l, compound: '0/0'}));
  const wet = stint({laps: 14, stint: 2, slope: 0, seed: 5}).map(l =>
    addLoss({...l, compound: '1/1', wetness: 12, tyreCarcassC: 62}, 5, 9),
  );
  wet[0] = {...wet[0], pitOut: true};
  wet[4] = {...wet[4], offTrackSec: 5, lapTime: wet[4].lapTime + 15};
  const {reasons, damage} = selectNormalRacing([...dry, ...wet]);
  for (const l of wet.slice(5)) assert.deepEqual(reasons.get(l.id), []);
  assert.ok(damage.every(d => !d.flagged));
});

test('the optimal lap uses only the most common conditions', () => {
  const dry = stint({laps: 10, slope: 0}).map(l => ({...l, compound: '0/0'}));
  // Three wet laps with an impossibly quick section 1 must not count.
  const wet = stint({laps: 3, stint: 2, slope: 0, seed: 9}).map(l => ({
    ...addLoss(l, 1, -3),
    compound: '1/1',
    wetness: 20,
  }));
  const r = analyzeConsistency([...dry, ...wet]);
  assert.ok(r.corners[0].bestLap <= 10 && r.corners[0].bestLap >= 1);
  assert.ok(dry.some(l => l.lapNumber === r.corners[0].bestLap));
});

test('a section best skips an off-track pass but keeps the rest of that lap', () => {
  const laps = stint({laps: 10, slope: 0});
  // Lap 3 is fastest everywhere, but went off in section 2.
  laps[2] = {
    ...laps[2],
    corners: laps[2].corners.map((c, k) => ({
      ...c,
      segTime: c.segTime - 0.5,
      offTrackSec: k === 1 ? 1.2 : 0,
    })),
    lapTime: laps[2].lapTime - 2.5,
  };
  const r = analyzeConsistency(laps);
  assert.equal(r.corners[0].bestLap, 3);
  assert.notEqual(r.corners[1].bestLap, 3);
  assert.equal(r.corners[2].bestLap, 3);
  assert.ok(r.summary.optimalLap > r.summary.bestLap);
});

test('a corner with a straight before it starts a section; a lift into a braking zone joins the corner after', () => {
  // Road Atlanta's shape: T1 off the straight, a short run, T2 taken with a
  // lift straight into the braking for T3.
  const p = track([
    {length: 500, brakeLast: 100},
    {length: 120, radius: 60, left: false}, // T1
    {length: 200}, // about 3.6 s at full throttle
    {length: 60, radius: 60, left: true}, // T2, a lift
    {length: 60, brakeLast: 60},
    {length: 90, radius: 50, left: false}, // T3, braked
    {length: 600},
  ]);
  assert.equal(findTrackCorners(p).length, 3);
  const sections = findTrackSections(p);
  assert.deepEqual(
    sections.map(s => s.parts.map(c => c.direction)),
    [['right'], ['left', 'right']],
  );
  assert.equal(sections[1].direction, 'mixed');
});

test('a flat corner is part of the straight after the corner before it', () => {
  const p = track([
    {length: 400, brakeLast: 80},
    {length: 120, radius: 60, left: true},
    {length: 300},
    {length: 150, radius: 150, left: false, flat: true},
    {length: 400},
  ]);
  const corners = findTrackCorners(p);
  assert.deepEqual(
    corners.map(c => c.flat),
    [false, true],
  );
  const sections = findTrackSections(p);
  assert.equal(sections.length, 1);
  assert.equal(sections[0].parts.length, 2);
});

test('braked corners with only a short run between them are one section', () => {
  const p = track([
    {length: 500, brakeLast: 100},
    {length: 90, radius: 50, left: false},
    {length: 60, brakeLast: 40}, // about 0.4 s at full throttle
    {length: 90, radius: 50, left: true},
    {length: 400, brakeLast: 100},
    {length: 120, radius: 60, left: false},
    {length: 600},
  ]);
  const sections = findTrackSections(p);
  assert.deepEqual(
    sections.map(s => s.parts.length),
    [2, 1],
  );
});

test('the apex is the slowest point, or the tightest one when that is an edge', () => {
  const p = track([
    {length: 400, brakeLast: 80},
    {length: 150, radius: 60, left: true},
    {length: 400},
  ]);
  const [s0, s1] = [400 / 5 + 1, 550 / 5];
  // A slow corner: slowest in its middle, so that is the apex.
  const dip = {
    ...p,
    speedKmh: p.speedKmh.map((v, i) =>
      i >= s0 && i <= s1 ? 100 + Math.abs(i - 95) : v,
    ),
  };
  const [slow] = findTrackCorners(dip);
  assert.ok(Math.abs(slow.apexM - 475) <= 10, `slow apex ${slow.apexM}`);
  // Accelerating through it: slowest at turn-in, so the apex is where it
  // turns tightest, inside the corner and not on its edge.
  const rising = {
    ...p,
    // Rising from well before the corner to well after it.
    speedKmh: p.speedKmh.map((v, i) =>
      i >= 60 && i <= 130 ? 80 + (i - 60) * 2 : v,
    ),
  };
  const [fast] = findTrackCorners(rising);
  assert.ok(
    fast.apexM - fast.turnInM > 5 && fast.exitM - fast.apexM > 5,
    `apex ${fast.apexM} in ${fast.turnInM}-${fast.exitM}`,
  );
});
