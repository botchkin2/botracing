import {describe, expect, it} from '@jest/globals';

import {freshTyres, type LapTyres, toLapTyres, WHEELS} from './tyres';

const wheels = (fl: number, fr: number, rl: number, rr: number) => ({
  FL: fl,
  FR: fr,
  RL: rl,
  RR: rr,
});

describe('toLapTyres', () => {
  it('reads the four wheels by name, never by position', () => {
    const t = toLapTyres({
      v: 1,
      wearPct: wheels(94, 100, 93, 92.5),
      pressureKpa: wheels(160, 161, 150, 162),
      hotPressureKpa: wheels(166, 167, 158, 168),
      rubberC: wheels(80, 81, 82, 83),
      carcassC: wheels(70, 71, 72, 73),
      changed: ['FR'],
    });
    expect(t?.wearPct).toEqual(wheels(94, 100, 93, 92.5));
    expect(t?.hotPressureKpa).toEqual(wheels(166, 167, 158, 168));
    expect(t?.changed).toEqual(['FR']);
    expect(WHEELS).toEqual(['FL', 'FR', 'RL', 'RR']);
  });

  it('reads the tread thirds by wheel and name, a wheel or a third that has none null', () => {
    const t = toLapTyres({
      v: 3,
      treadC: {
        FL: {inner: 81, centre: 72.5, outer: 61},
        FR: {inner: 80, centre: 'x', outer: null},
        RL: null,
      },
    });
    expect(t?.treadC).toEqual({
      FL: {inner: 81, centre: 72.5, outer: 61},
      FR: {inner: 80, centre: null, outer: null},
      RL: null,
      RR: null,
    });
    // Before TYRES_VERSION 3 there is none.
    expect(toLapTyres({v: 2})?.treadC).toBeNull();
  });

  it('keeps a dead-sensor wheel null and a missing field null', () => {
    const t = toLapTyres({
      v: 1,
      wearPct: {FL: 90, FR: null, RL: 'x', RR: Number.NaN},
      pressureKpa: null,
      changed: null,
    });
    expect(t?.wearPct).toEqual({FL: 90, FR: null, RL: null, RR: null});
    expect(t?.pressureKpa).toBeNull();
    expect(t?.rubberC).toBeNull();
    expect(t?.hotPressureKpa).toBeNull();
    expect(t?.changed).toBeNull();
  });

  it('is null for a lap without the block, and drops names that are not wheels', () => {
    expect(toLapTyres(undefined)).toBeNull();
    expect(toLapTyres('FL')).toBeNull();
    expect(toLapTyres({changed: ['FL', 'XX', 3]})?.changed).toEqual(['FL']);
  });
});

describe('freshTyres', () => {
  const tyres = (changed: ('FL' | 'FR' | 'RL' | 'RR')[] | null): LapTyres => ({
    v: 1,
    wearPct: null,
    pressureKpa: null,
    hotPressureKpa: null,
    rubberC: null,
    carcassC: null,
    treadC: null,
    changed,
  });

  it('is the lap after a stop that changed any wheel, a set or one wheel', () => {
    expect(freshTyres({tyres: tyres(['FR']), endedInReset: false})).toBe(true);
    expect(
      freshTyres({tyres: tyres(['FL', 'FR', 'RL', 'RR']), endedInReset: false}),
    ).toBe(true);
  });

  it('is the lap after a reset to the garage, which has no pit window', () => {
    expect(freshTyres({tyres: tyres([]), endedInReset: true})).toBe(true);
    expect(freshTyres({tyres: null, endedInReset: true})).toBe(true);
  });

  it('is false for the first lap, after no change, and without the block', () => {
    expect(freshTyres(null)).toBe(false);
    expect(freshTyres(undefined)).toBe(false);
    expect(freshTyres({tyres: tyres([]), endedInReset: false})).toBe(false);
    expect(freshTyres({tyres: tyres(null), endedInReset: false})).toBe(false);
    expect(freshTyres({tyres: null, endedInReset: false})).toBe(false);
  });
});
