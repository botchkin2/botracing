// Run: node --test tools/curate/buildFromLaps.test.mjs
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mapFromLaps, selectMapLaps} from '../sessions/analyze.mjs';
import {buildFromLaps} from './loader.mjs';

const distanceM = 1000;
const gridN = Math.floor(distanceM / 5) + 1;

function lap(n, {gps = true, length = distanceM} = {}) {
  const fill = v => Float64Array.from({length: gridN}, () => v);
  return {
    lapTime: 60 + n,
    distanceM: length,
    comparable: true,
    timed: true,
    partial: false,
    clean: true,
    courseYellowSec: 0,
    pitlane: false,
    pitIn: false,
    pitOut: false,
    dist: [0, length],
    grid: {
      time: fill(0),
      speed: fill(150),
      throttle: fill(100),
      brake: fill(0),
      lat: fill(gps ? 33.74 : NaN),
      lon: fill(gps ? -84.2 : NaN),
    },
  };
}

const track = {name: 'Test', variant: 'full'};

test('a map needs 3 gridded laps within 1% of the fastest lap', () => {
  const two = [lap(1), lap(2)];
  assert.equal(
    mapFromLaps(selectMapLaps(two).laps, selectMapLaps(two).gridN),
    null,
  );
  const three = [lap(1), lap(2), lap(3)];
  const selected = selectMapLaps(three);
  const built = mapFromLaps(selected.laps, selected.gridN);
  assert.equal(built.laps, 3);
  assert.equal(built.map.lengthM, distanceM);
  assert.equal(built.map.stepM, 5);
  const off = lap(4, {length: distanceM * 1.02});
  const kept = selectMapLaps([...three, off]);
  assert.equal(kept.laps.length, 3);
  assert.ok(kept.laps.every(l => l !== off));
});

test('buildFromLaps returns the plan shape: under 8 laps the map is kept and the boundaries are not', () => {
  const few = buildFromLaps({
    laps: [lap(1), lap(2), lap(3)],
    sim: 'iracing',
    track,
    sessions: [{id: 'sess-a', laps: [lap(1), lap(2), lap(3)]}],
  });
  assert.equal(few.lapsUsed, 3);
  assert.equal(few.gps, true);
  assert.equal(few.boundaries, null);
  assert.equal(few.sessionId, 'sess-a');
  assert.equal(few.map.lengthM, distanceM);

  const none = buildFromLaps({
    laps: [lap(1), lap(2)],
    sim: 'iracing',
    track,
    sessions: [{id: 'sess-a', laps: [lap(1), lap(2)]}],
  });
  assert.equal(none.map, null);
  assert.equal(none.lapsUsed, 0);
  assert.equal(none.boundaries, null);
});

test('a lap marked slow after the map was chosen still counts toward the map', () => {
  const laps = [lap(1), lap(2), lap(3)];
  for (const l of laps) {
    Object.defineProperty(l, 'mapComparable', {
      value: true,
      enumerable: false,
    });
  }
  laps[2].comparable = false;
  assert.equal(selectMapLaps(laps).laps.length, 3);
  assert.equal(Object.keys(laps[0]).includes('mapComparable'), false);
});

test('a grid with no finite position is no GPS, and no map', () => {
  const built = buildFromLaps({
    laps: [lap(1, {gps: false}), lap(2, {gps: false}), lap(3, {gps: false})],
    sim: 'iracing',
    track,
    sessions: [{id: 'sess-a'}],
  });
  assert.equal(built.gps, false);
  assert.equal(built.map, null);
  assert.equal(built.lapsUsed, 0);
});
