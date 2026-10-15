// Tyre heat strips (pit-wall thread 73, row 1f): one strip per meter, a row per
// wheel and a column per lap, coloured on a FIXED physical scale so two
// sessions compare. Numbers and units only: no bands, no cause (we do not
// know a car's window, and a lap's tyre temperature is not separable from its
// fuel load or wear). Pure.
import {WHEELS, type Wheel} from '@/src/analysis/tyres';
import type {Lap} from '@/src/data/sessions';
import {oneDecimal} from '@/src/design';

export type HeatMeterKey = 'rubber' | 'pressure';

export type HeatMeter = {
  key: HeatMeterKey;
  title: string;
  unit: string;
  /** The ends of the fixed scale, in `unit`: the same in every session. */
  min: number;
  max: number;
};

/**
 * Rubber: the outer layer's median over the lap, as the Tires card's axle line
 * reads it. Pressure: the lap's median hot pressure.
 *
 * The ends are fixed per sim and come from Botkin's own data, not one race
 * (pit-wall thread 73, plank #5608): the p2 and p98 of every wheel on the
 * laps from the third lap of a stint on, rounded out to 5, by
 * `tools/dev/tyreScale.mjs` over a local analysis of his sessions on
 * 2026-10-15.
 *   LMU, 23 sessions (1,028 rubber and 1,026 pressure readings): rubber
 *     p2 51.1 / p98 82.9 C, hot pressure p2 144.6 / p98 173.4 kPa.
 *   iRacing, 2 sessions (28 readings, a small sample: provisional): rubber
 *     p2 35.0 / p98 65.2 C, hot pressure p2 158.6 / p98 181.4 kPa.
 * A session outside the ends clamps to the end colour, and the legend prints
 * the ends. Re-derive when the sample grows.
 */
const LMU_METERS: readonly HeatMeter[] = [
  {key: 'rubber', title: 'Rubber temperature', unit: '°C', min: 50, max: 85},
  {key: 'pressure', title: 'Hot pressure', unit: 'kPa', min: 145, max: 175},
];
const IRACING_METERS: readonly HeatMeter[] = [
  {key: 'rubber', title: 'Rubber temperature', unit: '°C', min: 35, max: 70},
  {key: 'pressure', title: 'Hot pressure', unit: 'kPa', min: 155, max: 185},
];

export const heatMetersFor = (sim: string): readonly HeatMeter[] =>
  sim === 'iracing' ? IRACING_METERS : LMU_METERS;

export type HeatColumn = {
  lapId: string;
  /** "L28". */
  label: string;
  stint: number;
  /** The session's best lap: marked, not explained. */
  best: boolean;
  /** FL, FR, RL, RR (the Tires card's order) in the meter's unit; null with no reading. */
  values: Record<Wheel, number | null>;
};

export type HeatStrip = {
  meter: HeatMeter;
  columns: HeatColumn[];
  /** Column indexes where a new stint starts (a gap is drawn before each). */
  stintStarts: number[];
};

/** Where a value sits on its meter's scale, 0 to 1; null for no reading. */
export function scalePosition(
  meter: HeatMeter,
  v: number | null,
): number | null {
  if (v == null || !Number.isFinite(v)) return null;
  return Math.min(1, Math.max(0, (v - meter.min) / (meter.max - meter.min)));
}

const readingOf = (
  lap: Lap,
  key: HeatMeterKey,
): Record<Wheel, number | null> | null => {
  const block = key === 'rubber' ? lap.tyres?.rubberC : lap.tyres?.pressureKpa;
  if (!block) return null;
  return {
    FL: block.FL ?? null,
    FR: block.FR ?? null,
    RL: block.RL ?? null,
    RR: block.RR ?? null,
  };
};

/** Both strips over every lap that has a reading; none when no lap does. */
export function buildHeatStrips(
  laps: Lap[],
  bestLapId: string | null,
  sim: string,
): HeatStrip[] {
  const ordered = [...laps].sort((a, b) => a.lapIndex - b.lapIndex);
  const strips: HeatStrip[] = [];
  for (const meter of heatMetersFor(sim)) {
    const columns: HeatColumn[] = [];
    for (const lap of ordered) {
      const values = readingOf(lap, meter.key);
      if (!values || WHEELS.every(w => values[w] == null)) continue;
      columns.push({
        lapId: lap.id,
        label: `L${lap.lapIndex}`,
        stint: lap.stint,
        best: lap.id === bestLapId,
        values,
      });
    }
    if (columns.length === 0) continue;
    const stintStarts = columns
      .map((c, i) => (i > 0 && c.stint !== columns[i - 1].stint ? i : -1))
      .filter(i => i >= 0);
    strips.push({meter, columns, stintStarts});
  }
  return strips;
}

/**
 * The column the readout shows before any tap: the best lap's, so its four
 * values are readable without a tap and the strip shows the shape around it
 * (plank #5612); null when the strip has no best lap.
 */
export function defaultColumn(strip: HeatStrip): number | null {
  const i = strip.columns.findIndex(c => c.best);
  return i >= 0 ? i : null;
}

/** "L28 · FL 71.9 · FR 72.3 · RL 71.2 · RR 71.8 °C": what a tapped column reads. */
export function readoutText(strip: HeatStrip, column: HeatColumn): string {
  const parts = WHEELS.map(w => {
    const v = column.values[w];
    return `${w} ${v == null ? '—' : oneDecimal(v)}`;
  });
  return `${column.label} · ${parts.join(' · ')} ${strip.meter.unit}`;
}
