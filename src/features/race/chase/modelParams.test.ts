import {describe, expect, it} from '@jest/globals';

import {SHAPES, type ClassShape} from './carShapes';
import {applyParams, type ModelParams} from './modelParams';

const HYPER = SHAPES.Hyper;
const last = (s: ClassShape) => s.hull[s.hull.length - 1];
const before = (s: ClassShape) => s.hull[s.hull.length - 2];

describe('the tail seen from behind', () => {
  it('tailW and tailTopW move the last station fully and the one before it by half', () => {
    const s = applyParams(HYPER, {tailW: 0.1, tailTopW: -0.2});
    expect(last(s)[1]).toBeCloseTo(last(HYPER)[1] + 0.1, 9);
    expect(last(s)[3]).toBeCloseTo(last(HYPER)[3] - 0.2, 9);
    expect(before(s)[1]).toBeCloseTo(before(HYPER)[1] + 0.05, 9);
    expect(before(s)[3]).toBeCloseTo(before(HYPER)[3] - 0.1, 9);
    // the nose is not touched
    expect(s.hull[0]).toEqual(HYPER.hull[0]);
  });

  it('a tail never collapses: no half-width falls below 0.1 m, whatever is asked', () => {
    const s = applyParams(HYPER, {tailW: -5, tailTopW: -5});
    for (const st of s.hull) {
      expect(st[1]).toBeGreaterThanOrEqual(0.1 - 1e-9);
      expect(st[3]).toBeGreaterThanOrEqual(0.1 - 1e-9);
    }
  });

  it('tailCut narrows the sill behind the rear axle and leaves the wheels where they were', () => {
    const s = applyParams(HYPER, {tailCut: 1});
    expect(last(s)[1]).toBeLessThan(last(HYPER)[1] * 0.6);
    expect(before(s)[1]).toBeLessThan(before(HYPER)[1]);
    expect(before(s)[1]).toBeGreaterThan(last(s)[1]);
    expect(s.wheels).toEqual(HYPER.wheels);
  });

  it('tailRound adds one station near the tail, narrower than its neighbours, and pulls the last one in', () => {
    const s = applyParams(HYPER, {tailRound: 1});
    expect(s.hull).toHaveLength(HYPER.hull.length + 1);
    const n = s.hull.length;
    expect(s.hull[n - 2][0]).toBeLessThan(s.hull[n - 3][0]);
    expect(s.hull[n - 2][0]).toBeGreaterThan(s.hull[n - 1][0]);
    expect(s.hull[n - 1][1]).toBeLessThan(HYPER.hull[HYPER.hull.length - 1][1]);
    expect(s.hull[n - 1][3]).toBeLessThan(HYPER.hull[HYPER.hull.length - 1][3]);
    // the front of the car is the class's own
    expect(s.hull.slice(0, n - 3)).toEqual(HYPER.hull.slice(0, n - 3));
    expect(applyParams(HYPER, {tailRound: 0}).hull).toHaveLength(
      HYPER.hull.length,
    );
  });

  it('the wing and the fin stay on the tail it made: the wing is above the deck under it', () => {
    const s = applyParams(HYPER, {tailRound: 1, tailCut: 1, tailW: -0.2});
    expect(s.wing[1]).toBeGreaterThan(last(s)[4]);
  });
});

describe('end plates and fender width', () => {
  it('endPlate is carried onto the shape as given, and the class has none', () => {
    expect(HYPER.endPlate).toBeUndefined();
    const s = applyParams(HYPER, {endPlate: {h: 0.4, sweep: 0.1}});
    expect(s.endPlate).toEqual({h: 0.4, sweep: 0.1});
  });

  it('fenderW moves every bulge outward by that much and changes nothing else', () => {
    const bulges = [
      {x: 1.2, len: 1, z: 0.7, w: 0.3, h: 0.2},
      {x: -1.4, len: 1, z: 0.8, w: 0.2, h: 0.1},
    ];
    const s = applyParams(HYPER, {bulges, fenderW: 0.12});
    expect(s.bulges?.map(b => b.z)).toEqual([0.82, 0.92]);
    expect(s.bulges?.map(b => b.x)).toEqual([1.2, -1.4]);
    expect(applyParams(HYPER, {bulges}).bulges).toEqual(bulges);
    expect(applyParams(HYPER, {fenderW: 0.2}).bulges).toBeUndefined();
  });
});

describe('every rear parameter keeps every number finite, whatever it is given', () => {
  const values = [-5, -0.5, -0.1, 0, 0.1, 0.5, 5];
  const rear: (keyof ModelParams)[] = [
    'tailW',
    'tailTopW',
    'tailRound',
    'tailCut',
    'fenderW',
  ];
  it.each(rear)('%s', key => {
    for (const v of values) {
      const s = applyParams(HYPER, {
        [key]: v,
        bulges: [{x: 1.2, len: 1, z: 0.7, w: 0.3, h: 0.2}],
      });
      for (const st of s.hull)
        for (const n of st) expect(Number.isFinite(n)).toBe(true);
      for (const n of s.wing) expect(Number.isFinite(n)).toBe(true);
      for (const b of s.bulges ?? [])
        for (const n of Object.values(b)) expect(Number.isFinite(n)).toBe(true);
      s.hull.forEach((st, i) => {
        if (i > 0) expect(st[0]).toBeLessThan(s.hull[i - 1][0]);
        expect(st[4]).toBeGreaterThanOrEqual(st[2]);
      });
    }
  });
});
