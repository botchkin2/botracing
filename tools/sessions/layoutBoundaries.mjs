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

const median = values => {
  const v = values.filter(Number.isFinite).sort((a, b) => a - b);
  return v.length ? v[v.length >> 1] : 0;
};

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
 * minimums (`minLaps`, `minSessions`), for tests.
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
}) {
  const sections = map.corners;
  const lengthM = map.lengthM;
  const key = mapKeyOf(sections);
  // Boundaries kept for another map are replaced, with a higher rev.
  const usable = stored && stored.mapKey === key ? stored : null;
  const old = stored && !usable ? {...stored, v: 0} : stored;
  const traces = new Map(laps.map(l => [l, pedalTrace(l, lengthM)]));
  const pooled = laps.filter(measures);
  const kinds = usable?.kinds ?? null;
  const prevExit = k => (k > 0 ? sections[k - 1].exitM : 0);
  const decided = sections.map((s, k) =>
    onsetsOfLaps(
      pooled.map(l => traces.get(l)),
      s,
      prevExit(k),
      kinds?.[k],
    ),
  );
  const speed = Array.from({length: Math.ceil(lengthM / GRID_M) + 1}, (_, g) =>
    median(pooled.map(l => l.grid.speed[g])),
  );
  const speedKmhAt = m =>
    speed[Math.min(speed.length - 1, Math.max(0, Math.round(m / GRID_M)))];
  const fold = foldBoundaries({
    sections,
    stored: usable ?? old ?? null,
    sessionId,
    pools: onsetPools(sections, decided),
    speedKmhAt,
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
  const sessions = {};
  for (const [id, pools] of Object.entries(state.sessions)) {
    sessions[id] = pools.map(p => {
      const nz = {};
      p.counts.forEach((c, i) => {
        if (c > 0) nz[i] = c;
      });
      return {kind: p.kind, binFromM: p.binFromM, size: p.counts.length, nz};
    });
  }
  return {...state, sessions};
}

/** The inverse of `packState`; null for nothing stored. */
export function unpackState(doc) {
  if (!doc) return null;
  const sessions = {};
  for (const [id, pools] of Object.entries(doc.sessions ?? {})) {
    sessions[id] = pools.map(p => {
      const counts = new Array(p.size).fill(0);
      for (const [i, c] of Object.entries(p.nz ?? {})) counts[Number(i)] = c;
      return {kind: p.kind, binFromM: p.binFromM, counts};
    });
  }
  return {...doc, sessions};
}
