import {describe, expect, it} from '@jest/globals';

import {type TowerCar, towerRows} from './towerRows';

const TRACK = 4000;
const car = (index: number, place: number, lapDistM: number, over: Partial<TowerCar> = {}): TowerCar => ({
  index,
  classPlace: place,
  classKey: 'gt3',
  classTag: 'GT3',
  color: '#fff',
  model: `M${index}`,
  lapDistM,
  intervalS: place === 1 ? null : 2,
  inGarage: false,
  ...over,
});
// ten cars, 100 m apart on the road, place n at 1000 - 100 n
const field = Array.from({length: 10}, (_, i) => car(i, i + 1, 1000 - i * 100));

describe('towerRows', () => {
  it('is empty without a followed car on the road', () => {
    expect(towerRows(field, null, 'order', 5, TRACK)).toEqual([]);
    expect(towerRows(field, 99, 'order', 5, TRACK)).toEqual([]);
    expect(towerRows([car(1, 0, 10, {inGarage: true})], 1, 'order', 5, TRACK)).toEqual([]);
  });
  it('centres the followed car in the running order, with the class gap to it', () => {
    const rows = towerRows(field, 4, 'order', 5, TRACK);
    expect(rows.map(r => r.index)).toEqual([2, 3, 4, 5, 6]);
    expect(rows.map(r => r.gap)).toEqual(['−4.0', '−2.0', '', '+2.0', '+4.0']);
    expect(rows.find(r => r.followed)?.index).toBe(4);
  });
  it('reads the intervals the HUD reads: the car ahead and the car behind', () => {
    const rows = towerRows(field.map(c => ({...c, intervalS: 1.5 + c.index * 0.1})), 4, 'order', 3, TRACK);
    // me = index 4; the car ahead is 1.5 + 0.4 = 1.9 up, the car behind is 1.5 + 0.5 = 2.0 back
    expect(rows.map(r => r.gap)).toEqual(['−1.9', '', '+2.0']);
  });
  it('prints a dash when an interval on the way is unknown (the grid)', () => {
    const grid = field.map(c => ({...c, intervalS: null}));
    expect(towerRows(grid, 4, 'order', 3, TRACK).map(r => r.gap)).toEqual(['–', '', '–']);
  });
  it('keeps the full count at the front and the back of the field', () => {
    expect(towerRows(field, 0, 'order', 5, TRACK).map(r => r.index)).toEqual([0, 1, 2, 3, 4]);
    expect(towerRows(field, 9, 'order', 5, TRACK).map(r => r.index)).toEqual([5, 6, 7, 8, 9]);
  });
  it('keeps Order to the class of the followed car, so its neighbours are its class places', () => {
    const mixed = field.map(c => (c.index === 3 ? {...c, classKey: 'hy', classTag: 'HY', classPlace: 1} : c));
    const rows = towerRows(mixed, 4, 'order', 3, TRACK);
    expect(rows.map(r => r.index)).toEqual([2, 4, 5]);
    expect(rows.map(r => r.classPlace)).toEqual([3, 5, 6]);
    expect(rows.every(r => r.classTag === 'GT3')).toBe(true);
  });
  it('labels a Near row from another class with its own tag and class place', () => {
    const mixed = field.map(c => (c.index === 3 ? {...c, classKey: 'hy', classTag: 'HY', classPlace: 1} : c));
    const rows = towerRows(mixed, 4, 'near', 3, TRACK);
    expect(rows.map(r => [r.index, r.classTag, r.classPlace, r.gap])).toEqual([[3, 'HY', 1, '+100 m'], [4, 'GT3', 5, ''], [5, 'GT3', 6, '−100 m']]);
  });
  it('orders by road distance in Near, ahead on top, in metres', () => {
    const shuffled = [field[5], field[0], field[3], field[4], field[9]];
    const rows = towerRows(shuffled, 4, 'near', 5, TRACK);
    expect(rows.map(r => r.index)).toEqual([0, 3, 4, 5, 9]);
    expect(rows.map(r => r.gap)).toEqual(['+400 m', '+100 m', '', '−100 m', '−500 m']);
  });
  it('reads a car just across the line as near', () => {
    const rows = towerRows([car(1, 1, 3950), car(2, 2, 30)], 2, 'near', 2, TRACK);
    expect(rows.map(r => [r.index, r.gap])).toEqual([[2, ''], [1, '−80 m']]);
  });
});
