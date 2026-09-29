import {describe, expect, it} from '@jest/globals';

import {layoutsOf, toTrackInfo, trackInfo} from './catalog';

describe('toTrackInfo', () => {
  it('drops fetched facts that are missing instead of inventing them', () => {
    const t = toTrackInfo('lmu-x', {layout: 'X', lengthM: 4000});
    expect(t).toMatchObject({
      layout: 'X',
      location: 'X',
      lengthM: 4000,
      openedYear: null,
      country: null,
      countryCode: null,
      place: null,
      summary: null,
      osmNames: [],
    });
  });

  it('keeps a summary only with its text and link', () => {
    expect(toTrackInfo('a', {summary: {extract: 'Text'}}).summary).toBeNull();
    expect(
      toTrackInfo('a', {summary: {extract: 'Text', url: 'https://w/x'}}).summary
        ?.attribution,
    ).toBe('Wikipedia, CC BY-SA 4.0');
  });
});

it('drops motorcycle-only corner names', () => {
  const t = toTrackInfo('a', {
    osmNames: [
      {name: 'Motorcycle Turn 12', lat: 1, lon: 1},
      {name: 'Turn 12', lat: 1, lon: 1},
    ],
  });
  expect(t.osmNames.map(n => n.name)).toEqual(['Turn 12']);
});

describe('the bundled catalog', () => {
  it('has the Wikipedia attribution on every summary', () => {
    const spa = trackInfo('lmu-circuit_de_spa_francorchamps');
    expect(spa?.countryCode).toBe('BE');
    expect(spa?.summary?.attribution).toMatch(/CC BY-SA/);
  });

  it('groups layouts by circuit', () => {
    expect(
      layoutsOf('lmu-silverstone_grand_prix_circuit_wec').map(t => t.trackId),
    ).toEqual([
      'lmu-silverstone_grand_prix_circuit_elms',
      'lmu-silverstone_grand_prix_circuit_wec',
    ]);
  });
});
