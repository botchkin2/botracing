import {describe, expect, it} from '@jest/globals';

import {type GridTrace} from '@/src/analysis/resample';

import {buildFollowModel} from './followModel';

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

const place = (t: GridTrace, from: number, to: number, stride: number) => {
  const out = [];
  for (let i = from; i <= to; i += stride) out.push({x: t.lon[i], y: t.lat[i]});
  return out;
};

const ref = {lapId: 'a', selIndex: 0, key: true, highlighted: false};
const other = {lapId: 'b', selIndex: 1, key: false, highlighted: false};
const traces = new Map([
  ['a', straight()],
  ['b', straight(2)],
]);

const build = (cursorM: number, windowSpanM: number | null) =>
  buildFollowModel({
    refTrace: traces.get('a')!,
    traces,
    shown: [other, ref],
    cursorM,
    windowSpanM,
    outline: [],
    place,
  });

describe('buildFollowModel', () => {
  it('centres on the reference at the cursor, heading along it', () => {
    const f = build(300, 200);
    expect(f.centre).toEqual({x: 300, y: 0});
    expect(f.headingRad).toBeCloseTo(0);
    expect(f.visibleM).toBeCloseTo(190);
  });

  it('draws only the road around the cursor', () => {
    const f = build(300, 200);
    const xs = f.lines[0].points.map(p => p.x);
    // 0.7 × 190 behind and 0.95 × 190 ahead, plus 40 m either side.
    expect(Math.min(...xs)).toBe(125);
    expect(Math.max(...xs)).toBe(520);
  });

  it('uses the reference line as the road with no outline', () => {
    expect(build(300, 200).band).toHaveLength(1);
  });

  it('ticks brake points for key laps only, across the line', () => {
    const ticks = build(450, 200).brakeTicks;
    expect(ticks.map(t => t.lapId)).toEqual(['a']);
    const [l, r] = ticks[0].ends;
    expect(l.x).toBeCloseTo(500);
    expect(Math.abs(l.y - r.y)).toBeCloseTo(4.8);
  });

  it('keeps the whole lap for the inset', () => {
    expect(build(300, null).inset.line).toHaveLength(51);
  });
});
