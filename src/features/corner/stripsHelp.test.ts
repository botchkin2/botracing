import {describe, expect, it} from '@jest/globals';

import {LAP_BARS_HELP} from '../session/lapBarsHelp';
import {PIT_REVIEW_HELP} from '../session/pitReview';
import {RACE_HELP} from '../race/raceHelp';
import {STRIPS_HELP} from './stripsHelp';

// One instrument rule for every "?" (camber #937): the data is the subject.
describe('how-to-read copy', () => {
  const sets = {STRIPS_HELP, LAP_BARS_HELP, RACE_HELP, PIT_REVIEW_HELP};

  it.each(Object.entries(sets))('%s is 2–4 lines', (_name, lines) => {
    expect(lines.length).toBeGreaterThanOrEqual(2);
    expect(lines.length).toBeLessThanOrEqual(4);
  });

  it('gives no advice, verdicts or rankings', () => {
    const all = Object.values(sets).flat().join(' ');
    expect(all).not.toMatch(
      /\b(should|try|better|worse|worst|good|bad|improve|too )\b/i,
    );
  });
});
