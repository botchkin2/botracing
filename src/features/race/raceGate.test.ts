import {describe, expect, it} from '@jest/globals';

import {raceGate} from './raceGate';

const base = {
  sessionPending: false,
  hasDetail: true,
  hasField: true,
  fieldError: false,
  hasBestLap: true,
  line: 'drawn' as const,
  readyInputs: true,
};

describe('raceGate', () => {
  it('is ready with everything in', () => {
    expect(raceGate(base)).toBe('ready');
  });

  it('a race with no timed lap ends, it never waits (pitboard #4507: one parked lap, positions and all)', () => {
    expect(raceGate({...base, hasBestLap: false, line: 'pending'})).toBe(
      'no-lap',
    );
  });

  it('a best lap whose line cannot be drawn ends too (radio #4511)', () => {
    // A trace with no GPS, or no lap length to grid it on: nothing can help.
    expect(raceGate({...base, line: 'missing'})).toBe('no-line');
    // A failed request: a retry can.
    expect(raceGate({...base, line: 'failed'})).toBe('line-error');
  });

  it('waits only while something can still arrive', () => {
    expect(raceGate({...base, line: 'pending'})).toBe('field-loading');
    expect(raceGate({...base, readyInputs: false})).toBe('field-loading');
    expect(raceGate({...base, sessionPending: true})).toBe('loading');
  });

  it('names what is missing, field first', () => {
    expect(raceGate({...base, hasField: false})).toBe('no-field');
    expect(raceGate({...base, fieldError: true})).toBe('field-error');
    expect(raceGate({...base, hasDetail: false})).toBe('error');
  });
});
