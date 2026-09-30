// The race pit review (pit-wall thread 36): one row per stop and one row for
// the end, from the fuel facts the uploader already stores on each lap
// (tools/sessions/fuelFacts.mjs). Pure. Numbers, units and what they were
// measured against, never advice (CODE_STANDARDS §7).
import type {Lap, PitStop, SessionType} from '@/src/data/sessions';

export type PitStopReview = {key: string; title: string; lines: string[]};

export type PitReview = {
  stops: PitStopReview[];
  /** Null when no whole lap has a fuel level to end on. */
  end: {title: string; lines: string[]} | null;
  explainer: string;
};

// Behind the "?" on the Pit stops card (thread 33 #1119), one sentence a line.
export const PIT_REVIEW_HELP: readonly string[] = [
  'Each stop: what was in the tank at pit entry, what the stop added and the time in the lane.',
  'Laps are at the stint’s median use per green lap.',
  'Tyres changed means the average tyre wear reading jumped after the stop.',
  'The end row is the last whole lap: the tank at the last stop plus what it added, less what was left, is what the laps after it used.',
];

const litres = (v: number) => `${v.toFixed(1)} L`;
const pct = (v: number) => `${Math.round(v)} %`;
// The printed numbers, so the balance can be computed from them and close on
// the page (camber, #147).
const round1 = (v: number) => Math.round(v * 10) / 10;
const round0 = (v: number) => Math.round(v);
const lapsOf = (v: number) => `${v.toFixed(1)} laps`;

/**
 * The stops of a race, in driving order. A stop on the first lap of the
 * session is the service before the start, not a stop, and is left out
 * (camber, thread 36 #1117). Practice and qualifying have no review.
 */
function racePitLaps(sessionType: SessionType, laps: Lap[]): Lap[] {
  if (sessionType !== 'R') return [];
  const first = laps.length > 0 ? laps[0].lapIndex : 0;
  return laps.filter(l => l.pitStop !== null && l.lapIndex !== first);
}

/**
 * Whether the tyres were changed at the stop entered on laps[index], from the
 * uploader's wear-jump flag. The flag lands on the first lap that starts after
 * the wear reading has updated, which is the lap after the out lap (Silverstone
 * 09-16: pit-in L14, out lap L15, flag on L16), so look through the out lap
 * and the first lap after it. Null when the session ends before that.
 */
function tyresChanged(laps: Lap[], index: number): boolean | null {
  let changed = false;
  for (let j = index + 1; j < laps.length; j++) {
    changed = changed || laps[j].newTyres;
    if (!laps[j].pitOut) return changed;
  }
  return changed ? true : null;
}

function stopLines(stop: PitStop, tyres: boolean | null): string[] {
  const {fuelL, vePct} = stop.atEntry;
  const inTank = [
    fuelL != null && litres(fuelL),
    vePct != null && `${pct(vePct)} VE`,
  ].filter(Boolean);
  const {fuel, ve} = stop.lapsLeftAtEntry;
  const lapsLeft = [
    fuel != null && `${lapsOf(fuel)} of fuel`,
    ve != null && `${lapsOf(ve)} of VE`,
  ].filter(Boolean);
  const out: string[] = [];
  if (inTank.length) out.push(`In the tank: ${inTank.join(' · ')}`);
  if (lapsLeft.length) out.push(`${lapsLeft.join(' · ')} at the median`);
  const {fuelL: addL, vePct: addVe} = stop.added;
  if (addL === 0) out.push('Drive-through: nothing added');
  else if (addL != null || addVe != null)
    out.push(
      `Added: ${[
        addL != null && `+${litres(addL)}`,
        addVe != null && `+${pct(addVe)} VE`,
      ]
        .filter(Boolean)
        .join(' · ')}`,
    );
  if (stop.inPitS != null) out.push(`In the lane: ${stop.inPitS.toFixed(0)} s`);
  if (tyres != null) out.push(tyres ? 'Tyres changed' : 'Tyres not changed');
  return out;
}

// "Fuel: 12.9 L in + 50.0 L added at the last stop · 49.8 L used after ·
// 13.1 L left". The level at the end is measured; what the laps after the
// stop used is the tank's own balance, taken from the rounded numbers as
// printed so the line closes.
function endLine(
  name: string,
  inTank: number | null,
  added: number | null,
  left: number | null,
  lapsLeft: number | null,
  fmt: (v: number) => string,
  round: (v: number) => number,
): string | null {
  if (left == null) return null;
  const tail = lapsLeft != null ? ` (${lapsOf(lapsLeft)} at the median)` : '';
  if (inTank == null || added == null)
    return `${name}: ${fmt(left)} left${tail}`;
  const used = round(round(inTank) + round(added) - round(left));
  return `${name}: ${fmt(inTank)} in + ${fmt(
    added,
  )} added at the last stop · ${fmt(used)} used after · ${fmt(
    left,
  )} left${tail}`;
}

/** Null for anything but a race with at least one stop. */
export function buildPitReview(
  sessionType: SessionType,
  laps: Lap[],
): PitReview | null {
  const pitLaps = racePitLaps(sessionType, laps);
  if (pitLaps.length === 0) return null;
  const stops = pitLaps.map((lap, i): PitStopReview => {
    return {
      key: lap.id,
      title: `L${lap.lapIndex} · Stop ${i + 1} of ${pitLaps.length}`,
      // Unknown (null) on the last lap: the session ended in the pits.
      lines: stopLines(
        lap.pitStop as PitStop,
        tyresChanged(
          laps,
          laps.findIndex(l => l.id === lap.id),
        ),
      ),
    };
  });

  const last = pitLaps[pitLaps.length - 1].pitStop as PitStop;
  const ending = [...laps]
    .reverse()
    .find(l => !l.partial && l.fuel?.endL != null);
  const f = ending?.fuel;
  const lines = f
    ? [
        endLine(
          'Fuel',
          last.atEntry.fuelL,
          last.added.fuelL,
          f.endL,
          f.lapsLeftFuel,
          litres,
          round1,
        ),
        endLine(
          'VE',
          last.atEntry.vePct,
          last.added.vePct,
          f.veEndPct,
          f.lapsLeftVe,
          pct,
          round0,
        ),
      ].filter((l): l is string => l != null)
    : [];
  return {
    stops,
    end:
      ending && lines.length
        ? {title: `End of L${ending.lapIndex}`, lines}
        : null,
    explainer: PIT_REVIEW_HELP.join(' '),
  };
}
