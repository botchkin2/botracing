import {describe, expect, test} from '@jest/globals';

import {basisLaps, replace, toggle} from './lapSelection';

describe('toggle', () => {
  test('a tap adds an unticked lap at the end', () => {
    expect(toggle(['a', 'b'], 'c')).toEqual(['a', 'b', 'c']);
  });

  test('a tap removes a ticked lap, wherever it is', () => {
    expect(toggle(['a', 'b', 'c'], 'a')).toEqual(['b', 'c']);
    expect(toggle(['a', 'b', 'c'], 'c')).toEqual(['a', 'b']);
  });

  test('two taps on the same lap leave the selection as it was', () => {
    expect(toggle(toggle(['a'], 'b'), 'b')).toEqual(['a']);
  });

  test('no lap is privileged: the first ticked lap is removed like any other', () => {
    expect(toggle(['a', 'b'], 'a')).toEqual(['b']);
  });

  test('there is no cap: a tap always adds', () => {
    const many = Array.from({length: 40}, (_, i) => `l${i}`);
    expect(toggle(many, 'extra')).toHaveLength(41);
  });

  test('does not mutate its input', () => {
    const laps = ['a'];
    toggle(laps, 'b');
    expect(laps).toEqual(['a']);
  });
});

describe('replace', () => {
  test('the selection becomes the stint, in the drag order', () => {
    expect(replace(['c', 'a', 'b'])).toEqual(['c', 'a', 'b']);
  });

  test('a lap that the drag crosses twice is kept once, at its first place', () => {
    expect(replace(['a', 'b', 'a', 'c'])).toEqual(['a', 'b', 'c']);
  });

  test('an empty stint clears the selection', () => {
    expect(replace([])).toEqual([]);
  });

  test('it returns a new array', () => {
    const stint = ['a'];
    expect(replace(stint)).not.toBe(stint);
  });
});

describe('basisLaps', () => {
  test('the ticked laps are the basis when any are ticked', () => {
    expect(basisLaps(['b', 'c'], ['a', 'b', 'c', 'd'])).toEqual(['b', 'c']);
  });

  test('with nothing ticked, every comparable lap is the basis', () => {
    expect(basisLaps([], ['a', 'b', 'c'])).toEqual(['a', 'b', 'c']);
  });

  test('with nothing ticked and no comparable lap, the basis is empty', () => {
    expect(basisLaps([], [])).toEqual([]);
  });

  test('it returns a copy, not the input', () => {
    const ticked = ['a'];
    expect(basisLaps(ticked, [])).not.toBe(ticked);
  });
});
