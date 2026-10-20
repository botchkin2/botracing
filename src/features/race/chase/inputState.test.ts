import {describe, expect, it} from '@jest/globals';

import {inputState, throttleState} from './inputState';

describe('inputState', () => {
  it('names the four states at their cut-offs', () => {
    expect(inputState(5, 100)).toBe('brake');
    expect(inputState(4, 100)).toBe('full');
    expect(inputState(0, 96)).toBe('part');
    expect(inputState(0, 97)).toBe('full');
    expect(inputState(0, 8)).toBe('coast');
    expect(inputState(0, 9)).toBe('part');
  });
  it('reads throttle alone for the pedal bar', () => {
    expect(throttleState(100)).toBe('full');
    expect(throttleState(50)).toBe('part');
    expect(throttleState(0)).toBe('coast');
  });
});
