// Plans for changing a track in the curated catalog (pit wall thread 2 #204 to
// #210). A plan is made from what is live and what the curator proposes, writes
// nothing, and says what would change, what is refused, and how many sessions
// across all users it would send back through analysis. Pure.
//
//   planAdd      an unknown track becomes curated, from a chosen session
//   planReplace  a curated track's map is replaced, from a chosen session
//   planRefold   a curated track's boundaries are refolded from chosen sessions
//   planUndo     the track goes back to an earlier rev, as a new rev
//
// `current` is {track, boundaries, catalogRev}: the live track doc (or null),
// the live boundaries doc (or null), and the track's catalogRev (0 for none).
// `built` is what the loader made from the chosen recordings:
//   {map, boundaries (the folded state), lapsUsed, gps, sessionId, sim, track: {name, variant}}
// `samples` are the lap lengths (m) of the user sessions already on this track,
// `blast` is {sessions: n}.
import {windowsOf} from '../../src/analysis/cornerBoundaries.ts';
import {MAP_MIN_LAPS} from '../sessions/analyze.mjs';
import {mapKeyOf, packState} from '../sessions/layoutBoundaries.mjs';
import {
  describeMap,
  diffBoundaries,
  diffMaps,
  renderBoundaryDiff,
  renderMapDiff,
} from './diff.mjs';

export const MIN_LAPS_FOR_MAP = MAP_MIN_LAPS;
/** A new map's length may differ from the median of the user sessions by this much. */
export const LENGTH_TOLERANCE = 0.01;
/** The fewest user sessions the length can be compared against. */
export const MIN_LENGTH_SAMPLES = 3;
/** How many sessions a user's tray re-analyses per run after a change (#293). */
export const RESYNC_PER_RUN = 25;

/** What the curator owns on a track doc; everything else on it survives. */
export const CURATED_FIELDS = [
  'mapVersion',
  'lengthM',
  'stepM',
  'corners',
  'source',
  'boundaries',
  'catalogRev',
  'curatedAt',
  'curatedBy',
];
const META = ['catalogRev', 'curatedAt', 'curatedBy'];

/** The curated part of a track doc, as it is now. */
export function curatedOf(track) {
  const out = {};
  for (const k of CURATED_FIELDS)
    if (track && track[k] !== undefined) out[k] = track[k];
  return out;
}

const median = xs => {
  const s = [...xs].sort((a, b) => a - b);
  const h = s.length >> 1;
  return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2;
};

function start(kind, trackId, current, blast) {
  return {
    kind,
    trackId,
    expectedRev: current.catalogRev ?? 0,
    newRev: (current.catalogRev ?? 0) + 1,
    refusals: [],
    warnings: [],
    blast: blast ?? null,
    diff: {map: null, boundaries: null},
    set: {},
    deleteFields: [],
    boundaries: {action: 'keep', doc: null},
    // The state being replaced, kept in the history before anything changes.
    before: {
      curated: curatedOf(current.track),
      boundaries: current.boundaries ?? null,
    },
  };
}

const hasMap = track => Boolean(track && track.corners && track.corners.length);

/** What is wrong with a map made from a session, before it can become official. */
function checkBuilt(plan, built, samples) {
  if (!built || !built.map) {
    plan.refusals.push(
      'no corner map could be built from this session (too few clean laps of one length, or no usable lap)',
    );
    return;
  }
  if (!built.gps)
    plan.refusals.push(
      'this session has no GPS (Lat/Lon), so no map can be made from it',
    );
  // A map without its boundaries looks curated, but a catalog-only analysis
  // needs this map's boundaries too (#293), so every tray would give "none".
  if (!built.boundaries)
    plan.refusals.push(
      'no corner boundaries could be made with this map (the session gave none): a map without its boundaries would leave every analysis without corners',
    );
  if (built.lapsUsed < MIN_LAPS_FOR_MAP)
    plan.refusals.push(
      `only ${built.lapsUsed} clean laps of one length, ${MIN_LAPS_FOR_MAP} are needed for a map`,
    );
  const lengths = (samples ?? []).filter(Number.isFinite);
  if (lengths.length >= MIN_LENGTH_SAMPLES) {
    const mid = median(lengths);
    const off = Math.abs(built.map.lengthM - mid) / mid;
    if (off > LENGTH_TOLERANCE)
      plan.refusals.push(
        `the map's lap length (${
          built.map.lengthM
        } m) differs from the median of the ${
          lengths.length
        } user sessions on this track (${Math.round(mid * 10) / 10} m) by ${(
          off * 100
        ).toFixed(1)}%, more than ${
          LENGTH_TOLERANCE * 100
        }%: a pit-lane or shortcut lap must not become the official map`,
      );
  } else {
    plan.warnings.push(
      `only ${lengths.length} user session(s) on this track to compare the lap length with (${MIN_LENGTH_SAMPLES} are needed for the length check)`,
    );
  }
}

/** The boundaries that go with a map: the summary on the track doc and the stored doc. */
function boundariesFor(plan, built, current, map) {
  const state = {...built.boundaries};
  // The rev only ever goes up, so nothing recorded against an older rev can
  // look current again.
  state.rev = Math.max(state.rev ?? 1, (current.boundaries?.rev ?? 0) + 1);
  state.mapKey = mapKeyOf(map.corners);
  plan.set.boundaries = {
    v: state.v,
    rev: state.rev,
    startsM: state.startsM,
    marginM: state.marginM,
    windows: windowsOf(state, map.corners, map.lengthM),
  };
  plan.boundaries = {action: 'set', doc: packState(state)};
  plan.diff.boundaries = diffBoundaries(current.boundaries ?? null, state);
}

export function planAdd({trackId, current, built, samples, blast}) {
  const plan = start('add', trackId, current, blast);
  if (hasMap(current.track))
    plan.refusals.push(
      `${trackId} already has a curated map (rev ${plan.expectedRev}): use plan-replace`,
    );
  checkBuilt(plan, built, samples);
  if (built?.map) {
    plan.diff.map = diffMaps(null, built.map);
    plan.set = {
      id: trackId,
      sim: built.sim,
      track: built.track,
      mapVersion: built.map.mapVersion,
      lengthM: built.map.lengthM,
      stepM: built.map.stepM,
      corners: built.map.corners,
    };
    if (built.boundaries) boundariesFor(plan, built, current, built.map);
  }
  return plan;
}

export function planReplace({
  trackId,
  current,
  built,
  samples,
  blast,
  allowRenumber = false,
}) {
  const plan = start('replace', trackId, current, blast);
  if (!hasMap(current.track))
    plan.refusals.push(`${trackId} has no curated map yet: use plan-add`);
  checkBuilt(plan, built, samples);
  if (built?.map) {
    plan.diff.map = diffMaps(current.track ?? null, built.map);
    if (plan.diff.map.renumbered.length && !allowRenumber)
      plan.refusals.push(
        `this would renumber corners (${plan.diff.map.renumbered
          .map(r => `T${r.from} -> T${r.to}`)
          .join(
            ', ',
          )}): every user's comparisons are keyed on corner numbers. Re-run with --allow-renumber if that is what you mean`,
      );
    if (plan.diff.map.removed.length)
      plan.warnings.push(
        `corners removed: ${plan.diff.map.removed
          .map(n => `T${n}`)
          .join(', ')}`,
      );
    plan.set = {
      mapVersion: built.map.mapVersion,
      lengthM: built.map.lengthM,
      stepM: built.map.stepM,
      corners: built.map.corners,
    };
    plan.deleteFields.push('source');
    if (built.boundaries) boundariesFor(plan, built, current, built.map);
  }
  return plan;
}

export function planRefold({trackId, current, built, blast}) {
  const plan = start('refold', trackId, current, blast);
  if (!hasMap(current.track)) {
    plan.refusals.push(
      `${trackId} has no curated map: boundaries belong to a map, use plan-add first`,
    );
    return plan;
  }
  if (!built?.boundaries) {
    plan.refusals.push(
      'the chosen sessions gave no boundaries (no laps that fit the track map)',
    );
    return plan;
  }
  const key = mapKeyOf(current.track.corners);
  if (built.boundaries.mapKey !== key)
    plan.refusals.push(
      'the boundaries were folded onto a different map than the live one',
    );
  plan.diff.map = diffMaps(current.track, current.track);
  boundariesFor(plan, built, current, current.track);
  if (
    plan.diff.boundaries &&
    plan.diff.boundaries.moved === 0 &&
    plan.diff.boundaries.revFrom !== null
  )
    plan.warnings.push(
      'no section start moved by more than its margin: this changes the rev but not what users see',
    );
  return plan;
}

export function planUndo({trackId, current, history, toRev, blast}) {
  const plan = start('undo', trackId, current, blast);
  const target = toRev ?? plan.expectedRev - 1;
  if (plan.expectedRev === 0) {
    plan.refusals.push(`${trackId} has no history to undo`);
    return plan;
  }
  if (!(target >= 0 && target < plan.expectedRev)) {
    plan.refusals.push(
      `rev ${target} is not an earlier rev of ${trackId} (it is at rev ${plan.expectedRev})`,
    );
    return plan;
  }
  const entry = history.get(target);
  if (!entry) {
    plan.refusals.push(`the history has no rev ${target} of ${trackId}`);
    return plan;
  }
  const snap = entry.snapshot;
  plan.restoresRev = target;
  // The curated fields come back as they were; fields that did not exist then
  // are removed; the meta fields describe this change.
  for (const k of CURATED_FIELDS) {
    if (META.includes(k)) continue;
    if (snap.curated[k] !== undefined) plan.set[k] = snap.curated[k];
    else if (current.track && current.track[k] !== undefined)
      plan.deleteFields.push(k);
  }
  plan.boundaries = snap.boundaries
    ? {action: 'set', doc: snap.boundaries}
    : {action: 'delete', doc: null};
  plan.diff.map = diffMaps(
    hasMap(current.track) ? current.track : null,
    snap.curated.corners ? snap.curated : null,
  );
  plan.diff.boundaries = diffBoundaries(
    current.boundaries ?? null,
    snap.boundaries ?? null,
  );
  const same =
    JSON.stringify(curatedWithoutMeta(snap.curated)) ===
      JSON.stringify(curatedWithoutMeta(curatedOf(current.track))) &&
    JSON.stringify(snap.boundaries ?? null) ===
      JSON.stringify(current.boundaries ?? null);
  if (same)
    plan.refusals.push(
      `rev ${target} is the same as what is live: nothing to undo`,
    );
  return plan;
}

const curatedWithoutMeta = c =>
  Object.fromEntries(Object.entries(c).filter(([k]) => !META.includes(k)));

/** The plan as lines for the curator. */
export function renderPlan(plan) {
  const lines = [];
  const verb = {
    add: 'ADD',
    replace: 'REPLACE the map of',
    refold: 'REFOLD the boundaries of',
    undo: 'UNDO to an earlier rev of',
  }[plan.kind];
  lines.push(
    `${verb} ${plan.trackId}: catalogRev ${plan.expectedRev} -> ${plan.newRev}${
      plan.restoresRev !== undefined
        ? ` (restores rev ${plan.restoresRev})`
        : ''
    }`,
  );
  if (plan.kind === 'add' && plan.set.corners)
    lines.push(
      ...describeMap({lengthM: plan.set.lengthM, corners: plan.set.corners}),
    );
  else if (plan.diff.map) {
    const d = renderMapDiff(plan.diff.map);
    lines.push(...(d.length ? d : ['the map does not change']));
  }
  if (plan.diff.boundaries) {
    const d = renderBoundaryDiff(plan.diff.boundaries);
    lines.push(...(d.length ? d : ['the boundaries do not change']));
  }
  if (plan.blast) {
    lines.push(
      `blast radius: ${plan.blast.sessions} session(s) across all users are on this track; their trays will re-analyse them (at most ${RESYNC_PER_RUN} per run each, newest first, while the local files exist)`,
    );
  }
  for (const w of plan.warnings) lines.push(`warning: ${w}`);
  for (const r of plan.refusals) lines.push(`REFUSED: ${r}`);
  return lines;
}

/** One line for the history. */
export function summaryOf(plan) {
  const parts = [];
  if (plan.diff.map) {
    const d = plan.diff.map;
    if (plan.kind === 'add')
      parts.push(
        `new map, ${plan.set.corners?.length ?? 0} corners, ${
          plan.set.lengthM
        } m`,
      );
    else
      parts.push(
        `${d.moved.length} corner edge(s) moved, ${d.added.length} added, ${d.removed.length} removed`,
      );
  }
  if (plan.diff.boundaries)
    parts.push(
      `boundaries rev ${plan.diff.boundaries.revFrom ?? 'none'} -> ${
        plan.diff.boundaries.revTo ?? 'none'
      }, ${plan.diff.boundaries.moved} section(s) moved`,
    );
  return `${plan.kind}: ${parts.join('; ')}`;
}
