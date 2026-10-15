import {describe, expect, it} from '@jest/globals';

import type {Lap} from '@/src/data/sessions';

import {
  buildHeatStrips,
  HEAT_METERS,
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
    const strips = buildHeatStrips(laps, 'l4');
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
    );
    expect(strips[0].columns.map(c => c.label)).toEqual(['L2']);
    expect(Object.keys(strips[0].columns[0].values)).toEqual([
      'FL',
      'FR',
      'RL',
      'RR',
    ]);
    expect(buildHeatStrips([lap(1, 1, null, null)], null)).toEqual([]);
  });

  it('puts a value on a fixed scale, the same for every session, and clamps outside it', () => {
    const rubber = HEAT_METERS[0];
    expect(scalePosition(rubber, 50)).toBe(0);
    expect(scalePosition(rubber, 100)).toBe(1);
    expect(scalePosition(rubber, 75)).toBe(0.5);
    expect(scalePosition(rubber, 20)).toBe(0);
    expect(scalePosition(rubber, 130)).toBe(1);
    expect(scalePosition(rubber, null)).toBeNull();
  });

  it('reads a tapped column as numbers with a unit and says nothing about why', () => {
    const [rubber] = buildHeatStrips(laps, null);
    expect(readoutText(rubber, rubber.columns[1])).toBe(
      'L2 · FL 72.0 · FR 73.0 · RL 71.0 · RR 72.0 °C',
    );
  });
});
