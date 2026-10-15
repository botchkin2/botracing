// Tyre heat strips (pit-wall thread 73, row 1f): one strip per meter, a row per
// wheel and a column per lap, coloured on a FIXED physical scale so two
// sessions compare. Numbers and units only: no bands, no cause (we do not
// know a car's window, and a lap's tyre temperature is not separable from its
// fuel load or wear). Pure.
import {WHEELS, type Wheel} from '@/src/analysis/tyres';
import type {Lap} from '@/src/data/sessions';

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
 * Rubber: the outer layer's median over the lap, as the Tires card's axle
 * line reads it; 50 to 100 C spans a cold out-lap to the hottest tread the
 * card scales (TREAD_BAR_MAX_C). Pressure: the lap's median hot pressure.
 */
export const HEAT_METERS: readonly HeatMeter[] = [
  {key: 'rubber', title: 'Rubber temperature', unit: '°C', min: 50, max: 100},
  {key: 'pressure', title: 'Hot pressure', unit: 'kPa', min: 150, max: 190},
];

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
): HeatStrip[] {
  const ordered = [...laps].sort((a, b) => a.lapIndex - b.lapIndex);
  const strips: HeatStrip[] = [];
  for (const meter of HEAT_METERS) {
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

/** "L28 · FL 71.9 · FR 72.3 · RL 71.2 · RR 71.8 °C": what a tapped column reads. */
export function readoutText(strip: HeatStrip, column: HeatColumn): string {
  const parts = WHEELS.map(w => {
    const v = column.values[w];
    return `${w} ${v == null ? '—' : v.toFixed(1)}`;
  });
  return `${column.label} · ${parts.join(' · ')} ${strip.meter.unit}`;
}
