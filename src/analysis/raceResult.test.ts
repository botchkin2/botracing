import {describe, expect, it} from '@jest/globals';

import {
  FINISH_VERSION,
  finishCurrent,
  finishDoc,
  finishPosition,
  type ResultField,
} from './raceResult';

// Four updates. Car 0 (player, GT3) runs 3rd overall, finishes 2nd; car 1
// (Hyper) leads; car 2 (GT3) is ahead of the player until the last update;
// car 3 (GT3) leaves the field (absent) before the end.
const field: ResultField = {
  cars: [
    {class: 'GT3', player: true},
    {class: 'Hyper'},
    {class: 'GT3'},
    {class: 'GT3'},
  ],
  place: [
    [3, 3, 3, 2],
    [1, 1, 1, 1],
    [2, 2, 2, 3],
    [4, 4, null, null],
  ],
  laps: [
    [0, 5, 10, 12],
    [0, 7, 14, 17],
    [0, 5, 10, 12],
    [0, 4, null, null],
  ],
};

describe('finishPosition', () => {
  it('reads the place at the last update the player is in, overall and in class', () => {
    expect(finishPosition(field)).toEqual({
      overall: 2,
      inClass: 1,
      ofOverall: 3,
      ofClass: 2,
      lapsDone: 12,
      leaderLapsDone: 17,
    });
  });

  it('counts the class place among cars of the same class only', () => {
    const f: ResultField = {
      ...field,
      place: [[5], [1], [2], [3]],
      laps: [[9], [9], [9], [9]],
    };
    // Place 5 overall; the GT3 cars ahead are 2 and 3, so 3rd in class.
    expect(finishPosition(f)).toMatchObject({
      overall: 5,
      inClass: 3,
      ofClass: 3,
    });
  });

  it('uses the last update the player has a place at, not the last update', () => {
    const f: ResultField = {
      ...field,
      place: [
        [3, 2, null, null],
        [1, 1, 1, 1],
        [2, 3, 2, 2],
        [4, 4, 3, 3],
      ],
      laps: [
        [0, 4, null, null],
        [0, 6, 12, 18],
        [0, 4, 8, 12],
        [0, 4, 8, 12],
      ],
    };
    expect(finishPosition(f)).toMatchObject({
      overall: 2,
      lapsDone: 4,
      leaderLapsDone: 6,
    });
  });

  it('is null without a player or without a place', () => {
    expect(
      finishPosition({...field, cars: field.cars.map(c => ({class: c.class}))}),
    ).toBeNull();
    expect(
      finishPosition({
        ...field,
        place: [
          [null, null],
          [1, 1],
          [2, 2],
          [3, 3],
        ],
      }),
    ).toBeNull();
  });
});

describe('finishDoc', () => {
  it('carries the position for a race and none for practice or qualifying', () => {
    expect(finishDoc(field, 'Race')).toMatchObject({
      version: FINISH_VERSION,
      kind: 'race',
      finish: {overall: 2, inClass: 1},
    });
    for (const type of ['Practice', 'Qualify'])
      expect(finishDoc(field, type)).toEqual({
        version: FINISH_VERSION,
        kind: 'other',
        finish: null,
      });
  });

  it('can be kept only for this version and this kind of session', () => {
    const doc = finishDoc(field, 'Race');
    expect(finishCurrent(doc as never, 'Race')).toBe(true);
    expect(finishCurrent(doc as never, 'Practice')).toBe(false);
    expect(
      finishCurrent({...doc, version: FINISH_VERSION - 1} as never, 'Race'),
    ).toBe(false);
    expect(finishCurrent(null, 'Race')).toBe(false);
  });
});
