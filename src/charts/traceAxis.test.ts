import {describe, expect, test} from '@jest/globals';

import {
  deltaScale,
  lateralScale,
  pedalScale,
  speedScale,
  steeringScale,
} from '@/src/features/corner/scales';
import {overviewScale} from '@/src/features/compare/overviewScale';

import {insideFrame, labelBox} from './labelBox';
import {lapBarsPlot} from './lapBarsPlot';
import {
  AXIS_H,
  labelledTicks,
  plotPad,
  xTickBaseline,
  yOfValue,
  yTickBaseline,
} from './traceAxis';
import {type Scale} from './scale';

const PT = 9;
const WIDTH = 343;
// Every plot height Corner and Compare draw, phone and desktop, and more.
const HEIGHTS = Array.from({length: 41}, (_, i) => 40 + i * 4);

/** True when ChartLabel's safety net would leave this label where it is. */
function unmoved(text: string, x: number, baseline: number, h: number) {
  const at = insideFrame(text, x, baseline, PT, 'start', {
    width: WIDTH,
    height: h + AXIS_H,
  });
  return at.x === x && at.baseline === baseline;
}

const scales: [string, Scale][] = [
  ['Corner speed', speedScale([[143.2, 257.9]], [0, 10], 5)],
  ['Corner delta', deltaScale([[-0.55, 0.31]], [0, 10], 5)],
  ['Corner pedals', pedalScale()],
  ['Corner steering', steeringScale()],
  ['Corner line', lateralScale([[-9.2, 8.7]], [0, 10], 5)],
];

describe('TraceChart y ticks sit on their lines, inside the svg', () => {
  test.each(scales)('%s: no tick label is moved, at any height', (_, s) => {
    for (const h of HEIGHTS) {
      const pad = plotPad(true, PT);
      const y = (v: number) => yOfValue([s.lo, s.hi], h, pad, v);
      for (const t of labelledTicks(s.ticks, y, PT)) {
        const base = yTickBaseline(y(t.v), PT);
        expect(unmoved(t.label, 3, base, h)).toBe(true);
        // On its gridline: the box is centred on the value's y.
        const b = labelBox(t.label, 3, base, PT, 'start');
        expect((b.top + b.bottom) / 2).toBeCloseTo(y(t.v), 6);
      }
    }
  });

  test('Compare overview: ±s ends, unmoved and centred', () => {
    const o = overviewScale([{values: [0.4, -1.7]}]);
    for (const h of [44, 58, 70]) {
      const y = (v: number) => yOfValue(o.domain, h, plotPad(true, PT), v);
      for (const t of o.ticks)
        expect(unmoved(t.label, 3, yTickBaseline(y(t.v), PT), h)).toBe(true);
    }
  });

  test('labels never overlap: a short pedal chart labels 0, 50, 100 %', () => {
    const s = pedalScale();
    const y = (v: number) => yOfValue([s.lo, s.hi], 52, plotPad(true, PT), v);
    const shown = labelledTicks(s.ticks, y, PT);
    expect(shown.map(t => t.label)).toEqual(['0 %', '50 %', '100 %']);
    for (let i = 1; i < shown.length; i++) {
      const a = labelBox(
        'x',
        0,
        yTickBaseline(y(shown[i - 1].v), PT),
        PT,
        'start',
      );
      const b = labelBox('x', 0, yTickBaseline(y(shown[i].v), PT), PT, 'start');
      expect(b.bottom).toBeLessThanOrEqual(a.top);
    }
  });

  test('thinning keeps both ends: a short steering chart labels −100, 0, 100 %', () => {
    const s = steeringScale();
    const y = (v: number) => yOfValue([s.lo, s.hi], 40, plotPad(true, PT), v);
    expect(labelledTicks(s.ticks, y, PT).map(t => t.label)).toEqual([
      '−100 %',
      '0 %',
      '100 %',
    ]);
  });

  test('gears 3 to 6 in a short chart: the two ends', () => {
    const ticks = [3, 4, 5, 6].map(v => ({v, label: `${v}`}));
    const y = (v: number) => yOfValue([2.5, 6.5], 40, plotPad(true, PT), v);
    expect(labelledTicks(ticks, y, PT).map(t => t.label)).toEqual(['3', '6']);
  });

  test('x ticks stand on the bottom edge, unmoved', () => {
    for (const h of HEIGHTS)
      expect(unmoved('3500 m', 40, xTickBaseline(h, PT), h)).toBe(true);
  });
});

describe('Laps bars: the ±range ticks are unmoved', () => {
  test('at the top and bottom of the plot, with and without label rows', () => {
    for (const height of [120, 160, 215, 260])
      for (const rows of [0, 12.4, 24.4]) {
        const {plotTop, plotBottom} = lapBarsPlot(height, rows, PT);
        for (const [label, y] of [
          ['−1.5 s', plotTop],
          ['+1.5 s', plotBottom],
        ] as const) {
          const base = yTickBaseline(y, PT);
          const at = insideFrame(label, 2, base, PT, 'start', {
            width: WIDTH,
            height,
          });
          expect(at).toEqual({x: 2, baseline: base});
        }
      }
  });
});
