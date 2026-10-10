import {describe, expect, it} from '@jest/globals';

import {
  sectionHeaderOf,
  turnBadgeOf,
  turnOfPart,
  turnTitleOf,
} from './turnNames';

// Road Atlanta: corner 7 "T7 entry", corner 8 "T7" are one turn split in two.
describe('turn names', () => {
  it('a section split into entry and apex reads one turn', () => {
    expect(sectionHeaderOf(['T7 entry', 'T7'])).toBe('T7');
  });
  it('a real range keeps its ends and drops phase words inside it', () => {
    expect(sectionHeaderOf(['T2', 'T3', 'T4 exit', 'T5'])).toBe('T2–5');
  });
  it('a single corner is its name', () => {
    expect(sectionHeaderOf(['T10a'])).toBe('T10a');
  });
  it('the turn of a part drops its phase word', () => {
    expect(turnOfPart('T7 entry')).toBe('T7');
    expect(turnOfPart('T10a')).toBe('T10a');
  });
  it('the map badge shows the number on the bare part only', () => {
    expect(turnBadgeOf('T7')).toBe('7');
    expect(turnBadgeOf('T7 entry')).toBe('');
    expect(turnBadgeOf('T10a')).toBe('10a');
  });
  it('a Corner title keeps the phase word', () => {
    expect(turnTitleOf('T7')).toBe('Turn 7');
    expect(turnTitleOf('T7 entry')).toBe('Turn 7 entry');
  });
});
