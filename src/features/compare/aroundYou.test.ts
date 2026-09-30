import {describe, expect, it} from '@jest/globals';

import {type Field} from '@/src/analysis/field';
import {type Radar, type RadarCar} from '@/src/analysis/radar';

import {aroundYouRows} from './aroundYou';

const rc = (
  index: number,
  forwardM: number,
  sideM: number,
  over = {},
): RadarCar => ({
  index,
  cls: 'gt3',
  forwardM,
  sideM,
  relYawRad: 0,
  alongside: null,
  lengthM: 4.6,
  widthM: 2,
  opacity: 1,
  ...over,
});

const field = {
  cars: [
    {vehicle: null, carClass: 'GT3'},
    {vehicle: 'Ferrari 296 GT3', carClass: 'GT3'},
    {vehicle: null, carClass: 'Hyper'},
    {vehicle: null, carClass: 'GT3'},
  ],
} as unknown as Field;

describe('aroundYouRows', () => {
  const radar: Radar = {
    cars: [
      rc(2, -8.4, 0.2),
      rc(1, 12.2, -2.4),
      rc(3, 0.5, 3, {alongside: 'right'}),
    ],
    leftLit: false,
    rightLit: true,
  };
  const rows = aroundYouRows(radar, field);

  it('lists the nearest car first', () => {
    expect(rows.map(r => r.index)).toEqual([3, 2, 1]);
  });

  it('says ahead and behind with a true minus, and the side in words', () => {
    expect(rows[1].forwardText).toBe('−8 m');
    expect(rows[1].sideText).toBe('in line');
    expect(rows[2].forwardText).toBe('+12 m');
    expect(rows[2].sideText).toBe('left 2.4 m');
    expect(rows[0].sideText).toBe('right 3.0 m');
  });

  it('carries the alongside flag, and the model or else the class as its name', () => {
    expect(rows[0].alongside).toBe('right');
    expect(rows[2].label).toBe('Ferrari 296 GT3');
    expect(rows[1].label).toBe('Hyper');
  });

  it('is empty with no cars', () => {
    expect(
      aroundYouRows({cars: [], leftLit: false, rightLit: false}, field),
    ).toEqual([]);
  });
});
