import {type TrackCorner} from '@/src/data/sessions';
import {formatDistance, turnLabel} from '@/src/design';

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
    // The caption keeps lap metres ("4,050 → 300 m"), what the lap doc says.
    caption: viewCaption(
      turnLabel(corner.n, corner.official),
      {fromM: corner.entryM, toM: next.entryM},
      neighbours,
      overlappingLabels(corners, corner, lengthM),
    ),
  };
}

/**
 * "Shaded: T8 · 3,665 → 3,860 m · also in view: T9 apex 3,925 m · T8 and T9
 * overlap here". Says what is shown and nothing else. The labels are the
 * chips' (official ones where a track has them). `overlapping` are the other
 * corners whose entry-to-exit span shares track with this one's (the Bus
 * Stop), so the overlap is named instead of left for the reader to puzzle out.
 */
export function viewCaption(
  label: string,
  stretch: CornerStretch,
  neighbours: {label: string; lapM: number}[],
  overlapping: string[] = [],
): string {
  const range = `${plain(stretch.fromM)} → ${plain(stretch.toM)} m`;
  const also = neighbours.map(n => `${n.label} apex ${formatDistance(n.lapM)}`);
  return [
    `Shaded: ${label} · ${range}`,
    also.length > 0 ? `also in view: ${also.join(', ')}` : null,
    overlapping.length > 0 ? overlapSentence([label, ...overlapping]) : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

/**
 * The caption when the corner has a window of its own (pit-wall thread 45):
 * "Shaded: S5 (T8–T10) · 3,665 → 4,005 m · also in view: ...". A window that
 * runs past the zoom window says where it really ends and that the rest is not
 * drawn, so the shading ending at the edge is not read as the window's end
 * (setup #1760).
 */
export function windowCaption(
  label: string,
  /** The window in lap metres, what the caption prints. */
  window: CornerStretch,
  /** The same window in the zoom window's frame, to see what runs past it. */
  inFrame: CornerStretch,
  neighbours: {label: string; lapM: number}[],
  zoom: [number, number],
): string {
  const [startM, endM] = zoom;
  const cut = [
    inFrame.fromM < startM
      ? `window starts at ${plain(window.fromM)} m, not drawn`
      : null,
    inFrame.toM > endM
      ? `window continues to ${plain(window.toM)} m, not drawn`
      : null,
  ].filter(Boolean);
  const also = neighbours.map(n => `${n.label} apex ${formatDistance(n.lapM)}`);
  return [
    `Shaded: ${label} · ${plain(window.fromM)} → ${plain(window.toM)} m`,
    ...cut,
    also.length > 0 ? `also in view: ${also.join(', ')}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

// "T8 and T9 overlap here", "T8, T9 and T10 overlap here".
function overlapSentence(labels: string[]): string {
  const head = labels.slice(0, -1).join(', ');
  return `${head} and ${labels[labels.length - 1]} overlap here`;
}

/**
 * Labels of the other corners whose entry-to-exit span shares track with this
 * corner's, on the lap or across the start/finish line.
 */
export function overlappingLabels(
  corners: TrackCorner[],
  corner: TrackCorner,
  lengthM: number,
): string[] {
  const shifts = lengthM > 0 ? [0, -lengthM, lengthM] : [0];
  // A corner that runs over the line has its exit at a smaller distance than
  // its entry: unroll it by one lap, as inWindowFrame does.
  const spanOf = (c: TrackCorner): [number, number] => [
    c.entryM,
    c.exitM < c.entryM && lengthM > 0 ? c.exitM + lengthM : c.exitM,
  ];
  const [fromM, toM] = spanOf(corner);
  return corners
    .filter(c => c.n !== corner.n)
    .filter(c => {
      const [a, b] = spanOf(c);
      return shifts.some(shift => a + shift < toM && fromM < b + shift);
    })
    .map(c => turnLabel(c.n, c.official));
}

// formatDistance adds the unit; the range prints one "m" after both numbers.
function plain(m: number): string {
  return Math.round(m).toLocaleString('en-US');
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
