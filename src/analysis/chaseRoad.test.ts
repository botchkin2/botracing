import {describe, expect, it} from '@jest/globals';

import {chaseRoad, roadGrade, roadHeight} from './chaseRoad';

describe('chaseRoad', () => {
  const ring = Array.from({length: 40}, (_, i) => ({
    x: 100 * Math.cos((i / 40) * Math.PI * 2),
    y: 100 * Math.sin((i / 40) * Math.PI * 2),
  }));
  it('takes measured half-widths and fills a missing side', () => {
    const left = ring.map(() => 6);
    const right = ring.map((_, i) => (i === 3 ? NaN : 5));
    const road = chaseRoad(ring, {stepM: 10, lengthM: 400, leftM: left, rightM: right}, 10, 400, null, 0)!;
    expect(road.hl.every(w => w === 6)).toBe(true);
    // bin 3 is 30 m of the 628 m lap: the point nearest it holds the default 7 m, the points far from it 5 m
    const at3 = Math.round((3 / 40) * road.cx.length);
    expect(road.hr[at3]).toBeGreaterThan(6.5);
    expect(road.hr[Math.round((20 / 40) * road.cx.length)]).toBe(5);
    expect(road.elev).toBeNull();
    expect(road.heightM).toBeNull();
  });
  it('is null for a path too short to be a road', () => {
    expect(chaseRoad(ring.slice(0, 3), null, 10, 30, null, 0)).toBeNull();
  });
  it('keeps the profile with its own step and lap, and its lowest point', () => {
    const road = chaseRoad(ring, null, 10, 400, {stepM: 10, heightM: [3, -2, 5, 1, 0]}, 50)!;
    expect(road.elev).toEqual({stepM: 10, heightM: [3, -2, 5, 1, 0], lengthM: 50});
    expect(road.elevMin).toBe(-2);
  });
  it('has no profile without a lap length to read it on', () => {
    expect(chaseRoad(ring, null, 10, 400, {stepM: 10, heightM: [0, 1, 2, 3]}, 0)!.elev).toBeNull();
  });
});

describe('chaseRoad resampling', () => {
  // a 30 m radius hairpin ring whose bin means are unevenly spaced (0.85 to 1.15 of the nominal 10 m, near the surface's 8.5 to 12.2), as the surface's are
  const N = 20;
  const R = 30;
  const angles: number[] = [0];
  for (let i = 1; i < N; i++) angles.push(angles[i - 1] + (i % 2 ? 0.85 : 1.15));
  const lap = angles[N - 1] + (N % 2 ? 0.85 : 1.15);
  const uneven = angles.map(a => ({x: R * Math.cos((a / lap) * 2 * Math.PI), y: R * Math.sin((a / lap) * 2 * Math.PI)}));
  const left = uneven.map((_, i) => 4 + i);
  const heights = Array.from({length: 40}, (_, i) => i);
  const road = chaseRoad(uneven, {stepM: 10, lengthM: 200, leftM: left, rightM: left}, 10, 200, {stepM: 5, heightM: heights}, 200)!;
  const n = road.cx.length;

  it('puts every point the same arc length from the next, so a distance along it is metres', () => {
    const seg: number[] = [];
    for (let i = 0; i < n; i++) seg.push(Math.hypot(road.cx[(i + 1) % n] - road.cx[i], road.cy[(i + 1) % n] - road.cy[i]));
    expect(road.stepM * n).toBeCloseTo(road.lengthM, 9);
    // a chord is shorter than its arc by under 1 mm at a 2 m step on a 30 m radius
    for (const d of seg) expect(Math.abs(d - road.stepM)).toBeLessThan(0.002);
    expect(road.stepM).toBeCloseTo(2, 0);
  });
  it('is round: on the 30 m circle the tangent between points is within 1 degree of the true one', () => {
    for (let i = 0; i < n; i++) {
      const mx = (road.cx[i] + road.cx[(i + 1) % n]) / 2;
      const my = (road.cy[i] + road.cy[(i + 1) % n]) / 2;
      const tangent = Math.atan2(road.cy[(i + 1) % n] - road.cy[i], road.cx[(i + 1) % n] - road.cx[i]);
      const truth = Math.atan2(my, mx) + Math.PI / 2;
      const off = Math.abs(Math.atan2(Math.sin(tangent - truth), Math.cos(tangent - truth))) * (180 / Math.PI);
      expect(off).toBeLessThan(1);
      // and on the circle: the curve stays within a centimetre of the 30 m radius
      expect(Math.abs(Math.hypot(road.cx[i], road.cy[i]) - R)).toBeLessThan(0.05);
    }
  });
  it('keeps the lap as the game measures it, for reading a car lapDistM and the profile', () => {
    expect(road.lapM).toBe(200);
  });
  it('carries what the bin it came from held: width between the two bins, the curated height at its own place', () => {
    // the first point is bin 0
    expect(road.hl[0]).toBeCloseTo(4);
    expect(road.heightM?.[0]).toBeCloseTo(0);
    // widths rise by one a bin round the lap, so they rise from the first point and never fall until the wrap
    for (let k = 1; k < n - 8; k++) expect(road.hl[k]).toBeGreaterThanOrEqual(road.hl[k - 1] - 1e-9);
    // and heights the same: the profile rises along the lap
    for (let k = 1; k < n - 8; k++) expect(road.heightM![k]).toBeGreaterThanOrEqual(road.heightM![k - 1] - 1e-9);
  });
});

describe('roadHeight', () => {
  const elev = {stepM: 10, heightM: [0, 10, 20, 30, 40], lengthM: 45};
  it('scales the road lap onto the profile lap (one lap, two measures) and wraps', () => {
    // the road measured the lap as 90 m: its 30 m is the profile's 15 m, its 85 m the profile's 42.5 m
    expect(roadHeight(elev, 30, 90)).toBeCloseTo(15);
    expect(roadHeight(elev, 85, 90)).toBeCloseTo(20);
  });
  it('reads grade as rise over run on the profile metres, + uphill', () => {
    expect(roadGrade(elev, 20, 45, 10)).toBeCloseTo(1);
    expect(roadGrade(elev, 42.5, 45, 4)).toBeCloseTo(-8);
  });
});
