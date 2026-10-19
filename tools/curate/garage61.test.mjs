import assert from 'node:assert/strict';
import {test} from 'node:test';
import {
  buildFromGarage61,
  commonCar,
  createClient,
  LapHidden,
  lapFromCsv,
  matchTrack,
  pickLaps,
  readToken,
  tokenOf,
  usable,
} from './garage61.mjs';
import * as iracing from '../sessions/iracing.mjs';
import {run} from './curate.mjs';
import {memoryCatalog} from './fixture.mjs';
import {LoaderError} from './loader.mjs';

const HEAD =
  'Speed,LapDistPct,Lat,Lon,Brake,Throttle,RPM,SteeringWheelAngle,Gear,PositionType';

/**
 * A synthetic circuit lap as Garage61's CSV: a rounded rectangle driven at 60 Hz
 * with four slow corners, braking before each and full throttle after. `scale`
 * is how fast this driver is; `brakeEarly` moves the brake point (m).
 */
function circuitCsv({scale = 1, brakeEarly = 0, pit = false} = {}) {
  const straight = 600;
  const radius = 60;
  const legs = [];
  for (let k = 0; k < 4; k++) {
    legs.push({kind: 'straight', len: straight});
    legs.push({kind: 'arc', len: (Math.PI / 2) * radius});
  }
  const total = legs.reduce((a, l) => a + l.len, 0);
  let x = 0;
  let y = 0;
  let heading = 0;
  const rows = [];
  let d = 0;
  const speedAt = (s, leg, inLeg) => {
    if (leg.kind === 'arc') return 18 * scale;
    const toEnd = leg.len - inLeg;
    const brakeAt = 180 + brakeEarly;
    const fromStart = inLeg;
    const v = Math.min(70 * scale, 18 * scale + fromStart * 0.35);
    return toEnd < brakeAt
      ? Math.min(v, 18 * scale + (toEnd / brakeAt) * 52 * scale)
      : v;
  };
  let li = 0;
  let inLeg = 0;
  while (li < legs.length) {
    const leg = legs[li];
    const v = speedAt(d, leg, inLeg);
    const toEnd = leg.len - inLeg;
    const braking = leg.kind === 'straight' && toEnd < 180 + brakeEarly;
    const lat = 34 + y / 111320;
    const lon = -83 + x / (111320 * Math.cos((34 * Math.PI) / 180));
    rows.push(
      [
        v,
        d / total,
        lat,
        lon,
        braking ? 0.8 : 0,
        braking || leg.kind === 'arc' ? 0 : 1,
        7000,
        0,
        4,
        pit ? 1 : 3,
      ].join(','),
    );
    const step = v / 60;
    if (leg.kind === 'arc') heading += (step / radius) * 1;
    x += Math.cos(heading) * step;
    y += Math.sin(heading) * step;
    d += step;
    inLeg += step;
    if (inLeg >= leg.len) {
      inLeg = 0;
      li++;
    }
  }
  return `${HEAD}\n${rows.join('\n')}\n`;
}

const lapTimeOf = csv => (csv.trim().split('\n').length - 1) / 60;

test('the token is read from the .env text, never from anywhere else', () => {
  assert.equal(tokenOf('A=1\nGARAGE61_TOKEN=abc123\nB=2\n'), 'abc123');
  assert.equal(tokenOf('GARAGE61_TOKEN="quoted"\n'), 'quoted');
  assert.equal(tokenOf('GARAGE61_OAUTH_CLIENT_ID=x\n'), null);
  assert.throws(() => readToken('C:/no/such/.env'), LoaderError);
});

test('a Garage61 track is matched to our id by TrackID and the config name, and refused otherwise with both names', () => {
  const tracks = [
    {
      id: 40,
      name: 'Road Atlanta',
      variant: 'Full Course',
      platform: 'iracing',
      platform_id: '127',
    },
    {
      id: 178,
      name: 'Road Atlanta',
      variant: 'Club',
      platform: 'iracing',
      platform_id: '126',
    },
    {
      id: 104,
      name: 'Long Beach Street Circuit',
      variant: '',
      platform: 'iracing',
      platform_id: '179',
    },
    {
      id: 9,
      name: 'Monza',
      variant: 'Combined',
      platform: 'iracing',
      platform_id: '247',
    },
    {
      id: 8,
      name: 'Monza',
      variant: 'Grand Prix',
      platform: 'iracing',
      platform_id: '247',
    },
  ];
  assert.equal(matchTrack(tracks, 'iracing-127-full_course').track.id, 40);
  assert.equal(matchTrack(tracks, 'iracing-127-full_course').checkedName, true);
  // An empty variant: the TrackID names it alone, and the result says the name was not checked.
  const lb = matchTrack(tracks, 'iracing-179-longbeach');
  assert.equal(lb.track.id, 104);
  assert.equal(lb.checkedName, false);
  // The TrackID is right and the name is not: refused, both printed.
  assert.throws(
    () => matchTrack(tracks, 'iracing-127-club'),
    /iracing-127-club does not match one Garage61 track: "Road Atlanta" \/ "Full Course" \(id 40\).*our name "club"/,
  );
  // Two layouts share a TrackID and the name picks one.
  assert.equal(matchTrack(tracks, 'iracing-247-grand_prix').track.id, 8);
  assert.throws(
    () => matchTrack(tracks, 'iracing-999-x'),
    /no iRacing track with TrackID 999/,
  );
  assert.throws(() => matchTrack(tracks, 'lmu-monza'), /only has iRacing/);
});

test('only clean laps with readable telemetry count, from one car, fastest first', () => {
  const lap = (id, over = {}) => ({
    id,
    lapTime: 60 + Number(id),
    clean: true,
    canViewTelemetry: true,
    car: {id: 1},
    ...over,
  });
  const items = [
    lap('5'),
    lap('1'),
    lap('3', {clean: false}),
    lap('2', {canViewTelemetry: false}),
    lap('4', {offtrack: true}),
    lap('6', {pitOut: true}),
    lap('7', {car: {id: 2}}),
    lap('8', {car: {id: 2}}),
    lap('9', {car: {id: 2}}),
  ];
  assert.deepEqual(
    items.filter(usable).map(l => l.id),
    ['5', '1', '7', '8', '9'],
  );
  assert.equal(commonCar(items).id, 2);
  assert.deepEqual(
    pickLaps(
      items.filter(l => l.car.id === 1),
      5,
    ).map(l => l.id),
    ['1', '5'],
  );
  assert.deepEqual(
    pickLaps(items, 2).map(l => l.id),
    ['1', '5'],
  );
});

test('a CSV becomes a lap at 60 Hz whose two lengths agree', () => {
  const csv = circuitCsv();
  const made = lapFromCsv(csv, {lapTime: lapTimeOf(csv)});
  assert.equal(made.refused, undefined);
  assert.ok(Math.abs(made.distanceM - made.gpsM) / made.gpsM < 0.01);
  assert.equal(made.lap.dist.length, made.rec.s.t.length);
  // Speed is km/h, brake and throttle are percent.
  assert.ok(Math.max(...made.rec.s.speed_kmh) > 200);
  assert.ok(Math.max(...made.rec.s.brake_pct) <= 100);
  assert.ok(Math.max(...made.rec.s.brake_pct) > 50);
});

test('a CSV that is not at 60 Hz, was in the pit lane, or whose lengths disagree is refused with the numbers', () => {
  const csv = circuitCsv();
  const t = lapTimeOf(csv);
  assert.match(lapFromCsv(csv, {lapTime: t * 2}).refused, /not 60 Hz/);
  assert.match(
    lapFromCsv(circuitCsv({pit: true}), {lapTime: t}).refused,
    /pit lane/,
  );
  assert.match(
    lapFromCsv(csv.replace(/^Speed/, 'Velocity'), {lapTime: t}).refused,
    /no Speed column/,
  );
  // Speeds 5 % high: the integrated length leaves the GPS length.
  const fast = csv
    .trim()
    .split('\n')
    .map((l, i) => {
      if (i === 0) return l;
      const c = l.split(',');
      c[0] = String(Number(c[0]) * 1.05);
      return c.join(',');
    })
    .join('\n');
  assert.match(
    lapFromCsv(fast, {lapTime: t}).refused,
    /speed length .* GPS length/,
  );
});

test('the client honours a 429, hides one private lap, refuses a bad token, and never carries the token', async () => {
  const token = 'SECRET-TOKEN-VALUE';
  const waits = [];
  const calls = [];
  let n = 0;
  const fetchImpl = async (url, init) => {
    calls.push({url, auth: init.headers.Authorization});
    n++;
    if (url.endsWith('/tracks') && n === 1)
      return {status: 429, ok: false, headers: new Map([['retry-after', '7']])};
    if (url.endsWith('/tracks'))
      return {status: 200, ok: true, json: async () => ({items: [{id: 1}]})};
    if (url.includes('/csv'))
      return {status: 403, ok: false, headers: new Map()};
    return {
      status: 401,
      ok: false,
      headers: new Map(),
      text: async () => token,
    };
  };
  const client = createClient({
    token,
    fetchImpl,
    sleep: async ms => waits.push(ms),
  });
  assert.deepEqual(await client.tracks(), [{id: 1}]);
  assert.deepEqual(waits, [7000]);
  assert.ok(calls.every(c => c.auth === `Bearer ${token}`));
  await assert.rejects(() => client.csv('abc'), LapHidden);
  await assert.rejects(
    () => client.bests(5),
    error => {
      assert.match(error.message, /refused the token \(HTTP 401\) on \/laps/);
      assert.ok(!error.message.includes(token));
      return true;
    },
  );
});

test('a map is built from other drivers’ laps, one session per driver, with no names or ids in what is kept', async () => {
  const laps = [];
  const csvs = new Map();
  for (let i = 0; i < 12; i++) {
    const csv = circuitCsv({scale: 1 + i * 0.004, brakeEarly: (i % 4) * 3});
    const id = `lap${i}`;
    csvs.set(id, csv);
    laps.push({
      id,
      lapTime: lapTimeOf(csv),
      clean: true,
      canViewTelemetry: true,
      car: {id: 7},
      driver: {slug: `driver-${i}`, name: 'A Real Name'},
    });
  }
  const client = {
    tracks: async () => [
      {
        id: 40,
        name: 'Test Ring',
        variant: 'Full Course',
        platform: 'iracing',
        platform_id: '127',
      },
    ],
    bests: async () => ({items: laps, total: 400}),
    csv: async id => csvs.get(id),
  };
  const built = await buildFromGarage61({
    client,
    trackId: 'iracing-127-full_course',
    laps: 12,
  });
  assert.equal(built.sim, 'iracing');
  assert.equal(built.report.used, 12);
  assert.equal(built.report.visibleDrivers, 400);
  assert.equal(built.gps, true);
  assert.ok(built.map, 'a map');
  assert.ok(
    built.map.corners.length >= 2,
    `${built.map.corners.length} sections`,
  );
  assert.ok(built.boundaries, 'boundaries');
  assert.deepEqual(built.source, {
    kind: 'garage61',
    laps: 12,
    drivers: 12,
    query: built.source.query,
  });
  // Nothing identifying a person or a lap is kept.
  const kept = JSON.stringify({source: built.source, report: built.report});
  assert.ok(!kept.includes('A Real Name'));
  assert.ok(!kept.includes('driver-3'));
  assert.ok(!/lap\d/.test(kept));
  assert.equal(built.track.variant, '127-full_course');
});

test('a lap whose telemetry is hidden is skipped; with none usable the run is refused with the reasons', async () => {
  const csv = circuitCsv();
  const mk = id => ({
    id,
    lapTime: lapTimeOf(csv),
    clean: true,
    canViewTelemetry: true,
    car: {id: 7},
  });
  const tracks = [
    {
      id: 40,
      name: 'T',
      variant: 'Full Course',
      platform: 'iracing',
      platform_id: '127',
    },
  ];
  const hidden = {
    tracks: async () => tracks,
    bests: async () => ({items: [mk('a'), mk('b')], total: 2}),
    csv: async () => {
      throw new LapHidden(403);
    },
  };
  await assert.rejects(
    () =>
      buildFromGarage61({client: hidden, trackId: 'iracing-127-full_course'}),
    /none of the 2 laps could be used: telemetry not readable \(HTTP 403\)/,
  );
  const empty = {
    tracks: async () => tracks,
    bests: async () => ({items: [], total: 0}),
  };
  await assert.rejects(
    () =>
      buildFromGarage61({client: empty, trackId: 'iracing-127-full_course'}),
    /no clean lap with visible telemetry/,
  );
});

test('plan-add --from garage61: the dry run says where the laps came from, apply stores the source with no names or ids, and a thin set is refused', async () => {
  const ID = 'iracing-127-full_course';
  const csvs = new Map();
  const mk = (i, over = {}) => {
    const csv = circuitCsv({scale: 1 + i * 0.004, brakeEarly: (i % 4) * 3});
    csvs.set(`lap${i}`, csv);
    return {
      id: `lap${i}`,
      lapTime: lapTimeOf(csv),
      clean: true,
      canViewTelemetry: true,
      car: {id: 7},
      driver: {slug: `driver-${i}`},
      ...over,
    };
  };
  const tracks = [
    {
      id: 40,
      name: 'Test Ring',
      variant: 'Full Course',
      platform: 'iracing',
      platform_id: '127',
    },
  ];
  const clientOf = laps => ({
    tracks: async () => tracks,
    bests: async () => ({items: laps, total: 300}),
    csv: async id => csvs.get(id),
  });
  const deps = (garage61, be) => ({
    backend: be,
    adapter: iracing,
    folder: '/f',
    workDir: '/w',
    by: 'botkin',
    now: () => '2026-10-19T12:00:00Z',
    garage61,
  });
  const text = r => r.lines.join('\n');
  const be = memoryCatalog();
  const dry = await run(
    ['plan-add', ID, '--from', 'garage61'],
    deps(clientOf(Array.from({length: 12}, (_, i) => mk(i))), be),
  );
  assert.equal(dry.code, 0, text(dry));
  assert.match(
    text(dry),
    /Garage61: Test Ring \/ Full Course, 300 drivers visible, car 7, 12 of 12 laps used/,
  );
  assert.match(text(dry), /ADD iracing-127-full_course: catalogRev 0 -> 1/);
  assert.equal(be.commits, 0);
  const done = await run(
    [
      'plan-add',
      ID,
      '--from',
      'garage61',
      '--apply',
      '--reason',
      'garage61 laps',
    ],
    deps(clientOf(Array.from({length: 12}, (_, i) => mk(i))), be),
  );
  assert.equal(done.code, 0, text(done));
  const doc = be.state.tracks.get(ID);
  assert.equal(doc.source.kind, 'garage61');
  assert.equal(doc.source.laps, 12);
  assert.equal(doc.source.builtAt, '2026-10-19T12:00:00Z');
  const stored = JSON.stringify([doc.source, [...be.state.history.values()]]);
  assert.ok(!stored.includes('driver-') && !/lap\d/.test(stored));
  // Under 8 laps is the same refusal every map meets.
  const thin = await run(
    ['plan-add', 'iracing-127-full_course', '--from', 'garage61'],
    deps(clientOf(Array.from({length: 5}, (_, i) => mk(i))), memoryCatalog()),
  );
  assert.equal(thin.code, 1);
  assert.match(
    text(thin),
    /clean laps of one length, 8 are needed|no corner map could be built/,
  );
});
