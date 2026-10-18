import {describe, expect, it} from '@jest/globals';
import {chaseRoad} from './chaseRoad';
import {roadIndex} from './chaseRoadIndex';

// A 400 m circle (radius 63.66 m), 10 m points, 8 m half-width, a ramp of height 0..9 m over the lap.
const N = 40;
const R = 400 / (2 * Math.PI);
const centre = Array.from({length: N}, (_, i) => ({
  x: R * Math.cos((i / N) * 2 * Math.PI),
  y: R * Math.sin((i / N) * 2 * Math.PI),
}));
const elev = Array.from({length: 10}, (_, i) => i);
const road = chaseRoad(centre, null, 10, 400, elev)!;
const idx = roadIndex(road);

describe('roadIndex', () => {
  it('finds the nearest lap distance and the side of the road', () => {
    const out = idx.nearest(R + 3, 0.0001)!;
    expect(out.dist).toBeCloseTo(3, 0);
    expect(out.s % 400).toBeCloseTo(0, 0);
    // counter-clockwise travel: the outside of the circle is on the right of the car
    expect(out.side).toBe(1);
    expect(idx.nearest(R - 3, 0.0001)!.side).toBe(-1);
  });
  it('is null with no road in reach', () => {
    expect(idx.nearest(5000, 5000)).toBeNull();
  });
  it('interpolates height by lap distance and wraps', () => {
    expect(idx.hasHeight).toBe(true);
    expect(idx.heightAt(0)).toBeCloseTo(0);
    expect(idx.heightAt(200)).toBeCloseTo(5, 0);
    expect(idx.heightAt(400)).toBeCloseTo(idx.heightAt(0));
  });
  it('points along the travel direction and measures its curvature', () => {
    expect(idx.tangentAt(0)).toBeCloseTo(Math.PI / 2, 1);
    expect(idx.curvatureAt(100)).toBeCloseTo(1 / R, 2);
  });
  it('is flat with no profile', () => {
    const flat = roadIndex(chaseRoad(centre, null, 10, 400, null)!);
    expect(flat.hasHeight).toBe(false);
    expect(flat.heightAt(123)).toBe(0);
  });
});
