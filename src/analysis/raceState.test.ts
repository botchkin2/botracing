import {describe, expect, it} from '@jest/globals';

import {ABSENT, type Field, type FieldCar} from './field';
import {carsAt, OFF_TRACK_M, prepareRace, STOPPED_FOR_S} from './raceState';

const HZ = 5;
const TRACK = 1000;

type Row = {
  /** Lap distance, metres; null when the car is absent. */
  d: number | null;
  lat?: number;
  pit?: boolean;
  yaw?: number;
  place?: number;
  laps?: number;
  x?: number;
  z?: number;
};

// One car from a function of the update index.
function car(
  index: number,
  carClass: string,
  updates: number,
  row: (u: number) => Row,
  player = false,
): FieldCar {
  const c: FieldCar = {
    index,
    carClass,
    vehicle: null,
    player,
    lapDistM: new Float32Array(updates),
    pathLateralM: new Float32Array(updates),
    xM: new Float32Array(updates),
    zM: new Float32Array(updates),
    yawRad: new Float32Array(updates),
    place: new Int16Array(updates),
    lapsDone: new Int16Array(updates),
    inPits: new Int8Array(updates),
    flag: new Int16Array(updates),
  };
  for (let u = 0; u < updates; u++) {
    const r = row(u);
    if (r.d === null) {
      c.lapDistM[u] = NaN;
      c.pathLateralM[u] = NaN;
      c.xM[u] = NaN;
      c.zM[u] = NaN;
      c.yawRad![u] = NaN;
      c.place[u] = ABSENT;
      c.lapsDone[u] = ABSENT;
      c.inPits[u] = ABSENT;
      c.flag[u] = ABSENT;
      continue;
    }
    c.lapDistM[u] = r.d;
    c.pathLateralM[u] = r.lat ?? 0;
    // A straight line: world x follows the distance.
    c.xM[u] = r.x ?? r.d;
    c.zM[u] = r.z ?? 0;
    c.yawRad![u] = r.yaw ?? 0;
    c.place[u] = r.place ?? index + 1;
    c.lapsDone[u] = r.laps ?? 0;
    c.inPits[u] = r.pit ? 1 : 0;
  }
  return c;
}

function field(updates: number, cars: FieldCar[]): Field {
  return {
    version: 2,
    hz: HZ,
    startEtS: 0,
    timeS: Float64Array.from({length: updates}, (_, u) => u / HZ),
    cars,
  };
}

const at = (f: Field, t: number, snap = true) =>
  carsAt(prepareRace(f), t, snap);

describe('carsAt', () => {
  it('gives every car its position, class place and overall place', () => {
    const f = field(10, [
      car(0, 'GT3', 10, u => ({d: 100 + u * 10, place: 3}), true),
      car(1, 'GT3', 10, u => ({d: 200 + u * 10, place: 2})),
      car(2, 'Hyper', 10, u => ({d: 300 + u * 10, place: 1})),
    ]);
    const cars = at(f, 0.4);
    expect(cars.map(c => [c.index, c.xM, c.state])).toEqual([
      [0, 120, 'running'],
      [1, 220, 'running'],
      [2, 320, 'running'],
    ]);
    expect(cars.map(c => c.classPlace)).toEqual([2, 1, 1]);
    expect(cars[0].player).toBe(true);
  });

  it('gap and interval come from when each car passed the same progress', () => {
    // The leader drives 10 m per update. The second car is 20 m behind, the
    // third 50 m behind: they reach the leader's spot 2 and 5 updates later.
    const f = field(30, [
      car(0, 'GT3', 30, u => ({d: 300 + u * 10, place: 1})),
      car(1, 'GT3', 30, u => ({d: 280 + u * 10, place: 2})),
      car(2, 'GT3', 30, u => ({d: 250 + u * 10, place: 3})),
    ]);
    const [a, b, c] = at(f, 20 / HZ);
    expect(a.gapS).toBe(0);
    expect(b.gapS).toBeCloseTo(2 / HZ, 6);
    expect(c.gapS).toBeCloseTo(5 / HZ, 6);
    expect(a.intervalS).toBeNull();
    expect(b.intervalS).toBeCloseTo(2 / HZ, 6);
    expect(c.intervalS).toBeCloseTo(3 / HZ, 6);
  });

  it('a car a whole lap of distance behind the class leader is laps down, not just a time gap', () => {
    // The leader is on lap 2 (one done), the second car is on lap 1 and the
    // third is a car length behind the leader on the same lap.
    const f = field(10, [
      car(0, 'GT3', 10, u => ({d: 500 + u * 50, laps: 1, place: 1})),
      car(1, 'GT3', 10, u => ({d: 300 + u * 50, laps: 0, place: 2})),
      car(2, 'GT3', 10, u => ({d: 480 + u * 50, laps: 1, place: 3})),
    ]);
    const [a, b, c] = at(f, 5 / HZ);
    expect([a.lapsDown, b.lapsDown, c.lapsDown]).toEqual([0, 1, 0]);
  });

  it('keeps counting across the start line', () => {
    // Lap length 1000: the leader crosses the line, the follower 30 m later.
    const f = field(12, [
      car(0, 'GT3', 12, u => ({
        d: (950 + u * 10) % 1000,
        laps: u >= 5 ? 1 : 0,
        place: 1,
        x: 0,
      })),
      car(1, 'GT3', 12, u => ({
        d: (920 + u * 10) % 1000,
        laps: u >= 8 ? 1 : 0,
        place: 2,
        x: 0,
      })),
    ]);
    // Track length comes from the largest lap distance seen (990).
    const cars = at(f, 11 / HZ);
    expect(cars[1].gapS).toBeCloseTo(3 / HZ, 5);
  });

  it('a grid that straddles the line: the car behind it is not a lap ahead', () => {
    // Both on lap 0 at the first update: one 10 m behind the 1000 m line
    // (distance 990), one 30 m past it. Same speed, 10 m per update. Update
    // 10: the car ahead was at the follower's spot (-10 m) before it was seen,
    // and at 90 m (where the follower is now) at update 6.
    const f = field(20, [
      car(0, 'GT3', 20, u => ({d: 30 + u * 10, place: 1}), true),
      car(1, 'GT3', 20, u => ({
        d: (990 + u * 10) % 1000,
        laps: u >= 1 ? 1 : 0,
        place: 2,
      })),
    ]);
    const [, b] = at(f, 10 / HZ);
    expect(b.gapS).toBeCloseTo(4 / HZ, 5);
  });

  it('stays quick and right late in a long race', () => {
    // 3 hours at 5 Hz, two cars 10 s apart, one lap of 5,000 m per 100 s.
    const n = 3 * 3600 * HZ;
    const d = (u: number, lag: number) => ((u / HZ - lag) * 50) % 5000;
    const lap = (u: number, lag: number) =>
      Math.floor(((u / HZ - lag) * 50) / 5000);
    const f = field(n, [
      car(0, 'GT3', n, u => ({d: d(u, 0), laps: lap(u, 0), place: 1}), true),
      car(1, 'GT3', n, u => ({
        d: Math.max(0, d(u, 10)),
        laps: Math.max(0, lap(u, 10)),
        place: 2,
      })),
    ]);
    const prep = prepareRace(f);
    const start = Date.now();
    const cars = carsAt(prep, (n - 100) / HZ, true);
    expect(Date.now() - start).toBeLessThan(100);
    expect(cars[1].gapS).toBeCloseTo(10, 1);
  });

  it('stays stopped past 32,767 updates', () => {
    const n = 40000;
    const f = field(n, [
      car(0, 'GT3', n, u => ({d: u < 3 ? u * 10 : 30}), true),
    ]);
    expect(at(f, (n - 1) / HZ)[0].state).toBe('stopped');
  });

  it('snaps to the nearest sample when paused and blends while playing', () => {
    const f = field(4, [car(0, 'GT3', 4, u => ({d: u * 10}), true)]);
    // 0.3 s is between updates 1 (0.2 s) and 2 (0.4 s).
    expect(at(f, 0.29, true)[0].xM).toBe(10);
    expect(at(f, 0.31, true)[0].xM).toBe(20);
    expect(at(f, 0.3, false)[0].xM).toBeCloseTo(15, 5);
  });

  it('blends heading the short way round ±π', () => {
    const f = field(2, [
      car(0, 'GT3', 2, u => ({d: u, yaw: u === 0 ? 3.0 : -3.0})),
    ]);
    const h = at(f, 0.1, false)[0].headingRad ?? 0;
    // Halfway between 3.0 and -3.0 the short way is π (≈ 3.14), not 0.
    expect(Math.abs(Math.abs(h) - Math.PI)).toBeLessThan(0.16);
  });

  it('a car in the garage keeps its last spot but has no place, and is not blended', () => {
    const f = field(6, [
      car(0, 'GT3', 6, u => ({d: u * 10, place: 1}), true),
      car(1, 'GT3', 6, u => (u < 3 ? {d: 100 + u * 10, place: 2} : {d: null})),
    ]);
    const [, b] = at(f, 4 / HZ, true);
    expect(b.state).toBe('garage');
    expect(b.xM).toBe(120);
    expect(b.classPlace).toBe(0);
    expect(b.gapS).toBeNull();
    // Interpolating between the last sample and the first absent one: no blend.
    expect(at(f, 2.5 / HZ, false)[1].xM).toBe(120);
  });

  it('leaves out a car that has not been on the map yet', () => {
    const f = field(6, [
      car(0, 'GT3', 6, u => ({d: u * 10}), true),
      car(1, 'GT3', 6, u => (u < 4 ? {d: null} : {d: 50})),
    ]);
    expect(at(f, 1 / HZ).map(c => c.index)).toEqual([0]);
    expect(at(f, 4 / HZ).map(c => c.index)).toEqual([0, 1]);
  });

  it('counts pit stops, not a start in the pit lane or a short blip', () => {
    // 5 Hz: a 15 s stop is 75 updates. Out of the pits from the start, a
    // 2 s blip at update 10 (the whole-field blip at the Daytona start), a
    // stop from update 40 to 115, and a second one from 150 to the end.
    const inPit = (u: number) =>
      (u >= 10 && u < 20) || (u >= 40 && u < 115) || u >= 150;
    const f = field(160, [
      car(0, 'GT3', 160, u => ({d: u * 10, pit: inPit(u)}), true),
      car(1, 'GT3', 160, u => ({d: u * 10, pit: u < 2})),
    ]);
    expect(at(f, 15 / HZ)[0]).toMatchObject({state: 'pit', pits: 0});
    expect(at(f, 60 / HZ)[0]).toMatchObject({state: 'pit', pits: 1});
    expect(at(f, 130 / HZ)[0]).toMatchObject({state: 'running', pits: 1});
    // A stop still going when the data ends counts.
    expect(at(f, 155 / HZ)[0]).toMatchObject({state: 'pit', pits: 2});
    expect(at(f, 155 / HZ)[1]).toMatchObject({state: 'running', pits: 0});
  });

  it('is stopped after STOPPED_FOR_S under 5 km/h outside the pit lane', () => {
    const still = Math.ceil(STOPPED_FOR_S * HZ) + 2;
    const f = field(still + 6, [
      car(0, 'GT3', still + 6, u => ({d: u < 3 ? u * 10 : 30}), true),
      car(1, 'GT3', still + 6, u => ({d: u < 3 ? u * 10 : 30, pit: true})),
    ]);
    // The last move is update 2 to 3; updates 4 to 13 are 10 slow ones = 2 s.
    expect(at(f, 13 / HZ)[0].state).toBe('stopped');
    expect(at(f, 12 / HZ)[0].state).toBe('running');
    expect(at(f, 8 / HZ)[0].state).toBe('running');
    // A car standing in the pit lane is in the pits, not stopped.
    expect(at(f, 13 / HZ)[1].state).toBe('pit');
  });

  it('is off track past OFF_TRACK_M from the centre line, either side', () => {
    const f = field(2, [
      car(0, 'GT3', 2, () => ({d: 10, lat: OFF_TRACK_M + 0.1}), true),
      car(1, 'GT3', 2, () => ({d: 20, lat: -(OFF_TRACK_M + 0.1)})),
      car(2, 'GT3', 2, () => ({d: 30, lat: OFF_TRACK_M})),
    ]);
    expect(at(f, 0).map(c => c.state)).toEqual(['off', 'off', 'running']);
  });

  it('files without heading give null', () => {
    const f = field(2, [car(0, 'GT3', 2, u => ({d: u}), true)]);
    f.cars[0].yawRad = null;
    expect(at(f, 0)[0].headingRad).toBeNull();
  });

  it('an empty field gives no cars', () => {
    expect(at(field(0, []), 0)).toEqual([]);
  });
});
