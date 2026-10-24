import {describe, expect, it} from '@jest/globals';
import {KERB_SHARE, roadUse, USE_COLUMNS} from './roadUse';

// a straight 200 m road, a point every 2 m, 6 m each side
const POINTS = 100;
const ld = Array.from({length: POINTS}, (_, i) => i * 2);
const half = ld.map(() => 6);

function samples(f: (d: number, i: number) => number | null, perMetre = 5) {
  const d: number[] = [];
  const l: number[] = [];
  for (let m = 0; m < 200; m += 1 / perMetre) {
    const lat = f(m, d.length);
    if (lat !== null) {
      d.push(m);
      l.push(lat);
    }
  }
  return {ld: d, lat: l};
}

describe('roadUse', () => {
  it('puts the shade on the column the cars run in', () => {
    // every car 2 m right of the centre: column (2+6)/12*32 = 21
    const use = roadUse(samples(() => 2), 200, ld, half, half);
    const k = 50;
    const row = Array.from(use!.shade.slice(k * USE_COLUMNS, (k + 1) * USE_COLUMNS));
    const peak = row.indexOf(Math.max(...row));
    expect(peak).toBe(21);
    expect(Math.max(...row)).toBe(1);
    expect(row[3]).toBe(0);
  });
  it('flags a kerb only where cars touch that edge: the right edge on 80-120 m, never the left', () => {
    // on 80-120 m every other sample is 5.7 m right of the centre (0.3 m inside a 6 m edge), elsewhere all run down the middle
    const use = roadUse(samples((d, i) => (d >= 80 && d < 120 && i % 2 === 0 ? 5.7 : 0)), 200, ld, half, half);
    expect(use!.kerbRight[50]).toBe(1); // 100 m
    expect(use!.kerbRight[10]).toBe(0); // 20 m
    expect(use!.kerbRight[90]).toBe(0); // 180 m
    expect(Array.from(use!.kerbLeft).every(v => v === 0)).toBe(true);
    expect(KERB_SHARE).toBeLessThan(0.5);
  });
  it('is null with no samples', () => {
    expect(roadUse({ld: [], lat: []}, 200, ld, half, half)).toBeNull();
  });
});
