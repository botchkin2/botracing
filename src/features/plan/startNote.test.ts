import {describe, expect, it} from '@jest/globals';

import {startNote} from './startNote';

const full = {fuelL: 73, vePct: 100};
const none = {vePct: null, fuelL: null};

describe('startNote', () => {
  it('names the default when nothing is typed: never a silent full load', () => {
    expect(startNote(none, full, true)).toBe('Start 100 % (not set)');
    expect(startNote(none, full, false)).toBe('Start 73 L (not set)');
    expect(startNote(none, {fuelL: null, vePct: 100}, false)).toBe(
      'Start full load (not set)',
    );
  });

  it('reads what he typed, without the not-set mark', () => {
    expect(startNote({vePct: 87, fuelL: null}, full, true)).toBe('Start 87 %');
    expect(startNote({vePct: 87.5, fuelL: null}, full, true)).toBe(
      'Start 87.5 %',
    );
    expect(startNote({vePct: null, fuelL: 62}, full, false)).toBe('Start 62 L');
  });

  it('a VE car reads its VE first, then the litres', () => {
    expect(startNote({vePct: 87, fuelL: 60.25}, full, true)).toBe(
      'Start 87 % · 60.3 L',
    );
  });

  it('a car without VE ignores a stale VE entry', () => {
    expect(startNote({vePct: 87, fuelL: null}, full, false)).toBe(
      'Start 73 L (not set)',
    );
  });

  it('litres typed on a VE car still read as set', () => {
    expect(startNote({vePct: null, fuelL: 60}, full, true)).toBe('Start 60 L');
  });
});
