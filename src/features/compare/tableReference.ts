// What Compare's tables (the chip deltas and the time per section) read each
// lap against (pit-wall thread 44 #1833 and #1835, Botkin: "the tables and
// everything just run against all checked boxes"). The checked laps' median
// per corner window (two laps are a set: their midpoint); failing that (a
// session not resynced yet), the first lap's stint medians, then that lap
// itself. With a Ref lap picked on purpose, that lap alone. Pure: laps and
// the map in, a named reference out; every header prints `label`.
import {
  checkedWindowMedians,
  type Lap,
  stintWindowMedians,
  type TrackMapData,
  type WindowReference,
} from '@/src/data/sessions';

const MIN_SET_LAPS = 2;

export type TableReferenceKind = 'set' | 'stint' | 'lap';

export type TableReference = {
  kind: TableReferenceKind;
  /** "median of 8 checked laps", "stint 2 medians", or the reference lap's name. */
  label: string;
  /** Section number to that section's median in seconds; empty for the lap. */
  sectionS: Map<number, number>;
  /** The sum of every window's median (the lap's total), null if a window has none. */
  totalS: number | null;
};

function fromWindows(ref: WindowReference): {
  sectionS: Map<number, number>;
  totalS: number | null;
} {
  const sectionS = new Map<number, number>();
  let total: number | null = 0;
  ref.windows.forEach((w, i) => {
    const m = ref.medians[i]?.medianS ?? null;
    if (m == null) total = null;
    else if (total != null) total += m;
    if (m != null && w.kind === 'section' && w.section != null)
      sectionS.set(w.section, m);
  });
  return {sectionS, totalS: total};
}

export function tableReference(input: {
  /** The checked laps, the reference first. */
  selected: Lap[];
  /** This session's laps, for the stint fallback. */
  sessionLaps: Lap[];
  map: TrackMapData | null;
  /** The reference lap's name ("L12"), for the last fallback. */
  refName: string;
  /** A Ref lap is the basis: measure against that lap alone. */
  refLap?: boolean;
}): TableReference {
  const {selected, sessionLaps, map} = input;
  const lapRef: TableReference = {
    kind: 'lap',
    label: input.refName,
    sectionS: new Map(),
    totalS: null,
  };
  if (input.refLap || !map?.boundaries) return lapRef;
  if (selected.length >= MIN_SET_LAPS) {
    const set = checkedWindowMedians(selected, map, MIN_SET_LAPS);
    if (set && set.laps >= MIN_SET_LAPS) {
      const m = fromWindows(set);
      if (m.sectionS.size > 0)
        return {
          kind: 'set',
          label: `median of ${set.laps} checked laps`,
          ...m,
        };
    }
  }
  const ref = selected[0];
  // A lap of another session has no stint here.
  if (ref && sessionLaps.some(l => l.id === ref.id)) {
    const stint = stintWindowMedians(sessionLaps, map, ref.stint);
    if (stint) {
      const m = fromWindows(stint);
      if (m.sectionS.size > 0)
        return {
          kind: 'stint',
          label: `stint ${stint.stint} medians`,
          ...m,
        };
    }
  }
  return lapRef;
}
