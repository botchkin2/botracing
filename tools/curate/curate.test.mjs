import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {MAP_MIN_LAPS} from '../sessions/analyze.mjs';
import {catalogStamp} from '../sessions/catalogStamp.mjs';
import {
  mapKeyOf,
  sessionBoundaries,
  unpackState,
} from '../sessions/layoutBoundaries.mjs';
import {LENGTH_M, makeLap, map as synthMap} from '../sessions/syntheticLap.mjs';
import {PlanRefused, applyPlan} from './apply.mjs';
import {
  describeMap,
  diffBoundaries,
  diffMaps,
  matchCorners,
  renderBoundaryDiff,
  renderMapDiff,
} from './diff.mjs';
import {memoryCatalog} from './fixture.mjs';
import {
  CURATED_FIELDS,
  MIN_LAPS_FOR_MAP,
  planAdd,
  planRefold,
  planReplace,
  planUndo,
  renderPlan,
} from './plan.mjs';

// -- the map and boundaries a loader would hand in ------------------------------------

const corner = (n, apexM) => ({
  n,
  entryM: apexM - 110,
  turnInM: apexM - 60,
  apexM,
  exitM: apexM + 60,
  parts: [{n}],
});
const mapOf = (...apexes) => ({
  mapVersion: 4,
  lengthM: LENGTH_M,
  stepM: 5,
  corners: apexes.map((a, i) => corner(i + 1, a)),
});
const foldState = (
  map,
  brakes = [
    [650, 1450],
    [652, 1452],
    [648, 1448],
  ],
  stored = null,
) =>
  sessionBoundaries({
    laps: brakes.map(([a, b]) => makeLap(a, b).lap),
    map: {lengthM: map.lengthM, corners: synthMap.corners},
    stored,
    sessionId: 'built',
    fold: {minLaps: 1, minSessions: 1},
  }).state;

// The synthetic lap runs on the synthetic map's two corners; the curated map the
// tests move around uses the same corners so boundaries and map agree.
const MAP = {
  mapVersion: 4,
  lengthM: synthMap.lengthM,
  stepM: 5,
  corners: synthMap.corners,
};
const built = (overrides = {}) => ({
  map: MAP,
  boundaries: foldState(MAP),
  lapsUsed: 14,
  gps: true,
  sessionId: 'sess-1',
  sim: 'lmu',
  track: {name: 'Road Atlanta', variant: 'Road Atlanta'},
  ...overrides,
});
const NONE = {track: null, boundaries: null, catalogRev: 0};
const samples = [2000, 2004, 1998, 2001];

// -- diffs ------------------------------------------------------------------------------

test('a map is described in lines, and a missing map says so', () => {
  const lines = describeMap(MAP);
  assert.equal(lines[0], `lap length ${LENGTH_M} m, 2 corners`);
  assert.match(lines[1], /^  T1: turn-in 700 m, apex 760 m, exit 820 m$/);
  assert.deepEqual(describeMap(null), ['no corner map']);
});

test('corners are matched by apex, a corner that moved is moved, not new', () => {
  const a = mapOf(500, 1200, 1800);
  const b = mapOf(520, 1195, 1800);
  const d = diffMaps(a, b);
  assert.deepEqual(d.moved.map(x => [x.n, x.what, x.from, x.to]).slice(0, 3), [
    [1, 'turn-in', 440, 460],
    [1, 'apex', 500, 520],
    [1, 'exit', 560, 580],
  ]);
  assert.deepEqual([d.added, d.removed, d.renumbered], [[], [], []]);
  assert.equal(d.lengthDeltaM, 0);
  const lines = renderMapDiff(d);
  assert.ok(lines.includes('T1 apex 500 m -> 520 m (+20 m)'), lines.join('\n'));
  assert.equal(
    renderMapDiff(diffMaps(a, a)).length,
    0,
    'identical maps: nothing to say',
  );
});

test('a corner inserted before others renumbers them; one added at the end does not', () => {
  const base = mapOf(500, 1200, 1800);
  const inserted = {
    ...base,
    corners: [corner(1, 500), corner(2, 900), corner(3, 1200), corner(4, 1800)],
  };
  const d = diffMaps(base, inserted);
  assert.deepEqual(d.added, [2], 'the new corner is T2');
  assert.deepEqual(d.renumbered, [
    {from: 2, to: 3},
    {from: 3, to: 4},
  ]);
  assert.ok(
    renderMapDiff(d).some(l =>
      l.startsWith('RENUMBERED: the corner that was T2 would become T3'),
    ),
  );
  const atEnd = {...base, corners: [...base.corners, corner(4, 1950)]};
  const e = diffMaps(base, atEnd);
  assert.deepEqual([e.added, e.renumbered], [[4], []]);
  const removed = {...base, corners: [corner(1, 500), corner(2, 1800)]};
  const f = diffMaps(base, removed);
  assert.deepEqual(f.removed, [2]);
  assert.deepEqual(
    f.renumbered,
    [{from: 3, to: 2}],
    'T3 closing up to T2 is a renumbering too',
  );
  assert.deepEqual(
    matchCorners([corner(1, 500)], [corner(1, 600)]).pairs.length,
    0,
    'beyond 60 m is a different corner',
  );
});

test('boundaries: a start beyond its margin is moved, inside it within, and the rev is shown', () => {
  const oldB = {rev: 2, mapKey: 'k', startsM: [880, 1500], marginM: [12, 10]};
  const newB = {rev: 3, mapKey: 'k', startsM: [892.5, 1503], marginM: [12, 10]};
  const d = diffBoundaries(oldB, newB);
  assert.deepEqual(
    d.rows.map(r => r.status),
    ['moved', 'within'],
  );
  assert.equal(d.moved, 1);
  const lines = renderBoundaryDiff(d);
  assert.ok(lines.includes('boundaries rev 2 -> 3'));
  assert.ok(
    lines.some(l =>
      l.includes(
        'section 1: window start 880 m -> 892.5 m, margin 12 m (moved)',
      ),
    ),
  );
  assert.equal(
    diffBoundaries(oldB, oldB).rows.every(r => r.status === 'same'),
    true,
  );
  assert.deepEqual(
    diffBoundaries(null, newB).rows.map(r => r.status),
    ['new', 'new'],
  );
  assert.equal(
    diffBoundaries(oldB, {...newB, mapKey: 'other'}).mapChanged,
    true,
  );
});

// -- plans ----------------------------------------------------------------------------------

test('adding an unknown track: the plan carries the map, its boundaries and the blast radius, and refuses nothing', () => {
  const p = planAdd({
    trackId: 'lmu-road-atlanta',
    current: NONE,
    built: built(),
    samples,
    blast: {sessions: 37},
  });
  assert.deepEqual(p.refusals, []);
  assert.equal(p.kind, 'add');
  assert.deepEqual([p.expectedRev, p.newRev], [0, 1]);
  assert.equal(p.set.id, 'lmu-road-atlanta');
  assert.equal(p.set.corners.length, 2);
  assert.equal(p.boundaries.action, 'set');
  assert.equal(p.set.boundaries.rev, 1, 'a first layout starts at rev 1');
  assert.equal(p.boundaries.doc.mapKey, mapKeyOf(MAP.corners));
  const lines = renderPlan(p);
  assert.match(lines[0], /^ADD lmu-road-atlanta: catalogRev 0 -> 1/);
  assert.ok(lines.some(l => l.startsWith('  T1: turn-in 700 m')));
  assert.ok(
    lines.some(l => l.includes('blast radius: 37 session(s) across all users')),
  );
  assert.ok(lines.some(l => l.includes('at most 25 per run')));
  assert.equal(
    lines.some(l => l.startsWith('REFUSED')),
    false,
  );
});

test('a map is refused for too few laps, no GPS, no map, a wrong length, or when the track already has one', () => {
  const refusal = (extra, args = {}) =>
    planAdd({
      trackId: 't',
      current: NONE,
      built: built(extra),
      samples,
      ...args,
    }).refusals.join(' | ');
  assert.equal(
    MIN_LAPS_FOR_MAP,
    MAP_MIN_LAPS,
    'the threshold is the analysis one',
  );
  assert.match(
    refusal({lapsUsed: 6}),
    /only 6 clean laps of one length, 8 are needed/,
  );
  assert.match(refusal({gps: false}), /no GPS/);
  assert.match(
    planAdd({trackId: 't', current: NONE, built: built({map: null}), samples})
      .refusals[0],
    /no corner map could be built/,
  );
  // The official map must not be a pit-lane or shortcut lap: the length is checked against the user sessions.
  assert.match(
    refusal({map: {...MAP, lengthM: 2200}}),
    /differs from the median of the 4 user sessions[^|]*by 10.0%[^|]*pit-lane or shortcut/,
  );
  assert.equal(
    refusal({map: {...MAP, lengthM: 2015}}),
    '',
    '0.8% off the median is fine',
  );
  assert.match(
    refusal(
      {},
      {
        current: {
          track: {corners: MAP.corners},
          boundaries: null,
          catalogRev: 3,
        },
      },
    ),
    /already has a curated map \(rev 3\): use plan-replace/,
  );
});

test('with too few user sessions to compare the length, that is a warning, not a refusal', () => {
  const p = planAdd({
    trackId: 't',
    current: NONE,
    built: built(),
    samples: [2000],
  });
  assert.deepEqual(p.refusals, []);
  assert.ok(
    p.warnings.some(w =>
      w.includes(
        'only 1 user session(s) on this track to compare the lap length with',
      ),
    ),
  );
});

const live = (extra = {}) => ({
  track: {
    id: 't',
    corners: MAP.corners,
    lengthM: MAP.lengthM,
    mapVersion: 4,
    catalogRev: 2,
    georef: {x: 1},
    ...extra,
  },
  boundaries: {...foldState(MAP), rev: 3},
  catalogRev: 2,
});

test('replacing a map shows what moved, keeps numbers stable, and refuses a renumbering unless allowed', () => {
  const moved = {
    ...MAP,
    corners: MAP.corners.map((c, i) =>
      i === 0 ? {...c, apexM: c.apexM + 14, exitM: c.exitM + 14} : c,
    ),
  };
  const p = planReplace({
    trackId: 't',
    current: live(),
    built: built({map: moved}),
    samples,
  });
  assert.deepEqual(p.refusals, []);
  assert.deepEqual([p.expectedRev, p.newRev], [2, 3]);
  assert.ok(
    renderPlan(p).some(l => l.startsWith('T1 apex 760 m -> 774 m (+14 m)')),
  );
  assert.equal(
    p.set.boundaries.rev,
    4,
    'the boundaries rev only goes up: 3 -> 4',
  );
  assert.ok(
    !('id' in p.set) && !('georef' in p.set),
    'only the curated fields are written; georef etc. survive',
  );

  const renumbered = {
    ...MAP,
    corners: [
      {...MAP.corners[0], n: 2},
      {...MAP.corners[1], n: 3},
    ],
  };
  const bad = planReplace({
    trackId: 't',
    current: live(),
    built: built({map: renumbered}),
    samples,
  });
  assert.ok(
    bad.refusals.some(
      r =>
        r.includes('would renumber corners (T1 -> T2, T2 -> T3)') &&
        r.includes('--allow-renumber'),
    ),
  );
  const ok = planReplace({
    trackId: 't',
    current: live(),
    built: built({map: renumbered}),
    samples,
    allowRenumber: true,
  });
  assert.deepEqual(ok.refusals, []);
  assert.match(
    planReplace({trackId: 't', current: NONE, built: built(), samples})
      .refusals[0],
    /has no curated map yet: use plan-add/,
  );
});

test('refolding boundaries needs the live map, folds onto it, and warns when nothing moved by more than its margin', () => {
  const same = planRefold({
    trackId: 't',
    current: live(),
    built: built({boundaries: foldState(MAP)}),
  });
  assert.deepEqual(same.refusals, []);
  assert.equal(same.boundaries.action, 'set');
  assert.equal(same.set.boundaries.rev, 4);
  assert.ok(
    same.warnings.some(w =>
      w.includes('no section start moved by more than its margin'),
    ),
  );
  assert.equal(same.set.corners, undefined, 'the map is untouched');
  const other = planRefold({
    trackId: 't',
    current: live(),
    built: built({boundaries: {...foldState(MAP), mapKey: 'another'}}),
  });
  assert.ok(
    other.refusals.some(r => r.includes('different map than the live one')),
  );
  assert.match(
    planRefold({trackId: 't', current: NONE, built: built()}).refusals[0],
    /has no curated map/,
  );
  assert.match(
    planRefold({trackId: 't', current: live(), built: {boundaries: null}})
      .refusals[0],
    /gave no boundaries/,
  );
});

// -- apply and the flows --------------------------------------------------------------------------

const BY = 'botkin@example.com';
let clock = 0;
const now = () => `2026-10-06T00:00:${String(clock++).padStart(2, '0')}.000Z`;

async function planOn(catalog, kind, args) {
  const current = await catalog.readCatalog('t');
  const blast = {sessions: await catalog.sessionCount('t')};
  const samplesNow = await catalog.sessionLengths('t');
  if (kind === 'add')
    return planAdd({
      trackId: 't',
      current,
      built: args.built,
      samples: samplesNow,
      blast,
    });
  if (kind === 'replace')
    return planReplace({
      trackId: 't',
      current,
      built: args.built,
      samples: samplesNow,
      blast,
      allowRenumber: args.allowRenumber,
    });
  if (kind === 'refold')
    return planRefold({trackId: 't', current, built: args.built, blast});
  return planUndo({
    trackId: 't',
    current,
    history: await catalog.readHistory('t'),
    toRev: args.toRev,
    blast,
  });
}

test('a dry run writes nothing: planning only reads', async () => {
  const catalog = memoryCatalog({lengths: {t: samples}, counts: {t: 5}});
  const before = structuredClone([...catalog.state.tracks]);
  const p = await planOn(catalog, 'add', {built: built()});
  assert.equal(p.refusals.length, 0);
  assert.equal(catalog.commits, 0);
  assert.deepEqual([...catalog.state.tracks], before);
  assert.equal(catalog.state.history.size, 0);
});

test('apply needs a clean plan, a reason and a name, and a stale plan writes nothing', async () => {
  const catalog = memoryCatalog({lengths: {t: samples}});
  const p = await planOn(catalog, 'add', {built: built()});
  await assert.rejects(applyPlan(catalog, p, {by: BY}), /needs --reason/);
  await assert.rejects(
    applyPlan(catalog, p, {reason: '   ', by: BY}),
    /needs --reason/,
  );
  await assert.rejects(
    applyPlan(catalog, p, {reason: 'first map'}),
    /who is applying/,
  );
  const bad = planAdd({
    trackId: 't',
    current: NONE,
    built: built({lapsUsed: 3}),
    samples,
  });
  await assert.rejects(
    applyPlan(catalog, bad, {reason: 'x', by: BY}),
    error =>
      error instanceof PlanRefused && /only 3 clean laps/.test(error.message),
  );
  assert.equal(catalog.commits, 0, 'nothing was written by any of those');

  await applyPlan(catalog, p, {
    reason: 'first map from a clean race',
    by: BY,
    now,
  });
  // The same plan again: the track is at rev 1 now, so it is stale, not duplicated.
  await assert.rejects(
    applyPlan(catalog, p, {reason: 'again', by: BY}),
    error =>
      error instanceof PlanRefused &&
      /the track changed since this plan \(it is at catalogRev 1, the plan was made at 0\): run the dry run again/.test(
        error.message,
      ),
  );
  assert.equal(catalog.commits, 1);
  assert.equal(catalog.state.history.size, 1);
});

test('the whole story: unknown track, curated, edited, a mistake, undone, and the stamp moves at every step', async () => {
  const catalog = memoryCatalog({
    tracks: {},
    lengths: {t: samples},
    counts: {t: 12},
  });
  const stamps = [];
  const stampNow = async () => {
    const c = await catalog.readCatalog('t');
    return catalogStamp(c.track, c.boundaries);
  };
  stamps.push(await stampNow());
  assert.equal(stamps[0], 'none', 'an unknown track');

  // 1. Unknown to curated.
  const add = await planOn(catalog, 'add', {built: built()});
  const r1 = await applyPlan(catalog, add, {
    reason: 'add Road Atlanta from the Sunday race',
    by: BY,
    now,
  });
  assert.equal(r1.rev, 1);
  assert.equal(
    r1.regenerated,
    true,
    'the versioned catalog file is regenerated after the commit',
  );
  const afterAdd = await catalog.readCatalog('t');
  assert.deepEqual(
    [
      afterAdd.catalogRev,
      afterAdd.track.curatedBy,
      afterAdd.track.corners.length,
    ],
    [1, BY, 2],
  );
  assert.equal(afterAdd.track.source.sessionId, 'sess-1');
  assert.ok(afterAdd.track.source.builtAt);
  assert.equal(afterAdd.boundaries.mapKey, mapKeyOf(MAP.corners));
  stamps.push(await stampNow());

  // 2. Edit the track: a corner moved.
  const edited = {
    ...MAP,
    corners: MAP.corners.map((c, i) =>
      i === 0 ? {...c, apexM: c.apexM + 14, exitM: c.exitM + 14} : c,
    ),
  };
  const rep = await planOn(catalog, 'replace', {
    built: built({map: edited, sessionId: 'sess-2'}),
  });
  assert.equal(rep.expectedRev, 1);
  await applyPlan(catalog, rep, {reason: 'T1 apex was early', by: BY, now});
  const afterEdit = await catalog.readCatalog('t');
  assert.equal(afterEdit.catalogRev, 2);
  assert.equal(afterEdit.track.corners[0].apexM, 774);
  stamps.push(await stampNow());

  // 3. A refold that moves no start still changes what the trays see, through catalogRev.
  const fold = await planOn(catalog, 'refold', {
    built: built({map: edited, boundaries: unpackState(afterEdit.boundaries)}),
  });
  await applyPlan(catalog, fold, {
    reason: 'refold from the two best sessions',
    by: BY,
    now,
  });
  assert.equal((await catalog.readCatalog('t')).catalogRev, 3);
  stamps.push(await stampNow());

  // 4. A mistake: undo goes back to rev 2 (the edit), as a new rev 4.
  const undo = await planOn(catalog, 'undo', {});
  assert.deepEqual(undo.refusals, []);
  assert.equal(undo.restoresRev, 2);
  const undoLines = renderPlan(undo);
  assert.match(
    undoLines[0],
    /^UNDO to an earlier rev of t: catalogRev 3 -> 4 \(restores rev 2\)/,
  );
  await applyPlan(catalog, undo, {reason: 'the refold was wrong', by: BY, now});
  const afterUndo = await catalog.readCatalog('t');
  assert.equal(
    afterUndo.catalogRev,
    4,
    'undo is a new rev, history is not rewritten',
  );
  assert.deepEqual(
    afterUndo.track.corners,
    afterEdit.track.corners,
    'the map of rev 2 is back',
  );
  assert.deepEqual(
    afterUndo.boundaries,
    afterEdit.boundaries,
    'and its boundaries',
  );
  stamps.push(await stampNow());

  // Every apply moved the stamp: no two consecutive stamps are equal.
  for (let i = 1; i < stamps.length; i++)
    assert.notEqual(stamps[i], stamps[i - 1], `step ${i}`);
  assert.match(stamps.at(-1), /:r4$/);

  // History: one entry per apply, never rewritten, each holding the state it replaced.
  const history = await catalog.readHistory('t');
  assert.deepEqual([...history.keys()].sort(), [0, 1, 2, 3]);
  assert.deepEqual(history.get(0).snapshot.curated, {}, 'rev 0 is "no map"');
  assert.equal(history.get(0).reason, 'add Road Atlanta from the Sunday race');
  assert.equal(history.get(1).reason, 'T1 apex was early');
  assert.equal(history.get(3).kind, 'undo');
  assert.ok(history.get(1).summary.startsWith('replace:'));

  // The undo is itself undoable.
  const undoUndo = await planOn(catalog, 'undo', {toRev: 3});
  assert.deepEqual(undoUndo.refusals, []);
  await applyPlan(catalog, undoUndo, {
    reason: 'actually the refold was fine',
    by: BY,
    now,
  });
  assert.equal((await catalog.readCatalog('t')).catalogRev, 5);
});

test('undoing the very first add takes the track back to unknown: map fields removed, boundaries deleted, other fields kept', async () => {
  const catalog = memoryCatalog({
    tracks: {t: {georef: {x: 1}, outline: {path: 'trackmaps/t/v1.geojson.gz'}}},
    lengths: {t: samples},
  });
  const add = await planOn(catalog, 'add', {built: built()});
  await applyPlan(catalog, add, {reason: 'add', by: BY, now});
  const undo = await planOn(catalog, 'undo', {});
  assert.deepEqual(undo.refusals, []);
  assert.ok(
    undo.deleteFields.includes('corners') &&
      undo.deleteFields.includes('boundaries'),
  );
  assert.equal(undo.boundaries.action, 'delete');
  await applyPlan(catalog, undo, {reason: 'wrong track', by: BY, now});
  const back = await catalog.readCatalog('t');
  assert.equal(back.track.corners, undefined, 'no map again');
  assert.equal(back.boundaries, null);
  assert.deepEqual(
    back.track.georef,
    {x: 1},
    'what the curator does not own is untouched',
  );
  assert.ok(back.track.outline);
  assert.equal(back.catalogRev, 2);
  assert.equal(catalogStamp(back.track, back.boundaries), 'none');
});

test('undo refuses what makes no sense: no history, a rev that is not earlier, a missing entry, a no-op', async () => {
  const fresh = memoryCatalog();
  assert.match(
    (await planOn(fresh, 'undo', {})).refusals[0],
    /no history to undo/,
  );
  const catalog = memoryCatalog({lengths: {t: samples}});
  await applyPlan(catalog, await planOn(catalog, 'add', {built: built()}), {
    reason: 'add',
    by: BY,
    now,
  });
  assert.match(
    (await planOn(catalog, 'undo', {toRev: 1})).refusals[0],
    /not an earlier rev/,
  );
  assert.match(
    (await planOn(catalog, 'undo', {toRev: -1})).refusals[0],
    /not an earlier rev/,
  );
  catalog.state.history.clear();
  assert.match(
    (await planOn(catalog, 'undo', {toRev: 0})).refusals[0],
    /the history has no rev 0/,
  );
});

test('history is append-only: an existing history document is never written again', async () => {
  const catalog = memoryCatalog({lengths: {t: samples}});
  const first = await planOn(catalog, 'add', {built: built()});
  await applyPlan(catalog, first, {reason: 'add', by: BY, now});
  const stored = structuredClone([...catalog.state.history]);
  const edit = await planOn(catalog, 'replace', {
    built: built({
      map: {
        ...MAP,
        corners: MAP.corners.map(c => ({...c, apexM: c.apexM + 3})),
      },
    }),
  });
  await applyPlan(catalog, edit, {reason: 'nudge', by: BY, now});
  for (const [key, doc] of stored)
    assert.deepEqual(
      catalog.state.history.get(key),
      doc,
      `${key} is unchanged`,
    );
  // And a second history for the same rev cannot be written (a forced duplicate).
  await assert.rejects(
    catalog.commit({
      trackId: 't',
      expectedRev: 2,
      newRev: 3,
      history: {rev: 0},
      set: {catalogRev: 3},
      deleteFields: [],
      boundaries: {action: 'keep'},
    }),
    /already exists/,
  );
});

test('only the curated fields are ever touched on a track document', async () => {
  const catalog = memoryCatalog({
    tracks: {
      t: {
        georef: {x: 1},
        outline: {path: 'o'},
        quality: 'good',
        name: 'Road Atlanta',
      },
    },
    lengths: {t: samples},
  });
  const add = await planOn(catalog, 'add', {built: built()});
  await applyPlan(catalog, add, {reason: 'add', by: BY, now});
  const doc = (await catalog.readCatalog('t')).track;
  for (const k of ['georef', 'outline', 'quality', 'name'])
    assert.ok(doc[k] !== undefined, `${k} survives`);
  const written = Object.keys(doc).filter(
    k => !['georef', 'outline', 'quality', 'name'].includes(k),
  );
  for (const k of written)
    assert.ok(
      ['id', 'sim', 'track', ...CURATED_FIELDS].includes(k),
      `${k} is a curated field or identity`,
    );
});

test('the module never writes anything but through commit, and has no delete of a history document', () => {
  for (const file of ['apply.mjs', 'plan.mjs', 'diff.mjs']) {
    const code = readFileSync(new URL(`./${file}`, import.meta.url), 'utf8')
      .replace(/\/\/.*$/gm, '')
      .replace(/\/\*[\s\S]*?\*\//g, '');
    assert.ok(
      !/\.(delete|remove|unlink|rm|set|update)\s*\(/.test(code),
      `${file} writes outside commit`,
    );
    assert.ok(
      !/history[^\n]*delete|delete[^\n]*history/i.test(code),
      `${file} touches history destructively`,
    );
  }
});
