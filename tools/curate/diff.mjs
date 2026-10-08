// What a curator reads before applying a change to a track (pit wall thread 2
// #204 to #210): the corner map and the layout boundaries, described and
// compared in plain words. Pure.
//
// A map is {lengthM, corners: [{n, entryM, turnInM, apexM, exitM, parts}]};
// boundaries are {rev, mapKey, startsM: [m per section], marginM: [m per section]}.

/** Corners within this many metres of each other (apex to apex) are the same corner. */
export const MATCH_M = 60;
/** A change smaller than this is not worth listing. */
const MOVED_M = 0.5;

const m1 = x => (Math.round(x * 10) / 10).toString();

/** The map in lines: length, then one line per corner. */
export function describeMap(map) {
  if (!map) return ['no corner map'];
  const lines = [
    `lap length ${m1(map.lengthM)} m, ${map.corners.length} corners`,
  ];
  for (const c of map.corners) {
    const parts =
      c.parts && c.parts.length > 1 ? `, ${c.parts.length} parts` : '';
    lines.push(
      `  T${c.n}: turn-in ${m1(c.turnInM)} m, apex ${m1(c.apexM)} m, exit ${m1(
        c.exitM,
      )} m${parts}`,
    );
  }
  return lines;
}

/**
 * Pairs each old corner with the nearest new corner by apex, within MATCH_M,
 * each new corner used once. Returns {pairs: [[old, new]], removed, added}.
 */
export function matchCorners(oldCorners, newCorners) {
  const taken = new Set();
  const pairs = [];
  const removed = [];
  for (const o of oldCorners) {
    let best = null;
    for (const n of newCorners) {
      if (taken.has(n)) continue;
      const d = Math.abs(n.apexM - o.apexM);
      if (d <= MATCH_M && (!best || d < best.d)) best = {n, d};
    }
    if (best) {
      taken.add(best.n);
      pairs.push([o, best.n]);
    } else removed.push(o);
  }
  const added = newCorners.filter(n => !taken.has(n));
  return {pairs, removed, added};
}

/**
 * The difference between two maps (either may be null: no map).
 *   moved       [{n, what, from, to}] a turn-in, apex or exit that moved
 *   added       [corner numbers] corners in the new map with no old one
 *   removed     [corner numbers] old corners with no new one
 *   renumbered  [{from, to}] an old corner that is the same place but has a
 *               new number: corner numbers are what every user's comparisons
 *               are keyed on, so this is what a curator must not do by accident
 */
export function diffMaps(oldMap, newMap) {
  if (!oldMap || !newMap) {
    return {
      oldLengthM: oldMap?.lengthM ?? null,
      newLengthM: newMap?.lengthM ?? null,
      lengthDeltaM: null,
      moved: [],
      added: (newMap?.corners ?? []).map(c => c.n),
      removed: (oldMap?.corners ?? []).map(c => c.n),
      renumbered: [],
    };
  }
  const {pairs, removed, added} = matchCorners(oldMap.corners, newMap.corners);
  const moved = [];
  const renumbered = [];
  for (const [o, n] of pairs) {
    if (o.n !== n.n) renumbered.push({from: o.n, to: n.n});
    for (const [what, key] of [
      ['turn-in', 'turnInM'],
      ['apex', 'apexM'],
      ['exit', 'exitM'],
    ]) {
      if (Math.abs(n[key] - o[key]) >= MOVED_M)
        moved.push({n: o.n, what, from: o[key], to: n[key]});
    }
  }
  return {
    oldLengthM: oldMap.lengthM,
    newLengthM: newMap.lengthM,
    lengthDeltaM: newMap.lengthM - oldMap.lengthM,
    moved,
    added: added.map(c => c.n),
    removed: removed.map(c => c.n),
    renumbered,
  };
}

/** The map difference in lines; empty when nothing changed. */
export function renderMapDiff(d) {
  const lines = [];
  if (d.lengthDeltaM !== null && Math.abs(d.lengthDeltaM) >= MOVED_M)
    lines.push(
      `lap length ${m1(d.oldLengthM)} m -> ${m1(d.newLengthM)} m (${
        d.lengthDeltaM > 0 ? '+' : ''
      }${m1(d.lengthDeltaM)} m)`,
    );
  for (const r of d.renumbered)
    lines.push(
      `RENUMBERED: the corner that was T${r.from} would become T${r.to}`,
    );
  for (const mv of d.moved)
    lines.push(
      `T${mv.n} ${mv.what} ${m1(mv.from)} m -> ${m1(mv.to)} m (${
        mv.to > mv.from ? '+' : ''
      }${m1(mv.to - mv.from)} m)`,
    );
  if (d.added.length)
    lines.push(`added: ${d.added.map(n => `T${n}`).join(', ')}`);
  if (d.removed.length)
    lines.push(`removed: ${d.removed.map(n => `T${n}`).join(', ')}`);
  return lines;
}

/**
 * The difference between two boundary states, a section at a time (either may
 * be null). A start that moved by more than its margin is "moved" (sessions cut
 * at the old one are stale); within the margin it is "within".
 */
export function diffBoundaries(oldB, newB) {
  const sections = Math.max(
    oldB?.startsM?.length ?? 0,
    newB?.startsM?.length ?? 0,
  );
  const rows = [];
  for (let k = 0; k < sections; k++) {
    const from = oldB?.startsM?.[k] ?? null;
    const to = newB?.startsM?.[k] ?? null;
    const margin = oldB?.marginM?.[k] ?? newB?.marginM?.[k] ?? null;
    let status = 'same';
    if (from === null) status = 'new';
    else if (to === null) status = 'removed';
    else if (Math.abs(to - from) > (margin ?? 0)) status = 'moved';
    else if (Math.abs(to - from) >= MOVED_M) status = 'within';
    rows.push({section: k + 1, from, to, marginM: margin, status});
  }
  return {
    revFrom: oldB?.rev ?? null,
    revTo: newB?.rev ?? null,
    rows,
    moved: rows.filter(r => r.status === 'moved').length,
    mapChanged: Boolean(oldB && newB && oldB.mapKey !== newB.mapKey),
  };
}

export function renderBoundaryDiff(d) {
  const lines = [];
  if (d.revFrom !== d.revTo)
    lines.push(`boundaries rev ${d.revFrom ?? 'none'} -> ${d.revTo ?? 'none'}`);
  for (const r of d.rows) {
    if (r.status === 'same') continue;
    const margin = r.marginM === null ? '' : `, margin ${m1(r.marginM)} m`;
    if (r.status === 'new')
      lines.push(`section ${r.section}: window start ${m1(r.to)} m (new)`);
    else if (r.status === 'removed')
      lines.push(`section ${r.section}: window removed (was ${m1(r.from)} m)`);
    else
      lines.push(
        `section ${r.section}: window start ${m1(r.from)} m -> ${m1(
          r.to,
        )} m${margin} (${r.status})`,
      );
  }
  if (d.mapChanged)
    lines.push(
      'the boundaries belong to a different map than the ones they replace',
    );
  return lines;
}
