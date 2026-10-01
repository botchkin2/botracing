// Run: node --test tools/sessions/cornerSlices.test.mjs
// The slice must hold what the app draws from the lap's CSV today: the same
// resampleTrace and sliceSamples, cut in the uploader instead of on the phone.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {
  MAP_AFTER_M,
  MAP_BEFORE_M,
  ZOOM_AFTER_M,
  ZOOM_BEFORE_M,
} from '../../src/analysis/cornerWindows.ts';
import {
  decodeCornerSlices,
  SLICE_CHANNELS,
} from '../../src/analysis/cornerSlices.ts';
import {sliceSamples} from '../../src/analysis/nativeSamples.ts';
import {resampleTrace} from '../../src/analysis/resample.ts';
import {parseTraceCsv} from '../../src/analysis/traceCsv.ts';
import {
  buildCornerSlices,
  mapCorners,
  EXIT_REACH_M,
  SLICE_AFTER_M,
  SLICE_BEFORE_M,
  WINDOW_PAD_M,
} from './cornerSlices.mjs';

const LENGTH_M = 3000;
const ROWS = 3001; // 100 Hz over a 30 s lap at 100 m/s

// A lap in the trace CSV's format. Pedals are recorded at 50 Hz and the
// position and lateral at 10 Hz, so the rows between are empty, as the
// uploader writes them.
function lapCsv({lateral = true, shift = 0} = {}) {
  const header = `Speed,LapDistPct,Lat,Lon,Brake,Throttle,RPM,SteeringWheelAngle,Gear,OffAsphalt${
    lateral ? ',PathLateral,TrackEdge' : ''
  }`;
  const lines = [header];
  for (let i = 0; i < ROWS; i++) {
    const speed = ((100 + 30 * Math.sin(i / 200 + shift)) / 3.6) * 3.6; // m/s
    const cells = [
      speed.toFixed(4),
      (i / (ROWS - 1)).toFixed(6),
      i % 10 === 0 ? (60 + i * 1e-5).toFixed(6) : '',
      i % 10 === 0 ? (i * 1e-5).toFixed(6) : '',
      i % 2 === 0 ? (0.5 + 0.5 * Math.sin(i / 90)).toFixed(4) : '',
      i % 2 === 0 ? (0.5 + 0.5 * Math.cos(i / 90)).toFixed(4) : '',
      '8000.0',
      (0.2 * Math.sin(i / 150)).toFixed(4),
      '3',
      '0',
    ];
    if (lateral) {
      cells.push(i % 10 === 0 ? (2 * Math.sin(i / 300)).toFixed(2) : '');
      cells.push(i % 10 === 0 ? (6 + Math.cos(i / 300)).toFixed(2) : '');
    }
    lines.push(cells.join(','));
  }
  return lines.join('\n');
}

const map = {
  lengthM: LENGTH_M,
  corners: [
    {
      n: 1,
      apexM: 1500,
      parts: [
        {n: 1, apexM: 1400},
        {n: 2, apexM: 1700},
      ],
    },
    {n: 3, apexM: 100},
  ],
};

const build = laps => buildCornerSlices(laps, map);
const decode = (out, n) =>
  decodeCornerSlices(JSON.parse(out.files.find(f => f.n === n).text));

test('one file per corner: parts count as corners, a corner with no parts as itself', () => {
  assert.deepEqual(
    mapCorners(map).map(c => c.n),
    [1, 2, 3],
  );
  const out = build([{id: 'a', csv: () => lapCsv()}]);
  assert.deepEqual(out.corners, [1, 2, 3]);
  assert.equal(out.files.length, 3);
});

test('parity: the slice equals the app path (parse, resample, slice) for every channel', () => {
  const csv = lapCsv();
  const out = build([{id: 'a', csv: () => csv}]);
  const grid = resampleTrace(parseTraceCsv(csv), LENGTH_M, 5);
  const slice = decode(out, 1).laps[0];
  const from = 1400 - SLICE_BEFORE_M;
  const to = 1400 + SLICE_AFTER_M;
  for (const ch of SLICE_CHANNELS) {
    const want = sliceSamples(grid.samples[ch], from, to);
    const got = slice.samples[ch];
    assert.equal(got.distanceM.length, want.distanceM.length, ch);
    assert.ok(got.distanceM.length > 0, `${ch} has samples`);
    got.distanceM.forEach((d, i) => {
      assert.ok(Math.abs(d - want.distanceM[i]) <= 0.0006, `${ch} d[${i}]`);
      assert.ok(
        Math.abs(got.values[i] - want.values[i]) <=
          0.51 * 10 ** -(ch === 'speedKph' ? 3 : 2),
        `${ch} v[${i}] ${got.values[i]} vs ${want.values[i]}`,
      );
    });
  }
  // The time on the 5 m grid, which the delta from entry subtracts.
  const i0 = slice.gridFromM / 5;
  slice.timeS.forEach((t, k) =>
    assert.ok(Math.abs(t - grid.timeS[i0 + k]) <= 0.00006, `timeS[${k}]`),
  );
  assert.equal(slice.gridFromM, 1400 - SLICE_BEFORE_M);
  assert.equal(slice.timeS.length, (SLICE_BEFORE_M + SLICE_AFTER_M) / 5 + 1);
});

test('a slower channel is not held or repeated: brake keeps its 50 Hz samples', () => {
  const csv = lapCsv();
  const out = build([{id: 'a', csv: () => csv}]);
  const brake = decode(out, 1).laps[0].samples.brakePct;
  const speed = decode(out, 1).laps[0].samples.speedKph;
  // Half the rows carry a brake value, and speed has one per row.
  assert.ok(
    Math.abs(speed.distanceM.length / brake.distanceM.length - 2) < 0.1,
  );
});

test('a lap without the lateral columns has empty lateral samples, never zeros', () => {
  const out = build([{id: 'a', csv: () => lapCsv({lateral: false})}]);
  const lap = decode(out, 1).laps[0];
  assert.equal(lap.samples.pathLateralM.values.length, 0);
  assert.equal(lap.samples.trackEdgeM.values.length, 0);
  assert.ok(lap.samples.speedKph.values.length > 0);
});

test('a window that reaches the line is clipped there, not padded', () => {
  const slice = decode(build([{id: 'a', csv: () => lapCsv()}]), 3);
  assert.deepEqual(slice.windowM, [0, 100 + SLICE_AFTER_M]);
  const first = slice.laps[0].samples.speedKph.distanceM[0];
  assert.ok(first >= 0 && first < 1, `starts at the line: ${first}`);
  assert.equal(slice.laps[0].gridFromM, 0);
});

test('laps keep their ids and order; the hash follows the content', () => {
  const a = build([
    {id: 'x-000', csv: () => lapCsv()},
    {id: 'x-001', csv: () => lapCsv({shift: 1})},
  ]);
  assert.deepEqual(
    decode(a, 1).laps.map(l => l.id),
    ['x-000', 'x-001'],
  );
  const same = build([
    {id: 'x-000', csv: () => lapCsv()},
    {id: 'x-001', csv: () => lapCsv({shift: 1})},
  ]);
  assert.equal(same.hash, a.hash);
  const other = build([
    {id: 'x-000', csv: () => lapCsv()},
    {id: 'x-001', csv: () => lapCsv({shift: 2})},
  ]);
  assert.notEqual(other.hash, a.hash);
  assert.match(a.hash, /^[0-9a-f]{12}$/);
});

test('no map, no slices', () => {
  assert.equal(buildCornerSlices([], null), null);
  assert.equal(buildCornerSlices([], {lengthM: 3000, corners: []}), null);
});

test('the decoder names the field that is wrong', () => {
  assert.throws(() => decodeCornerSlices({v: 2}), /unknown format/);
  const good = JSON.parse(
    build([{id: 'a', csv: () => lapCsv()}]).files[0].text,
  );
  good.laps[0].samples.speedKph.v = 'x';
  assert.throws(() => decodeCornerSlices(good), /speedKph\.v is not an array/);
});

test('the slice window covers the zoom window and the braking map, so they cannot drift', () => {
  assert.ok(SLICE_BEFORE_M >= ZOOM_BEFORE_M && SLICE_BEFORE_M >= MAP_BEFORE_M);
  assert.ok(SLICE_AFTER_M >= ZOOM_AFTER_M && SLICE_AFTER_M >= MAP_AFTER_M);
  // ...and the file says so: a corner well inside the lap holds the whole window.
  const slice = decode(build([{id: 'a', csv: () => lapCsv()}]), 2);
  assert.deepEqual(slice.windowM, [1700 - MAP_BEFORE_M, 1700 + MAP_AFTER_M]);
});

// The layout's windows for the map above (sections in order: corner 1 with its
// two parts, corner 3), as `windowsOf` gives them; only the extents matter.
const windowsFor = (part2, part1 = {fromM: 1300, toM: 1600}) => [
  {
    kind: 'section',
    section: 1,
    fromM: part1.fromM,
    toM: part2.toM,
    parts: [
      {n: 1, ...part1},
      {n: 2, ...part2},
    ],
  },
  {kind: 'section', section: 3, fromM: 100, toM: 400, parts: []},
];
const windowOf = (windows, n) =>
  decode(buildCornerSlices([{id: 'a', csv: () => lapCsv()}], map, windows), n)
    .windowM;

test('a corner window that reaches past the screen window widens the slice by a pad', () => {
  // Part 2 (apex 1700) runs 1600 to 1950: the apex window ends at 1900, the
  // corner's own at 1950 + the pad.
  const w = windowOf(windowsFor({fromM: 1600, toM: 1950}), 2);
  assert.deepEqual(w, [1700 - SLICE_BEFORE_M, 1950 + WINDOW_PAD_M]);
  // One that starts before the apex window does reaches back to it, less the pad.
  const early = windowOf(windowsFor({fromM: 1100, toM: 1800}), 2);
  assert.equal(early[0], 1100 - WINDOW_PAD_M);
});

test('a window that runs a long way (the last corner, to the line) is capped past the exit', () => {
  // To the line at 3000 m: 2000 m of tri-oval would be 181 KB for 14 laps.
  const w = windowOf(windowsFor({fromM: 1600, toM: 3000}), 2);
  assert.equal(w[1], 1700 + SLICE_AFTER_M + EXIT_REACH_M);
  // The corner's own facts, not the slice, carry the time to the boundary.
  assert.ok(w[1] < 3000);
});

test('a corner with no window keeps the screen window alone', () => {
  const w = windowOf([], 2);
  assert.deepEqual(w, [1700 - SLICE_BEFORE_M, 1700 + SLICE_AFTER_M]);
});
