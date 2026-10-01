import {describe, expect, it} from '@jest/globals';

import {type CarState, type RaceCar} from '@/src/analysis/raceState';

import {
  buildRaceModel,
  classKey,
  defaultFilter,
  displayModel,
  labelRank,
  roadGapS,
  roadOffsetM,
  roadSummary,
  roadSummaryText,
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
      ['Hyper', 'LMP2', 'GT3', 'LMGT3', 'GTE', 'LMH', '', 'Odd'].map(classKey),
    ).toEqual([
      'hypercar',
      'lmp2',
      'gt3',
      'gt3',
      'gt3',
      'hypercar',
      'other',
      'other',
    ]);
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

  it('a class filter shows that class alone under a Class header, garage last', () => {
    const m = buildRaceModel({cars: field, filter: 'gt3', focus: null});
    expect(m.groups).toHaveLength(1);
    expect(m.groups[0].title).toBe('Class · GT3');
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
    const codes = ['IN', 'STOP', 'OFF'];
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

describe('field mode (practice and qualifying)', () => {
  const TRACK = 4000;
  // You at 1000 m on a 4000 m track: a GT3 120 m ahead, one 85 m behind, a
  // hypercar 180 m behind, an LMP2 950 m ahead across the line (3950 m).
  const onRoad = (
    index: number,
    carClass: string,
    lapDistM: number,
    extra: Partial<RaceCar> = {},
  ) => car(index, carClass, index + 1, {lapDistM, ...extra});
  const cars = [
    onRoad(0, 'GT3', 1000, {player: true}),
    onRoad(1, 'GT3', 1120),
    onRoad(2, 'GT3', 915),
    onRoad(3, 'Hyper', 820),
    onRoad(4, 'LMP2', 3950),
    onRoad(5, 'GT3', 1050, {state: 'pit'}),
    onRoad(6, 'GT3', NaN, {state: 'garage'}),
  ];

  it('measures the road offset, wrapping at the line', () => {
    const you = {lapDistM: 3900};
    expect(roadOffsetM({lapDistM: 100}, you, TRACK)).toBe(200);
    expect(roadOffsetM({lapDistM: 3700}, you, TRACK)).toBe(-200);
    expect(roadOffsetM({lapDistM: NaN}, you, TRACK)).toBeNull();
    expect(roadOffsetM({lapDistM: 10}, you, 0)).toBeNull();
  });

  it('finds the cars ahead and behind and the faster class coming', () => {
    // Every car at 200 km/h, 55.6 m/s.
    const s = roadSummary(cars, TRACK)!;
    expect(s.ahead).toMatchObject({key: 'gt3', metres: 120});
    expect(s.ahead!.seconds).toBeCloseTo(120 / (200 / 3.6), 6);
    expect(s.behind).toMatchObject({key: 'gt3', metres: 85});
    expect(s.coming).toMatchObject({key: 'hypercar', metres: 180});
    expect(s.coming!.seconds).toBeCloseTo(180 / (200 / 3.6), 6);
  });

  it('times a car ahead at your speed and a car behind at its own', () => {
    expect(roadGapS({speedKmh: 100}, {speedKmh: 200}, 100)).toBeCloseTo(1.8, 6);
    expect(roadGapS({speedKmh: 100}, {speedKmh: 200}, -100)).toBeCloseTo(
      3.6,
      6,
    );
    // The car that sets the time is standing still: no time.
    expect(roadGapS({speedKmh: 0}, {speedKmh: 200}, -100)).toBeNull();
    expect(roadGapS({speedKmh: 200}, {speedKmh: 2}, 100)).toBeNull();
  });

  it('lists a faster class as coming only within 5 s', () => {
    const far = [
      onRoad(0, 'GT3', 2000, {player: true}),
      onRoad(1, 'Hyper', 2000 - 300), // 5.4 s at 200 km/h
    ];
    expect(roadSummary(far, TRACK)!.coming).toBeNull();
    expect(roadSummary(far, TRACK)!.behind).toMatchObject({metres: 300});
  });

  it('counts neither the pit lane nor the garage, nor a slower class as coming', () => {
    // The car in the pit lane at +50 m is skipped.
    expect(roadSummary(cars, TRACK)!.ahead!.metres).toBe(120);
    const slower = roadSummary(
      [onRoad(0, 'LMP2', 1000, {player: true}), onRoad(1, 'GT3', 900)],
      TRACK,
    )!;
    expect(slower.coming).toBeNull();
    expect(roadSummary([onRoad(1, 'GT3', 900)], TRACK)).toBeNull();
  });

  it('says it in one line', () => {
    expect(roadSummaryText(roadSummary(cars, TRACK)!)).toBe(
      'Ahead 2.2 s (120 m) GT3 · Behind 1.5 s (85 m) GT3 · Faster class: Hypercar 3.2 s (180 m) behind',
    );
  });

  it('says the nearest car behind once when it is the faster class', () => {
    const near = [
      onRoad(0, 'GT3', 1000, {player: true}),
      onRoad(1, 'GT3', 1120),
      onRoad(2, 'Hyper', 900),
    ];
    const line = roadSummaryText(roadSummary(near, TRACK)!);
    expect(line).toContain('Behind 1.8 s (100 m) Hypercar (faster class)');
    expect(line).not.toContain('Faster class:');
  });

  it('has no place, no class position on a dot, and the road gap in seconds in place of the gap', () => {
    const m = buildRaceModel({
      cars,
      filter: 'all',
      focus: null,
      mode: 'field',
      trackM: TRACK,
    });
    const rows = m.groups.flatMap(g => g.rows);
    expect(rows.every(r => r.position === '')).toBe(true);
    expect(rows.find(r => r.player)!.gap).toBe('');
    expect(rows.find(r => r.index === 1)!.gap).toBe('+2.2 s');
    expect(rows.find(r => r.index === 2)!.gap).toBe('−1.5 s');
    expect(rows.find(r => r.index === 6)!.gap).toBe('—');
    expect(m.dots.every(d => d.label === '')).toBe(true);
    expect(m.road).not.toBeNull();
  });

  it('orders a class from furthest ahead to furthest behind, you among them', () => {
    const m = buildRaceModel({
      cars,
      filter: 'gt3',
      focus: null,
      mode: 'field',
      trackM: TRACK,
    });
    expect(m.groups[0].rows.map(r => r.index)).toEqual([1, 5, 0, 2, 6]);
  });

  it('labels the focus without a class place', () => {
    const m = buildRaceModel({
      cars,
      filter: 'all',
      focus: 1,
      mode: 'field',
      trackM: TRACK,
    });
    expect(m.focusLabel).toBe('Car 1 · GT3 · +2.2 s');
  });

  it('is the race model unchanged by default', () => {
    const m = buildRaceModel({cars, filter: 'all', focus: null});
    expect(m.road).toBeNull();
    expect(m.groups.flatMap(g => g.rows).some(r => r.position !== '')).toBe(
      true,
    );
  });
});
