import {describe, expect, it} from '@jest/globals';

import {TICK_PT} from './ChartLabel';
import {labelBox} from './labelBox';
import {fitScale, fixedScale} from './scale';
import {MIN_PAD_PT, stripAxis} from './stripAxis';
import {withUnit} from './tickFormat';

const scaleOf = (values: number[], unit: string) =>
  fitScale(values, {symmetric: false, maxTicks: 5, format: withUnit(unit)});

describe('stripAxis', () => {
  it('keeps every labelled tick inside the svg at phone width, the end labels included', () => {
    for (const [values, unit] of [
      [[100, 119], 'm'],
      [[4.18, 4.61], 's'],
      [[118, 131], 'km/h'],
    ] as const) {
      const width = 343;
      const a = stripAxis(scaleOf([...values], unit), width, false, TICK_PT);
      for (const t of a.ticks.filter(x => x.labelled)) {
        const box = labelBox(t.label, t.x, 0, TICK_PT, 'middle');
        expect(box.left).toBeGreaterThanOrEqual(0);
        expect(box.right).toBeLessThanOrEqual(width);
      }
    }
  });

  it('pads the plot by half the widest label, never less than the dot radius', () => {
    const a = stripAxis(scaleOf([118, 131], 'km/h'), 343, false, TICK_PT);
    // "130 km/h" is 8 glyphs.
    expect(a.padX).toBeCloseTo((8 * 0.6 * TICK_PT) / 2 + 1, 6);
    // One-glyph labels (0 … 4) are narrower than the dots need.
    const plain = stripAxis(fixedScale(0, 4, 1), 343, false, TICK_PT);
    expect(plain.padX).toBe(MIN_PAD_PT);
  });

  it('runs the larger values on the left when flipped (brake point: earlier is left)', () => {
    const s = scaleOf([100, 119], 'm');
    const a = stripAxis(s, 343, true, TICK_PT);
    expect(a.x(s.hi)).toBeCloseTo(a.padX, 6);
    expect(a.x(s.lo)).toBeCloseTo(343 - a.padX, 6);
  });

  it('labels every tick when they fit, and every other one when they would touch', () => {
    const s = scaleOf([100, 119], 'm');
    expect(stripAxis(s, 343, false, TICK_PT).ticks.every(t => t.labelled)).toBe(
      true,
    );
    const narrow = stripAxis(s, 120, false, TICK_PT).ticks;
    expect(narrow.map(t => t.labelled)).toEqual([
      true,
      false,
      true,
      false,
      true,
    ]);
  });
});
