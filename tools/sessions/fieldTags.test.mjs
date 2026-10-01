// Run: node --test tools/sessions/fieldTags.test.mjs
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {encode} from './field.mjs';
import {decodeField, lapFieldFacts} from './fieldTags.mjs';
import {lapTraffic} from './lapTraffic.mjs';

const DT = 0.2;
const cars = [
  {id: 0, class: 'GT3', vehicle: 'A', player: true},
  {id: 1, class: 'GT3', vehicle: 'B', player: false},
  {id: 2, class: 'GT3', vehicle: 'C', player: false},
  // Parked far away: only makes the lap 4000 m long for the wrap maths.
  {id: 3, class: 'GT3', vehicle: 'D', player: false},
  {id: 4, class: 'Hypercar', vehicle: 'E', player: false},
];

// rows(u) -> {0: {lapDist, lane, flag, inPits}, 1: ...} for update u.
function build(n, rows) {
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
  for (let u = 0; u < n; u++) {
    const now = rows(u);
    for (const c of cars) {
      const v = now[c.id];
      if (!v) continue;
      r.et.push(10 + u * DT);
      r.id.push(c.id);
      r.lapDist.push(v.lapDist);
      r.pathLateral.push(v.lane ?? 0);
      r.x.push(0);
      r.z.push(0);
      r.oriX.push(0);
      r.oriZ.push(1);
      r.place.push(c.id + 1);
      r.laps.push(1);
      r.inPits.push(v.inPits ? 1 : 0);
      r.flag.push(v.flag ?? 0);
    }
  }
  return encode(r, cars);
}
const V = 250 / 3.6; // player speed, m/s
const me = u => ({lapDist: 100 + u * V * DT, lane: 0});
const far = {lapDist: 4000, lane: 30};
const all = {from: 0, to: 1e9};

test('decodeField gives metres and null where a car is absent', () => {
  const f = build(3, u => ({0: me(u), 3: far, ...(u === 1 ? {1: me(u)} : {})}));
  const d = decodeField(f);
  assert.equal(d.cars[1].lapDistM[0], null);
  assert.equal(d.cars[1].lapDistM[1], Math.round(me(1).lapDist * 10) / 10);
  assert.equal(d.etS[2], 10.4);
});

test('draft: a car 20 m ahead in the lane above 200 km/h, counted from the second update', () => {
  const f = build(20, u => ({
    0: me(u),
    1: {lapDist: me(u).lapDist + 20, lane: 1.5},
    3: far,
  }));
  const [t] = lapFieldFacts(f, [all]);
  assert.equal(t.draftS, 3.8); // 19 updates with a speed
  assert.equal(t.trafficAheadS, 3.8); // 20 / 69 m/s = 0.29 s; no speed at update 0
  assert.equal(t.trafficBehindS, 0);
});

test('draft: not in the lane, too far, or too slow', () => {
  const at = (gap, lane, speedKmh) => {
    const v = speedKmh / 3.6;
    const f = build(10, u => ({
      0: {lapDist: 100 + u * v * DT, lane: 0},
      1: {lapDist: 100 + u * v * DT + gap, lane},
      3: far,
    }));
    return lapFieldFacts(f, [all])[0];
  };
  assert.equal(at(20, 3, 250).draftS, 0); // next lane
  assert.equal(at(35, 0, 250).draftS, 0); // past 30 m
  assert.equal(at(20, 0, 150).draftS, 0); // below 200 km/h
  assert.equal(at(30, 0, 250).draftS, 1.8); // 30 m counts
  // 35 m at 250 km/h is still traffic (0.5 s) though not draft.
  assert.equal(at(35, 0, 250).trafficAheadS, 1.8);
});

test('traffic behind and the 1 s edge', () => {
  const f = build(10, u => ({
    0: me(u),
    1: {lapDist: me(u).lapDist - V * 1.5, lane: 0}, // 1.5 s behind
    2: {lapDist: me(u).lapDist - V * 0.5, lane: 0}, // 0.5 s behind
    3: far,
  }));
  const [t] = lapFieldFacts(f, [all]);
  assert.equal(t.trafficBehindS, 1.8); // nearest car is 0.5 s back
  assert.equal(t.trafficAheadS, 0);
});

test('passes: made and suffered, per lap window, cars in the pits ignored', () => {
  // Car 1 starts 30 m behind and is 30 m ahead 3 s later (suffered, update 15).
  // Car 2 starts 30 m ahead, then drops back through the player (made).
  const f = build(40, u => ({
    0: me(u),
    1: {lapDist: me(u).lapDist - 30 + u * 4, lane: 3},
    2: {lapDist: me(u).lapDist + 30 - Math.max(0, u - 20) * 4, lane: 3},
    3: far,
  }));
  const whole = lapFieldFacts(f, [all])[0];
  assert.equal(whole.passesSuffered, 1);
  assert.equal(whole.passesMade, 1);
  const halves = lapFieldFacts(f, [
    {from: 0, to: 10 + 20 * DT},
    {from: 10 + 20 * DT, to: 1e9},
  ]);
  assert.deepEqual(
    halves.map(h => [h.passesSuffered, h.passesMade]),
    [
      [1, 0],
      [0, 1],
    ],
  );
  const pit = build(40, u => ({
    0: me(u),
    1: {lapDist: me(u).lapDist - 30 + u * 4, lane: 3, inPits: true},
    3: far,
  }));
  assert.equal(lapFieldFacts(pit, [all])[0].passesSuffered, 0);
});

test('the game flag is gameBlueS, and windows are [from, to)', () => {
  const f = build(30, u => ({
    0: {...me(u), flag: u >= 5 && u < 15 ? 6 : 0},
    3: far,
  }));
  assert.equal(lapFieldFacts(f, [all])[0].gameBlueS, 2);
  const [a, b] = lapFieldFacts(f, [
    {from: 10, to: 10 + 10 * DT},
    {from: 10 + 10 * DT, to: 1e9},
  ]);
  assert.equal(a.gameBlueS, 1); // updates 5-9
  assert.equal(b.gameBlueS, 1); // updates 10-14
});

test('blueFlagS is a faster-class car within 1.5 s behind, whatever the game flag says', () => {
  // The latched case (#1534): the game flags the player with nothing near.
  const latched = build(30, u => ({
    0: {...me(u), flag: 6},
    3: far,
  }));
  const l = lapFieldFacts(latched, [all])[0];
  assert.equal(l.blueFlagS, 0);
  assert.equal(l.gameBlueS, 6);
  // A Hypercar 60 m (0.9 s) behind for updates 5-14 is 2 s of blue.
  const near = build(30, u => ({
    0: me(u),
    4: {lapDist: me(u).lapDist - (u >= 5 && u < 15 ? 60 : 400), lane: 5},
    3: far,
  }));
  assert.equal(lapFieldFacts(near, [all])[0].blueFlagS, 2);
  // 150 m (2.2 s) behind is not blue.
  const wide = build(30, u => ({
    0: me(u),
    4: {lapDist: me(u).lapDist - 150, lane: 5},
    3: far,
  }));
  assert.equal(lapFieldFacts(wide, [all])[0].blueFlagS, 0);
  // A car of the player's own class behind is a battle, not blue.
  const same = build(30, u => ({
    0: me(u),
    1: {lapDist: me(u).lapDist - 60, lane: 5},
    3: far,
  }));
  assert.equal(lapFieldFacts(same, [all])[0].blueFlagS, 0);
  // A faster car ahead is not blue.
  const ahead = build(30, u => ({
    0: me(u),
    4: {lapDist: me(u).lapDist + 60, lane: 5},
    3: far,
  }));
  assert.equal(lapFieldFacts(ahead, [all])[0].blueFlagS, 0);
});

test('spans: where traffic and blue were, adding up to the seconds', () => {
  // A GT3 30 m ahead in lane for updates 5-14 (0.43 s ahead: traffic), a
  // gap of two updates, then again for 20-24; a Hypercar 60 m behind for 8-17.
  const f = build(40, u => ({
    0: me(u),
    1: {
      lapDist:
        me(u).lapDist + ((u >= 5 && u < 15) || (u >= 20 && u < 25) ? 30 : 300),
      lane: 0,
    },
    4: {lapDist: me(u).lapDist - (u >= 8 && u < 18 ? 60 : 500), lane: 5},
    3: far,
  }));
  const t = lapFieldFacts(f, [all])[0];
  const sum = spans =>
    Math.round(spans.reduce((a, s) => a + s.s, 0) * 10) / 10;
  assert.equal(t.aheadSpans.length, 2);
  assert.equal(sum(t.aheadSpans), t.trafficAheadS);
  assert.equal(t.blueSpans.length, 1);
  assert.equal(sum(t.blueSpans), t.blueFlagS);
  // The first span starts where the player was at update 5 and ends one step
  // past update 14.
  const step = V * DT;
  assert.equal(t.aheadSpans[0].fromM, Math.round(me(5).lapDist * 10) / 10);
  assert.ok(Math.abs(t.aheadSpans[0].toM - (me(14).lapDist + step)) < 0.5);
});

test('the field lap length rides with the block, for scaling the spans', () => {
  const f = build(10, u => ({0: me(u), 3: far}));
  assert.equal(lapFieldFacts(f, [all])[0].fieldLapM, 4000);
});

test('spans are per window, and passes carry where they happened', () => {
  const f = build(40, u => ({
    0: me(u),
    1: {lapDist: me(u).lapDist - 30 + u * 4, lane: 3},
    3: far,
  }));
  const t = lapFieldFacts(f, [all])[0];
  assert.deepEqual(t.aheadSpans, []);
  assert.equal(t.passMarks.length, t.passesMade + t.passesSuffered);
  assert.equal(typeof t.passMarks[0].atM, 'number');
});

test('no player car in the field: nulls', () => {
  const noPlayer = build(5, u => ({1: me(u), 3: far}));
  noPlayer.cars[0].player = false;
  assert.deepEqual(lapFieldFacts(noPlayer, [all, all]), [null, null]);
});

test('a gap that rounds to exactly zero is not a second pass', () => {
  // Car 1 runs alongside for two updates (0.0 m), then ahead: one pass.
  const gaps = [-0.4, -0.2, 0, 0, 0.2, 0.4, 0.6];
  const f = build(gaps.length, u => ({
    0: me(u),
    1: {lapDist: me(u).lapDist + gaps[u], lane: 3},
    3: far,
  }));
  const [t] = lapFieldFacts(f, [all]);
  assert.equal(t.passesSuffered, 1);
  assert.equal(t.passesMade, 0);
});

test('extra columns in the field change nothing (read by name)', () => {
  const f = build(5, u => ({
    0: me(u),
    1: {lapDist: me(u).lapDist + 20, lane: 0},
    3: far,
  }));
  const withYaw = {
    ...f,
    v: 3,
    yawCrad: f.cars.map(() => new Array(5).fill(1)),
    extra: 1,
  };
  assert.deepEqual(lapFieldFacts(withYaw, [all]), lapFieldFacts(f, [all]));
});

// A Hypercar lapping a GT3 is not a lost place: passes count the player's
// class, the All counts take every car (apex, pit wall thread 27 #820).
test('passes and battle are class-aware; the All counts are not', () => {
  const was = cars[1].class;
  cars[1].class = 'Hyper';
  try {
    // Car 1 (Hyper) starts 30 m behind and passes; car 2 (GT3) starts 30 m
    // ahead and drops back through the player.
    const f = build(40, u => ({
      0: me(u),
      1: {lapDist: me(u).lapDist - 30 + u * 4, lane: 3},
      2: {lapDist: me(u).lapDist + 30 - Math.max(0, u - 20) * 4, lane: 3},
      3: far,
    }));
    const [t] = lapFieldFacts(f, [all]);
    assert.equal(t.passesSuffered, 0); // the Hyper's pass is not a lost place
    assert.equal(t.passesSufferedAll, 1);
    assert.equal(t.passesMade, 1);
    assert.equal(t.passesMadeAll, 1);
  } finally {
    cars[1].class = was;
  }
});

test('battleS: seconds within 1 s of a same-class car, either side, any lane', () => {
  // Car 1 (GT3) 0.5 s ahead in the next lane; car 2 (Hyper) 0.5 s behind.
  const was = cars[2].class;
  cars[2].class = 'Hyper';
  try {
    const f = build(10, u => ({
      0: me(u),
      1: {lapDist: me(u).lapDist + V * 0.5, lane: 5},
      2: {lapDist: me(u).lapDist - V * 0.5, lane: 0},
      3: far,
    }));
    const [t] = lapFieldFacts(f, [all]);
    assert.equal(t.battleS, 1.8); // 9 updates with a speed, counted once each
    assert.equal(t.trafficAheadS, 0); // next lane: not traffic on the line
    // Only a car of another class near: no battle.
    const other = build(10, u => ({
      0: me(u),
      2: {lapDist: me(u).lapDist - V * 0.5, lane: 0},
      3: far,
    }));
    assert.equal(lapFieldFacts(other, [all])[0].battleS, 0);
  } finally {
    cars[2].class = was;
  }
});

// Firestore refuses an array directly inside an array, and every lap doc is
// written to it: the traffic block of every kind of lap must have none
// (the v3 spans were [a, b, c] and blocked a rollout).
test('no array inside an array anywhere in a traffic block', () => {
  const nested = (v, path = 'traffic') => {
    if (Array.isArray(v)) {
      assert.ok(!v.some(Array.isArray), `array in array at ${path}`);
      v.forEach((x, i) => nested(x, `${path}[${i}]`));
    } else if (v && typeof v === 'object')
      for (const [k, x] of Object.entries(v)) nested(x, `${path}.${k}`);
  };
  const f = build(40, u => ({
    0: me(u),
    1: {
      lapDist: me(u).lapDist + (u >= 5 && u < 15 ? 30 : 300),
      lane: 0,
    },
    4: {lapDist: me(u).lapDist - (u >= 8 && u < 18 ? 60 : 500), lane: 5},
    3: far,
  }));
  const [t] = lapFieldFacts(f, [all]);
  assert.ok(t.aheadSpans.length > 0 && t.blueSpans.length > 0);
  nested(t);
  nested(lapTraffic(f, [all])[0]);
});
