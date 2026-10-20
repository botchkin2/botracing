import {describe, expect, it} from '@jest/globals';
import {altitudeLabel, gapSeconds, chaseHudNumbers, elevationWindow, gearLabel, gradeLabel, PROFILE_FLOOR_M} from './chaseHud';
import {fixtureRoad} from './chaseRoadFixture';

// 10 m of climb over a 1000 m lap (heights every 100 m), linear then back down; the road measures the lap as 400 m.
const elev = {stepM: 100, heightM: [0, 2, 4, 6, 8, 10, 8, 6, 4, 2]};

const centre = Array.from({length: 40}, (_, i) => ({x: i * 10, y: 0}));
const roadWith = (e: typeof elev | null) => fixtureRoad(centre, 400, {elevation: e, elevationLapM: 1000});

describe('chaseHudNumbers', () => {
  it('is empty without a profile or a position', () => {
    expect(chaseHudNumbers(roadWith(null), 100)).toEqual({gradePct: null, altM: null});
    expect(chaseHudNumbers(roadWith(elev), null)).toEqual({gradePct: null, altM: null});
  });
  it('reads grade and height above the lowest point', () => {
    const road = roadWith(elev);
    const up = chaseHudNumbers(road, 100); // the profile's 250 m
    expect(up.gradePct).toBeCloseTo(2, 1); // 2 m per 100 m
    expect(up.altM).toBeCloseTo(5, 1);
    expect(chaseHudNumbers(road, 300).gradePct).toBeCloseTo(-2, 1);
    expect(road.elevMin).toBe(0);
  });
});

describe('elevationWindow', () => {
  it('samples from behind to ahead of the car, the car at its own index', () => {
    const w = elevationWindow(roadWith(elev), 200, 40, 200, 6)!;
    expect(w.heights).toHaveLength(7);
    expect(w.stepM).toBeCloseTo(40);
    expect(w.carIndex).toBe(1);
    expect(w.heights[1]).toBeCloseTo(10, 1); // at 200 of 400 m the road is at its top
  });
  it('never scales less than the floor, so a small wobble stays flat', () => {
    const tiny = {stepM: 100, heightM: [0, 0.2, 0.4, 0.2, 0, 0, 0, 0, 0, 0]};
    const w = elevationWindow(roadWith(tiny), 40, 40, 200, 12)!;
    expect(w.spanM).toBe(PROFILE_FLOOR_M);
    expect(w.baseM).toBeLessThan(0);
    expect(w.baseM + w.spanM).toBeGreaterThan(0.4);
  });
  it('is null on a road without a profile', () => {
    expect(elevationWindow(roadWith(null), 100, 40, 200, 6)).toBeNull();
  });
});

describe('labels', () => {
  it('names the gear', () => {
    expect([-1, 0, 1, 6].map(gearLabel)).toEqual(['R', 'N', '1', '6']);
  });
  it('writes grade with a true minus and altitude in whole metres', () => {
    expect(gradeLabel(2.14)).toBe('+2.1%');
    expect(gradeLabel(-0.44)).toBe('−0.4%');
    expect(gradeLabel(0.02)).toBe('0.0%');
    expect(altitudeLabel(12.6)).toBe('13 m');
  });
});

describe('gapSeconds', () => {
  it('shows no gap before the start, the standings intervals after', () => {
    const i = {intervalAheadS: 0.5, intervalBehindS: 120};
    expect(gapSeconds({...i, beforeStart: true})).toEqual({aheadS: null, behindS: null});
    expect(gapSeconds({...i, beforeStart: false})).toEqual({aheadS: 0.5, behindS: 120});
  });
});
