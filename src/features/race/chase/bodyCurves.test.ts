import {describe, expect, it} from '@jest/globals';

import {
  CROWN_M,
  SHOULDER_POINTS,
  STATIONS,
  bodyStations,
  sampleCurve,
  sectionRing,
  spline,
  stationAt,
  type BodyModel,
  type CurvePoint,
} from './bodyCurves';
import {COUPE} from './__fixtures__/coupeBody';

describe('sampleCurve', () => {
  const pts: CurvePoint[] = [
    [0, 0],
    [1, 1],
    [2, 1],
    [3, 4],
  ];
  it('passes through its control points, in any order', () => {
    for (const [x, v] of pts) expect(sampleCurve(pts, x)).toBeCloseTo(v, 9);
    expect(sampleCurve([...pts].reverse(), 1)).toBeCloseTo(1, 9);
  });
  it('never overshoots: between two control points the value stays between theirs', () => {
    for (let i = 0; i < pts.length - 1; i++) {
      const lo = Math.min(pts[i][1], pts[i + 1][1]);
      const hi = Math.max(pts[i][1], pts[i + 1][1]);
      for (let k = 0; k <= 20; k++) {
        const v = sampleCurve(
          pts,
          pts[i][0] + ((pts[i + 1][0] - pts[i][0]) * k) / 20,
        );
        expect(v).toBeGreaterThanOrEqual(lo - 1e-9);
        expect(v).toBeLessThanOrEqual(hi + 1e-9);
      }
    }
  });
  it('holds the end values outside its points', () => {
    expect(sampleCurve(pts, -5)).toBe(0);
    expect(sampleCurve(pts, 9)).toBe(4);
  });
  it('is finite everywhere it is asked, also for coincident-height points', () => {
    for (let x = -1; x <= 4; x += 0.05)
      expect(Number.isFinite(sampleCurve(pts, x))).toBe(true);
  });
});

describe('spline', () => {
  it('returns n samples evenly spaced in x, from its first point to its last', () => {
    const s = spline(COUPE.top, 9);
    expect(s).toHaveLength(9);
    expect(s[0][0]).toBe(-2);
    expect(s[8][0]).toBe(2);
    for (let i = 1; i < s.length; i++)
      expect(s[i][0] - s[i - 1][0]).toBeCloseTo(0.5, 9);
  });
});

describe('bodyStations', () => {
  const stations = bodyStations(COUPE);
  it('runs from the nose to the tail, the length apart, x strictly decreasing', () => {
    expect(stations).toHaveLength(STATIONS);
    expect(stations[0].x).toBeCloseTo(2, 9);
    expect(stations[STATIONS - 1].x).toBeCloseTo(-2, 9);
    for (let i = 1; i < stations.length; i++)
      expect(stations[i].x).toBeLessThan(stations[i - 1].x);
  });
  it('has the sill under the belt under the top, and the top edge inside the belt, at every station', () => {
    for (const st of stations) {
      expect(st.sill).toBeLessThan(st.belt);
      expect(st.belt).toBeLessThan(st.top);
      expect(st.topHalf).toBeLessThanOrEqual(st.half + 1e-9);
      expect(st.sillHalf).toBeLessThan(st.half);
      for (const n of Object.values(st)) expect(Number.isFinite(n)).toBe(true);
    }
  });
  it('bulges over the axles: the half-width at each axle is wider than at the waist between them', () => {
    const waist = stationAt(COUPE, 0.2).half;
    expect(stationAt(COUPE, COUPE.frontAxleX).half).toBeGreaterThan(waist);
    expect(stationAt(COUPE, COUPE.rearAxleX).half).toBeGreaterThan(waist);
  });
  it('puts the greenhouse in the body: the roof is narrower than the belt and the highest point of the top line', () => {
    const roof = stationAt(COUPE, -0.1);
    const hood = stationAt(COUPE, 1.4);
    expect(roof.topHalf).toBeCloseTo(0.6, 9);
    expect(roof.topHalf).toBeLessThan(roof.half * 0.8);
    expect(hood.topHalf).toBeGreaterThan(hood.half * 0.8);
    const tops = stations.map(st => st.top);
    expect(Math.max(...tops)).toBeGreaterThanOrEqual(roof.top - 1e-9);
  });
  it('keeps a shoulder even when the top line sinks to the belt', () => {
    const flat: BodyModel = {
      ...COUPE,
      top: [
        [2, 0.3],
        [-2, 0.3],
      ],
      belt: [
        [2, 0.5],
        [-2, 0.5],
      ],
    };
    for (const st of bodyStations(flat)) {
      expect(st.top - st.belt).toBeGreaterThan(0.02);
      expect(st.belt - st.sill).toBeGreaterThan(0.02);
    }
  });
});

describe('sectionRing', () => {
  const st = stationAt(COUPE, 0.2);
  const ring = sectionRing(st);
  it('is symmetric about the centre line, left flank first', () => {
    expect(ring).toHaveLength(2 * (3 + SHOULDER_POINTS + 1) + 1);
    const n = ring.length;
    for (let i = 0; i < n; i++) {
      expect(ring[i][0]).toBeCloseTo(-ring[n - 1 - i][0], 9);
      expect(ring[i][1]).toBeCloseTo(ring[n - 1 - i][1], 9);
    }
    expect(ring[0][0]).toBeLessThan(0);
    expect(ring[Math.floor(n / 2)][0]).toBe(0);
  });
  it('is widest at the belt, lowest at the sill, highest at the crown, and every point is finite', () => {
    expect(Math.max(...ring.map(p => Math.abs(p[0])))).toBeCloseTo(st.half, 9);
    expect(Math.min(...ring.map(p => p[1]))).toBeCloseTo(st.sill, 9);
    expect(Math.max(...ring.map(p => p[1]))).toBeCloseTo(st.top + CROWN_M, 9);
    for (const [z, y] of ring) {
      expect(Number.isFinite(z)).toBe(true);
      expect(Number.isFinite(y)).toBe(true);
    }
  });
  it('rises monotonically up the left flank: the height never drops going from the sill to the top edge', () => {
    const left = ring.slice(0, (ring.length - 1) / 2 + 1);
    for (let i = 1; i < left.length; i++)
      expect(left[i][1]).toBeGreaterThanOrEqual(left[i - 1][1] - 1e-9);
  });
  it('rounds the shoulder: a boxier roundness pushes the shoulder points further out and up', () => {
    const soft = sectionRing(st, 2);
    const box = sectionRing(st, 4);
    const k = 3 + 1; // the middle shoulder point
    expect(Math.abs(box[k][0])).toBeGreaterThan(Math.abs(soft[k][0]));
    expect(box[k][1]).toBeGreaterThan(soft[k][1]);
  });
});
