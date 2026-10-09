import {describe, expect, it} from '@jest/globals';

import {type NearbyCar} from '@/src/analysis/nearbyCars';

import {nearbyRow} from './nearbyRows';

const car = (over: Partial<NearbyCar>): NearbyCar => ({
  index: 1,
  slot: 'class3',
  short: 'GT3',
  classLabel: 'GT3',
  vehicle: 'Ferrari 296 GT3',
  metres: 123.4,
  intervalS: 1.23,
  lapsUp: 0,
  pit: false,
  ...over,
});

describe('nearbyRow', () => {
  it('says the gap in seconds and metres with a true minus, and a lap up or down', () => {
    expect(nearbyRow(car({}))).toMatchObject({
      gapText: '+1.2 s',
      metresText: '+123 m',
      lapsText: '',
      label: 'Ferrari 296 GT3',
    });
    expect(
      nearbyRow(car({metres: -45.2, intervalS: -0.84, lapsUp: -1})),
    ).toMatchObject({gapText: '−0.8 s', metresText: '−45 m', lapsText: '−1L'});
    expect(nearbyRow(car({lapsUp: 1})).lapsText).toBe('+1L');
  });

  it('leaves the time out when none is known, and names a car with no model by its class', () => {
    expect(nearbyRow(car({intervalS: null})).gapText).toBe('');
    expect(nearbyRow(car({vehicle: null})).label).toBe('GT3');
  });
});
