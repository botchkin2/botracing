import {type ClassPaceDoc, medianVsClass} from '@/src/analysis/classPace';
import {formatGap, formatLapTime} from '@/src/design';

/**
 * A race's class median beside his own, for the Session head (ticket 20, the
 * race head of ticket 56): the median of the other drivers' own medians in his
 * class, and his median against it, both read from the game's results file
 * (`classPace`) so the two are the same laps' clock. Never instead of his
 * Median: that one is the selection's. Empty outside a race, and without
 * `classPace` (a session synced before the tray that sends the drivers' laps).
 */
export function classMedianFacts(session: {
  sessionType: string;
  classPace: ClassPaceDoc | null;
}): {label: string; value: string; basis: string}[] {
  if (session.sessionType !== 'R') return [];
  const m = medianVsClass(session.classPace);
  if (!m) return [];
  return [
    {
      label: 'Class median',
      value: formatLapTime(m.classS),
      basis: `you ${formatGap(m.youS - m.classS)} · ${m.cars} cars`,
    },
  ];
}
