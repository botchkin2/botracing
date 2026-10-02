import {describe, expect, it} from '@jest/globals';

import {
  FINISH_VERSION,
  finishCurrent,
  finishDoc,
  finishPosition,
  type ResultField,
} from './raceResult';

// Six updates, four cars. The player (GT3) crosses the line at updates 1, 2
// and 3 (laps 1, 2, 3), takes 2nd overall and 1st in class at the last
// crossing, then drives into the garage and is scored last at update 5. The
// Hyper leader has 3 laps from update 3 on: it finished first. Car 2 (GT3) is
// ahead of the player until update 3; car 3 (GT3) is absent from update 4.
const field: ResultField = {
  cars: [
    {class: 'GT3', player: true},
    {class: 'Hyper'},
    {class: 'GT3'},
    {class: 'GT3'},
  ],
  place: [
    [3, 3, 3, 2, 4, 4],
    [1, 1, 1, 1, 1, 1],
    [2, 2, 2, 3, 2, 2],
    [4, 4, 4, 4, null, null],
  ],
  laps: [
    [0, 1, 2, 3, 3, 3],
    [0, 1, 2, 3, 3, 3],
    [0, 1, 2, 2, 3, 3],
    [0, 1, 2, 2, null, null],
  ],
};

describe('finishPosition', () => {
  it('reads the place at the last line crossing, not after the player left the track', () => {
    expect(finishPosition(field)).toEqual({
      overall: 2,
      inClass: 1,
      ofOverall: 4,
      ofClass: 3,
      lapsDone: 3,
      leaderLapsDone: 3,
      leftEarly: false,
    });
  });

  it('counts the class place among cars of the same class only', () => {
    const f: ResultField = {
      ...field,
      place: [
        [0, 5],
        [0, 1],
        [0, 2],
        [0, 3],
      ],
      laps: [
        [0, 1],
        [0, 1],
        [0, 1],
        [0, 1],
      ],
    };
    // Place 5; the GT3 cars ahead are 2 and 3, so 3rd in class.
    expect(finishPosition(f)).toMatchObject({
      overall: 5,
      inClass: 3,
      ofClass: 3,
    });
  });

  it('says the player left early when the leader crossed the line after the last crossing', () => {
    const f: ResultField = {
      ...field,
      laps: [
        [0, 1, 2, 3, 3, 3],
        [0, 2, 4, 6, 8, 10],
        [0, 2, 4, 5, 7, 9],
        [0, 1, 2, 2, null, null],
      ],
    };
    expect(finishPosition(f)).toMatchObject({
      overall: 2,
      lapsDone: 3,
      leaderLapsDone: 10,
      leftEarly: true,
    });
  });

  it('is null without a player, a crossing or a place at it', () => {
    expect(
      finishPosition({...field, cars: field.cars.map(c => ({class: c.class}))}),
    ).toBeNull();
    // Never crosses the line.
    expect(
      finishPosition({...field, laps: [[0, 0, 0], ...field.laps.slice(1)]}),
    ).toBeNull();
    // No place at the crossing.
    expect(
      finishPosition({
        ...field,
        place: [[3, 3, 3, null, 4, 4], ...field.place.slice(1)],
      }),
    ).toBeNull();
  });
});

describe('finishDoc', () => {
  it('carries the position for a race and none for practice or qualifying', () => {
    expect(finishDoc(field, 'Race')).toMatchObject({
      version: FINISH_VERSION,
      kind: 'race',
      finish: {overall: 2, inClass: 1, leftEarly: false},
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
