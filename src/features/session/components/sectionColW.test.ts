import {describe, expect, it} from '@jest/globals';

import {headWidth, sectionColW} from './LapTableRow';

describe('section column width', () => {
  it('is at least its head: T10A–T12 is 49 px, not the 38 px it was', () => {
    expect(headWidth(['S/F', 'T1', 'T10A–T12'])).toBeGreaterThanOrEqual(49);
    expect(sectionColW(1440, ['S/F', 'T1', 'T10A–T12'])).toBeGreaterThanOrEqual(
      49,
    );
  });

  it('grows with a longer section name, whatever the track', () => {
    const short = sectionColW(1440, ['S1', 'S2']);
    const long = sectionColW(1440, ['Chicane-Esses-Bus-Stop-Section']);
    expect(long).toBeGreaterThan(short);
  });

  it('shares the room for short heads, up to the old 60 px cap', () => {
    expect(sectionColW(1440, ['T1', 'T2'])).toBeLessThanOrEqual(60);
  });
});
