// Run: node --test tools/sessions/raceLanes.parity.test.mjs
// The app's lanes (src/analysis/raceLanes.ts) and the uploader's per-lap
// facts (fieldTags.mjs) are two implementations of the same rules; this runs
// both on one multi-class field and checks the totals agree, so the lanes and
// the lap tags cannot drift.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {raceLanes} from '../../src/analysis/raceLanes.ts';
import {encode} from './field.mjs';
import {lapFieldFacts} from './fieldTags.mjs';

const DT = 0.2;
const N = 600;
const V = 250 / 3.6;
const cars = [
  {id: 0, class: 'GT3', vehicle: null, player: true},
  {id: 1, class: 'GT3', vehicle: null, player: false},
  {id: 2, class: 'Hyper', vehicle: null, player: false},
  {id: 3, class: 'GT3', vehicle: null, player: false},
  // Parked: makes the lap 4000 m long for the wrap maths.
  {id: 4, class: 'GT3', vehicle: null, player: false},
];

// Slow drifts in and out of range, so tows, battles and passes all happen
// several times. The lane offsets are 0.6 m or 3.0 m from the player, never
// exactly 2.0 m: a lane difference on the decimetre grid at exactly the
// threshold compares differently in doubles (the uploader) and float32 (the
// app), and that tie is not what this test is about.
const wave = (u, period, amp, phase = 0) =>
  amp * Math.sin((2 * Math.PI * (u + phase)) / period);
const place = {
  0: u => ({
    lapDist: 100 + u * V * DT,
    lane: 0.3,
    pit: u >= 400 && u < 430,
    flag: u % 150 < 20 ? 6 : 0,
  }),
  1: u => ({
    lapDist: 100 + u * V * DT + 45 + wave(u, 200, 60),
    lane: u % 120 < 70 ? 0.9 : 3.3,
  }),
  2: u => ({lapDist: 100 + u * V * DT - 20 + wave(u, 260, 90, 30), lane: 1.1}),
  3: u => ({lapDist: 100 + u * V * DT + 12.3 + wave(u, 150, 40, 70), lane: 4}),
  4: () => ({lapDist: 4000, lane: 30}),
};

function build() {
  const r = {
    et: [],
    id: [],
    lapDist: [],
    pathLateral: [],
    x: [],
    z: [],
    oriX: [],
    oriZ: [],
    place: [],
    laps: [],
    inPits: [],
    flag: [],
  };
  for (let u = 0; u < N; u++) {
    for (const c of cars) {
      const v = place[c.id](u);
      r.et.push(10 + u * DT);
      r.id.push(c.id);
      r.lapDist.push(v.lapDist);
      r.pathLateral.push(v.lane);
      r.x.push(0);
      r.z.push(0);
      r.oriX.push(0);
      r.oriZ.push(1);
      r.place.push(c.id + 1);
      r.laps.push(0);
      r.inPits.push(v.pit ? 1 : 0);
      r.flag.push(v.flag ?? 0);
    }
  }
  return encode(r, cars);
}

// What toField (src/data/field/adapters.ts) does: running sums, scaled, into
// typed arrays with NaN / -1 for absent.
function decode(file) {
  const sum = (row, unit) => {
    let s = 0;
    return Float32Array.from(row, v => (v === null ? NaN : (s += v) * unit));
  };
  const ints = (row, T) => T.from(row, v => (v === null ? -1 : v));
  return {
    version: file.v,
    hz: file.hz,
    startEtS: file.et0,
    timeS: Float64Array.from(file.tDs, d => d / 10),
    cars: file.cars.map((c, i) => ({
      index: i,
      carClass: c.class,
      vehicle: c.vehicle,
      player: c.player,
      lapDistM: sum(file.lapDistDm[i], 0.1),
      pathLateralM: sum(file.pathLateralDm[i], 0.1),
      xM: sum(file.xDm[i], 0.1),
      zM: sum(file.zDm[i], 0.1),
      yawRad: sum(file.yawCrad[i], 0.01),
      place: ints(file.place[i], Int16Array),
      lapsDone: ints(file.laps[i], Int16Array),
      inPits: ints(file.inPits[i], Int8Array),
      flag: ints(file.flag[i], Int16Array),
    })),
  };
}

const total = spans => spans.reduce((a, s) => a + (s.toS - s.fromS), 0);
const noClock = {playerAt: () => null, timeAtLapDistance: () => null};

test('lane totals equal the per-lap facts on the same field', () => {
  const file = build();
  const facts = lapFieldFacts(file, [{from: 0, to: 1e9}])[0];
  const lanes = raceLanes(decode(file), noClock);
  // The scene must actually exercise every rule, or this proves nothing.
  assert.ok(facts.draftS > 3, `draft ${facts.draftS}`);
  assert.ok(facts.battleS > 3, `battle ${facts.battleS}`);
  assert.ok(facts.passesMade + facts.passesSuffered > 2);
  assert.ok(facts.passesMadeAll > facts.passesMade);
  // Positions are on a 0.1 m grid, so a gap lands exactly on a threshold at
  // some updates, and doubles (the uploader) and float32 (the app) can fall on
  // either side of it. That moves a few updates; a wrong threshold or rule
  // moves tens of seconds in this scene, so the tolerance is 1 s or 5 %.
  const close = (lane, fact, what) =>
    assert.ok(
      Math.abs(lane - fact) <= Math.max(1, 0.05 * fact),
      `${what}: lanes ${lane.toFixed(1)} s vs facts ${fact} s`,
    );
  close(total(lanes.tow), facts.draftS, 'tow');
  close(total(lanes.battle), facts.battleS, 'battle');
  assert.equal(lanes.passes.filter(p => p.made).length, facts.passesMade);
  assert.equal(lanes.passes.filter(p => !p.made).length, facts.passesSuffered);
  assert.ok(total(lanes.pit) > 5);
});
