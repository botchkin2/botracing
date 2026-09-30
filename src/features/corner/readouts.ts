import {nearestSample} from '@/src/analysis/nativeSamples';
import {formatGap} from '@/src/design';

import {type ZoomLine} from './model';

// The values beside each desktop chart's label at the pointer, one per lap
// that is on. A recorded channel reads its nearest real sample, never an
// in-between value (CODE_STANDARDS §6); the time difference lives on the grid,
// so it reads the nearest grid point.

export type ReadoutChart =
  | 'delta'
  | 'speed'
  | 'brake'
  | 'throttle'
  | 'steering'
  | 'line';

export type Readout = {
  lapId: string;
  label: string;
  onIndex: number;
  text: string;
};

const signed = (v: number, digits: number) =>
  `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(digits)}`;

/** Readouts for every chart at distance `m`, for the laps that are on. */
export function readoutsAt(
  lines: ZoomLine[],
  stepM: number,
  m: number,
): Record<ReadoutChart, Readout[]> {
  const out: Record<ReadoutChart, Readout[]> = {
    delta: [],
    speed: [],
    brake: [],
    throttle: [],
    steering: [],
    line: [],
  };
  const on = lines
    .filter(l => l.onIndex != null)
    .sort((a, b) => (a.onIndex as number) - (b.onIndex as number));
  for (const l of on) {
    const add = (chart: ReadoutChart, text: string | null) => {
      if (text != null)
        out[chart].push({
          lapId: l.lapId,
          label: l.label,
          onIndex: l.onIndex as number,
          text,
        });
    };
    const at = (ch: keyof ZoomLine['samples']) =>
      nearestSample(l.samples[ch], m);
    const delta = l.deltaS[Math.round(m / stepM)];
    add('delta', Number.isFinite(delta) ? formatGap(delta) : null);
    const speed = at('speedKph');
    add('speed', speed == null ? null : `${Math.round(speed)}`);
    const brake = at('brakePct');
    add('brake', brake == null ? null : `${Math.round(brake)}`);
    const throttle = at('throttlePct');
    add('throttle', throttle == null ? null : `${Math.round(throttle)}`);
    const steering = at('steeringPct');
    add('steering', steering == null ? null : signed(steering, 0));
    const lateral = at('pathLateralM');
    add('line', lateral == null ? null : `${signed(lateral, 1)} m`);
  }
  return out;
}
