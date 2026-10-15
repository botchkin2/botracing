import {describe, expect, it} from '@jest/globals';

import type {Lap} from '@/src/data/sessions';

import {
  buildHeatStrips,
  defaultColumn,
  heatMetersFor,
  readoutText,
  scalePosition,
} from './heatStrips';

const wheels = (fl: number, fr: number, rl: number, rr: number) => ({
  FL: fl,
  FR: fr,
  RL: rl,
  RR: rr,
});
const lap = (
  i: number,
  stint: number,
  rubber: number | null,
  kpa: number | null,
): Lap =>
  ({
    id: `l${i}`,
    lapIndex: i,
    stint,
    tyres: {
      v: 3,
      wearPct: null,
      hotPressureKpa: null,
      carcassC: null,
      treadC: null,
      changed: null,
      rubberC:
        rubber == null ? null : wheels(rubber, rubber + 1, rubber - 1, rubber),
      pressureKpa: kpa == null ? null : wheels(kpa, kpa + 1, kpa, kpa - 1),
    },
  } as unknown as Lap);

describe('buildHeatStrips', () => {
  const laps = [
    lap(1, 1, 70, 165),
    lap(2, 1, 72, 166),
    lap(3, 2, 73, 167),
    lap(4, 2, 71, 166),
  ];

  it('is one strip per meter, a column per lap, stints separated, the best lap marked', () => {
    const strips = buildHeatStrips(laps, 'l4', 'lmu');
    expect(strips.map(s => s.meter.key)).toEqual(['rubber', 'pressure']);
    const rubber = strips[0];
    expect(rubber.columns.map(c => c.label)).toEqual(['L1', 'L2', 'L3', 'L4']);
    expect(rubber.stintStarts).toEqual([2]);
    expect(rubber.columns.map(c => c.best)).toEqual([
      false,
      false,
      false,
      true,
    ]);
    expect(rubber.columns[0].values).toEqual({FL: 70, FR: 71, RL: 69, RR: 70});
  });

  it('keeps the Tires card wheel order and drops a lap with no reading; none without any', () => {
    const strips = buildHeatStrips(
      [lap(1, 1, null, null), lap(2, 1, 72, 166)],
      null,
      'lmu',
    );
    expect(strips[0].columns.map(c => c.label)).toEqual(['L2']);
    expect(Object.keys(strips[0].columns[0].values)).toEqual([
      'FL',
      'FR',
      'RL',
      'RR',
    ]);
    expect(buildHeatStrips([lap(1, 1, null, null)], null, 'lmu')).toEqual([]);
  });

  it('puts a value on a fixed scale, the same for every session, and clamps outside it', () => {
    const rubber = heatMetersFor('lmu')[0];
    expect(scalePosition(rubber, 50)).toBe(0);
    expect(scalePosition(rubber, 85)).toBe(1);
    expect(scalePosition(rubber, 67.5)).toBe(0.5);
    expect(scalePosition(rubber, 10)).toBe(0);
    expect(scalePosition(rubber, 130)).toBe(1);
    expect(scalePosition(rubber, null)).toBeNull();
  });

  it('opens the readout on the best lap, and on nothing when the strip has none', () => {
    const [withBest] = buildHeatStrips(laps, 'l4', 'lmu');
    expect(defaultColumn(withBest)).toBe(3);
    expect(
      readoutText(withBest, withBest.columns[defaultColumn(withBest)!]),
    ).toBe('L4 · FL 71.0 · FR 72.0 · RL 70.0 · RR 71.0 °C');
    const [noBest] = buildHeatStrips(laps, null, 'lmu');
    expect(defaultColumn(noBest)).toBeNull();
  });

  it('has its own fixed ends per sim, from his data, and an unknown sim reads as LMU', () => {
    expect(heatMetersFor('iracing').map(m => [m.min, m.max])).toEqual([
      [35, 70],
      [155, 185],
    ]);
    expect(heatMetersFor('lmu').map(m => [m.min, m.max])).toEqual([
      [50, 85],
      [145, 175],
    ]);
    expect(heatMetersFor('other')).toBe(heatMetersFor('lmu'));
  });

  it('reads a tapped column as numbers with a unit and says nothing about why', () => {
    const [rubber] = buildHeatStrips(laps, null, 'lmu');
    expect(readoutText(rubber, rubber.columns[1])).toBe(
      'L2 · FL 72.0 · FR 73.0 · RL 71.0 · RR 72.0 °C',
    );
  });
});
