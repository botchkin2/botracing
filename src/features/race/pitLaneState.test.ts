import {describe, expect, it} from '@jest/globals';

import {type Field, type FieldCar} from '@/src/analysis/field';
import {carsAt, prepareRace} from '@/src/analysis/raceState';
import {toTrackMap} from '@/src/data/sessions/adapters';
import {type MapPlacer} from '@/src/data/sessions';
import {mapPlacer} from '@/src/data/sessions/mapPlace';

import fixture from './__fixtures__/daytonaStart.json';
import {markPitLane} from './pitLaneState';

// The real first field update of the Daytona race 9b16b76c78af6ec0 (all 62
// cars parked on the pit road, in-pits flag 0) and the map's pit lane.
type Start = {
  class: string;
  lapDistM: number;
  pathLateralM: number;
  xM: number;
  zM: number;
  inPits: number;
};

// The same update twice, 0.2 s apart, so nothing moves.
function startField(cars: Start[]): Field {
  const two = (v: number) => Float32Array.of(v, v);
  return {
    version: 2,
    hz: 5,
    hasPositions: true,
    startEtS: 0,
    timeS: Float64Array.of(0, 0.2),
    cars: cars.map(
      (c, i): FieldCar => ({
        index: i,
        carClass: c.class,
        vehicle: null,
        player: i === 0,
        lapDistM: two(c.lapDistM),
        pathLateralM: two(c.pathLateralM),
        xM: two(c.xM),
        zM: two(c.zM),
        yawRad: null,
        place: Int16Array.of(i + 1, i + 1),
        lapsDone: Int16Array.of(0, 0),
        inPits: Int8Array.of(c.inPits, c.inPits),
        flag: Int16Array.of(0, 0),
      }),
    ),
  };
}

const placer = mapPlacer(toTrackMap(fixture.rawMap));
const cars = carsAt(prepareRace(startField(fixture.cars)), 0, true);

describe('markPitLane on the real start of the Daytona race', () => {
  it('the off-track rule alone calls the parked field off track (the bug)', () => {
    expect(cars).toHaveLength(62);
    expect(cars.filter(c => c.state === 'off').length).toBeGreaterThanOrEqual(
      58,
    );
  });

  it('with the pit lane from the map, they are on the grid, not IN', () => {
    const fixed = markPitLane(cars, placer);
    expect(fixed.filter(c => c.state === 'off')).toHaveLength(0);
    expect(fixed.filter(c => c.state === 'pit')).toHaveLength(0);
    expect(fixed.filter(c => c.state === 'running').length).toBeGreaterThanOrEqual(
      58,
    );
  });

  it('after the start, the same cars on the pit road are IN', () => {
    const racing = cars.map(c => ({...c, lapsDone: 1}));
    const fixed = markPitLane(racing, placer);
    expect(fixed.filter(c => c.state === 'pit').length).toBeGreaterThanOrEqual(
      58,
    );
  });
});

describe('markPitLane', () => {
  const lane = [
    [
      {x: 0, y: 30},
      {x: 300, y: 30},
    ],
  ];
  // Only what markPitLane reads: the pit lane and the world-to-map placement.
  const stub = (pitLane: {x: number; y: number}[][]) =>
    ({
      placeWorld: (pts: {x: number; z: number}[]) =>
        pts.map(p => ({x: p.x, y: p.z})),
      pitLane,
    } as unknown as MapPlacer);
  const car = (
    index: number,
    x: number,
    z: number,
    state: 'off' | 'running',
    lapsDone = 1,
  ) =>
    ({index, xM: x, zM: z, state, lapsDone} as unknown as (typeof cars)[number]);

  it('moves only off-track cars that sit on the lane', () => {
    const out = markPitLane(
      [
        car(0, 100, 30, 'off'),
        car(1, 100, 80, 'off'),
        car(2, 100, 30, 'running'),
      ],
      stub(lane),
    );
    expect(out.map(c => c.state)).toEqual(['pit', 'off', 'running']);
  });

  it('returns the same cars when there is no pit lane or nothing is off track', () => {
    const list = [car(0, 100, 30, 'off')];
    expect(markPitLane(list, stub([]))).toBe(list);
    const running = [car(0, 100, 30, 'running')];
    expect(markPitLane(running, stub(lane))).toBe(running);
  });
});
