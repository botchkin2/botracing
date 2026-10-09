// Run: node --test tools/sessions/surface.test.mjs
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {Buffer} from 'node:buffer';
import {gzipSync} from 'node:zlib';
import {fromLocalMetres, LMU_FAKE_ORIGIN} from '../../src/analysis/geo.ts';
import {surfaceGeometry} from '../../src/analysis/trackSurface.ts';
import {
  buildSurface,
  foldSurfaces,
  gzipSurface,
  parseSurface,
  surfaceLapFromCsv,
  usableLap,
} from './surface.mjs';
import {surfaceProgressLine} from './surfaceProgress.mjs';

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

test('building from a set: the centre agrees, and a second build is identical', () => {
  const sessions = [
    {id: 'a', csvs: [csv({pl: -2, edge: -6})]},
    {id: 'b', csvs: [csv({pl: 3, edge: 6})]},
  ];
  const first = buildSurface(LENGTH_M, sessions);
  assert.equal(first.sessionsAdded, 2);
  assert.equal(first.lapsAdded, 2);
  const g = surfaceGeometry(first.surface);
  assert.ok(Math.max(...g.runs[0].centre.map(p => Math.abs(p.y))) < 0.01);
  assert.ok(Math.abs(g.halfWidthM - 6) < 0.01);
  const again = buildSurface(LENGTH_M, sessions);
  assert.equal(again.sessionsAdded, 2);
  assert.deepEqual(again.surface.bins, first.surface.bins);
});

test('a session whose traces have no lateral columns adds nothing', () => {
  const old = {id: 'old', csvs: [csv({pl: 0, edge: -6, columns: false})]};
  const r = buildSurface(LENGTH_M, [old]);
  assert.equal(r.sessionsAdded, 0);
  const later = buildSurface(LENGTH_M, [
    {id: 'old', csvs: [csv({pl: 0, edge: -6})]},
  ]);
  assert.equal(later.sessionsAdded, 1);
});

test('a longer track is its own surface, built only from the sessions named', () => {
  const rebuilt = buildSurface(2000, [
    {id: 'b', csvs: [csv({pl: 0, edge: -6})]},
  ]);
  assert.equal(rebuilt.sessionsAdded, 1);
  assert.equal(rebuilt.surface.bins.length, 200);
});

test('the stored file round-trips, stays small, and names no session', () => {
  const {surface} = buildSurface(LENGTH_M, [
    {id: 'a', csvs: [csv({pl: -2, edge: -6}), csv({pl: 3, edge: 6})]},
  ]);
  const gz = gzipSurface(surface);
  const back = parseSurface(gz);
  assert.equal('sessions' in back, false);
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

// The track lines only: the "surface N/M tracks" progress lines are tested apart.
const trackLines = lines => l => {
  if (!l.startsWith('surface ')) lines.push(l);
};

test('foldSurfaces rebuilds from the named set, and a second run matches', async () => {
  const store = storeWith(['s1', 's2']);
  const lines = [];
  const connectStore = async () => store;
  const read = async () =>
    parseSurface((await store.bucket.file(ARTIFACT).download())[0]);

  await foldSurfaces({
    sessionIds: ['s1', 's2'],
    log: trackLines(lines),
    connectStore,
  });
  assert.ok(lines[0].startsWith('trackA: 2 sessions, 4 laps'));
  assert.equal('sessions' in (await read()), false);
  assert.equal(store.tracks.trackA.surface.laps, 4);
  assert.equal('sessions' in store.tracks.trackA.surface, false);
  const firstBytes = Buffer.from(store.files[ARTIFACT]);

  store.downloads.length = 0;
  store.written.length = 0;
  await foldSurfaces({
    sessionIds: ['s1', 's2'],
    log: trackLines(lines),
    connectStore,
  });
  assert.ok(lines.at(-2).startsWith('trackA: 2 sessions, 4 laps'));
  assert.deepEqual(
    store.downloads.filter(p => p.startsWith('traces/')).sort(),
    [
      'traces/s1-lap1.csv.gz',
      'traces/s1-lap2.csv.gz',
      'traces/s2-lap1.csv.gz',
      'traces/s2-lap2.csv.gz',
    ],
  );
  assert.deepEqual(Buffer.from(store.files[ARTIFACT]), firstBytes);
});

test('a rebuild with no named set is refused and writes nothing', async () => {
  const store = storeWith(['s1', 's2']);
  await assert.rejects(
    () => foldSurfaces({connectStore: async () => store}),
    /named set is required/,
  );
  assert.deepEqual(store.written, []);
});

test('--owner rebuilds that owner only, so a copied owner is not counted twice', async () => {
  const store = storeWith(['s1', 's2']);
  store.sessions.s1.ownerId = 'uid-a';
  store.sessions.s2.ownerId = 'uid-b';
  const lines = [];
  await foldSurfaces({
    ownerId: 'uid-a',
    log: trackLines(lines),
    connectStore: async () => store,
  });
  assert.ok(lines[0].startsWith('trackA: 1 sessions, 2 laps'));
  assert.deepEqual(
    store.downloads.filter(p => p.startsWith('traces/')).sort(),
    ['traces/s1-lap1.csv.gz', 'traces/s1-lap2.csv.gz'],
  );
});

test('the command exits non-zero without --sessions or --owner', () => {
  const script = fileURLToPath(new URL('./surface.mjs', import.meta.url));
  const r = spawnSync(process.execPath, [script], {encoding: 'utf8'});
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /named set is required/);
});

test('a named set rebuilds from only those sessions', async () => {
  const store = storeWith(['s1', 's2']);
  const lines = [];
  await foldSurfaces({
    sessionIds: ['s2'],
    log: trackLines(lines),
    connectStore: async () => store,
  });
  assert.ok(lines[0].startsWith('trackA: 1 sessions, 2 laps'));
  assert.deepEqual(
    store.downloads.filter(p => p.startsWith('traces/')).sort(),
    ['traces/s2-lap1.csv.gz', 'traces/s2-lap2.csv.gz'],
  );
});

test('foldSurfaces on named tracks leaves the others alone, and a dry run writes nothing', async () => {
  const store = storeWith(['s1']);
  store.tracks.trackB = {lengthM: LENGTH_M};
  const lines = [];
  await foldSurfaces({
    trackIds: ['trackB'],
    sessionIds: ['s1'],
    log: trackLines(lines),
    connectStore: async () => store,
  });
  assert.ok(lines[0].startsWith('trackB: 0 sessions'));
  assert.deepEqual(store.written, []);
  await foldSurfaces({
    trackIds: ['trackA'],
    sessionIds: ['s1'],
    dry: true,
    log: trackLines(lines),
    connectStore: async () => store,
  });
  assert.ok(lines.at(-1).startsWith('trackA: 1 sessions'));
  assert.deepEqual(store.written, []);
});

test('a grid lap (lap number 0) is left out: it sits at LapDistPct 0 for a minute', () => {
  const ok = {timed: true, comparable: true, lapNumber: 1};
  assert.equal(usableLap(ok), true);
  assert.equal(usableLap({...ok, lapNumber: 0}), false);
});

test('a rebuild carries the current rules whatever the old file said', () => {
  const rebuilt = buildSurface(LENGTH_M, [
    {id: 'a', csvs: [csv({pl: 0, edge: -6})]},
  ]);
  assert.equal(rebuilt.surface.rules, 2);
});

test('foldSurfaces says how far it is, one line per track and a last one: the watcher reads them', async () => {
  const store = storeWith(['s1']);
  store.tracks.trackB = {lengthM: LENGTH_M};
  store.tracks.noLength = {};
  const lines = [];
  await foldSurfaces({
    sessionIds: ['s1'],
    log: l => lines.push(l),
    connectStore: async () => store,
  });
  const progress = lines.filter(l => l.startsWith('surface '));
  // Two tracks have a length: the one without is not counted. Each line is
  // printed before its track starts, with the tracks finished so far.
  assert.deepEqual(progress, [
    'surface 0/2 tracks',
    'surface 1/2 tracks',
    'surface 2/2 tracks',
  ]);
  assert.equal(progress[0], surfaceProgressLine(0, 2));
  assert.ok(
    lines.indexOf('surface 0/2 tracks') <
      lines.findIndex(l => l.startsWith('trackA:')),
  );
  assert.equal(lines.at(-1), 'surface 2/2 tracks');
});

test('foldSurfaces with nothing to fold prints no progress line', async () => {
  const store = storeWith(['s1']);
  const lines = [];
  await foldSurfaces({
    trackIds: ['noSuchTrack'],
    sessionIds: ['s1'],
    log: l => lines.push(l),
    connectStore: async () => store,
  });
  assert.deepEqual(lines, []);
});
