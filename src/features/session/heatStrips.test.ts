import {describe, expect, it} from '@jest/globals';

import type {Lap} from '@/src/data/sessions';

import {
  buildHeatStrips,
  defaultColumn,
  readoutText,
  scalePosition,
  sessionRange,
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
  green?: boolean,
): Lap =>
  ({
    id: `l${i}`,
    lapIndex: i,
    stint,
    fuel: green == null ? null : {green},
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

  it('opens the readout on the best lap, and on nothing when the strip has none', () => {
    const [withBest] = buildHeatStrips(laps, 'l4');
    expect(defaultColumn(withBest)).toBe(3);
    expect(
      readoutText(withBest, withBest.columns[defaultColumn(withBest)!]),
    ).toBe('L4 · FL 71.0 · FR 72.0 · RL 70.0 · RR 71.0 °C');
    const [noBest] = buildHeatStrips(laps, null);
    expect(defaultColumn(noBest)).toBeNull();
  });

  it('reads a tapped column as numbers with a unit and says nothing about why', () => {
    const [rubber] = buildHeatStrips(laps, null);
    expect(readoutText(rubber, rubber.columns[1])).toBe(
      'L2 · FL 72.0 · FR 73.0 · RL 71.0 · RR 72.0 °C',
    );
  });
});

describe("the scale is the session's own range", () => {
  // His rebuilt race, L28 (thread 73 #5644): rubber 73.4 / 67.7 / 75.3 / 71.2
  // and pressure 166.5 / 163.3 / 167.2 / 164.9, a front to rear spread of 7.6 C.
  const race = [
    {
      ...lap(27, 2, 73.4, 166.5, true),
      tyres: {
        ...lap(27, 2, 73.4, 166.5).tyres,
        rubberC: wheels(73.4, 67.7, 75.3, 71.2),
        pressureKpa: wheels(166.5, 163.3, 167.2, 164.9),
      },
    },
    lap(28, 2, 72, 165, true),
    lap(29, 2, 71, 165, true),
  ] as Lap[];

  it('runs from the least to the most of all four wheels, so the front-to-rear spread is on it', () => {
    const [rubber, pressure] = buildHeatStrips(race, null);
    expect(rubber.meter).toMatchObject({min: 67.7, max: 75.3, unit: '°C'});
    // Pressure moved 3.9 kPa, under the 6 kPa floor: centred on 165.25 and widened.
    expect(pressure.meter.min).toBeCloseTo(162.25, 5);
    expect(pressure.meter.max).toBeCloseTo(168.25, 5);
    expect(pressure.meter.unit).toBe('kPa');
    // The two wheels at opposite ends land at the ends of the colours.
    const l28 = rubber.columns[0].values;
    expect(scalePosition(rubber.meter, l28.FR)).toBe(0);
    expect(scalePosition(rubber.meter, l28.RL)).toBe(1);
    expect(scalePosition(rubber.meter, l28.FL)).toBeCloseTo(0.75, 2);
  });

  it('a pit or out lap, which is not green, does not set the range while a green lap exists', () => {
    const out = lap(30, 3, 40, 150, false);
    const [rubber] = buildHeatStrips([...race, out], null);
    expect(rubber.meter.min).toBe(67.7);
    // The out lap is still a column, drawn on the clamped end.
    expect(rubber.columns).toHaveLength(4);
    expect(scalePosition(rubber.meter, 40)).toBe(0);
  });

  it('with no green lap at all it uses every lap with a reading', () => {
    const [rubber] = buildHeatStrips(
      [lap(1, 1, 50, 150), lap(2, 1, 80, 160)],
      null,
    );
    expect(rubber.meter.min).toBeCloseTo(49, 5);
    expect(rubber.meter.max).toBeCloseTo(81, 5);
  });

  it('a session that barely moves gets a floor of 6 C and 6 kPa around its middle, not a rainbow of noise', () => {
    const calm = [lap(1, 1, 70, 165, true), lap(2, 1, 70.4, 165.2, true)];
    const [rubber, pressure] = buildHeatStrips(calm, null);
    // Range 69..71.4 widened to 6 around 70.2.
    expect(rubber.meter.max - rubber.meter.min).toBeCloseTo(6, 5);
    expect((rubber.meter.min + rubber.meter.max) / 2).toBeCloseTo(70.2, 5);
    expect(pressure.meter.max - pressure.meter.min).toBeCloseTo(6, 5);
  });

  it('puts a value on the scale and clamps outside it', () => {
    const meter = {min: 60, max: 80};
    expect(scalePosition(meter, 60)).toBe(0);
    expect(scalePosition(meter, 80)).toBe(1);
    expect(scalePosition(meter, 70)).toBe(0.5);
    expect(scalePosition(meter, 10)).toBe(0);
    expect(scalePosition(meter, 130)).toBe(1);
    expect(scalePosition(meter, null)).toBeNull();
  });

  it('sessionRange ignores missing readings', () => {
    expect(
      sessionRange({minSpan: 2}, [
        {green: true, values: {FL: 70, FR: null, RL: 74, RR: null}},
        {green: true, values: {FL: null, FR: 72, RL: null, RR: null}},
      ]),
    ).toEqual({min: 70, max: 74});
  });
});
