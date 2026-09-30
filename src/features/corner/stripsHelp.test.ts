import {describe, expect, it} from '@jest/globals';

import {LAP_BARS_HELP} from '../session/lapBarsHelp';
import {PIT_REVIEW_HELP} from '../session/pitReview';
import {RACE_HELP} from '../race/raceHelp';
import {CORNER_CHART_HELP} from './chartHelp';
import {STRIPS_HELP} from './stripsHelp';

// One instrument rule for every "?" (camber #937): the data is the subject.
describe('how-to-read copy', () => {
  const sets = {
    STRIPS_HELP,
    LAP_BARS_HELP,
    RACE_HELP,
    PIT_REVIEW_HELP,
    ...Object.fromEntries(
      Object.entries(CORNER_CHART_HELP).map(([k, v]) => [`CORNER_${k}`, v]),
    ),
  };

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

  // Each channel's own rate (docs/LMU_SYNC_NOTES.md), round 5 item 7.
  it('states each Corner channel’s own rate, and no steering direction', () => {
    const rate = (k: keyof typeof CORNER_CHART_HELP) =>
      CORNER_CHART_HELP[k].join(' ');
    expect(rate('speed')).toContain('100 Hz');
    expect(rate('steering')).toContain('100 Hz');
    expect(rate('brake')).toContain('50 Hz');
    expect(rate('throttle')).toContain('50 Hz');
    expect(rate('speed')).toContain('5 m position grid');
    expect(rate('steering')).toContain('% of full lock');
    expect(rate('steering')).not.toMatch(/(left|right)/i);
    // The delta is each lap's own clock at every grid point, not integrated.
    expect(rate('delta')).toContain('own recorded clock');
    expect(rate('delta')).not.toMatch(/integrat/i);
  });
});
