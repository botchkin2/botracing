// The traffic facts the Session screen shows (round 7, 2A and 2B): the clean
// and traffic medians beside the all-lap median, and one lap's seconds and
// counts. Facts about laps, never a verdict: the headline pace stays every
// comparable lap (Botkin, pit-wall thread 44 #1563).
import {type LapSet, trafficMedians} from '@/src/analysis/traffic';
import {type Lap, type LapTraffic} from '@/src/data/sessions';
import {formatLapTime} from '@/src/design';

/** A traffic or clean set needs this many laps to show a median (the floor used everywhere else). */
export {MIN_SET_LAPS} from '@/src/analysis/traffic';

/** "1:49.800 · 4 of 14 laps"; null under the lap floor, where there is no median. */
export function setText(set: LapSet, ofLaps: number): string | null {
  return set.medianS == null
    ? null
    : `${formatLapTime(set.medianS)} · ${set.laps} of ${ofLaps} laps`;
}

/** The clean and traffic medians of a run of laps, or null without a field. */
export function paceSplit(laps: Lap[]) {
  return trafficMedians(laps);
}

/** A stint header's tail: " · clean 1:49.800 (4) · traffic 1:50.900 (6)", each only from 3 laps. */
export function stintTrafficText(laps: Lap[]): string {
  const split = paceSplit(laps);
  if (!split) return '';
  const part = (name: string, set: LapSet) =>
    set.medianS == null
      ? ''
      : ` · ${name} ${formatLapTime(set.medianS)} (${set.laps})`;
  return part('clean', split.clean) + part('traffic', split.traffic);
}

export type TrafficRow = {label: string; value: string; note?: string};

const secs = (v: number) => `${v.toFixed(1)} s`;
const metres = (v: number) => `${Math.round(v).toLocaleString('en-GB')} m`;

/**
 * One lap's traffic facts for the detail panel, or null for a lap without a
 * field (the section is then absent, never a column of zeros).
 */
export function trafficRows(traffic: LapTraffic | null): TrafficRow[] | null {
  if (!traffic) return null;
  const rows: TrafficRow[] = [
    {label: 'In a tow', value: secs(traffic.draftS)},
    {label: 'Car within 1 s ahead', value: secs(traffic.trafficAheadS)},
    {label: 'Car within 1 s behind', value: secs(traffic.trafficBehindS)},
    {label: 'Faster car behind', value: secs(traffic.blueFlagS)},
    {
      label: 'Passes within the car’s class',
      value: `made ${traffic.passesMade} · suffered ${traffic.passesSuffered}`,
    },
    {
      label: 'Faster-class cars that passed',
      value: String(traffic.overtakes.length),
      ...(traffic.overtakes.length > 0
        ? {
            note: traffic.overtakes
              .map(o => `${metres(o.atM)}${o.cls ? ` (${o.cls})` : ''}`)
              .join(' · '),
          }
        : {}),
    },
  ];
  return rows;
}
