import {describe, expect, it} from '@jest/globals';

import {IRACING_NO_FIELD_WHY, raceGate, raceScreenField} from './raceGate';

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

describe('raceScreenField, the decision useRaceData draws with', () => {
  const note = 'Other cars: recording not drawn';

  it('a garbage field is not drawn, and the empty state says its note', () => {
    const screen = raceScreenField({
      field: {hash: 'abc', mark: {kind: 'garbage'}, note},
      fieldMissing: 'should not win',
    });
    expect(screen.hash).toBeNull();
    expect(screen.why).toBe(note);
    expect(raceGate({...base, hasField: screen.hash !== null})).toBe(
      'no-field',
    );
  });

  it('an unmarked field with a hash is drawn', () => {
    const screen = raceScreenField({
      field: {hash: 'abc', note: null},
      fieldMissing: null,
    });
    expect(screen.hash).toBe('abc');
    expect(raceGate({...base, hasField: screen.hash !== null})).toBe('ready');
  });
});

describe('an iRacing race with no field', () => {
  it('says why: the other cars come from the live recorder, which this race predates', () => {
    expect(raceScreenField({sim: 'iracing'})).toEqual({
      hash: null,
      why: IRACING_NO_FIELD_WHY,
    });
    expect(IRACING_NO_FIELD_WHY).toBe(
      'Other cars: not recorded. This race is from before the recorder.',
    );
  });
  it('keeps the analysis note when it has one, and says nothing for LMU or a session with a field', () => {
    expect(
      raceScreenField({sim: 'iracing', fieldMissing: 'the file had no cars'})
        .why,
    ).toBe('the file had no cars');
    expect(raceScreenField({sim: 'lmu'}).why).toBeNull();
    expect(raceScreenField({sim: 'iracing', field: {hash: 'h1'}}).hash).toBe(
      'h1',
    );
  });
});
