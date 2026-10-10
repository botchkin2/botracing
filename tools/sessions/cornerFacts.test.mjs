import assert from 'node:assert/strict';
import {test} from 'node:test';
import {windowsOf} from '../../src/analysis/cornerBoundaries.ts';
import {cornerFacts} from './cornerFacts.mjs';
import {docProblems} from './docShape.mjs';
import {LENGTH_M, makeLap, map} from './syntheticLap.mjs';
import {
  mapKeyOf,
  packState,
  sessionBoundaries,
  unpackState,
} from './layoutBoundaries.mjs';

const flags = {local: [], course: []};
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
  assert.equal('sessions' in packed, false);
  const back = unpackState(JSON.parse(JSON.stringify(packed)));
  assert.deepEqual(back.sessions, {});
  assert.deepEqual(back.startsM, state.startsM);
  assert.equal(unpackState(null), null);
});

test("windows come back as the model's own from the kept starts", () => {
  const {state, windows} = layout;
  assert.deepEqual(windows, windowsOf(state, map.corners, LENGTH_M));
});

test('what a lap doc and the track doc carry from here passes the Firestore shape check', () => {
  const {corners, startStraight} = factsOf(laps[0], layout);
  const lapDoc = {
    corners,
    startStraight,
    cornerBoundaries: {v: layout.state.v, rev: layout.state.rev},
  };
  assert.deepEqual(docProblems(lapDoc), []);
  assert.deepEqual(docProblems(packState(layout.state)), []);
  assert.deepEqual(
    docProblems({
      boundaries: {
        v: layout.state.v,
        rev: layout.state.rev,
        startsM: layout.state.startsM,
        marginM: layout.state.marginM,
        windows: layout.windows,
      },
    }),
    [],
  );
});

// One lap driven from functions of distance, 100 Hz, for the inputs below: a
// section of two corners (a right at 300-400 m braked for at 210 m, a left at
// 430-520 m with only a lift), the way Road Atlanta's T2/T3 sit in one window.
const INPUT_LENGTH = 1000;
const INPUT_MAP = {
  lengthM: INPUT_LENGTH,
  corners: [
    {
      n: 1,
      direction: 'mixed',
      entryM: 200,
      turnInM: 300,
      apexM: 350,
      exitM: 520,
      parts: [
        {n: 1, direction: 'right', entryM: 200, turnInM: 300, apexM: 350, exitM: 400, minSpeedKmh: 72},
        {n: 2, direction: 'left', entryM: 410, turnInM: 430, apexM: 470, exitM: 520, minSpeedKmh: 90},
      ],
    },
  ],
};
const INPUT_WINDOWS = [
  {kind: 'start-straight', section: null, fromM: 0, toM: 200, parts: []},
  {
    kind: 'section',
    section: 1,
    fromM: 200,
    toM: INPUT_LENGTH,
    parts: [
      {n: 1, turnInM: 300, fromM: 200, toM: 410},
      {n: 2, turnInM: 430, fromM: 410, toM: INPUT_LENGTH},
    ],
  },
];
const ramp = (d, from, to, peak) =>
  d <= from || d >= to ? 0 : (peak * (d - from)) / (to - from);
function drive({rightPositive = true} = {}) {
  const sign = rightPositive ? 1 : -1;
  const t = [], dist = [], speed = [], brake = [], throttle = [], steer = [];
  let d = 0;
  let time = 1000;
  while (d < INPUT_LENGTH) {
    const v = d >= 300 && d < 400 ? 20 : d >= 430 && d < 520 ? 25 : 50;
    t.push(time);
    dist.push(d);
    speed.push(v * 3.6);
    brake.push(d >= 210 && d < 290 ? 80 : 0);
    // Closed from the brake until the right-hander's apex, a lift only in the left.
    throttle.push(d >= 210 && d < 355 ? 0 : d >= 420 && d < 470 ? 60 : 100);
    // Right: wheel eases in from 280 m to 30 % at the apex, out by 400 m.
    // Left: from 440 m to -25 % at 470 m.
    const right = ramp(d, 280, 350, 30) || ramp(d, 400, 350, 30);
    const left = ramp(d, 440, 470, 25) || ramp(d, 520, 470, 25);
    steer.push(sign * (right - left));
    d += v / 100;
    time += 0.01;
  }
  const n = t.length;
  const gridN = Math.floor(INPUT_LENGTH / 5) + 1;
  const grid = {time: new Float64Array(gridN)};
  let j = 0;
  for (let g = 0; g < gridN; g++) {
    while (j < n - 2 && dist[j + 1] < g * 5) j++;
    grid.time[g] = t[j] - t[0];
  }
  return {
    rec: {
      s: {
        t: Float64Array.from(t),
        speed_kmh: Float64Array.from(speed),
        brake_pct: Float64Array.from(brake),
        throttle_pct: Float64Array.from(throttle),
        steer_pct: Float64Array.from(steer),
      },
      hz: {brake_pct: 100, throttle_pct: 100},
      baseHz: 100,
    },
    lap: {
      grid,
      dist,
      i0: 0,
      i1: n - 1,
      distanceM: INPUT_LENGTH,
      lapTime: t[n - 1] - t[0],
      off: new Uint8Array(n),
    },
  };
}
const inputsOf = ({rec, lap}, steerRightSign = 1) =>
  cornerFacts({
    rec,
    lap,
    windows: INPUT_WINDOWS,
    sections: INPUT_MAP.corners,
    flags,
    pits: [],
    lengthM: INPUT_LENGTH,
    onsets: [210],
    steerRightSign,
  }).corners[0];

test('each corner of a section reads the brake application braking for it, and no other', () => {
  const [p1, p2] = inputsOf(drive()).parts;
  assert.ok(Math.abs(p1.brakeAtM - 210) <= 0.5, `${p1.brakeAtM}`);
  assert.equal(p1.peakBrakePct, 80);
  // The left-hander only lifts: no brake point, no peak: not the right-hander's.
  assert.equal(p2.brakeAtM, null);
  assert.equal(p2.peakBrakePct, null);
});

test('a section with a single corner has its application as the corner’s', () => {
  const laps1 = [makeLap(580, 1380)];
  const l = factsOf(laps1[0], layoutOf(laps1)).corners[0];
  assert.equal(l.peakBrakePct, 80);
  assert.ok(Math.abs(l.brakeAtM - 580) <= 0.5);
});

test('turn-in is where the wheel leaves 20 % of the corner’s own peak, in either steering sign', () => {
  for (const rightPositive of [true, false]) {
    const [p1, p2] = inputsOf(
      drive({rightPositive}),
      rightPositive ? 1 : -1,
    ).parts;
    // Right: 6 % of the 30 % peak is reached 20 % of the way up the ramp (280 to 350).
    assert.ok(Math.abs(p1.turnInAtM - 294) <= 1.5, `${rightPositive} ${p1.turnInAtM}`);
    // Left: 5 % of 25 % at 20 % of the way from 440 to 470.
    assert.ok(Math.abs(p2.turnInAtM - 446) <= 1.5, `${rightPositive} ${p2.turnInAtM}`);
  }
});

test('throttle pickup ends the closed phase; a pedal that only lifts gives its lowest instead', () => {
  const [p1, p2] = inputsOf(drive()).parts;
  assert.ok(Math.abs(p1.throttlePickupAtM - 355) <= 1, `${p1.throttlePickupAtM}`);
  assert.equal(p1.minThrottlePct, 0);
  assert.equal(p2.throttlePickupAtM, null);
  assert.equal(p2.minThrottlePct, 60);
});

test('full throttle is the held point the split uses, one definition', () => {
  const c = inputsOf(drive());
  const [p1] = c.parts;
  assert.ok(Math.abs(p1.fullThrottleAtM - 355) <= 1, `${p1.fullThrottleAtM}`);
  assert.equal(p1.fullThrottleAtEdge, false);
});
