import {describe, expect, it} from '@jest/globals';
import {altitudeLabel, gapSeconds, chaseHudNumbers, elevationWindow, gearLabel, gradeLabel, slopeKind} from './chaseHud';
import {chaseRoad} from './chaseRoad';

// 10 m of climb over a 1000 m lap (heights every 100 m), linear then back down.
const elev = [0, 2, 4, 6, 8, 10, 8, 6, 4, 2];

const centre = Array.from({length: 40}, (_, i) => ({x: i * 10, y: 0}));
const roadWith = (e: number[] | null) => chaseRoad(centre, null, 10, 400, e)!;

describe('chaseHudNumbers', () => {
  it('is empty without a profile or a position', () => {
    expect(chaseHudNumbers(roadWith(null), 100)).toEqual({gradePct: null, altM: null});
    expect(chaseHudNumbers(roadWith(elev), null)).toEqual({gradePct: null, altM: null});
  });
  it('reads grade and height above the lowest point', () => {
    const road = roadWith(elev);
    const up = chaseHudNumbers(road, 100);
    expect(up.gradePct).toBeCloseTo(5, 0); // 2 m per 40 m
    expect(up.altM).toBeCloseTo(5, 0); // index 2.5 of a 40 m step: between 4 and 6
    expect(chaseHudNumbers(road, 300).gradePct).toBeCloseTo(-5, 0);
    expect(road.elevMin).toBe(0);
  });
});

describe('elevationWindow', () => {
  it('samples from behind to ahead of the car, the car at its own index', () => {
    const w = elevationWindow(elev, 500, 1000, 100, 500, 6);
    expect(w.heights).toHaveLength(7);
    expect(w.stepM).toBeCloseTo(100);
    expect(w.carIndex).toBe(1);
    expect(w.heights[1]).toBeCloseTo(10, 0); // at 500 m the road is at its top
  });
});

describe('slopeKind', () => {
  it('colours climbs, drops and level stretches', () => {
    expect(slopeKind(0.05)).toBe('up');
    expect(slopeKind(-0.05)).toBe('down');
    expect(slopeKind(0.01)).toBe('flat');
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
