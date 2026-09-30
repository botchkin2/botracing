import {describe, expect, it} from '@jest/globals';

import {type RaceCar} from '@/src/analysis/raceState';
import {mapPlacer, type MapPlacer} from '@/src/data/sessions';

import {followCar, followViewFor, RACE_FOLLOW_M} from './followTarget';

function car(over: Partial<RaceCar>): RaceCar {
  return {
    index: 0,
    carClass: 'GT3',
    vehicle: null,
    player: false,
    xM: 0,
    zM: 0,
    headingRad: 0,
    lapDistM: 0,
    speedKmh: 100,
    state: 'running',
    place: 1,
    classPlace: 1,
    lapsDone: 0,
    pits: 0,
    gapS: null,
    intervalS: null,
    lapsDown: 0,
    ...over,
  };
}

// Without a real map the placer only moves game-world metres into local map
// metres (x east, z north), which is what these tests need.
const placer: MapPlacer = mapPlacer(null);

describe('followCar', () => {
  const cars = [
    car({index: 0, player: true}),
    car({index: 1}),
    car({index: 2, state: 'garage'}),
    car({index: 3, headingRad: null}),
  ];

  it('is you when nothing is focused', () => {
    expect(followCar(cars, null)?.index).toBe(0);
  });

  it('is the focused car', () => {
    expect(followCar(cars, 1)?.index).toBe(1);
  });

  it('falls back to you when the focused car is in the garage or has no heading', () => {
    expect(followCar(cars, 2)?.index).toBe(0);
    expect(followCar(cars, 3)?.index).toBe(0);
  });

  it('is null when you have no heading either (file before v2)', () => {
    expect(followCar([car({player: true, headingRad: null})], null)).toBeNull();
  });
});

describe('followViewFor', () => {
  it('points the view along the car: yaw 0 is +z, which is north on the map', () => {
    const v = followViewFor(placer, car({xM: 10, zM: 20, headingRad: 0}), 300);
    expect(v?.headingRad).toBeCloseTo(Math.PI / 2, 3);
    expect(v?.visibleM).toBe(300);
  });

  it('yaw a quarter turn is +x, east, heading 0 on the map', () => {
    const v = followViewFor(
      placer,
      car({headingRad: Math.PI / 2}),
      RACE_FOLLOW_M,
    );
    expect(v?.headingRad).toBeCloseTo(0, 3);
  });

  it('puts the centre where the car is drawn as a dot', () => {
    const c = car({xM: 123, zM: -45, headingRad: 1});
    const [dot] = placer.placeWorld([{x: c.xM, z: c.zM}]);
    const v = followViewFor(placer, c, 300);
    expect(v?.centre.x).toBeCloseTo(dot.x, 6);
    expect(v?.centre.y).toBeCloseTo(dot.y, 6);
  });

  it('is null without a heading', () => {
    expect(followViewFor(placer, car({headingRad: null}), 300)).toBeNull();
  });
});
