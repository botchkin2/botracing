import {describe, expect, it} from '@jest/globals';

import {keyLapIds} from './keyLaps';

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

  it('uses the URL laps when two or more are selected', () => {
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

  it('draws every ticked lap, however many (no cap)', () => {
    const ticked = many.slice(0, 9);
    expect(
      keyLapIds({
        lapIds: many,
        selected: ticked,
        hl: null,
        bestLapId: 'l7',
        individual: false,
      }),
    ).toEqual(ticked);
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
