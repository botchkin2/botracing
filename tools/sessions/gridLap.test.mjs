// Run: node --test tools/sessions/gridLap.test.mjs
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {lapTicks} from './analyze.mjs';
import {
  GRID_PARKED_SEC,
  jumpsOffTheGrid,
  MAX_TICK_RISE_M,
  partialWhy,
  racingSpan,
} from './gridLap.mjs';

// A 100 Hz lap at 50 m/s: 0.5 m per tick.
const roll = (from, n) => Array.from({length: n}, (_, i) => from + i * 0.5);

test('a lap that rolls along is not a grid start', () => {
  assert.equal(jumpsOffTheGrid(roll(0, 2000)), false);
});

test('a lap that starts standing still and then rolls is not a grid start', () => {
  const standing = new Array(500).fill(0);
  assert.equal(jumpsOffTheGrid([...standing, ...roll(0, 500)]), false);
});

test('parked on the grid at 0, then the distance jumps to the grid slot (Sebring lap 0)', () => {
  // Sebring 574eec6c: 5,181 ticks at 0, a ramp of 485 m per tick, then 17 m/s.
  const parked = new Array(5181).fill(0);
  const ramp = [485, 970, 1455, 1940, 2425, 2910, 3395, 3880, 4365, 4850];
  assert.equal(jumpsOffTheGrid([...parked, ...ramp, ...roll(4850, 300)]), true);
});

test('a trace that opens far along the lap, with no jump to see (Daytona lap 0, grid at 67 %)', () => {
  assert.equal(jumpsOffTheGrid(roll(3635, 3500)), true);
  assert.equal(jumpsOffTheGrid(roll(MAX_TICK_RISE_M, 500)), false);
});

test('a standing start from the line is a lap: parked at 0, then rolling, no jump', () => {
  // Sebring 6121da, the second lap 0: 93 s still at the line, then a smooth lap.
  const parked = new Array(9355).fill(0);
  assert.equal(jumpsOffTheGrid([...parked, ...roll(0, 3000)]), false);
});

test('a single jump over the limit is enough, one at the limit is not', () => {
  assert.equal(jumpsOffTheGrid([0, MAX_TICK_RISE_M]), false);
  assert.equal(jumpsOffTheGrid([0, MAX_TICK_RISE_M + 1]), true);
});

test('empty and one-tick traces have no jump', () => {
  assert.equal(jumpsOffTheGrid([]), false);
  assert.equal(jumpsOffTheGrid([0]), false);
});

test('partialWhy: parked then jumped is grid; a jump without the parked start, or a cut lap, is file', () => {
  // Sebring 574eec6c: parked 52 s at 0 of a 243 s segment of 11,250 ticks.
  const sebring = [...new Array(5181).fill(0), 485, 970, 1455, 1940];
  assert.equal(partialWhy(false, sebring, 242.8), 'grid');
  // Daytona db47a83b: opens at 67 % of the lap and sits there.
  const daytona = [...new Array(6000).fill(3635), ...roll(3635, 3000)];
  assert.equal(partialWhy(false, daytona, 280.8), 'grid');
  // Imola practice d184d6e1 lap 1: 1.4 s long, opens at 98 % of the lap.
  assert.equal(partialWhy(false, [4809, 4810, 4812], 1.428), 'file');
  // A long untimed lap that jumps mid-way without sitting parked first.
  assert.equal(partialWhy(false, [...roll(0, 4000), 5000, 5001], 128), 'file');
  // Parked just under the limit.
  const brief = [...new Array(GRID_PARKED_SEC * 10 - 1).fill(0), 900, 901];
  assert.equal(partialWhy(false, brief, GRID_PARKED_SEC + 0.2), 'file');
  // Cut by a recording boundary, no jump: still file.
  assert.equal(partialWhy(true, roll(0, 100), 40), 'file');
  assert.equal(partialWhy(false, roll(0, 100), 40), null);
});

// A rolling-start race's lap 0 (Road Atlanta, seat-test 0acca4e2): parked on the grid slot at 2185 m,
// the formation lap to the line at 3656 m, then the racing lap from 0 to 4081 m. Ticks of 1 m, 10 m/s on the lap.
const gridRace = ({racingM = 4081, tail = 0} = {}) => [
  ...new Array(100).fill(2185),
  ...Array.from({length: 1471}, (_, i) => 2185 + i),
  ...Array.from({length: racingM}, (_, i) => i),
  ...Array.from({length: tail}, (_, i) => i),
];
const dropsOf = d => d.map((v, i) => (i > 0 && d[i - 1] - v > 150 ? i : -1)).filter(i => i >= 0);

test('the racing lap of a grid start is the span after the formation line, not the stretch up to it (ticket #49)', () => {
  const d = gridRace();
  const resets = dropsOf(d);
  assert.deepEqual(resets, [1571]);
  assert.deepEqual(racingSpan(d, 0, d.length - 1, resets), [1571, d.length - 1]);
});

test('a lap that starts at the line has no grid span: the first span is the lap', () => {
  const lap = Array.from({length: 4081}, (_, i) => i);
  const d = [...lap, ...lap.slice(0, 20)]; // the end beacon came after the line
  assert.equal(racingSpan(d, 0, d.length - 1, dropsOf(d)), null);
});

test('a grid start whose racing lap is cut short keeps the old first span', () => {
  const d = gridRace({racingM: 1500});
  assert.equal(racingSpan(d, 0, d.length - 1, dropsOf(d)), null);
});

test('a grid start whose end beacon came after the second line takes the span between the two lines', () => {
  const d = gridRace({tail: 30});
  const resets = dropsOf(d);
  assert.equal(resets.length, 2);
  assert.deepEqual(racingSpan(d, 0, d.length - 1, resets), [resets[0], resets[1] - 1]);
});

// lapTicks through a recording shaped like the stored one: ticks 10 ms apart, the lap beacon at the start only.
test('lapTicks gives a grid start its racing lap and a plain lap its own ticks', () => {
  const d = gridRace();
  const t = d.map((_, i) => i * 0.01);
  const rec = {s: {t, lap_dist_m: d}};
  const seg = {start: 0, end: t[t.length - 1], lapNumber: 0, partial: true};
  const [i0, i1, grid] = lapTicks(rec, seg);
  assert.deepEqual([i0, i1], [1571, d.length - 1]);
  assert.deepEqual(grid, [0, 1570]);
  assert.equal(d[i0], 0);
  assert.equal(d[i1], 4080);
  // a lap that rolls from the line is untouched, whatever follows it
  const plain = Array.from({length: 4081}, (_, i) => i);
  const rec2 = {s: {t: plain.map((_, i) => i * 0.01), lap_dist_m: plain}};
  assert.deepEqual(lapTicks(rec2, {start: 0, end: 40.8}), [0, 4080, null]);
});
