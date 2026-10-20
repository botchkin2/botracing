import {describe, expect, it} from '@jest/globals';

import type {Field, FieldCar} from './field';
import {WORLD_ROAD_STEP_M, worldRoad} from './worldRoad';

// A circular track of 300 m radius, driven counter-clockwise (the outside is the right of travel) at 40 m/s, 5 Hz,
// by cars on lines at known offsets from the centre. Every sample is a world x/z and its pathLateralM.
const R = 300;
const LAP = 2 * Math.PI * R;
const HZ = 5;

function drive(index: number, lat: number, laps: number, phase: number, inPit: (u: number) => boolean = () => false): FieldCar {
  const n = Math.floor((laps * LAP) / (40 / HZ));
  const arr = () => new Float32Array(n);
  const c: FieldCar = {
    index,
    carClass: 'GT3',
    classId: null,
    classLabel: null,
    vehicle: null,
    player: index === 0,
    lapDistM: arr(),
    pathLateralM: arr(),
    xM: arr(),
    zM: arr(),
    yawRad: arr(),
    place: new Int16Array(n),
    lapsDone: new Int16Array(n),
    inPits: new Int8Array(n),
    flag: new Int16Array(n),
  };
  for (let u = 0; u < n; u++) {
    const along = phase + (u * 40) / HZ;
    const a = along / R;
    c.lapDistM[u] = along % LAP;
    c.pathLateralM[u] = lat;
    c.xM[u] = (R + lat) * Math.cos(a);
    c.zM[u] = (R + lat) * Math.sin(a);
    c.yawRad![u] = Math.atan2(-Math.sin(a), Math.cos(a));
    c.place[u] = index + 1;
    c.inPits[u] = inPit(u) ? 1 : 0;
  }
  return c;
}

function field(cars: FieldCar[]): Field {
  const n = cars[0].lapDistM.length;
  return {version: 2, hz: HZ, hasPositions: true, startEtS: 0, timeS: Float64Array.from({length: n}, (_, u) => u / HZ), cars};
}

const base = {lapM: LAP, edges: null, elevation: null, elevationLapM: 0};

describe('worldRoad', () => {
  const cars = [-4, -1.5, 0, 2, 5].map((lat, i) => drive(i, lat, 3, i * 37));
  const road = worldRoad({...base, field: field(cars)})!;
  const n = road.cx.length;

  it('recovers the centre of the track from cars on lines at known offsets: the circle within 5 cm', () => {
    for (let i = 0; i < n; i++) expect(Math.abs(Math.hypot(road.cx[i], road.cy[i]) - R)).toBeLessThan(0.05);
  });
  it('is at equal arc length, 1.5 m', () => {
    expect(road.stepM).toBeCloseTo(WORLD_ROAD_STEP_M, 1);
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      expect(Math.abs(Math.hypot(road.cx[j] - road.cx[i], road.cy[j] - road.cy[i]) - road.stepM)).toBeLessThan(0.001);
    }
    expect(road.lengthM).toBeCloseTo(LAP, 0);
    expect(road.lapM).toBe(LAP);
  });
  it('turns steadily: the heading step between points is the true one to under 0.15 degree', () => {
    const want = (road.stepM / R) * (180 / Math.PI);
    for (let i = 1; i < n - 1; i++) {
      const a = Math.atan2(road.cy[i] - road.cy[i - 1], road.cx[i] - road.cx[i - 1]);
      const b = Math.atan2(road.cy[i + 1] - road.cy[i], road.cx[i + 1] - road.cx[i]);
      const step = Math.abs(Math.atan2(Math.sin(b - a), Math.cos(b - a))) * (180 / Math.PI);
      expect(Math.abs(step - want)).toBeLessThan(0.15);
    }
  });
  it('ignores a car in the pits and a car that is not on the line', () => {
    const pit = drive(5, 0, 3, 11, () => true);
    // a car 25 m off the line, with pathLateral claiming 0: an outlier, not the road
    const stray = drive(6, 25, 3, 90);
    stray.pathLateralM.fill(0);
    const noisy = worldRoad({...base, field: field([...cars, pit, stray])})!;
    for (let i = 0; i < noisy.cx.length; i++) expect(Math.abs(Math.hypot(noisy.cx[i], noisy.cy[i]) - R)).toBeLessThan(0.3);
  });
  it('reads widths and heights at each point\'s lap distance', () => {
    const edges = {stepM: 10, lengthM: LAP, leftM: Array.from({length: Math.ceil(LAP / 10)}, () => 6), rightM: Array.from({length: Math.ceil(LAP / 10)}, () => 9)};
    const withData = worldRoad({...base, field: field(cars), edges, elevation: {stepM: LAP / 4, heightM: [0, 4, 8, 4]}, elevationLapM: LAP})!;
    expect(withData.hl[10]).toBeCloseTo(6, 6);
    expect(withData.hr[10]).toBeCloseTo(9, 6);
    expect(withData.heightM).not.toBeNull();
    // a quarter of the way round the lap the profile is at its second value
    const q = Math.round(withData.cx.length / 4);
    expect(withData.heightM![q]).toBeCloseTo(4, 0);
    expect(road.heightM).toBeNull();
  });
  it('is null for a field with no positions or too few samples', () => {
    expect(worldRoad({...base, field: {...field(cars), hasPositions: false}})).toBeNull();
    expect(worldRoad({...base, field: field([drive(0, 0, 0.05, 0)])})).toBeNull();
  });
});
