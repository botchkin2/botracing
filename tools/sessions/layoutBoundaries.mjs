// One session's part in the layout's corner boundaries (pit-wall thread 45,
// #1590, #1603): take this session's laps, measure where each began braking or
// lifting for every section of the track map, fold those onsets into what the
// layout keeps, and hand back the windows its laps are cut at.
//
// The model is src/analysis/cornerBoundaries.ts; this is the part that knows
// laps: which laps count (comparable green laps only: no pit, yellow or
// off-track), and the distance frame (the map's, lap fraction times the track
// map's length, so onsets pooled across sessions do not smear).
import {
  CORNER_BOUNDARIES_VERSION,
  foldBoundaries,
  lapOnsets,
  onsetPools,
  onsetsOfLaps,
  windowsOf,
} from '../../src/analysis/cornerBoundaries.ts';

export {CORNER_BOUNDARIES_VERSION};

const GRID_M = 5;

// A lap's pedals on the 5 m grid, in the map's frame.
function pedalTrace(lap, lengthM) {
  const ratio = lap.distanceM / lengthM;
  const n = lap.grid.time.length;
  return {
    distM: Array.from({length: n}, (_, g) => (g * GRID_M) / ratio),
    brakePct: Array.from(lap.grid.brake),
    throttlePct: Array.from(lap.grid.throttle),
    speedKmh: Array.from(lap.grid.speed),
  };
}

// Which laps measure where laps agree: comparable, green and clean.
const measures = lap =>
  lap.comparable &&
  lap.clean &&
  !(lap.courseYellowSec > 0) &&
  !lap.pitlane &&
  !lap.pitIn &&
  !lap.pitOut;

/** The sections' identity, so boundaries stored for another map are not reused. */
export const mapKeyOf = sections =>
  sections.map(s => `${s.n}:${s.turnInM}:${s.exitM}`).join('|');

/**
 * laps: the session's laps with a grid that fit the map (`cornersFit`); map:
 * the track map ({lengthM, corners}); stored: the layout's boundaries as kept
 * (or null); sessionId: this session, replaced on a resync; fold: the model's
 * minimums (`minLaps`, `minSessions`), for tests. readOnly: the curated
 * boundaries are used exactly as they are and nothing is folded in (a sync that
 * may not change track data, thread 2 #155): `stored` must be this map's.
 * Returns {state, windows, onsets, moved, changed}: state is what to keep
 * (null when nothing can be measured), windows the CornerWindows its laps are
 * cut at, onsets per lap (a Map from the lap) the per-section onsets in the
 * map's frame.
 */
export function sessionBoundaries({
  laps,
  map,
  stored,
  sessionId,
  fold: opts = {},
  readOnly = false,
}) {
  const sections = map.corners;
  const lengthM = map.lengthM;
  const key = mapKeyOf(sections);
  if (readOnly) {
    if (!stored || stored.mapKey !== key)
      throw new Error(
        'read-only boundaries need the stored boundaries of this very map',
      );
    const prev = k => (k > 0 ? sections[k - 1].exitM : 0);
    const kinds = stored.kinds;
    const onsets = new Map(
      laps.map(l => {
        const trace = pedalTrace(l, lengthM);
        return [
          l,
          sections.map(
            (s, k) => onsetsOfLaps([trace], s, prev(k), kinds[k]).onsetsM[0],
          ),
        ];
      }),
    );
    return {
      state: stored,
      windows: windowsOf(stored, sections, lengthM),
      onsets,
      moved: false,
      changed: false,
    };
  }
  // Boundaries kept for another map are replaced, with a higher rev.
  const usable = stored && stored.mapKey === key ? stored : null;
  const old = stored && !usable ? {...stored, v: 0} : stored;
  const traces = new Map(laps.map(l => [l, pedalTrace(l, lengthM)]));
  const pooled = laps.filter(measures);
  const prevExit = k => (k > 0 ? sections[k - 1].exitM : 0);
  // Both kinds of onset for every pooled lap: the layout decides which one a
  // section is by the majority of every lap it has seen (foldBoundaries).
  const measured = sections.map((s, k) =>
    lapOnsets(
      pooled.map(l => traces.get(l)),
      s,
      prevExit(k),
    ),
  );
  const fold = foldBoundaries({
    sections,
    stored: usable ?? old ?? null,
    sessionId,
    pools: onsetPools(sections, measured),
    ...opts,
  });
  const state = {...fold.boundaries, mapKey: key};
  // Every lap's own onset per section, with the layout's kinds.
  const kindsNow = state.kinds;
  const onsets = new Map(
    laps.map(l => [
      l,
      sections.map(
        (s, k) =>
          onsetsOfLaps([traces.get(l)], s, prevExit(k), kindsNow[k]).onsetsM[0],
      ),
    ]),
  );
  return {
    state,
    windows: windowsOf(state, sections, lengthM),
    onsets,
    moved: fold.moved,
    changed: fold.changed || !usable,
  };
}

// Stored form: Firestore takes no array inside an array, and a session's pools
// are mostly empty bins, so each pool keeps only the bins that hold laps
// ({"12": 3} is three laps in bin 12), by session id.
export function packState(state) {
  const sparse = counts => {
    const nz = {};
    counts.forEach((c, i) => {
      if (c > 0) nz[i] = c;
    });
    return nz;
  };
  const sessions = {};
  for (const [id, pools] of Object.entries(state.sessions)) {
    sessions[id] = pools.map(p => ({
      laps: p.laps,
      braked: p.braked,
      speedKmh: p.speedKmh,
      binFromM: p.binFromM,
      size: p.brake.length,
      brake: sparse(p.brake),
      lift: sparse(p.lift),
    }));
  }
  return {...state, sessions};
}

/** The inverse of `packState`; null for nothing stored. */
export function unpackState(doc) {
  if (!doc) return null;
  const dense = (nz, size) => {
    const counts = new Array(size).fill(0);
    for (const [i, c] of Object.entries(nz ?? {})) counts[Number(i)] = c;
    return counts;
  };
  const sessions = {};
  for (const [id, pools] of Object.entries(doc.sessions ?? {})) {
    sessions[id] = pools.map(p => ({
      laps: p.laps,
      braked: p.braked,
      speedKmh: p.speedKmh ?? null,
      binFromM: p.binFromM,
      brake: dense(p.brake, p.size),
      lift: dense(p.lift, p.size),
    }));
  }
  return {...doc, sessions};
}

/**
 * Whether a session's corner times were cut at boundaries older than the
 * layout's now: it records the rev it used (none before boundaries existed),
 * and the layout's rev only goes up when a start moved by more than its margin.
 */
export const staleRev = (sessionRev, layoutRev) =>
  layoutRev != null && (sessionRev ?? 0) < layoutRev;
