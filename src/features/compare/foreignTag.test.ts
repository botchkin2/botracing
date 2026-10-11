import {describe, expect, it} from '@jest/globals';

import {foreignTag} from './foreignTag';

describe('foreignTag', () => {
  it('names the day and the kind of session', () => {
    expect(foreignTag('2026-09-25T12:00:00Z', 'R')).toBe('Sep 25 Race');
    expect(foreignTag('2026-09-25T12:00:00Z', 'P')).toBe('Sep 25 Practice');
    expect(foreignTag('2026-09-25T12:00:00Z', 'Q')).toBe('Sep 25 Qualifying');
  });

  it('tells a practice from a race on the same day', () => {
    expect(foreignTag('2026-09-25T10:00:00Z', 'P')).not.toBe(
      foreignTag('2026-09-25T14:00:00Z', 'R'),
    );
  });

  it('keeps the kind when the date does not parse', () => {
    expect(foreignTag('', 'R')).toBe('Race');
  });
});
