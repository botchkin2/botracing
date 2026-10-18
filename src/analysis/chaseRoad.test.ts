import {describe, expect, it} from '@jest/globals';

import {chaseRoad, gradeAt, heightAt} from './chaseRoad';

describe('chaseRoad', () => {
  const ring = Array.from({length: 40}, (_, i) => ({
    x: 100 * Math.cos((i / 40) * Math.PI * 2),
    y: 100 * Math.sin((i / 40) * Math.PI * 2),
  }));
  it('takes measured half-widths and fills a missing side', () => {
    const left = ring.map(() => 6);
    const right = ring.map((_, i) => (i === 3 ? NaN : 5));
    const road = chaseRoad(ring, {stepM: 10, lengthM: 400, leftM: left, rightM: right}, 10, 400, null);
    expect(road?.hl[0]).toBe(6);
    expect(road?.hr[3]).toBe(7);
    expect(road?.hr[4]).toBe(5);
    expect(road?.elev).toBeNull();
  });
  it('is null for a path too short to be a road', () => {
    expect(chaseRoad(ring.slice(0, 3), null, 10, 30, null)).toBeNull();
  });
  it('wraps height and reads grade as rise over run', () => {
    const elev = [0, 10, 20, 30]; // 100 m lap: 10 m per 25 m... a ramp
    expect(heightAt(elev, 0.125)).toBeCloseTo(5);
    expect(heightAt(elev, 1.125)).toBeCloseTo(5);
    expect(gradeAt(elev, 0.3, 100, 10)).toBeCloseTo(0.4, 1);
  });
});
