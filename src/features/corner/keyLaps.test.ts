import {describe, expect, it} from '@jest/globals';

import {keyLapIds, resetLapIds} from './keyLaps';

const many = Array.from({length: 25}, (_, i) => `l${i}`);

describe('keyLapIds', () => {
  it('defaults to the one ticked lap plus the best lap', () => {
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

  it('with nothing ticked it is the best lap and the next fastest, not the first two in the list', () => {
    const ranked = ['l9', 'l3', 'l0', 'l1'];
    expect(
      keyLapIds({
        lapIds: ['l0', 'l1', 'l3', 'l9', ...many.slice(10)],
        selected: [],
        hl: null,
        bestLapId: 'l9',
        ranked,
        individual: false,
      }),
    ).toEqual(['l9', 'l3']);
    // The highlighted lap is the second.
    expect(
      keyLapIds({
        lapIds: many,
        selected: [],
        hl: 'l4',
        bestLapId: 'l9',
        individual: false,
      }),
    ).toEqual(['l9', 'l4']);
  });

  it('without a session best the fastest drawn lap stands in', () => {
    expect(
      keyLapIds({
        lapIds: many,
        selected: [],
        hl: null,
        bestLapId: null,
        ranked: ['l5', 'l2'],
        individual: false,
      }),
    ).toEqual(['l5', 'l2']);
  });
});

describe('resetLapIds', () => {
  it('is the opening set, with the picked Ref kept', () => {
    expect(resetLapIds(null, ['a', 'b', 'c'])).toEqual(['a', 'b', 'c']);
    expect(resetLapIds('b', ['a', 'b', 'c'])).toEqual(['a', 'b', 'c']);
    expect(resetLapIds('z', ['a', 'b'])).toEqual(['z', 'a', 'b']);
    expect(resetLapIds(null, [])).toEqual([]);
  });
});
