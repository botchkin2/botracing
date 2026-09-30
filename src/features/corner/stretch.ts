import {type TrackCorner} from '@/src/data/sessions';
import {formatDistance, turnLabel} from '@/src/design';

// Which stretch of track a Corner screen is about, and what else is in view.
// The zoomed charts and the mini-map show a window around the apex that also
// holds the neighbouring corners' braking, so the screen shades this turn's
// own stretch, dims the rest, and names the neighbours' apexes (Botkin, pit-wall
// thread 27 #928, #934). The stretch is the one "time in corner" measures:
// this corner's entry to the next corner's entry. Orientation only: no
// judgement about the driving.

export type CornerStretch = {
  fromM: number;
  /** The next corner's entry. Smaller than fromM when the stretch crosses the
   *  start/finish line: it then runs to the end of the window. */
  toM: number;
};

export type NeighbourApex = {
  n: number;
  label: string;
  /** Where the apex sits in the window's own distance frame (negative for a
   *  corner just past the line seen from before it). */
  apexM: number;
  /** The apex's distance on the lap, what the caption prints. */
  lapM: number;
};

export type CornerView = {
  stretch: CornerStretch;
  neighbours: NeighbourApex[];
  caption: string;
};

/**
 * The stretch, the neighbouring apexes inside the window, and the caption.
 * `corners` are in track order; `lengthM` puts apexes across the start/finish
 * line into the window's frame (a corner just after the line is also just
 * before it).
 */
export function cornerView(
  corners: TrackCorner[],
  index: number,
  windowM: [number, number],
  lengthM: number,
): CornerView | null {
  const corner = corners[index];
  if (!corner) return null;
  const next = corners[(index + 1) % corners.length];
  const stretch = {fromM: corner.entryM, toM: next.entryM};
  const [startM, endM] = windowM;
  const neighbours: NeighbourApex[] = [];
  for (const c of corners) {
    if (c.n === corner.n) continue;
    for (const apexM of lengthM > 0
      ? [c.apexM - lengthM, c.apexM, c.apexM + lengthM]
      : [c.apexM]) {
      if (apexM < startM || apexM > endM) continue;
      neighbours.push({
        n: c.n,
        label: turnLabel(c.n, c.official),
        apexM,
        lapM: c.apexM,
      });
    }
  }
  neighbours.sort((a, b) => a.apexM - b.apexM);
  return {
    stretch,
    neighbours,
    caption: viewCaption(
      turnLabel(corner.n, corner.official),
      stretch,
      neighbours,
    ),
  };
}

/**
 * "Shaded: T8 · 3,665 → 3,860 m · also in view: T9 apex 3,925 m". Says what
 * is shown and nothing else. The labels are the chips' (official ones where a
 * track has them).
 */
export function viewCaption(
  label: string,
  stretch: CornerStretch,
  neighbours: {label: string; lapM: number}[],
): string {
  const range = `${plain(stretch.fromM)} → ${plain(stretch.toM)} m`;
  const also = neighbours.map(n => `${n.label} apex ${formatDistance(n.lapM)}`);
  return [
    `Shaded: ${label} · ${range}`,
    also.length > 0 ? `also in view: ${also.join(', ')}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

// formatDistance adds the unit; the range prints one "m" after both numbers.
function plain(m: number): string {
  return Math.round(m).toLocaleString('en-US');
}

/**
 * The parts of a window outside the stretch, as [from, to] ranges to dim.
 * A stretch that crosses the start/finish line (toM < fromM) runs to the end
 * of the window.
 */
export function dimmedRanges(
  windowM: [number, number],
  stretch: CornerStretch,
): [number, number][] {
  const [startM, endM] = windowM;
  const toM = stretch.toM < stretch.fromM ? endM : stretch.toM;
  const out: [number, number][] = [];
  if (stretch.fromM > startM) out.push([startM, Math.min(stretch.fromM, endM)]);
  if (toM < endM) out.push([Math.max(toM, startM), endM]);
  return out.filter(([a, b]) => b > a);
}
