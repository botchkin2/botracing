import {describe, expect, it} from '@jest/globals';

import {type CarState, type RaceCar} from '@/src/analysis/raceState';
import {mapPlacer, type TrackMapData} from '@/src/data/sessions';

import {followCamera} from './followCamera';

function car(index: number, extra: Partial<RaceCar> = {}): RaceCar {
  return {
    index,
    carClass: 'GT3',
    vehicle: `Car ${index}`,
    player: false,
    xM: index * 100,
    zM: 50,
    headingRad: 0,
    lapDistM: 0,
    speedKmh: 200,
    state: 'running' as CarState,
    place: index + 1,
    classPlace: index + 1,
    lapsDone: 1,
    pits: 0,
    gapS: null,
    intervalS: null,
    ...extra,
  };
}

const plain = mapPlacer(null);
const rotated = mapPlacer({
  lengthM: 1000,
  sections: [],
  quality: 'good',
  georef: {rotationDeg: 30, mirror: 1, originLat: 29.19, originLon: -81.07},
  outline: [],
  pitLane: [],
  attribution: null,
} satisfies TrackMapData);

describe('followCamera', () => {
  const cars = [car(0, {player: true}), car(1, {headingRad: Math.PI / 2})];

  it('yaw 0 is +z: on the plain map that is north', () => {
    const cam = followCamera(plain, cars, null)!;
    expect(cam.centre.x).toBeCloseTo(0, 3);
    expect(cam.centre.y).toBeCloseTo(50, 3);
    expect(cam.headingRad).toBeCloseTo(Math.PI / 2, 3);
  });

  it('the focused car takes the camera; clearing focus returns to you', () => {
    const cam = followCamera(plain, cars, 1)!;
    expect(cam.centre.x).toBeCloseTo(100, 3);
    // Yaw 90 degrees is +x, east.
    expect(cam.headingRad).toBeCloseTo(0, 3);
    expect(followCamera(plain, cars, null)!.centre.x).toBeCloseTo(0, 3);
  });

  it('a georef rotation turns the heading with the map', () => {
    const cam = followCamera(rotated, cars, 1)!;
    expect(cam.headingRad).toBeCloseTo(Math.PI / 6, 2);
  });

  it('no camera for a car in the garage or without yaw', () => {
    const garage = [car(0, {player: true, state: 'garage' as CarState})];
    expect(followCamera(plain, garage, null)).toBeNull();
    const noYaw = [car(0, {player: true, headingRad: null})];
    expect(followCamera(plain, noYaw, null)).toBeNull();
  });

  it('a focus that is not in the field falls back to you', () => {
    expect(followCamera(plain, cars, 9)!.centre.x).toBeCloseTo(0, 3);
  });
});
