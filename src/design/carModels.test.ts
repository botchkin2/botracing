import {describe, expect, it} from '@jest/globals';

import {carLabel} from './carModels';

describe('carLabel', () => {
  it.each([
    ['911GT3R Custom Team 2025 #397', 'Porsche 911 GT3 R', 'Custom #397'],
    ['Mustang Custom Team 2025 #397', 'Ford Mustang GT3', 'Custom #397'],
    ['Manthey DK Engineering 2026 #91:LM', 'Porsche 911 GT3 R', 'Manthey #91'],
    ['Iron Dames 2025 #85:ELMS', 'Porsche 911 GT3 R', 'Iron Dames #85'],
    ['Proton Competition 2026 #88:WEC', 'Ford Mustang GT3', 'Proton #88'],
    ['Proton Racing 2024 #44:LM', 'Ford Mustang GT3', 'Proton #44'],
    ['United Autosports 2025 #23:ELMS', 'McLaren 720S GT3 Evo', 'United #23'],
  ])('%s', (name, model, entry) => {
    expect(carLabel(name)).toEqual({model, entry});
  });

  it('falls back to the raw name', () => {
    expect(carLabel('Unknown Car #1')).toEqual({
      model: 'Unknown Car #1',
      entry: null,
    });
  });
});
