import {describe, expect, it} from '@jest/globals';

import {type Field, type FieldCar} from './field';
import {offTrackEvents} from './offTrackEvents';
import {raceClock} from './raceClock';
import {prepareRace} from './raceState';

const HZ = 5;
const UPDATES = 60;

// A car on a straight 1000 m lap that is `lat(u)` metres off the centre line.
function car(
  index: number,
  player: boolean,
  lat: (u: number) => number,
  pit: (u: number) => boolean = () => false,
): FieldCar {
  const c: FieldCar = {
    index,
    carClass: 'GT3',
    classId: null,
    classLabel: null,
    vehicle: null,
    player,
    lapDistM: new Float32Array(UPDATES),
    pathLateralM: new Float32Array(UPDATES),
    xM: new Float32Array(UPDATES),
    zM: new Float32Array(UPDATES),
    yawRad: null,
    place: new Int16Array(UPDATES).fill(index + 1),
    lapsDone: new Int16Array(UPDATES),
    inPits: new Int8Array(UPDATES),
    flag: new Int16Array(UPDATES),
  };
  for (let u = 0; u < UPDATES; u++) {
    c.lapDistM[u] = 100 + u * 10;
    c.pathLateralM[u] = lat(u);
    c.xM[u] = 100 + u * 10;
    c.inPits[u] = pit(u) ? 1 : 0;
  }
  return c;
}

const field = (cars: FieldCar[]): Field => ({
  version: 2,
  hz: HZ,
  hasPositions: true,
  startEtS: 0,
  timeS: Float64Array.from({length: UPDATES}, (_, u) => u / HZ),
  cars,
});

const run = (
  f: Field,
  index: number,
  onLane?: (x: number, z: number) => boolean,
) => offTrackEvents(prepareRace(f), raceClock(f), index, onLane);

// Off for updates 10..14 and 30..31, and one lone update at 45.
const wide = (u: number) =>
  (u >= 10 && u <= 14) || u === 30 || u === 31 || u === 45 ? 10 : 0;

describe('offTrackEvents', () => {
  it('lists each stretch off the road with its time, lap and place', () => {
    const f = field([car(0, true, wide), car(1, false, () => 0)]);
    expect(run(f, 0)).toEqual([
      // updates 10..14: the hold needs two consecutive updates, so the stretch
      // is the ones from the second on that are off (11..14).
      expect.objectContaining({lap: 1, lapDistM: 210, xM: 210, zM: 0}),
      expect.objectContaining({lap: 1, lapDistM: 410}),
    ]);
  });

  it('times a stretch from its first off update to the end of its last', () => {
    const f = field([car(0, true, wide)]);
    const [first, second] = run(f, 0);
    expect(first.fromS).toBeCloseTo(11 / HZ);
    expect(first.toS).toBeCloseTo(15 / HZ);
    expect(second.fromS).toBeCloseTo(31 / HZ);
    expect(second.toS).toBeCloseTo(32 / HZ);
  });

  it('does not mark a single update off the road', () => {
    const f = field([car(0, true, u => (u === 20 ? 10 : 0))]);
    expect(run(f, 0)).toEqual([]);
  });

  it('marks nothing for a car that stays on the road', () => {
    const f = field([car(0, true, () => 0)]);
    expect(run(f, 0)).toEqual([]);
  });

  it('skips a stretch in the pit lane flag or on the mapped pit lane', () => {
    const inPits = field([car(0, true, wide, u => u >= 10 && u <= 14)]);
    expect(run(inPits, 0)).toHaveLength(1);
    const f = field([car(0, true, wide)]);
    expect(run(f, 0, x => x < 300)).toHaveLength(1);
    expect(run(f, 0, () => true)).toEqual([]);
  });

  it('gives another car its stretches without a lap', () => {
    const f = field([car(0, true, () => 0), car(1, false, wide)]);
    const events = run(f, 1);
    expect(events).toHaveLength(2);
    expect(events[0].lap).toBeNull();
  });

  it('is empty for a car index that is not in the field', () => {
    expect(run(field([car(0, true, wide)]), 5)).toEqual([]);
  });
});
