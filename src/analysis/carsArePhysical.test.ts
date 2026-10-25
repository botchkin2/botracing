import {describe, expect, it} from '@jest/globals';

import {carsArePhysical} from './carsArePhysical';

describe('carsArePhysical', () => {
  it('a race and a practice have the other cars on track', () => {
    for (const sim of ['lmu', 'iracing'])
      for (const sessionType of ['Race', 'R', 'Practice', 'P'])
        expect(carsArePhysical({sim, sessionType})).toBe(true);
  });

  it('a qualifying does not, as the doc and the app spell it', () => {
    for (const sim of ['lmu', 'iracing'])
      for (const sessionType of ['Qualify', 'Q', 'qualifying'])
        expect(carsArePhysical({sim, sessionType})).toBe(false);
  });
});
