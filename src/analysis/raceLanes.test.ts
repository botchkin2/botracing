import {describe, expect, it} from '@jest/globals';

import type {Field, FieldCar} from './field';
import {laneWindow, lapLabelEvery, raceLanes} from './raceLanes';
import type {RaceClock} from './raceClock';

const DT = 0.2;
const V = 250 / 3.6; // player speed, m/s

interface CarSpec {
  carClass?: string;
  player?: boolean;
  lapDistM: (u: number) => number;
  lane?: number;
  pit?: (u: number) => boolean;
  flag?: (u: number) => number;
  laps?: (u: number) => number;
}

function car(index: number, n: number, s: CarSpec): FieldCar {
  const f32 = (fn: (u: number) => number) =>
    Float32Array.from({length: n}, (_, u) => fn(u));
  return {
    index,
    carClass: s.carClass ?? 'GT3',
    vehicle: null,
    player: s.player ?? false,
    lapDistM: f32(s.lapDistM),
    pathLateralM: f32(() => s.lane ?? 0),
    xM: f32(() => 0),
    zM: f32(() => 0),
    yawRad: null,
    place: Int16Array.from({length: n}, () => 1),
    lapsDone: Int16Array.from({length: n}, (_, u) => s.laps?.(u) ?? 0),
    inPits: Int8Array.from({length: n}, (_, u) => (s.pit?.(u) ? 1 : 0)),
    flag: Int16Array.from({length: n}, (_, u) => s.flag?.(u) ?? 0),
  };
}

function field(n: number, cars: CarSpec[]): Field {
  return {
    version: 2,
    hz: 1 / DT,
    hasPositions: true,
    startEtS: 0,
    timeS: Float64Array.from({length: n}, (_, u) => u * DT),
    cars: cars.map((c, i) => car(i, n, c)),
  };
}

const me = (over: Partial<CarSpec> = {}): CarSpec => ({
  player: true,
  lapDistM: u => 100 + u * V * DT,
  ...over,
});
// Parked far away: only makes the lap 4000 m long for the wrap maths.
const far: CarSpec = {lapDistM: () => 4000, lane: 30};
const clock: RaceClock = {
  playerAt: () => null,
  timeAtLapDistance: lap => (lap < 3 ? lap * 90 : null),
};

describe('raceLanes', () => {
  it('a field with no player has no lanes', () => {
    const f = field(5, [far]);
    expect(raceLanes(f, clock).pit).toEqual([]);
    expect(raceLanes(f, clock).durationS).toBe(0);
  });

  it('pit spans are runs of in-pit updates; laps start where the clock says', () => {
    const f = field(20, [
      me({pit: u => u >= 5 && u < 10, laps: u => Math.floor(u / 7)}),
      far,
    ]);
    const lanes = raceLanes(f, clock);
    expect(lanes.pit).toEqual([{fromS: 1, toS: 2}]);
    expect(lanes.durationS).toBeCloseTo(4);
    expect(lanes.lapStarts).toEqual([
      {lap: 1, timeS: 0},
      {lap: 2, timeS: 90},
      {lap: 3, timeS: 180},
    ]);
    expect(lanes.typicalLapS).toBe(90);
  });

  it('a tow is a car within 30 m ahead in the lane above 200 km/h, from the second update', () => {
    const f = field(20, [
      me(),
      {lapDistM: u => 100 + u * V * DT + 20, lane: 1.5},
      far,
    ]);
    const [span] = raceLanes(f, clock).tow;
    expect(span.fromS).toBeCloseTo(DT);
    expect(span.toS).toBeCloseTo(20 * DT);
    // Next lane, or too far ahead: no tow.
    const wide = field(20, [
      me(),
      {lapDistM: u => 100 + u * V * DT + 20, lane: 3},
      far,
    ]);
    expect(raceLanes(wide, clock).tow).toEqual([]);
    const distant = field(20, [
      me(),
      {lapDistM: u => 100 + u * V * DT + 35, lane: 0},
      far,
    ]);
    expect(raceLanes(distant, clock).tow).toEqual([]);
  });

  it('a battle is a same-class car within 1 s in any lane; another class is not', () => {
    const near = (carClass: string) =>
      field(10, [
        me(),
        {carClass, lapDistM: u => 100 + u * V * DT + V * 0.5, lane: 5},
        far,
      ]);
    const [span] = raceLanes(near('GT3'), clock).battle;
    expect(span.fromS).toBeCloseTo(DT);
    expect(raceLanes(near('Hyper'), clock).battle).toEqual([]);
  });

  it('blue flag gives one tick per stretch, at its start', () => {
    const f = field(30, [
      me({flag: u => ((u >= 5 && u < 10) || u >= 20 ? 6 : 0)}),
      far,
    ]);
    expect(raceLanes(f, clock).blueS).toEqual([1, 4]);
  });

  it('passes are own class, made or suffered by the sign of the gap', () => {
    // Car 1 (GT3) drops back through the player; car 2 (Hyper) passes
    // the player and is not counted.
    const f = field(40, [
      me(),
      {lapDistM: u => 100 + u * V * DT + 30 - u * 4, lane: 3},
      {
        carClass: 'Hyper',
        lapDistM: u => 100 + u * V * DT - 30 + u * 4,
        lane: 3,
      },
      far,
    ]);
    const {passes} = raceLanes(f, clock);
    expect(passes).toHaveLength(1);
    expect(passes[0].made).toBe(true);
    expect(passes[0].timeS).toBeCloseTo(8 * DT + DT, 0);
  });
});

describe('laneWindow', () => {
  const race = {durationS: 3000, typicalLapS: 108};

  it('race is the whole race; zoomed windows are 10 or 3 median laps, centred and clamped', () => {
    expect(laneWindow('race', 500, race)).toEqual({fromS: 0, toS: 3000});
    expect(laneWindow('l10', 1500, race)).toEqual({fromS: 960, toS: 2040});
    expect(laneWindow('l3', 100, race)).toEqual({fromS: 0, toS: 324});
    expect(laneWindow('l3', 2990, race)).toEqual({fromS: 2676, toS: 3000});
  });

  it('10 laps is 10 laps at any track: a 210 s lap gives a 2,100 s window', () => {
    const w = laneWindow('l10', 3000, {durationS: 6000, typicalLapS: 210});
    expect(w.toS - w.fromS).toBe(2100);
  });

  it('with no lap length to measure, the Daytona GT3 values', () => {
    const w = laneWindow('l10', 1500, {durationS: 3000, typicalLapS: null});
    expect(w.toS - w.fromS).toBe(1080);
  });

  it('a race shorter than the window shows all of it', () => {
    expect(laneWindow('l10', 100, {durationS: 900, typicalLapS: 108})).toEqual({
      fromS: 0,
      toS: 900,
    });
  });

  it('labels every 5, 2 or 1 laps', () => {
    expect(['race', 'l10', 'l3'].map(z => lapLabelEvery(z as never))).toEqual([
      5, 2, 1,
    ]);
  });
});

describe('lap starts', () => {
  it('a lap the clock cannot place is left out and later laps keep their numbers', () => {
    const f = field(20, [me({laps: u => Math.floor(u / 7)}), far]);
    const skipsLap1: RaceClock = {
      playerAt: () => null,
      timeAtLapDistance: lap => (lap === 1 ? null : lap * 90),
    };
    const lanes = raceLanes(f, skipsLap1);
    expect(lanes.lapStarts).toEqual([
      {lap: 1, timeS: 0},
      {lap: 3, timeS: 180},
    ]);
    // A gap across the missing lap is two laps long: no median from one gap.
    expect(lanes.typicalLapS).toBeNull();
  });
});
