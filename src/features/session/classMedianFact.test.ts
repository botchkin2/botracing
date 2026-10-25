import {describe, expect, it} from '@jest/globals';

import race from '@/src/analysis/__fixtures__/classPaceR.json';
import {classPaceDoc, type ResultsDriver} from '@/src/analysis/classPace';

import {classMedianFacts} from './classMedianFact';

const classPace = classPaceDoc(race.drivers as ResultsDriver[]);

describe('classMedianFacts', () => {
  it('a race says the class median and how he stands to it, from the results file', () => {
    const [f] = classMedianFacts({sessionType: 'R', classPace});
    expect(f.label).toBe('Class median');
    expect(f.value).toMatch(/^\d:\d\d\.\d{3}$/);
    expect(f.basis).toMatch(/^you [+−±]\d+\.\d{3} · 3 cars$/);
  });

  it('says nothing outside a race, or without classPace', () => {
    expect(classMedianFacts({sessionType: 'Q', classPace})).toEqual([]);
    expect(classMedianFacts({sessionType: 'P', classPace})).toEqual([]);
    expect(classMedianFacts({sessionType: 'R', classPace: null})).toEqual([]);
  });

  it('prints his gap with a sign: slower than the class is +, faster is −', () => {
    const slow = classPaceDoc(
      [100, 100, 100].map((t, i) => ({
        player: i === 0,
        cls: 'GT3',
        car: 'x',
        pos: i + 1,
        laps: [t, t, t, t].map(() => ({
          t: i === 0 ? 102 : 100,
          s1: null,
          s2: null,
          s3: null,
          pit: false,
        })),
      })),
    );
    expect(classMedianFacts({sessionType: 'R', classPace: slow})[0].basis).toBe(
      'you +2.000 · 2 cars',
    );
  });
});
