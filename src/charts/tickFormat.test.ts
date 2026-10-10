import {describe, expect, test} from '@jest/globals';

import {lapTimeTenths, signedSeconds, withUnit} from './tickFormat';

describe('signedSeconds', () => {
  test('shows the sign and the unit', () => {
    expect(signedSeconds(0.25, 2)).toBe('+0.25 s');
    expect(signedSeconds(-0.5, 2)).toBe('−0.50 s');
  });

  test('zero has no sign', () => {
    expect(signedSeconds(0, 1)).toBe('0.0 s');
  });

  test('uses the decimals it is given', () => {
    expect(signedSeconds(1.2345, 3)).toBe('+1.234 s');
  });
});

describe('lapTimeTenths', () => {
  test('under a minute: seconds with one decimal', () => {
    expect(lapTimeTenths(59.9)).toBe('59.9');
    expect(lapTimeTenths(12)).toBe('12.0');
  });

  test('from a minute: m:ss.s, seconds padded to two digits', () => {
    expect(lapTimeTenths(83.456)).toBe('1:23.5');
    expect(lapTimeTenths(125)).toBe('2:05.0');
  });

  test('rounds to tenths before splitting, so no 0:60', () => {
    expect(lapTimeTenths(59.96)).toBe('1:00.0');
  });

  test('a negative time carries the true minus sign', () => {
    expect(lapTimeTenths(-83.4)).toBe('−1:23.4');
    expect(lapTimeTenths(-4.2)).toBe('−4.2');
  });
});

describe('withUnit', () => {
  test('a value with its unit, at the given decimals', () => {
    expect(withUnit('km/h')(200, 0)).toBe('200 km/h');
    expect(withUnit('%')(12.5, 1)).toBe('12.5 %');
  });
});
