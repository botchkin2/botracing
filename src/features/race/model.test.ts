import {describe, expect, it} from '@jest/globals';

import {type CarState, type RaceCar} from '@/src/analysis/raceState';

import {
  buildRaceModel,
  classKey,
  defaultFilter,
  displayModel,
  labelRank,
} from './model';

function car(
  index: number,
  carClass: string,
  classPlace: number,
  extra: Partial<RaceCar> = {},
): RaceCar {
  return {
    index,
    carClass,
    vehicle: `Car ${index}`,
    player: false,
    xM: index * 10,
    zM: 0,
    headingRad: 0,
    lapDistM: index * 10,
    speedKmh: 200,
    state: 'running' as CarState,
    place: index + 1,
    classPlace,
    lapsDone: 3,
    pits: 0,
    gapS: classPlace === 1 ? 0 : classPlace * 1.5,
    intervalS: null,
    lapsDown: 0,
    ...extra,
  };
}

const field = [
  car(0, 'Hyper', 1),
  car(1, 'Hyper', 2),
  car(2, 'LMP2', 1),
  car(3, 'GT3', 2, {player: true, pits: 1}),
  car(4, 'GT3', 1),
  car(5, 'GT3', 0, {state: 'garage', gapS: null}),
];

describe('classKey', () => {
  it('maps the sim strings, else other', () => {
    expect(
      ['Hyper', 'LMP2', 'GT3', 'LMGT3', 'GTE', '', 'Odd'].map(classKey),
    ).toEqual(['hypercar', 'lmp2', 'gt3', 'other', 'gt3', 'other', 'other']);
  });
});

describe('displayModel', () => {
  it('drops the class LMU puts on the end of a model name', () => {
    expect(
      [
        'Porsche 911 GT3 R LMGT3',
        'Chevrolet Corvette Z06 LMGT3.',
        'Aston Martin Vantage AMR LMGT',
        'BMW M4 LMGT3',
        'Toyota TR010 LMH',
        'Cadillac V-Series.R',
        'Ferrari 296 LMGT3 Evo',
        'Porsche 911 GT3 R',
      ].map(displayModel),
    ).toEqual([
      'Porsche 911 GT3 R',
      'Chevrolet Corvette Z06',
      'Aston Martin Vantage AMR',
      'BMW M4',
      'Toyota TR010',
      'Cadillac V-Series.R',
      'Ferrari 296 GT3 Evo',
      'Porsche 911 GT3 R',
    ]);
  });

  it('says Unknown car with no name', () => {
    expect(displayModel(null)).toBe('Unknown car');
    expect(displayModel('  ')).toBe('Unknown car');
  });
});

describe('buildRaceModel', () => {
  it('All: one group per class present, with a header and the count', () => {
    const m = buildRaceModel({cars: field, filter: 'all', focus: null});
    expect(m.filter).toBe('all');
    expect(m.classes).toEqual(['hypercar', 'lmp2', 'gt3']);
    expect(m.groups.map(g => g.title)).toEqual([
      'HYPERCAR · 2 CARS',
      'LMP2 · 1 CARS',
      'GT3 · 3 CARS',
    ]);
    expect(m.carCount).toBe(6);
  });

  it('a class filter shows that class alone, no header, garage last', () => {
    const m = buildRaceModel({cars: field, filter: 'gt3', focus: null});
    expect(m.groups).toHaveLength(1);
    expect(m.groups[0].title).toBeNull();
    expect(m.groups[0].rows.map(r => r.index)).toEqual([4, 3, 5]);
  });

  it('falls back to All when the wanted class is not in the field', () => {
    const only = field.filter(c => c.carClass === 'GT3');
    expect(
      buildRaceModel({cars: only, filter: 'hypercar', focus: null}).filter,
    ).toBe('all');
  });

  it('rows: position, gap text, pit count, and the state that replaces it', () => {
    const rows = buildRaceModel({cars: field, filter: 'gt3', focus: null})
      .groups[0].rows;
    expect(rows[0]).toMatchObject({position: '1', gap: '', status: ''});
    expect(rows[1]).toMatchObject({
      position: '2',
      gap: '+3.000',
      status: '1',
      player: true,
    });
    expect(rows[2]).toMatchObject({
      position: '',
      gap: '—',
      status: 'GAR',
      state: 'garage',
    });
    const states = ['pit', 'stopped', 'off'] as const;
    const codes = ['PIT', 'STOP', 'OFF'];
    states.forEach((s, i) => {
      const m = buildRaceModel({
        cars: [car(0, 'GT3', 1, {state: s, pits: 2})],
        filter: 'all',
        focus: null,
      });
      expect(m.groups[0].rows[0].status).toBe(codes[i]);
    });
  });

  it('a lapped car reads +1 lap, then +2 laps, whatever its time gap', () => {
    const m = buildRaceModel({
      cars: [
        car(0, 'GT3', 2, {gapS: 130, lapsDown: 1}),
        car(1, 'GT3', 3, {gapS: 250, lapsDown: 2}),
      ],
      filter: 'all',
      focus: null,
    });
    expect(m.groups[0].rows.map(r => r.gap)).toEqual(['+1 lap', '+2 laps']);
  });

  it('a gap over a minute reads m:ss.s', () => {
    const m = buildRaceModel({
      cars: [car(0, 'GT3', 2, {gapS: 95.04})],
      filter: 'all',
      focus: null,
    });
    expect(m.groups[0].rows[0].gap).toBe('+1:35.0');
  });

  it('dots: garage cars are off the map, the focused car and you are drawn last', () => {
    const m = buildRaceModel({cars: field, filter: 'all', focus: 1});
    expect(m.dots.map(d => d.index)).toEqual([0, 2, 4, 1, 3]);
    expect(m.dots.at(-1)).toMatchObject({player: true});
    expect(m.dots.find(d => d.index === 1)?.focused).toBe(true);
    expect(m.groups[0].rows.find(r => r.index === 1)?.focused).toBe(true);
  });

  it('focus label: model, class place and gap; the garage says so', () => {
    const at = (focus: number) =>
      buildRaceModel({cars: field, filter: 'all', focus}).focusLabel;
    expect(at(3)).toBe('Car 3 · GT3 P2 · +3.000');
    expect(at(4)).toBe('Car 4 · GT3 P1');
    expect(at(5)).toBe('Car 5 · in the garage');
    expect(at(99)).toBeNull();
    expect(
      buildRaceModel({cars: field, filter: 'all', focus: null}).focusLabel,
    ).toBeNull();
  });

  it('you: class and model, or null with no player', () => {
    expect(
      buildRaceModel({cars: field, filter: 'all', focus: null}).you,
    ).toEqual({
      key: 'gt3',
      model: 'Car 3',
    });
    const none = field.map(c => ({...c, player: false}));
    expect(
      buildRaceModel({cars: none, filter: 'all', focus: null}).you,
    ).toBeNull();
  });

  it('an empty field is an empty model', () => {
    const m = buildRaceModel({cars: [], filter: 'all', focus: null});
    expect(m).toMatchObject({groups: [], dots: [], classes: [], carCount: 0});
  });
});

describe('defaultFilter', () => {
  it('is your class, else All', () => {
    expect(defaultFilter(field)).toBe('gt3');
    expect(defaultFilter(field.map(c => ({...c, player: false})))).toBe('all');
  });
});

describe('labelRank', () => {
  const you = car(3, 'GT3', 5, {player: true});
  it('ranks focused, you, near you in class, class leaders, then the rest', () => {
    const ranks = {
      focused: labelRank(car(9, 'GT3', 12), you, 9),
      you: labelRank(you, you, null),
      near: labelRank(car(6, 'GT3', 8), you, null),
      leader: labelRank(car(2, 'LMP2', 1), you, null),
      rest: labelRank(car(7, 'GT3', 9), you, null),
    };
    expect(ranks.focused).toBeLessThan(ranks.you);
    expect(ranks.you).toBeLessThan(ranks.near);
    expect(ranks.near).toBeLessThan(ranks.leader);
    expect(ranks.leader).toBeLessThan(ranks.rest);
  });

  it('breaks ties by overall place', () => {
    const a = labelRank(car(6, 'GT3', 9), you, null);
    const b = labelRank(car(7, 'GT3', 10), you, null);
    expect(a).toBeLessThan(b);
  });

  it('is a plain order with no player: leaders first', () => {
    expect(labelRank(car(1, 'GT3', 1), undefined, null)).toBeLessThan(
      labelRank(car(0, 'GT3', 2), undefined, null),
    );
  });
});
