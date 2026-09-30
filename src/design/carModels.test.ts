import {describe, expect, it} from '@jest/globals';

import {carLabel} from './carModels';

describe('carLabel', () => {
  it.each([
    [
      '911GT3R Custom Team 2025 #397',
      'Porsche 911 GT3 R',
      '911 GT3 R',
      'Custom #397',
    ],
    [
      'Mustang Custom Team 2025 #397',
      'Ford Mustang GT3',
      'Mustang GT3',
      'Custom #397',
    ],
    [
      'Manthey DK Engineering 2026 #91:LM',
      'Porsche 911 GT3 R',
      '911 GT3 R',
      'Manthey #91',
    ],
    [
      'Iron Dames 2025 #85:ELMS',
      'Porsche 911 GT3 R',
      '911 GT3 R',
      'Iron Dames #85',
    ],
    [
      'Proton Competition 2026 #88:WEC',
      'Ford Mustang GT3',
      'Mustang GT3',
      'Proton #88',
    ],
    [
      'Proton Racing 2024 #44:LM',
      'Ford Mustang GT3',
      'Mustang GT3',
      'Proton #44',
    ],
    [
      'United Autosports 2025 #23:ELMS',
      'McLaren 720S GT3 Evo',
      '720S GT3 Evo',
      'United #23',
    ],
  ])('%s', (name, model, shortModel, entry) => {
    expect(carLabel(name)).toEqual({model, shortModel, entry});
  });

  it('drops the series suffix from an entry the table does not know (Hypercar, LMP2)', () => {
    expect(carLabel('Cadillac WTR 2026 #101:LM')).toEqual({
      model: 'Cadillac WTR 2026 #101',
      shortModel: 'Cadillac WTR 2026 #101',
      entry: null,
    });
    expect(carLabel('CrowdStrike Racing by APR 2026 #4:WEC').model).toBe(
      'CrowdStrike Racing by APR 2026 #4',
    );
  });

  it('falls back to the raw name', () => {
    expect(carLabel('Unknown Car #1')).toEqual({
      model: 'Unknown Car #1',
      shortModel: 'Unknown Car #1',
      entry: null,
    });
  });
});
