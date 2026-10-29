import {describe, expect, it} from '@jest/globals';

import {matchCornerNames, matchSectionNames} from './cornerNames';

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

describe('matchSectionNames (ticket 83, Monza)', () => {
  // A stretch is a line of points from entry to exit, one every 10 m.
  const stretch = (fromM: number, toM: number) => {
    const points = [];
    for (let m = fromM; m <= toM; m += 10) points.push({lat: north(m), lon: 6});
    return points;
  };

  it('names a long arc from a point beside its stretch, not its apex (the Parabolica)', () => {
    // The apex is 300 m in; the name's point sits 90 m from it but on the arc's stretch.
    const sections = [{n: 0, points: stretch(0, 400)}];
    const name = {name: 'Curva Alboreto', lat: north(390), lon: 6};
    expect(matchCornerNames([{n: 0, lat: north(300), lon: 6}], [name]).has(0)).toBe(false);
    expect(matchSectionNames(sections, [name]).get(0)).toBe('Curva Alboreto');
  });

  it('a section takes the nearest name once: the chicane keeps its own name, the approach name goes unused (Ascari and Vialone)', () => {
    const sections = [{n: 0, points: stretch(100, 220)}];
    const names = [
      {name: 'Curva Vialone', lat: north(50), lon: 6},
      {name: 'Variante Ascari', lat: north(160), lon: 6},
    ];
    const got = matchSectionNames(sections, names);
    expect(got.get(0)).toBe('Variante Ascari');
    expect(got.size).toBe(1);
  });

  it('leaves a section unnamed when no name is within 60 m of its stretch', () => {
    expect(matchSectionNames([{n: 0, points: stretch(0, 100)}], [{name: 'Far', lat: north(161), lon: 6}]).size).toBe(0);
  });

  it('two sections close together still get one name each', () => {
    const got = matchSectionNames(
      [
        {n: 0, points: stretch(0, 20)},
        {n: 1, points: stretch(40, 60)},
      ],
      [
        {name: 'Eau Rouge', lat: north(10), lon: 6},
        {name: 'Raidillon', lat: north(50), lon: 6},
      ],
    );
    expect(got.get(0)).toBe('Eau Rouge');
    expect(got.get(1)).toBe('Raidillon');
  });
});
