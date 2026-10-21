import {describe, expect, it} from '@jest/globals';

import type {Field, FieldCar} from './field';
import {runSliced} from './steps';
import {closedHeight, WORLD_ROAD_STEP_M, worldRoad, worldRoadSteps} from './worldRoad';

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

const base = {lapM: LAP, edges: null, elevation: null, elevationLapM: 0, bank: null};

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
    // a quarter of the way round the lap the profile is at its second value, 4, less a quarter of the seam (4 - 0)
    const q = Math.round(withData.cx.length / 4);
    expect(withData.heightM![q]).toBeCloseTo(3, 0);
    expect(road.heightM).toBeNull();
  });
  it("draws an opening at its own side's bound, not as a 50 m road (Sebring pit entry), and leaves the other side and an ordinary road alone", () => {
    const bins = Math.ceil(LAP / 10);
    const left = Array.from({length: bins}, () => 10);
    const right = Array.from({length: bins}, (_, b) => (b >= 30 && b < 44 ? 50 : 6)); // 140 m reading 50 m
    const edges = {stepM: 10, lengthM: LAP, leftM: left, rightM: right};
    const bounded = worldRoad({...base, field: field(cars), edges})!;
    const at = (b: number) => Math.round((b * 10 * bounded.cx.length) / LAP);
    // bound = 3 x the side's median (6) = 18 m; the opening is drawn at it
    expect(Math.max(...bounded.hr)).toBeLessThanOrEqual(18 + 1e-9);
    expect(bounded.hr[at(36)]).toBeCloseTo(18, 6);
    expect(bounded.hr[at(10)]).toBeCloseTo(6, 6); // away from it, as measured
    for (const h of bounded.hl) expect(h).toBeCloseTo(10, 6); // the other side is untouched
  });
  it('a road with no opening is drawn exactly as measured (nothing exceeds 3x its median)', () => {
    const bins = Math.ceil(LAP / 10);
    const wavy = (base: number) => Array.from({length: bins}, (_, b) => base + 2 * Math.sin(b / 7));
    const edges = {stepM: 10, lengthM: LAP, leftM: wavy(6), rightM: wavy(7)};
    const drawn = worldRoad({...base, field: field(cars), edges})!;
    const lerp = (arr: number[], i: number) => {
      const ld = (i * LAP) / drawn.cx.length; // same mapping as worldRoad
      const f = ld / 10;
      const k = Math.floor(f);
      return arr[k % bins] + (arr[(k + 1) % bins] - arr[k % bins]) * (f - k);
    };
    for (let i = 0; i < drawn.hl.length; i += 5) {
      expect(drawn.hl[i]).toBeCloseTo(lerp(edges.leftM, i), 2);
      expect(drawn.hr[i]).toBeCloseTo(lerp(edges.rightM, i), 2);
    }
  });
  it('closes the height on itself: the end of the lap is the start of the lap, to 5 cm', () => {
    // a profile that ends 0.3 m above where it began (the drift of a GPS height over a lap)
    const elev = {stepM: 10, heightM: Array.from({length: 11}, (_, i) => i * 0.3 + (i === 10 ? 0.3 : 0)), lengthM: 105};
    const start = closedHeight(elev, 0, 105);
    const justBefore = closedHeight(elev, 105 - 1e-6, 105);
    expect(Math.abs(justBefore - start)).toBeLessThan(0.05);
    // and no step on the way: neighbouring points a metre apart differ by far less than the seam
    let worst = 0;
    for (let ld = 0; ld < 104; ld += 1) worst = Math.max(worst, Math.abs(closedHeight(elev, ld + 1, 105) - closedHeight(elev, ld, 105)));
    expect(worst).toBeLessThan(0.05 + 0.3 / 10 + 0.3 / 105);
    const withData = worldRoad({...base, field: field(cars), elevation: {stepM: LAP / 10, heightM: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 9.4]}, elevationLapM: LAP})!;
    const h = withData.heightM!;
    expect(Math.abs(h[h.length - 1] - h[0])).toBeLessThan(0.05 + 0.4 * (withData.stepM / LAP) * 10);
  });
  it('reads the curated bank at each point of the lap, closed at the line, and is level without one', () => {
    expect(road.bankDeg).toBeNull();
    // a swing of 4 degrees once round, on a profile of 10 m steps over the map's lap (a little longer than the game's)
    const map = LAP * 1.02;
    const steps = Math.floor(map / 10);
    const rollDeg = Array.from({length: steps + 1}, (_, i) => 4 * Math.sin((2 * Math.PI * i * 10) / map));
    const banked = worldRoad({...base, field: field(cars), elevationLapM: map, bank: {stepM: 10, rollDeg}})!;
    const b = banked.bankDeg!;
    expect(b).toHaveLength(banked.cx.length);
    expect(b[Math.floor(b.length * 0.25)]).toBeCloseTo(4, 1);
    expect(b[Math.floor(b.length * 0.75)]).toBeCloseTo(-4, 1);
    // closed at the line: the last point and the first differ by no more than one step of the swing
    expect(Math.abs(b[b.length - 1] - b[0])).toBeLessThan(0.1);
    // a profile too short to read is no profile
    expect(worldRoad({...base, field: field(cars), elevationLapM: map, bank: {stepM: 10, rollDeg: [1, 2]}})!.bankDeg).toBeNull();
  });
  it('is null for a field with no positions or too few samples', () => {
    expect(worldRoad({...base, field: {...field(cars), hasPositions: false}})).toBeNull();
    expect(worldRoad({...base, field: field([drive(0, 0, 0.05, 0)])})).toBeNull();
  });
});

describe('worldRoadSteps', () => {
  it('driven in slices gives the road the one-go fit gives, bit for bit', async () => {
    const cars = [-4, -1.5, 0, 2, 5].map((lat, i) => drive(i, lat, 3, i * 37));
    const input = {...base, field: field(cars)};
    const whole = worldRoad(input)!;
    let slices = 0;
    let ticks = 0;
    const sliced = await runSliced(
      worldRoadSteps(input),
      {budgetMs: 2, now: () => ticks++, yieldToLoop: async () => void slices++},
      () => false,
    );
    expect(slices).toBeGreaterThan(5);
    expect(sliced).toEqual(whole);
  });
});
