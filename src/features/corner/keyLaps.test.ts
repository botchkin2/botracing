import {describe, expect, it} from '@jest/globals';

import {extraTraceLapIds, keyLapIds, MAX_ON_LAPS, toggleLap} from './keyLaps';

const many = Array.from({length: 25}, (_, i) => `l${i}`);

describe('keyLapIds', () => {
  it('defaults to the reference plus the best lap', () => {
    expect(
      keyLapIds({
        lapIds: many,
        selected: ['l0'],
        hl: null,
        bestLapId: 'l7',
        individual: false,
      }),
    ).toEqual(['l0', 'l7']);
  });

  it('uses the URL laps when 2 to 6 are selected', () => {
    expect(
      keyLapIds({
        lapIds: many,
        selected: ['l3', 'l4', 'l9'],
        hl: null,
        bestLapId: 'l7',
        individual: false,
      }),
    ).toEqual(['l3', 'l4', 'l9']);
  });

  it('puts every lap on in individual mode', () => {
    const ids = ['a', 'b', 'c'];
    expect(
      keyLapIds({
        lapIds: ids,
        selected: ids,
        hl: null,
        bestLapId: null,
        individual: true,
      }),
    ).toEqual(ids);
  });
});

describe('toggleLap', () => {
  it('adds and removes, keeping the reference first', () => {
    expect(toggleLap(['r', 'a'], 'b')).toEqual({
      kind: 'ok',
      laps: ['r', 'a', 'b'],
    });
    expect(toggleLap(['r', 'a', 'b'], 'a')).toEqual({
      kind: 'ok',
      laps: ['r', 'b'],
    });
  });

  it('never removes the reference', () => {
    expect(toggleLap(['r', 'a'], 'r')).toEqual({kind: 'reference'});
  });

  it('stops at the palette size', () => {
    const full = Array.from({length: MAX_ON_LAPS}, (_, i) => `x${i}`);
    expect(toggleLap(full, 'y')).toEqual({kind: 'full'});
  });
});

describe('extraTraceLapIds', () => {
  const laps = [
    {id: 'ref', timeS: 100},
    {id: 'a', timeS: 100.4},
    {id: 'b', timeS: 99.5},
    {id: 'c', timeS: 103},
    {id: 'd', timeS: 98},
    {id: 'none', timeS: null},
  ];
  const lapIds = laps.map(l => l.id);

  it('takes the nearest laps to the reference by time, nearest first, never the laps on or untimed', () => {
    expect(
      extraTraceLapIds({lapIds, keyLapIds: ['ref', 'd'], laps, max: 2}),
    ).toEqual(['a', 'b']);
    expect(extraTraceLapIds({lapIds, keyLapIds: ['ref'], laps})).toEqual([
      'a',
      'b',
      'd',
      'c',
    ]);
  });

  it('is empty without a timed reference', () => {
    expect(extraTraceLapIds({lapIds, keyLapIds: ['none'], laps})).toEqual([]);
  });

  it('caps at 12 by default', () => {
    const many = Array.from({length: 40}, (_, i) => ({
      id: `l${i}`,
      timeS: 100 + i * 0.1,
    }));
    const ids = many.map(l => l.id);
    expect(
      extraTraceLapIds({lapIds: ids, keyLapIds: ['l0'], laps: many}),
    ).toHaveLength(12);
  });
});
