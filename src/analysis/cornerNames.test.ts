import {describe, expect, it} from '@jest/globals';

import {matchCornerNames} from './cornerNames';

// Near 50°N one metre north is 1/110540° of latitude.
const north = (m: number) => 50 + m / 110540;

describe('matchCornerNames', () => {
  it('names a corner from the nearest point within 60 m', () => {
    const names = matchCornerNames(
      [{n: 1, lat: north(0), lon: 6}],
      [
        {name: 'La Source', lat: north(20), lon: 6},
        {name: 'Far away', lat: north(55), lon: 6},
      ],
    );
    expect(names.get(1)).toBe('La Source');
  });

  it('leaves a corner unnamed past 60 m', () => {
    const names = matchCornerNames(
      [{n: 7, lat: north(0), lon: 6}],
      [{name: 'Pouhon', lat: north(61), lon: 6}],
    );
    expect(names.has(7)).toBe(false);
  });

  it('never gives one name to two close corners', () => {
    // Apexes 40 m apart; the only name sits between them, nearer C3.
    const names = matchCornerNames(
      [
        {n: 3, lat: north(0), lon: 6},
        {n: 4, lat: north(40), lon: 6},
      ],
      [{name: 'Eau Rouge', lat: north(15), lon: 6}],
    );
    expect(names.get(3)).toBe('Eau Rouge');
    expect(names.has(4)).toBe(false);
  });

  it('gives each corner its own name when both are close', () => {
    const names = matchCornerNames(
      [
        {n: 3, lat: north(0), lon: 6},
        {n: 4, lat: north(40), lon: 6},
      ],
      [
        {name: 'Eau Rouge', lat: north(18), lon: 6},
        {name: 'Raidillon', lat: north(22), lon: 6},
      ],
    );
    expect(names.get(3)).toBe('Eau Rouge');
    expect(names.get(4)).toBe('Raidillon');
  });
});
