import {describe, expect, it} from '@jest/globals';

import race from './__fixtures__/classPaceR.json';
import {type ResultsDriver} from './classPace';
import {
  FINISH_VERSION,
  finishCurrent,
  finishDoc,
  finishDocFromResults,
  finishFromResults,
  finishPosition,
  type ResultField,
  raceResultText,
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
      classLeaderLapsDone: 3,
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
      classLeaderLapsDone: 9,
      leftEarly: true,
    });
  });

  it('has no class leader when the player class has no name', () => {
    const unnamed: ResultField = {
      ...field,
      cars: field.cars.map(c => ({...c, class: ''})),
    };
    expect(finishPosition(unnamed)?.classLeaderLapsDone).toBeNull();
  });

  it('counts the class leader among the cars of the player class only', () => {
    // The 2 Oct Road Atlanta race (seat-test da3e67d0575d9423): a GT3 that
    // left at L20, the GT3 leader on 23 when the Hypercar leader took the
    // flag on 26.
    const f: ResultField = {
      cars: [{class: 'GT3', player: true}, {class: 'Hyper'}, {class: 'GT3'}],
      place: [
        [3, 3, 3],
        [1, 1, 1],
        [2, 2, 2],
      ],
      laps: [
        [19, 20, 20],
        [20, 24, 26],
        [19, 21, 23],
      ],
    };
    expect(finishPosition(f)).toMatchObject({
      lapsDone: 20,
      leaderLapsDone: 26,
      classLeaderLapsDone: 23,
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
        source: 'field',
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

const placed = {
  overall: 3,
  inClass: 1,
  ofOverall: 58,
  ofClass: 14,
  lapsDone: 20,
  leaderLapsDone: 21,
  classLeaderLapsDone: 21,
  leftEarly: false,
};

describe('raceResultText', () => {
  it('reads the overall place and the class place, and nothing without a result', () => {
    expect(raceResultText(placed)).toBe('P3 · P1 in class');
    expect(raceResultText(null)).toBeNull();
  });

  it('says "left early" with the class place and the class leader laps', () => {
    const left = {
      ...placed,
      overall: 26,
      inClass: 20,
      lapsDone: 20,
      classLeaderLapsDone: 21,
      leftEarly: true,
    };
    // The class is already on the row, so the result line leaves it out.
    expect(raceResultText(left)).toBe('P20 · L20 of L21+ (left early)');
    expect(raceResultText({...left, classLeaderLapsDone: null})).toBe(
      'P20 · L20 (left early)',
    );
  });
});

// His real race, Sebring 2026-10-21 (20_45_08-82R1), cut to him and a few cars:
// the game's file gives Position 5 and ClassPosition 1 (GT3), Finished Normally.
describe('finishFromResults: the game own classification', () => {
  const drivers = race.drivers as ResultsDriver[];

  it('is the file overall and class place, as the head says it: P5 · P1 in class', () => {
    const finish = finishFromResults(drivers)!;
    expect(finish).toMatchObject({overall: 5, inClass: 1, leftEarly: false});
    expect(raceResultText(finish)).toBe('P5 · P1 in class');
    // the classified counts are the drivers the input lists (this fixture is cut to 7)
    expect(finish.ofOverall).toBe(7);
    expect(finish.ofClass).toBe(4);
  });

  it('counts his laps and the leaders: the class leader laps are the GT3 ones, not the faster class', () => {
    const finish = finishFromResults(drivers)!;
    expect(finish.lapsDone).toBe(30);
    expect(finish.leaderLapsDone).toBe(33);
    expect(finish.classLeaderLapsDone).toBe(30);
  });

  it('a status other than "Finished Normally" is left early, and reads as the list reads a left-early race', () => {
    for (const status of ['DNF', 'DQ', 'None']) {
      const left = finishFromResults(
        drivers.map(d => (d.player ? {...d, status} : d)),
      )!;
      expect(left.leftEarly).toBe(true);
      expect(raceResultText(left)).toBe('P1 · L30 of L30+ (left early)');
    }
  });

  it('is null without his row, without his overall place (an input from before it), or with no drivers', () => {
    expect(finishFromResults(null)).toBeNull();
    expect(finishFromResults([])).toBeNull();
    expect(finishFromResults(drivers.filter(d => !d.player))).toBeNull();
    expect(
      finishFromResults(
        drivers.map(d => (d.player ? {...d, overall: undefined} : d)),
      ),
    ).toBeNull();
  });
});

describe('finishDocFromResults: the stored result of a race', () => {
  const drivers = race.drivers as ResultsDriver[];

  it('is the version, the race kind, the file finish and its source; none for practice or qualifying', () => {
    expect(finishDocFromResults(drivers, 'Race')).toEqual({
      version: FINISH_VERSION,
      kind: 'race',
      finish: finishFromResults(drivers),
      source: 'results',
    });
    expect(finishDocFromResults(drivers, 'Practice')).toBeNull();
    expect(finishDocFromResults(drivers, 'Qualify')).toBeNull();
  });

  it('is null when the file cannot place him, so the field result stands, unchanged', () => {
    expect(finishDocFromResults(null, 'Race')).toBeNull();
    expect(finishDoc(field, 'Race')).toMatchObject({
      kind: 'race',
      source: 'field',
      finish: {overall: 2, inClass: 1},
    });
    // a result of either source is kept under the same version and kind
    const fromFile = finishDocFromResults(drivers, 'Race');
    expect(finishCurrent(fromFile as never, 'Race')).toBe(true);
  });
});
