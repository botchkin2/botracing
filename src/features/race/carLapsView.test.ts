import {describe, expect, it} from '@jest/globals';

import {type CarLap} from '@/src/analysis/carLaps';

import {carLapsView} from './carLapsView';

const lap = (
  lapNumber: number | null,
  timeS: number | null,
  pit: CarLap['pit'] = null,
): CarLap => ({lapNumber, timeS, pit, startS: null, endS: null});

describe('carLapsView', () => {
  it('lists lap 1 first, times to a tenth with ≈, untimeable laps as "—"', () => {
    const view = carLapsView(
      [lap(4, 102.34), lap(5, null), lap(6, 131.96, 'in'), lap(null, 59.94, 'out')],
      'GT3',
      -1,
    );
    expect(view?.title).toBe('GT3 ≈');
    expect(view?.rows.map(r => [r.lap, r.time, r.tag])).toEqual([
      ['4', '≈1:42.3', ''],
      ['5', '—', ''],
      ['6', '≈2:12.0', 'IN'],
      ['—', '≈59.9', 'OUT'],
    ]);
  });

  it('marks the one current row, none before the first lap', () => {
    const laps = [lap(1, 90), lap(2, 91), lap(3, 92)];
    expect(carLapsView(laps, 'GT3', 1)?.rows.map(r => r.current)).toEqual([false, true, false]);
    expect(carLapsView(laps, 'GT3', -1)?.rows.map(r => r.current)).toEqual([false, false, false]);
  });

  it('is null without laps, so no empty card is drawn', () => {
    expect(carLapsView([], 'GT3', -1)).toBeNull();
  });
});
