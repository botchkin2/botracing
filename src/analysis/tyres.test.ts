import {describe, expect, it} from '@jest/globals';

import {toLapTyres, WHEELS} from './tyres';

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
      rubberC: wheels(80, 81, 82, 83),
      carcassC: wheels(70, 71, 72, 73),
      changed: ['FR'],
    });
    expect(t?.wearPct).toEqual(wheels(94, 100, 93, 92.5));
    expect(t?.changed).toEqual(['FR']);
    expect(WHEELS).toEqual(['FL', 'FR', 'RL', 'RR']);
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
    expect(t?.changed).toBeNull();
  });

  it('is null for a lap without the block, and drops names that are not wheels', () => {
    expect(toLapTyres(undefined)).toBeNull();
    expect(toLapTyres('FL')).toBeNull();
    expect(toLapTyres({changed: ['FL', 'XX', 3]})?.changed).toEqual(['FL']);
  });
});
