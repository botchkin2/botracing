import {describe, expect, it} from '@jest/globals';

import {carLapsView} from './carLapsView';

describe('carLapsView', () => {
  it('lists the newest lap first, times to a tenth with ≈, untimeable laps as "—"', () => {
    const view = carLapsView(
      [
        {lapNumber: 4, timeS: 102.34, pit: null},
        {lapNumber: 5, timeS: null, pit: null},
        {lapNumber: 6, timeS: 131.96, pit: 'in'},
        {lapNumber: null, timeS: 59.94, pit: 'out'},
      ],
      'GT3',
    );
    expect(view?.title).toBe('GT3 ≈');
    expect(view?.rows.map(r => [r.lap, r.time, r.tag])).toEqual([
      ['—', '≈59.9', 'OUT'],
      ['6', '≈2:12.0', 'IN'],
      ['5', '—', ''],
      ['4', '≈1:42.3', ''],
    ]);
  });

  it('is null without laps, so no empty card is drawn', () => {
    expect(carLapsView([], 'GT3')).toBeNull();
  });
});
