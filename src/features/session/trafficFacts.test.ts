import {describe, expect, it} from '@jest/globals';

import {type LapTraffic} from '@/src/data/sessions';

import {PACE_RULE, setText, trafficRows} from './trafficFacts';

const base: LapTraffic = {
  draftS: 6.14,
  trafficAheadS: 4.2,
  trafficBehindS: 0,
  blueFlagS: 1.2,
  passesMade: 2,
  passesSuffered: 1,
  passesMadeAll: 3,
  passesSufferedAll: 2,
  battleS: 0,
  overtakes: [],
};

describe('trafficRows', () => {
  it('is absent on a lap without a field, never a column of zeros', () => {
    expect(trafficRows(null)).toBeNull();
  });

  it('gives seconds to one decimal and the own-class pass counts', () => {
    const rows = trafficRows(base)!;
    expect(rows.map(r => [r.label, r.value])).toEqual([
      ['In a tow', '6.1 s'],
      ['Within 1 s ahead', '4.2 s'],
      ['Within 1 s behind', '0.0 s'],
      ['Faster car behind', '1.2 s'],
      ['Passes in your class', 'made 2 · suffered 1'],
      ['Faster-class cars that passed you', '0'],
    ]);
  });

  it('says where each faster-class car passed, in lap distance', () => {
    const rows = trafficRows({
      ...base,
      overtakes: [
        {cls: 'Hypercar', atM: 1240.4},
        {cls: 'LMP2', atM: 3810},
      ],
    })!;
    const last = rows.at(-1)!;
    expect(last.value).toBe('2');
    expect(last.note).toBe('1,240 m (Hypercar) · 3,810 m (LMP2)');
  });
});

describe('setText', () => {
  it('shows the median and the laps behind it, and nothing under the floor', () => {
    expect(setText({laps: 4, medianS: 109.8}, 14)).toBe(
      '1:49.800 · 4 of 14 laps',
    );
    expect(setText({laps: 2, medianS: null}, 14)).toBeNull();
  });
});

describe('PACE_RULE', () => {
  it('prints the stored clean rule, not "TRAF or BLUE"', () => {
    expect(PACE_RULE).toContain('no pass suffered');
    expect(PACE_RULE).toContain('1.5 s behind');
    expect(PACE_RULE).toContain('under 2 s within 1 s of a same-class car');
    expect(PACE_RULE).not.toMatch(/\b(better|worse|should|good|bad)\b/i);
  });
});
