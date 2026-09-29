import {describe, expect, it} from '@jest/globals';

import {keyLapIds, MAX_ON_LAPS, toggleLap} from './keyLaps';

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
