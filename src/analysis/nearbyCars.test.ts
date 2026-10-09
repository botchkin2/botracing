import {describe, expect, it} from '@jest/globals';

import {type Field, type FieldCar} from './field';
import {fieldClasses} from './fieldClasses';
import {nearbyCars} from './nearbyCars';
import {prepareRace} from './raceState';

const HZ = 5;
const UPDATES = 400;
const TRACK_M = 1000;

/** A car from its driven distance at each update (metres since the start); iRacing-like: no positions. */
function car(
  index: number,
  progress: (u: number) => number,
  over: Partial<FieldCar> = {},
  pitAt: (u: number) => boolean = () => false,
): FieldCar {
  const c: FieldCar = {
    index,
    carClass: '',
    classId: 4011,
    classLabel: 'GT3',
    vehicle: `Car ${index}`,
    player: false,
    lapDistM: new Float32Array(UPDATES),
    pathLateralM: new Float32Array(UPDATES).fill(NaN),
    xM: new Float32Array(UPDATES).fill(NaN),
    zM: new Float32Array(UPDATES).fill(NaN),
    yawRad: null,
    place: new Int16Array(UPDATES).fill(1),
    lapsDone: new Int16Array(UPDATES),
    inPits: new Int8Array(UPDATES),
    flag: new Int16Array(UPDATES),
    ...over,
  };
  for (let u = 0; u < UPDATES; u++) {
    const p = progress(u);
    c.lapDistM[u] = ((p % TRACK_M) + TRACK_M) % TRACK_M;
    c.lapsDone[u] = Math.floor(p / TRACK_M);
    c.inPits[u] = pitAt(u) ? 1 : 0;
  }
  return c;
}

const field = (cars: FieldCar[]): Field => ({
  version: 2,
  hz: HZ,
  hasPositions: false,
  startEtS: 0,
  timeS: Float64Array.from({length: UPDATES}, (_, u) => u / HZ),
  cars,
});

// You at 50 m/s (10 m per update) from 1100 m, so a lap is 20 s.
const you = (u: number) => 1100 + 10 * u;
const AT = 200; // 40 s in: you at 3100 m

describe('nearbyCars', () => {
  const f = field([
    car(0, you, {player: true}),
    // 100 m ahead at your speed: it passed your spot 2.0 s ago.
    car(1, u => you(u) + 100),
    // 50 m behind at your speed: it reaches your spot in 1.0 s.
    car(2, u => you(u) - 50),
    // 150 m ahead but at half your speed through here: it passed your spot
    // 6.0 s ago, where metres over your speed would say 3.0 s.
    car(3, u => 3100 + 150 + 5 * (u - AT)),
    // A lap up, 30 m ahead on the road.
    car(4, u => you(u) + TRACK_M + 30),
    // In the pit lane 10 m ahead: listed, not counted.
    car(
      5,
      u => you(u) + 10,
      {},
      () => true,
    ),
  ]);
  const prep = prepareRace(f);
  const classes = fieldClasses(f);
  const near = nearbyCars(prep, AT, classes, 2, true)!;

  it('lists the nearest ahead and behind, a pit-lane car not counted', () => {
    expect(near.ahead.map(c => c.index)).toEqual([5, 4, 1]);
    expect(near.behind.map(c => c.index)).toEqual([2]);
    expect(near.ahead[0].pit).toBe(true);
  });

  it('gives the real interval, from when the car passed your spot', () => {
    const by = (i: number) =>
      [...near.ahead, ...near.behind].find(c => c.index === i)!;
    expect(by(1).intervalS).toBeCloseTo(2.0, 1);
    expect(by(2).intervalS).toBeCloseTo(-1.0, 1);
    const slow = nearbyCars(prep, AT, classes, 5, true)!.ahead.find(
      c => c.index === 3,
    )!;
    expect(slow.metres).toBeCloseTo(150, 0);
    expect(slow.intervalS).toBeCloseTo(6.0, 1);
  });

  it('marks a car a lap up, and the rest on your lap', () => {
    expect(near.ahead.find(c => c.index === 4)).toMatchObject({lapsUp: 1});
    expect(near.ahead.find(c => c.index === 1)).toMatchObject({lapsUp: 0});
    expect(near.ahead.find(c => c.index === 4)!.metres).toBeCloseTo(30, 0);
  });

  it('marks no laps outside a race, where each car counts its own', () => {
    const practice = nearbyCars(prep, AT, classes, 2, false)!;
    expect(practice.ahead.every(c => c.lapsUp === 0)).toBe(true);
  });

  it('has no time where the field never saw the car cross your spot, and no speed to fall back on', () => {
    // At the first update nothing has a history and you have no speed yet.
    const first = nearbyCars(prep, 0, classes, 2, true)!;
    expect(first.ahead.find(c => c.index === 1)!.intervalS).toBeNull();
  });

  it('carries the class colour and label', () => {
    expect(near.behind[0]).toMatchObject({slot: 'class3', short: 'GT3'});
  });

  it('is null with you in the pit lane or not in the field', () => {
    const inPit = field([car(0, you, {player: true}, () => true)]);
    expect(nearbyCars(prepareRace(inPit), AT, classes, 2, true)).toBeNull();
    const noYou = field([car(1, you)]);
    expect(nearbyCars(prepareRace(noYou), AT, classes, 2, true)).toBeNull();
  });
});
