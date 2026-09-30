// Run: node --test tools/sessions/surface.test.mjs
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {Buffer} from 'node:buffer';
import {gzipSync} from 'node:zlib';
import {fromLocalMetres, LMU_FAKE_ORIGIN} from '../../src/analysis/geo.ts';
import {surfaceGeometry} from '../../src/analysis/trackSurface.ts';
import {
  buildSurface,
  foldSurfaces,
  gzipSurface,
  parseSurface,
  sessionsToFold,
  surfaceLapFromCsv,
  usableLap,
} from './surface.mjs';

const LENGTH_M = 1000;
const HEADER =
  'Speed,LapDistPct,Lat,Lon,Brake,Throttle,RPM,SteeringWheelAngle,Gear,OffAsphalt,PathLateral,TrackEdge';

// A straight road east along y = 0; a car at lateral `pl` (right of travel)
// sits south of the centre. Position rows (10 Hz) carry Lat/Lon and the lateral
// columns; the rows between are empty like the real file.
function csv({
  pl,
  edge,
  from = 0,
  to = LENGTH_M,
  columns = true,
  wrap = false,
}) {
  const head = columns ? HEADER : HEADER.split(',').slice(0, 10).join(',');
  const rows = [head];
  for (let d = from; d < to; d += 5) {
    const p = fromLocalMetres({x: d, y: -pl}, LMU_FAKE_ORIGIN);
    const cells = [30, d / LENGTH_M, p.lat, p.lon, 0, 1, 8000, 0, 5, 0];
    if (columns) cells.push(pl, edge);
    rows.push(cells.join(','));
    rows.push(
      [
        30,
        (d + 2) / LENGTH_M,
        '',
        '',
        '',
        '',
        8000,
        0,
        5,
        0,
        ...(columns ? ['', ''] : []),
      ].join(','),
    );
  }
  if (wrap) {
    // The counter has wrapped: the next lap's first samples.
    const p = fromLocalMetres({x: 5, y: -pl}, LMU_FAKE_ORIGIN);
    rows.push(
      [30, 0.005, p.lat, p.lon, 0, 1, 8000, 0, 5, 0, pl, edge].join(','),
    );
  }
  return rows.join('\n');
}

test('a lap CSV becomes the game-metre samples with a position', () => {
  const lap = surfaceLapFromCsv(csv({pl: 2, edge: 6}), LENGTH_M);
  assert.equal(lap.x.length, 200);
  assert.ok(Math.abs(lap.y[10] + 2) < 0.01);
  assert.ok(Math.abs(lap.x[10] - 50) < 0.01);
  assert.equal(lap.distM[10], 50);
  assert.equal(lap.pathLateralM[10], 2);
  assert.equal(lap.trackEdgeM[10], 6);
});

test('a trace from before PathLateral and TrackEdge gives nothing', () => {
  assert.equal(
    surfaceLapFromCsv(csv({pl: 2, edge: 6, columns: false}), LENGTH_M),
    null,
  );
});

test('samples after the lap counter wraps are the next lap and are left out', () => {
  const lap = surfaceLapFromCsv(
    csv({pl: 0, edge: -6, to: LENGTH_M, wrap: true}),
    LENGTH_M,
  );
  assert.equal(lap.x.length, 200);
});

test('only whole timed comparable laps off the pit lane are used', () => {
  const ok = {timed: true, comparable: true};
  assert.equal(usableLap(ok), true);
  assert.equal(usableLap({...ok, pitlane: true}), false);
  assert.equal(usableLap({...ok, pitIn: true}), false);
  assert.equal(usableLap({...ok, partial: true}), false);
  assert.equal(usableLap({...ok, comparable: false}), false);
  assert.equal(usableLap({...ok, timed: false}), false);
});

test('folding sessions in: the centre agrees, and a repeat adds nothing', () => {
  const sessions = [
    {id: 'a', csvs: [csv({pl: -2, edge: -6})]},
    {id: 'b', csvs: [csv({pl: 3, edge: 6})]},
  ];
  const first = buildSurface(null, LENGTH_M, sessions);
  assert.equal(first.sessionsAdded, 2);
  assert.equal(first.lapsAdded, 2);
  const g = surfaceGeometry(first.surface);
  assert.ok(Math.max(...g.runs[0].centre.map(p => Math.abs(p.y))) < 0.01);
  assert.ok(Math.abs(g.halfWidthM - 6) < 0.01);
  const again = buildSurface(first.surface, LENGTH_M, sessions);
  assert.equal(again.sessionsAdded, 0);
  assert.deepEqual(again.surface.bins, first.surface.bins);
});

test('a session whose traces have no lateral columns is not recorded as folded in', () => {
  const old = {id: 'old', csvs: [csv({pl: 0, edge: -6, columns: false})]};
  const r = buildSurface(null, LENGTH_M, [old]);
  assert.equal(r.sessionsAdded, 0);
  assert.deepEqual(r.surface.sessions, []);
  // Once its traces are re-uploaded with the columns, it is picked up.
  const later = buildSurface(r.surface, LENGTH_M, [
    {id: 'old', csvs: [csv({pl: 0, edge: -6})]},
  ]);
  assert.equal(later.sessionsAdded, 1);
});

test('a track whose length changed is rebuilt from scratch', () => {
  const first = buildSurface(null, LENGTH_M, [
    {id: 'a', csvs: [csv({pl: 0, edge: -6})]},
  ]);
  const rebuilt = buildSurface(first.surface, 2000, [
    {id: 'b', csvs: [csv({pl: 0, edge: -6})]},
  ]);
  assert.equal(rebuilt.replaced, true);
  assert.deepEqual(rebuilt.surface.sessions, ['b']);
  assert.equal(rebuilt.surface.bins.length, 200);
});

test('which sessions to read: only the new ones while the artifact fits, all of them once it is rebuilt', () => {
  const fits = buildSurface(null, LENGTH_M, [
    {id: 'a', csvs: [csv({pl: 0, edge: -6})]},
    {id: 'b', csvs: [csv({pl: 0, edge: -6})]},
  ]).surface;
  assert.deepEqual(sessionsToFold(fits, LENGTH_M, ['a', 'b', 'c']), ['c']);
  assert.deepEqual(sessionsToFold(null, LENGTH_M, ['a', 'b', 'c']), [
    'a',
    'b',
    'c',
  ]);
  // The track's length changed: the old artifact is discarded, so the two
  // sessions it held must be read again along with the new one.
  assert.deepEqual(sessionsToFold(fits, 2000, ['a', 'b', 'c']), [
    'a',
    'b',
    'c',
  ]);
});

test('a rebuild after a length change keeps every session', () => {
  const old = buildSurface(null, LENGTH_M, [
    {id: 'a', csvs: [csv({pl: 0, edge: -6})]},
    {id: 'b', csvs: [csv({pl: 0, edge: -6})]},
  ]).surface;
  const ids = sessionsToFold(old, 2000, ['a', 'b', 'c']);
  const rebuilt = buildSurface(
    old,
    2000,
    ids.map(id => ({id, csvs: [csv({pl: 0, edge: -6})]})),
  );
  assert.equal(rebuilt.replaced, true);
  assert.deepEqual(rebuilt.surface.sessions, ['a', 'b', 'c']);
});

test('the stored file round-trips and stays small', () => {
  const {surface} = buildSurface(null, LENGTH_M, [
    {id: 'a', csvs: [csv({pl: -2, edge: -6}), csv({pl: 3, edge: 6})]},
  ]);
  const gz = gzipSurface(surface);
  const back = parseSurface(gz);
  assert.equal(back.sessions[0], 'a');
  assert.equal(back.bins.length, surface.bins.length);
  assert.ok(Math.abs(back.bins[7].sx - surface.bins[7].sx) < 0.001);
  assert.ok(gz.length < 20000);
});

// --- the fold from the store ------------------------------------------------

// A small in-memory Firestore and bucket: only what foldSurfaces reads and writes.
function fakeStore({tracks, sessions, laps, files}) {
  const written = [];
  const downloads = [];
  const notFound = () => Object.assign(new Error('not found'), {code: 404});
  const snapshot = docs => ({
    docs: docs.map(([id, data]) => ({id, data: () => data, exists: true})),
  });
  const db = {
    collection: name => ({
      doc: id => ({
        get: async () => {
          const data = tracks[id];
          return {id, exists: data != null, data: () => data};
        },
        update: async patch => {
          written.push({track: id, patch});
          Object.assign(tracks[id], patch);
        },
      }),
      get: async () => snapshot(Object.entries(tracks)),
      where: (field, _op, value) => ({
        get: async () =>
          snapshot(
            name === 'sessions'
              ? Object.entries(sessions).filter(([, s]) => s[field] === value)
              : Object.entries(laps).filter(([, l]) => l[field] === value),
          ),
      }),
    }),
  };
  const bucket = {
    file: path => ({
      download: async () => {
        downloads.push(path);
        if (!(path in files)) throw notFound();
        return [files[path]];
      },
      save: async body => {
        files[path] = body;
        written.push({file: path});
      },
    }),
  };
  return {
    db,
    bucket,
    bucketName: 'test-bucket',
    written,
    downloads,
    tracks,
    sessions,
    laps,
    files,
  };
}

const ARTIFACT = 'surface/trackA/v1.json.gz';

// One more session with two laps in the fake store.
function addSessionTo(store, id) {
  store.sessions[id] = {trackId: 'trackA'};
  for (const n of [1, 2]) {
    const lapId = `${id}-lap${n}`;
    store.laps[lapId] = {
      sessionId: id,
      timed: true,
      comparable: true,
      trace: {path: `traces/${lapId}.csv.gz`},
    };
    store.files[`traces/${lapId}.csv.gz`] = gzipSync(
      Buffer.from(csv({pl: n === 1 ? -2 : 3, edge: n === 1 ? -6 : 6})),
    );
  }
}

function storeWith(sessionIds) {
  const tracks = {trackA: {lengthM: LENGTH_M}};
  const sessions = {};
  const laps = {};
  const files = {};
  for (const id of sessionIds) {
    sessions[id] = {trackId: 'trackA'};
    for (const n of [1, 2]) {
      const lapId = `${id}-lap${n}`;
      laps[lapId] = {
        sessionId: id,
        timed: true,
        comparable: true,
        trace: {path: `traces/${lapId}.csv.gz`},
      };
      files[`traces/${lapId}.csv.gz`] = gzipSync(
        Buffer.from(csv({pl: n === 1 ? -2 : 3, edge: n === 1 ? -6 : 6})),
      );
    }
  }
  return fakeStore({tracks, sessions, laps, files});
}

test('foldSurfaces writes the artifact and the pointer, then adds only what is new', async () => {
  const store = storeWith(['s1', 's2']);
  const lines = [];
  const connectStore = async () => store;
  const read = async () =>
    parseSurface((await store.bucket.file(ARTIFACT).download())[0]);

  await foldSurfaces({log: l => lines.push(l), connectStore});
  assert.ok(lines[0].startsWith('trackA: +2 sessions, +4 laps'));
  assert.deepEqual((await read()).sessions, ['s1', 's2']);
  assert.equal(store.tracks.trackA.surface.sessions, 2);
  assert.equal(store.written.filter(w => w.file).length, 1);

  // Nothing new: no trace is read and nothing is written.
  store.downloads.length = 0;
  store.written.length = 0;
  await foldSurfaces({log: l => lines.push(l), connectStore});
  assert.ok(lines.at(-1).startsWith('trackA: +0 sessions'));
  assert.deepEqual(store.written, []);
  assert.equal(store.downloads.filter(p => p.startsWith('traces/')).length, 0);

  // A third session arrives: only its laps are read, and it is added.
  addSessionTo(store, 's3');
  store.downloads.length = 0;
  await foldSurfaces({log: l => lines.push(l), connectStore});
  assert.equal(lines.at(-2), 'trackA: +1 sessions, +2 laps, 3 sessions in all');
  assert.deepEqual(
    store.downloads.filter(p => p.startsWith('traces/')).sort(),
    ['traces/s3-lap1.csv.gz', 'traces/s3-lap2.csv.gz'],
  );
  assert.deepEqual((await read()).sessions, ['s1', 's2', 's3']);
});

test('foldSurfaces on named tracks leaves the others alone, and a dry run writes nothing', async () => {
  const store = storeWith(['s1']);
  store.tracks.trackB = {lengthM: LENGTH_M};
  const lines = [];
  await foldSurfaces({
    trackIds: ['trackB'],
    log: l => lines.push(l),
    connectStore: async () => store,
  });
  assert.ok(lines[0].startsWith('trackB: +0 sessions'));
  assert.deepEqual(store.written, []);
  await foldSurfaces({
    trackIds: ['trackA'],
    dry: true,
    log: l => lines.push(l),
    connectStore: async () => store,
  });
  assert.ok(lines.at(-1).startsWith('trackA: +1 sessions'));
  assert.deepEqual(store.written, []);
});
