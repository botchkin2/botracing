import {describe, expect, test} from '@jest/globals';

import {median, stripBars} from './lapStrip';

const lap = (
  id: string,
  timeS: number | null,
  stint = 1,
  comparable = true,
) => ({
  id,
  timeS,
  stint,
  comparable,
});

describe('median', () => {
  test('the middle value, or the mean of the two middle values', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });

  test('an empty set has no median', () => {
    expect(median([])).toBeNull();
  });
});

describe('stripBars', () => {
  const laps = [lap('a', 80), lap('b', 81), lap('c', 83), lap('d', null)];

  test('with nothing ticked, each bar is its lap against every comparable lap', () => {
    const {bars, basisS} = stripBars(laps, []);
    expect(basisS).toBe(81);
    expect(bars.map(b => b.deltaS)).toEqual([-1, 0, 2, null]);
  });

  test('with laps ticked, the deltas are against their median only', () => {
    const {bars, basisS} = stripBars(laps, ['a', 'c']);
    expect(basisS).toBe(81.5);
    expect(bars.map(b => b.deltaS)).toEqual([-1.5, -0.5, 1.5, null]);
  });

  test('a lap that is ticked but not comparable still counts in the basis', () => {
    const odd = [lap('a', 80), lap('b', 90, 1, false)];
    expect(stripBars(odd, ['a', 'b']).basisS).toBe(85);
  });

  test('the ticked flag and the stint come through', () => {
    const {bars} = stripBars([lap('a', 80, 2)], ['a']);
    expect(bars[0]).toMatchObject({ticked: true, stint: 2});
  });

  test('no basis at all gives no deltas, never NaN', () => {
    const {bars, basisS} = stripBars([lap('a', null)], []);
    expect(basisS).toBeNull();
    expect(bars[0].deltaS).toBeNull();
  });
});
