// Tyre heat strips (pit-wall thread 73, row 1f): one strip per meter, a row per
// wheel and a column per lap, coloured on THE SESSION'S OWN range so a race's
// few degrees of drift can be seen (a fixed scale flattened them to 0.09 of the
// ramp: Botkin, "how are these useful? there is no variation", plank #5644).
// The legend prints both ends as numbers, so a reader knows the colours are this
// session's: that is the price of not comparing sessions by colour. Numbers and
// units only: no bands, no cause (we do not know a car's window, and a lap's
// tyre temperature is not separable from its fuel load or wear). Pure.
import {WHEELS, type Wheel} from '@/src/analysis/tyres';
import {lapLabel} from '@/src/analysis/lapNumbering';
import type {Lap} from '@/src/data/sessions';
import {oneDecimal} from '@/src/design';

export type HeatMeterKey = 'rubber' | 'pressure';

/** What a meter is; its ends are the session's (`HeatMeter`). */
type HeatMeterSpec = {
  key: HeatMeterKey;
  title: string;
  unit: string;
  /**
   * The least span of the scale, in `unit`. A session that barely moves does
   * not turn into a rainbow of noise: its range is centred and widened to this.
   */
  minSpan: number;
};

/**
 * Rubber: the outer layer's median over the lap, as the Tires card's axle line
 * reads it. Pressure: the lap's median hot pressure.
 */
const SPECS: readonly HeatMeterSpec[] = [
  {key: 'rubber', title: 'Rubber temperature', unit: '°C', minSpan: 6},
  {key: 'pressure', title: 'Hot pressure', unit: 'kPa', minSpan: 6},
];

export type HeatMeter = Omit<HeatMeterSpec, 'minSpan'> & {
  /** The ends of this session's scale, in `unit`. */
  min: number;
  max: number;
};

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
  meter: Pick<HeatMeter, 'min' | 'max'>,
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

/**
 * The session's own ends for a meter: the least and most of every wheel's
 * reading over the green laps (a pit, cut or out lap is not the range), the
 * four wheels together so a front-to-rear difference is on the scale. Falls
 * back to every lap with a reading when no lap is green. Widened to `minSpan`
 * around its middle.
 */
export function sessionRange(
  spec: Pick<HeatMeterSpec, 'minSpan'>,
  columns: {green: boolean; values: Record<Wheel, number | null>}[],
): {min: number; max: number} {
  const green = columns.filter(c => c.green);
  const used = green.length > 0 ? green : columns;
  const all = used.flatMap(c =>
    WHEELS.map(w => c.values[w]).filter((v): v is number => v != null),
  );
  const lo = Math.min(...all);
  const hi = Math.max(...all);
  if (hi - lo >= spec.minSpan) return {min: lo, max: hi};
  const middle = (lo + hi) / 2;
  return {min: middle - spec.minSpan / 2, max: middle + spec.minSpan / 2};
}

/** Both strips over every lap that has a reading; none when no lap does. */
export function buildHeatStrips(
  laps: Lap[],
  bestLapId: string | null,
): HeatStrip[] {
  const ordered = [...laps].sort((a, b) => a.lapIndex - b.lapIndex);
  const strips: HeatStrip[] = [];
  for (const {minSpan, ...spec} of SPECS) {
    const columns: HeatColumn[] = [];
    const green: boolean[] = [];
    for (const lap of ordered) {
      const values = readingOf(lap, spec.key);
      if (!values || WHEELS.every(w => values[w] == null)) continue;
      green.push(lap.fuel?.green === true);
      columns.push({
        lapId: lap.id,
        label: lapLabel(lap.lapNo),
        stint: lap.stint,
        best: lap.id === bestLapId,
        values,
      });
    }
    if (columns.length === 0) continue;
    const range = sessionRange(
      {minSpan},
      columns.map((c, i) => ({green: green[i], values: c.values})),
    );
    const stintStarts = columns
      .map((c, i) => (i > 0 && c.stint !== columns[i - 1].stint ? i : -1))
      .filter(i => i >= 0);
    strips.push({meter: {...spec, ...range}, columns, stintStarts});
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
