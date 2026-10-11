import {describe, expect, it} from '@jest/globals';

import {raceGate} from './raceGate';

const base = {
  sessionPending: false,
  hasDetail: true,
  hasField: true,
  fieldError: false,
  hasPositions: true,
  hasBestLap: true,
  readyInputs: true,
};

describe('raceGate', () => {
  it('is ready with everything in', () => {
    expect(raceGate(base)).toBe('ready');
  });

  it('a race with no timed lap ends, it never waits (pitboard #4507: one parked lap, positions and all)', () => {
    expect(raceGate({...base, hasBestLap: false, readyInputs: false})).toBe(
      'no-lap',
    );
    expect(
      raceGate({
        ...base,
        hasBestLap: false,
        hasPositions: false,
        readyInputs: false,
      }),
    ).toBe('no-lap');
  });

  it('waits only while something can still arrive', () => {
    expect(raceGate({...base, readyInputs: false})).toBe('field-loading');
    expect(raceGate({...base, sessionPending: true})).toBe('loading');
  });

  it('names what is missing', () => {
    expect(raceGate({...base, hasField: false})).toBe('no-field');
    expect(raceGate({...base, fieldError: true})).toBe('field-error');
    expect(raceGate({...base, hasDetail: false})).toBe('error');
  });
});
