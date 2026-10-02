// The one line in the Session facts that says what energy the session started
// and ended with (pit-wall thread 44 #1918, VE-first per #1826): "VE 87 % →
// 3 % · 2 stops added 140 %", or the same in litres when no VE is stored. It
// reads the same laps, start, end and stop rules as the Pit stops card
// (pitCard.ts) so the two never disagree. Pure; numbers only (CODE_STANDARDS §7).
import {endingLap, racePitLaps} from '@/src/data/sessions';
import type {Lap, SessionType} from '@/src/data/sessions';

import {sessionHasVe} from './pitCard';

const litres = (v: number) => `${v.toFixed(1)} L`;
const pct = (v: number) => `${Math.round(v)} %`;

/** Which card the line opens: the race's Pit stops / Fuel card, or the practice Fuel card. */
export type EnergyTarget = 'pit' | 'fuel' | null;

export type EnergyLine = {text: string; target: EnergyTarget};

/**
 * Null when the laps carry no start or no end reading (a session with no whole
 * lap, or fuel not recorded): the line is left out, never shown as dashes.
 */
export function energyLine(
  sessionType: SessionType,
  laps: Lap[],
  opens: EnergyTarget,
): EnergyLine | null {
  const ending = endingLap(laps);
  const first = laps[0]?.fuel;
  const last = ending?.fuel;
  if (!first || !last) return null;
  const hasVe = sessionHasVe(laps);
  const stops = racePitLaps(sessionType, laps);
  const add = (pick: (l: Lap) => number | null | undefined) =>
    stops.reduce((s, l) => s + (pick(l) ?? 0), 0);

  let range: string;
  let added: number;
  let addedText: (v: number) => string;
  if (hasVe) {
    if (first.veStartPct == null || last.veEndPct == null) return null;
    range = `VE ${pct(first.veStartPct)} → ${pct(last.veEndPct)}`;
    added = add(l => l.pitStop?.added.vePct);
    addedText = pct;
  } else {
    if (first.startL == null || last.endL == null) return null;
    range = `${litres(first.startL)} → ${litres(last.endL)}`;
    added = add(l => l.pitStop?.added.fuelL);
    addedText = litres;
  }
  const stopsText =
    stops.length > 0
      ? `${stops.length} ${stops.length === 1 ? 'stop' : 'stops'}` +
        (added > 0 ? ` added ${addedText(added)}` : ' added nothing')
      : null;
  return {text: [range, stopsText].filter(Boolean).join(' · '), target: opens};
}
