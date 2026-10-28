import {describe, expect, it} from '@jest/globals';

import race from './__fixtures__/classPaceR.json';
import {classPaceDoc, type ResultsDriver} from './classPace';
import {otherCarsState} from './otherCars';

const drivers = race.drivers as ResultsDriver[];
const NOT_RECORDED = 'Other cars: not recorded';

describe('otherCarsState', () => {
  it('a stored field is the field state, whatever else is known', () => {
    expect(
      otherCarsState({
        field: {hash: 'h'},
        fieldMissing: null,
        classPace: classPaceDoc(drivers),
      }),
    ).toEqual({kind: 'field'});
  });

  it("no field but the results file's drivers: positions missing, drivers known (the Class pace block lists them)", () => {
    expect(
      otherCarsState({
        field: null,
        fieldMissing: NOT_RECORDED,
        classPace: classPaceDoc(drivers),
      }),
    ).toEqual({kind: 'drivers'});
  });

  it('no field and no other driver (none, or only his own laps): nothing recorded, with the stored reason', () => {
    const onlyMe = classPaceDoc(drivers.filter(d => d.player));
    for (const classPace of [null, onlyMe])
      expect(
        otherCarsState({field: null, fieldMissing: NOT_RECORDED, classPace}),
      ).toEqual({kind: 'none', why: NOT_RECORDED});
    expect(
      otherCarsState({field: null, fieldMissing: null, classPace: null}),
    ).toEqual({kind: 'none', why: null});
  });
});
