import {type TrackCorner} from '@/src/data/sessions';
import {turnLabel} from '@/src/design';

// Which stretch of track a Corner screen is about, and what else is in view.
// The zoomed charts and the mini-map show a window around the apex that also
// holds the neighbouring corners' braking, so the screen shades this turn's
// own stretch, dims the rest, and names the neighbours' apexes (Botkin, pit-wall
// thread 27 #928, #934). The stretch is the one "time in corner" measures:
// this corner's entry to the next corner's entry. Orientation only: no
// judgement about the driving.

/** A stretch of track in the window's own distance frame: fromM < toM, and
 *  either may lie outside the window (or below 0, just before the line). */
export type CornerStretch = {
  fromM: number;
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
};

/**
 * The stretch and the neighbouring apexes inside the window.
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
  const [startM, endM] = windowM;
  const stretch = inWindowFrame(
    {fromM: corner.entryM, toM: next.entryM},
    windowM,
    lengthM,
  );
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
  };
}

/**
 * What the window's own shading needs said, and nothing else: that the window
 * runs past the zoom window (so the shading ending at the edge is not read as
 * the window's end, setup #1760), and where the delta is drawn from. The
 * neighbours' apexes are already named on the chart, so no "Shaded: T3 · also
 * in view" sentence. Empty when there is nothing to say.
 */
export function windowCaption(
  /** The window in the zoom window's frame, to see what runs past it. */
  inFrame: CornerStretch,
  zoom: [number, number],
  /**
   * For a part of a compound section: the delta is drawn from the section's
   * start, where laps run at the same speed, not from the part's start inside
   * the chicane. `drawn` is false when that start is before the drawn stretch.
   */
  deltaFrom: {label: string; lapM: number; drawn: boolean} | null = null,
): string {
  const [startM, endM] = zoom;
  return [
    inFrame.fromM < startM ? 'window starts earlier, not drawn' : null,
    inFrame.toM > endM ? 'window continues later, not drawn' : null,
    deltaFrom
      ? `delta from the start of ${deltaFrom.label}${
          deltaFrom.drawn ? '' : ', not drawn'
        }`
      : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

/**
 * The stretch as it sits in the window's frame. A stretch that runs over the
 * start/finish line (its end is a smaller lap distance than its start) is
 * unrolled by one lap, then moved by -L, 0 or +L, whichever lands it in the
 * window (a corner whose entry is before the line and apex after it, seen
 * from its own apex, sits at negative distances).
 */
export function inWindowFrame(
  lap: CornerStretch,
  windowM: [number, number],
  lengthM: number,
): CornerStretch {
  const fromM = lap.fromM;
  const toM = lap.toM < lap.fromM && lengthM > 0 ? lap.toM + lengthM : lap.toM;
  if (lengthM <= 0) return {fromM, toM};
  const [startM, endM] = windowM;
  for (const shift of [0, -lengthM, lengthM])
    if (toM + shift > startM && fromM + shift < endM)
      return {fromM: fromM + shift, toM: toM + shift};
  return {fromM, toM};
}

/** The parts of a window outside the stretch, as [from, to] ranges to dim. */
export function dimmedRanges(
  windowM: [number, number],
  stretch: CornerStretch,
): [number, number][] {
  const [startM, endM] = windowM;
  const out: [number, number][] = [];
  if (stretch.fromM > startM) out.push([startM, Math.min(stretch.fromM, endM)]);
  if (stretch.toM < endM) out.push([Math.max(stretch.toM, startM), endM]);
  return out.filter(([a, b]) => b > a);
}
