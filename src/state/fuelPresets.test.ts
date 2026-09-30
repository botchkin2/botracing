import {describe, expect, it} from '@jest/globals';

import {
  DEFAULT_LENGTH,
  freshId,
  newPreset,
  removePreset,
  upsertPreset,
} from './fuelPresets';

const at = '2026-09-26T00:00:00Z';

describe('newPreset', () => {
  it('fills the defaults: fill limit, full VE, formation lap, no stops', () => {
    expect(newPreset('  Endurance  ', {}, 'p1', at)).toEqual({
      id: 'p1',
      name: 'Endurance',
      length: DEFAULT_LENGTH,
      fuelL: null,
      vePct: 100,
      veRatio: null,
      formationLap: true,
      mandatoryStops: 0,
      savedAt: at,
    });
  });

  it('names an empty name Untitled and keeps what it is given', () => {
    const p = newPreset(
      ' ',
      {
        fuelL: 75,
        vePct: 80,
        mandatoryStops: 2,
        length: {kind: 'laps', value: 40},
      },
      'p2',
      at,
    );
    expect(p).toMatchObject({
      name: 'Untitled',
      fuelL: 75,
      vePct: 80,
      mandatoryStops: 2,
      length: {kind: 'laps', value: 40},
    });
  });
});

describe('preset list edits', () => {
  const a = newPreset('A', {}, 'p1', at);
  const b = newPreset('B', {}, 'p2', at);

  it('adds a new preset and replaces one with the same id', () => {
    expect(upsertPreset([a], b)).toEqual([a, b]);
    const a2 = {...a, name: 'A2'};
    expect(upsertPreset([a, b], a2)).toEqual([a2, b]);
  });

  it('removes by id and ignores an unknown one', () => {
    expect(removePreset([a, b], 'p1')).toEqual([b]);
    expect(removePreset([a, b], 'zz')).toEqual([a, b]);
  });

  it('never reuses an id', () => {
    expect(freshId([a, b], 1)).toBe('p3');
    expect(freshId([], 1)).toBe('p1');
    expect(freshId([a, b], 7)).toBe('p7');
  });
});
