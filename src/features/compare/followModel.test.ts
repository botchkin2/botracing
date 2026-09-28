import {describe, expect, it} from '@jest/globals';

import {type GridTrace} from '@/src/analysis/resample';

import {buildFollowGeometry, buildFollowView} from './followModel';
import {type MapPlacer} from './mapPlace';

// A straight 1000 m lap heading east on a 5 m grid; "lat/lon" hold metres so
// the placer is the identity. Brake goes on at 500 m.
function straight(offsetY = 0): GridTrace {
  const n = 201;
  const distanceM = Array.from({length: n}, (_, i) => i * 5);
  return {
    stepM: 5,
    distanceM,
    speedKph: distanceM.map(() => 200),
    throttlePct: distanceM.map(() => 100),
    brakePct: distanceM.map(m => (m >= 500 && m < 600 ? 80 : 0)),
    steeringPct: distanceM.map(() => 0),
    gear: distanceM.map(() => 6),
    lat: distanceM.map(() => offsetY),
    lon: distanceM,
    timeS: distanceM.map(m => m / 50),
  };
}

const placer: MapPlacer = {
  real: false,
  place: (t, from, to, stride) => {
    const out = [];
    for (let i = from; i <= to; i += stride)
      out.push({x: t.lon[i], y: t.lat[i]});
    return out;
  },
  outline: [],
};

const traces = new Map([
  ['a', straight()],
  ['b', straight(2)],
]);

describe('buildFollowView', () => {
  it('centres on the reference at the cursor, heading along it', () => {
    const v = buildFollowView(placer, traces.get('a')!, 300, 200);
    expect(v.centre).toEqual({x: 300, y: 0});
    expect(v.headingRad).toBeCloseTo(0);
    expect(v.visibleM).toBeCloseTo(190);
  });
  it('uses 260 m for the whole lap', () => {
    expect(buildFollowView(placer, traces.get('a')!, 300, null).visibleM).toBe(
      260,
    );
  });
});

describe('buildFollowGeometry', () => {
  const g = buildFollowGeometry(placer, traces, ['a', 'b'])!;

  it('keeps each lap whole at grid resolution', () => {
    expect(g.lines.get('a')).toHaveLength(201);
    expect(g.lines.get('b')![0]).toEqual({x: 0, y: 2});
  });
  it('uses the reference line as the road with no outline', () => {
    expect(g.band).toEqual([g.lines.get('a')]);
  });
  it('ticks each brake point across the lap line', () => {
    const [[l, r]] = g.brakeTicks.get('b')!;
    expect(l.x).toBeCloseTo(500);
    expect(Math.abs(l.y - r.y)).toBeCloseTo(4.8);
  });
  it('thins the inset line', () => {
    expect(g.inset).toHaveLength(51);
  });
  it('is null without the reference trace', () => {
    expect(buildFollowGeometry(placer, traces, ['x'])).toBeNull();
  });
});
