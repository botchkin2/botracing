import {describe, expect, it} from '@jest/globals';

import {type DropStop, type GreenLap} from '@/src/analysis/fuelPlan';

import {pooledUse, thresholdOf} from './pooledUse';

const lap = (
  sessionId: string,
  fuelL: number,
  vePct: number | null,
  lapTimeS: number,
): GreenLap => ({sessionId, fuelL, vePct, lapTimeS});

const laps = [
  lap('this', 2.3, 3.4, 101),
  lap('this', 2.4, 3.5, 100.5),
  lap('old', 2.5, null, 102),
];

describe('pooledUse', () => {
  it('marks this session full and earlier ones muted', () => {
    const r = pooledUse(laps, 'this', 'fuel', null)!;
    expect(r.points.map(p => p.muted)).toEqual([false, false, true]);
    expect(r.n).toBe(3);
    expect(r.thisSession).toBe(2);
  });

  it('leaves out laps without VE on the VE measure, never drawing 0', () => {
    const r = pooledUse(laps, 'this', 've', null)!;
    expect(r.n).toBe(2);
    expect(r.points.map(p => p.x)).toEqual([3.4, 3.5]);
  });

  it('is null when no lap has the measure', () => {
    expect(pooledUse([lap('a', 2, null, 100)], 'a', 've', null)).toBeNull();
    expect(pooledUse([], 'a', 'fuel', null)).toBeNull();
  });

  it('keeps the reference line inside the x domain', () => {
    const r = pooledUse(laps, 'this', 'fuel', {x: 1.9, label: 'x'})!;
    expect(r.xDomain[0]).toBeLessThan(1.9);
    expect(r.threshold?.x).toBe(1.9);
  });

  it('leaves out laps the uploader does not call comparable, so they cannot stretch the scale', () => {
    const slow: GreenLap = {...lap('this', 2.35, 3.45, 240), comparable: false};
    const out = pooledUse([...laps, slow], 'this', 'fuel', null);
    expect(out?.points.map(p => p.y)).toEqual([101, 100.5, 102]);
    expect(out?.n).toBe(3);
    expect(out?.yDomain[1]).toBeLessThan(110);
  });

  it('frames a single lap', () => {
    const r = pooledUse([lap('a', 2.4, 3.4, 100)], 'a', 'fuel', null)!;
    expect(r.xDomain[0]).toBeLessThan(2.4);
    expect(r.xDomain[1]).toBeGreaterThan(2.4);
    expect(r.yDomain[0]).toBeLessThan(100);
  });
});

describe('thresholdOf', () => {
  const drop = {fuelPerLapL: 2.31, vePerLapPct: null} as DropStop;
  it('takes the plan’s use per lap for the measure, or nothing', () => {
    expect(thresholdOf(drop, 'fuel')).toEqual({
      x: 2.31,
      label: '2.31 L to drop a stop',
    });
    expect(thresholdOf(drop, 've')).toBeNull();
    expect(thresholdOf(null, 'fuel')).toBeNull();
  });
});
