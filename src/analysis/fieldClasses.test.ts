import {describe, expect, it} from '@jest/globals';

import {classOfCar, cleanLapsS, fieldClasses} from './fieldClasses';

/** A car that completes a lap every `lapS` seconds over `updates` 1 s updates; `pitsAt` puts it in the pits then. */
function car(
  over: {carClass?: string; classId?: number; classLabel?: string},
  lapS: number,
  updates = 60,
  pitsAt: number[] = [],
) {
  const lapsDone = new Int16Array(updates);
  const inPits = new Int8Array(updates);
  for (let u = 0; u < updates; u++) {
    lapsDone[u] = Math.floor(u / lapS);
    inPits[u] = pitsAt.includes(u) ? 1 : 0;
  }
  return {
    carClass: over.carClass ?? '',
    classId: over.classId ?? null,
    classLabel: over.classLabel ?? null,
    lapsDone,
    inPits,
  };
}
const timeS = Float64Array.from({length: 60}, (_, u) => u);

describe('cleanLapsS', () => {
  it('times each lap between two steps of the counter, a pit-lane lap left out', () => {
    expect(cleanLapsS(car({}, 10), timeS)).toEqual([10, 10, 10, 10, 10]);
    // In the pits at 25 s: the lap from 20 to 30 is left out.
    expect(cleanLapsS(car({}, 10, 60, [25]), timeS)).toEqual([10, 10, 10, 10]);
  });
});

describe('classOfCar', () => {
  it('is iRacing’s class id with its label, else LMU’s name, else other', () => {
    expect(
      classOfCar({carClass: '', classId: 4029, classLabel: 'GTP'}),
    ).toEqual({
      key: 'ir:4029',
      label: 'GTP',
      short: 'GTP',
    });
    expect(
      classOfCar({carClass: 'Hyper', classId: null, classLabel: null}).key,
    ).toBe('hypercar');
    // GTE runs with GT3.
    expect(
      classOfCar({carClass: 'GTE', classId: null, classLabel: null}).key,
    ).toBe('gt3');
    expect(
      classOfCar({carClass: '', classId: null, classLabel: null}).key,
    ).toBe('other');
    expect(
      classOfCar({carClass: '', classId: 9, classLabel: 'Mazda MX-5 Cup +2'})
        .short,
    ).toBe('Mazd…');
  });
});

describe('fieldClasses', () => {
  it('gives the known classes their fixed colours (the LMU Daytona order)', () => {
    const t = fieldClasses({
      timeS,
      cars: [
        car({carClass: 'GT3'}, 12),
        car({carClass: 'LMP2'}, 11),
        car({carClass: 'Hyper'}, 10),
      ],
    });
    expect(t.list.map(c => [c.label, c.slot])).toEqual([
      ['Hypercar', 'class1'],
      ['LMP2', 'class2'],
      ['GT3', 'class3'],
    ]);
    expect(t.of('lmp2').title).toBe('LMP2');
  });

  it('keeps a known class colour in every race and both sims', () => {
    // A GT3-only iRacing server: GT3 is still class3.
    const gt3Only = fieldClasses({
      timeS,
      cars: [
        car({classId: 4011, classLabel: 'GT3'}, 12),
        car({classId: 4011, classLabel: 'GT3'}, 13),
      ],
    });
    expect(gt3Only.list.map(c => [c.key, c.slot, c.paceS])).toEqual([
      ['ir:4011', 'class3', 12.5],
    ]);
    // A two-class LMU race: GT3 stays class3, Hypercar class1.
    const twoClass = fieldClasses({
      timeS,
      cars: [car({carClass: 'GT3'}, 12), car({carClass: 'Hyper'}, 10)],
    });
    expect(twoClass.list.map(c => [c.label, c.slot])).toEqual([
      ['Hypercar', 'class1'],
      ['GT3', 'class3'],
    ]);
    // A known class with too few laps keeps its colour too.
    const fewLaps = fieldClasses({
      timeS,
      cars: [car({classId: 4029, classLabel: 'GTP'}, 25)],
    });
    expect(fewLaps.list[0]).toMatchObject({slot: 'class1', ordered: true});
  });

  it('gives another class a colour the known ones leave free, in pace order', () => {
    const t = fieldClasses({
      timeS,
      cars: [
        car({classId: 4029, classLabel: 'GTP'}, 10),
        car({classId: 2268, classLabel: 'GT4'}, 14),
        car({classId: 4011, classLabel: 'GT3'}, 12),
      ],
    });
    expect(t.list.map(c => [c.label, c.slot])).toEqual([
      ['GTP', 'class1'],
      ['GT3', 'class3'],
      ['GT4', 'class2'],
    ]);
  });

  it('puts a class with too few clean laps after the ranked ones, by its best lap', () => {
    const t = fieldClasses({
      timeS,
      cars: [
        car({classId: 9, classLabel: 'Cup'}, 12),
        // A single fast car that pitted: 2 clean laps, not enough to rank.
        car({classId: 4018, classLabel: 'LMP3'}, 25),
        car({classId: 2268, classLabel: 'GT4'}, 11),
      ],
    });
    expect(t.list.map(c => [c.label, c.slot, c.paceS, c.ordered])).toEqual([
      ['GT4', 'class1', 11, true],
      ['Cup', 'class2', 12, true],
      ['LMP3', 'class3', null, false],
    ]);
  });

  it('keeps cars with no class last and grey, and a fourth class grey', () => {
    const t = fieldClasses({
      timeS,
      cars: [
        car({}, 9),
        car({classId: 1, classLabel: 'A'}, 10),
        car({classId: 2, classLabel: 'B'}, 11),
        car({classId: 3, classLabel: 'C'}, 12),
        car({classId: 4, classLabel: 'D'}, 13),
      ],
    });
    expect(t.list.map(c => [c.label, c.slot])).toEqual([
      ['A', 'class1'],
      ['B', 'class2'],
      ['C', 'class3'],
      ['D', 'other'],
      ['Other', 'other'],
    ]);
    expect(t.of('ir:999')).toMatchObject({
      key: 'other',
      slot: 'other',
      title: 'OTHER',
    });
  });
});
