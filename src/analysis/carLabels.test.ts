import {describe, expect, it} from '@jest/globals';

import {type LabelCar, placeCarLabels} from './carLabels';

const car = (key: string, x: number, y: number, rank: number): LabelCar => ({
  key,
  x,
  y,
  radius: 3,
  width: 14,
  height: 12,
  rank,
});
const BOUNDS = {width: 200, height: 100};

describe('placeCarLabels', () => {
  it('puts a lone car label to its right, clear of the dot', () => {
    const p = placeCarLabels([car('a', 50, 50, 0)], [], BOUNDS).get('a')!;
    expect(p.x).toBeGreaterThanOrEqual(50 + 3);
    expect(p.y).toBeCloseTo(50 - 6);
  });

  it('keeps the better-ranked label where two want the same spot', () => {
    // b is at a's right edge: b's dot and a's first choice collide.
    const p = placeCarLabels(
      [car('a', 50, 50, 5), car('b', 62, 50, 1)],
      [],
      BOUNDS,
    );
    expect(p.get('b')!.x).toBeGreaterThan(62);
    // a moves to another side rather than covering b's dot or label.
    expect(p.get('a')).toBeDefined();
    expect(p.get('a')!.x).not.toBeCloseTo(p.get('b')!.x);
  });

  it('drops a label that has no free place, in rank order', () => {
    // Ten cars on one spot: the eight places around a dot are all there is.
    const cars = Array.from({length: 10}, (_, i) => car(`c${i}`, 100, 50, i));
    const p = placeCarLabels(cars, [], BOUNDS);
    expect(p.has('c0')).toBe(true);
    expect(p.has('c9')).toBe(false);
    expect(p.size).toBeLessThanOrEqual(8);
  });

  it('stays off the overlay boxes and inside the map', () => {
    // The right side runs into the overlay: the label goes to the left.
    const p = placeCarLabels(
      [car('a', 140, 10, 0)],
      [{x: 150, y: 0, width: 50, height: 30}],
      BOUNDS,
    );
    const {x, y} = p.get('a')!;
    expect(x + 14).toBeLessThanOrEqual(150);
    expect(y).toBeGreaterThanOrEqual(0);
    // No room anywhere: no label.
    const tight = placeCarLabels(
      [car('b', 20, 10, 0)],
      [{x: 0, y: 0, width: 200, height: 100}],
      BOUNDS,
    );
    expect(tight.size).toBe(0);
  });

  it('is empty with no cars', () => {
    expect(placeCarLabels([], [], BOUNDS).size).toBe(0);
  });
});
