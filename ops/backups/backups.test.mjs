import assert from 'node:assert/strict';
import {test} from 'node:test';
import {enableBackups, parseArgs as parseEnable} from './enable.mjs';
import {gatherState, gcloudRunner, quoteForWindows} from './gcloud.mjs';
import {
  CONFIG,
  compareDrill,
  drillLowerBounds,
  evaluateStatus,
  planEnable,
  readBackups,
  readBucket,
  readDatabase,
  readSchedules,
  scratchName,
  seconds,
} from './lib.mjs';
import {
  assertScratch,
  isRestoring,
  parseArgs as parseDrill,
  runDrill,
  runFileDrill,
  whileRestoring,
} from './restoreDrill.mjs';
import {parseDu, showStatus} from './status.mjs';

const DAY = 86_400;
const NOW = Date.parse('2026-10-06T12:00:00Z');
const hoursAgo = h => new Date(NOW - h * 3_600_000).toISOString();

// What gcloud prints (the field names the readers rely on).
const DB_ON = {
  locationId: 'nam5',
  pointInTimeRecoveryEnablement: 'POINT_IN_TIME_RECOVERY_ENABLED',
  versionRetentionPeriod: '604800s',
  deleteProtectionState: 'DELETE_PROTECTION_ENABLED',
};
const DB_OFF = {
  locationId: 'nam5',
  pointInTimeRecoveryEnablement: 'POINT_IN_TIME_RECOVERY_DISABLED',
  versionRetentionPeriod: '3600s',
  deleteProtectionState: 'DELETE_PROTECTION_DISABLED',
};
const SCHEDULE = {
  name: 'projects/botracing-61/databases/(default)/backupSchedules/s1',
  retention: '604800s',
  dailyRecurrence: {},
};
const backup = (id, hours, state = 'READY') => ({
  name: `projects/botracing-61/locations/nam5/backups/${id}`,
  database: 'projects/botracing-61/databases/(default)',
  snapshotTime: hoursAgo(hours),
  state,
});
const BUCKET_ON = {soft_delete_policy: {retention_duration_seconds: '604800'}};
const BUCKET_OFF = {soft_delete_policy: {retention_duration_seconds: '0'}};

const stateOf = ({db, schedules, backups, bucket}) => ({
  database: readDatabase(db),
  schedules: readSchedules(schedules),
  backups: readBackups(backups),
  bucket: readBucket(bucket),
});
const HEALTHY = stateOf({
  db: DB_ON,
  schedules: [SCHEDULE],
  backups: [backup('b2', 5), backup('b1', 29)],
  bucket: BUCKET_ON,
});

test('seconds reads durations and refuses the rest', () => {
  assert.equal(seconds('604800s'), 604800);
  assert.equal(seconds(604800), 604800);
  assert.equal(seconds('604800'), 604800);
  for (const bad of [undefined, null, '7d', '', {}, 'x'])
    assert.equal(seconds(bad), null);
});

test('the readers understand gcloud output, and say "unknown" for anything else', () => {
  assert.equal(readDatabase(DB_ON).pitr, true);
  assert.equal(readDatabase(DB_OFF).pitr, false);
  assert.equal(readDatabase(DB_ON).deleteProtection, true);
  assert.equal(readDatabase(DB_OFF).deleteProtection, false);
  assert.equal(readDatabase(DB_ON).location, 'nam5');
  assert.equal(readDatabase({}).known, false);
  assert.equal(readDatabase(null).known, false);
  assert.deepEqual(readSchedules([SCHEDULE]).items[0], {
    name: SCHEDULE.name,
    daily: true,
    weekly: false,
    retentionSeconds: 604800,
  });
  assert.equal(readSchedules([]).known, true);
  assert.equal(readSchedules({oops: 1}).known, false);
  assert.equal(readBucket(BUCKET_ON).softDeleteSeconds, 604800);
  assert.equal(readBucket(BUCKET_OFF).softDeleteSeconds, 0);
  assert.equal(readBucket({}).known, false);
  // gcloud storage has also printed camelCase.
  assert.equal(
    readBucket({softDeletePolicy: {retentionDurationSeconds: '604800'}})
      .softDeleteSeconds,
    604800,
  );
});

test('backups are the default database only, newest first, and need a snapshot time', () => {
  const other = {
    ...backup('x', 1),
    database: 'projects/botracing-61/databases/drill-1',
  };
  const noTime = {...backup('y', 2), snapshotTime: undefined};
  const read = readBackups([
    backup('old', 30),
    other,
    backup('new', 3),
    noTime,
  ]);
  assert.deepEqual(
    read.items.map(b => b.name.split('/').pop()),
    ['new', 'old'],
  );
});

test('planEnable: everything is needed on a bare project, in a safe order', () => {
  const bare = stateOf({
    db: DB_OFF,
    schedules: [],
    backups: [],
    bucket: BUCKET_OFF,
  });
  const steps = planEnable(bare);
  assert.deepEqual(
    steps.map(s => s.id),
    ['pitr', 'delete-protection', 'backup-schedule', 'soft-delete'],
  );
  assert.ok(steps.every(s => !s.done && s.known));
  assert.deepEqual(steps[0].args, [
    'firestore',
    'databases',
    'update',
    '--database=(default)',
    '--project=botracing-61',
    '--enable-pitr',
  ]);
  assert.ok(steps[2].args.includes('--recurrence=daily'));
  assert.ok(steps[2].args.includes('--retention=7d'));
  assert.ok(steps[3].args.includes('--soft-delete-duration=7d'));
  assert.ok(steps[3].args.includes('gs://botracing-61-lmu'));
});

test('planEnable: what is already on is done, a too-short schedule or soft delete is not', () => {
  assert.ok(planEnable(HEALTHY).every(s => s.done));
  const short = stateOf({
    db: DB_ON,
    schedules: [{...SCHEDULE, retention: `${3 * DAY}s`}],
    backups: [],
    bucket: {soft_delete_policy: {retention_duration_seconds: String(3 * DAY)}},
  });
  const done = Object.fromEntries(planEnable(short).map(s => [s.id, s.done]));
  assert.deepEqual(done, {
    pitr: true,
    'delete-protection': true,
    'backup-schedule': false,
    'soft-delete': false,
  });
  const weekly = stateOf({
    db: DB_ON,
    schedules: [
      {name: 'w', retention: '604800s', weeklyRecurrence: {day: 'MONDAY'}},
    ],
    backups: [],
    bucket: BUCKET_ON,
  });
  assert.equal(
    planEnable(weekly).find(s => s.id === 'backup-schedule').done,
    false,
  );
});

test('evaluateStatus: healthy is ok; each failure is named', () => {
  assert.equal(evaluateStatus(HEALTHY, CONFIG, NOW).ok, true);
  const fails = (patch, text) => {
    const result = evaluateStatus(
      stateOf({
        db: DB_ON,
        schedules: [SCHEDULE],
        backups: [backup('b', 5)],
        bucket: BUCKET_ON,
        ...patch,
      }),
      CONFIG,
      NOW,
    );
    assert.equal(result.ok, false, text);
    assert.match(result.problems.join('\n'), text);
  };
  fails({db: DB_OFF}, /PITR/);
  fails(
    {db: {...DB_ON, deleteProtectionState: 'DELETE_PROTECTION_DISABLED'}},
    /delete protection/i,
  );
  fails({schedules: []}, /backup schedule/);
  fails({backups: []}, /Newest backup: none READY/);
  fails({backups: [backup('b', 27)]}, /Newest backup.*27\.0 h old/);
  fails({backups: [backup('b', 5, 'CREATING')]}, /none READY/);
  fails({bucket: BUCKET_OFF}, /soft delete/i);
});

test('evaluateStatus: a backup at the 26 h limit passes, just past it fails; two schedules warn', () => {
  const at = h =>
    evaluateStatus(
      stateOf({
        db: DB_ON,
        schedules: [SCHEDULE],
        backups: [backup('b', h)],
        bucket: BUCKET_ON,
      }),
      CONFIG,
      NOW,
    ).ok;
  assert.equal(at(26), true);
  assert.equal(at(26.1), false);
  const two = evaluateStatus(
    stateOf({
      db: DB_ON,
      schedules: [SCHEDULE, SCHEDULE],
      backups: [backup('b', 5)],
      bucket: BUCKET_ON,
    }),
    CONFIG,
    NOW,
  );
  assert.ok(
    two.lines.some(l => l.startsWith('warn') && /2 daily schedules/.test(l)),
  );
});

test('scratch names are valid, drill-prefixed and never the live database', () => {
  const name = scratchName(new Date('2026-10-06T03:07:00Z'));
  assert.equal(name, 'drill-20261006-0307');
  assert.match(name, /^drill-\d{8}-\d{4}$/);
});

test('drill bounds: only sessions written by the snapshot count, with their laps and recordings', () => {
  const snapshot = hoursAgo(5);
  const sessions = [
    {updatedAt: hoursAgo(10), lapCount: 12, recordingIds: ['a', 'b']},
    {updatedAt: hoursAgo(6), lapCount: 3, recordingIds: ['c']},
    {updatedAt: hoursAgo(1), lapCount: 40, recordingIds: ['d', 'e', 'f']}, // after the snapshot
    {updatedAt: hoursAgo(9), lapCount: undefined, recordingIds: undefined},
  ];
  assert.deepEqual(drillLowerBounds(sessions, snapshot), {
    sessions: 3,
    laps: 15,
    recordings: 3,
  });
});

test('the drill does not flake when live grows while it runs (marshal #176)', () => {
  const bounds = {sessions: 10, laps: 100, recordings: 12};
  const live = {
    sessions: 12,
    laps: 130,
    recordings: 15,
    tracks: 17,
    trackBoundaries: 17,
    users: 2,
    uploaders: 1,
  };
  // Two sessions were uploaded after the backup: restored is lower than live, above the bound.
  const restored = {
    sessions: 10,
    laps: 100,
    recordings: 12,
    tracks: 17,
    trackBoundaries: 17,
    users: 2,
    uploaders: 1,
  };
  const result = compareDrill({live, restored, bounds});
  assert.equal(result.pass, true);
  // Live moving by a lot more while the drill ran changes nothing.
  assert.equal(
    compareDrill({live: {...live, laps: 999}, restored, bounds}).pass,
    true,
  );
});

test('the drill fails when the restore is short, empty or larger than live', () => {
  const bounds = {sessions: 10, laps: 100, recordings: 12};
  const live = {sessions: 12, laps: 130, recordings: 15, tracks: 17};
  const ok = {sessions: 10, laps: 100, recordings: 12, tracks: 17};
  assert.equal(compareDrill({live, restored: ok, bounds}).pass, true);
  const failing = restored =>
    compareDrill({live, restored, bounds})
      .rows.filter(r => !r.pass)
      .map(r => r.collection);
  assert.deepEqual(failing({...ok, laps: 99}), ['laps']);
  assert.deepEqual(failing({...ok, tracks: 0}), ['tracks']); // live has some, restored none
  assert.deepEqual(failing({...ok, sessions: 13}), ['sessions']); // more than live
  assert.deepEqual(failing({}), ['sessions', 'laps', 'recordings', 'tracks']);
  // An empty collection that is empty live is fine.
  const quiet = compareDrill({
    live: {...live, uploaders: 0},
    restored: {...ok, uploaders: 0},
    bounds,
  });
  assert.equal(quiet.pass, true);
});

test('Windows quoting: safe words stay, parentheses and spaces are quoted', () => {
  assert.equal(
    quoteForWindows('--project=botracing-61'),
    '--project=botracing-61',
  );
  assert.equal(
    quoteForWindows('--database=(default)'),
    '"--database=(default)"',
  );
  assert.equal(quoteForWindows('a b'), '"a b"');
  assert.equal(quoteForWindows('say "hi"'), '"say \\"hi\\""');
});

test('the runner: gcloud.cmd through a shell on Windows, plain gcloud elsewhere, JSON parsed on request', () => {
  const calls = [];
  const exec = (bin, args, options) => {
    calls.push({bin, args, shell: options.shell});
    return args.includes('--format=json') ? '{"a":1}' : 'text';
  };
  const win = gcloudRunner({exec, platform: 'win32'});
  assert.deepEqual(win(['x', '--database=(default)', '--format=json']), {a: 1});
  assert.deepEqual(calls[0], {
    bin: 'gcloud.cmd',
    args: ['x', '"--database=(default)"', '--format=json'],
    shell: true,
  });
  const unix = gcloudRunner({exec, platform: 'linux'});
  assert.equal(unix(['y']), 'text');
  assert.deepEqual(calls[1], {bin: 'gcloud', args: ['y'], shell: false});
});

function fakeRun(table) {
  const log = [];
  const run = args => {
    log.push(args);
    const key = args.slice(0, 3).join(' ');
    const hit = table[key];
    if (hit instanceof Error) throw hit;
    if (typeof hit === 'function') return hit(args);
    return hit ?? null;
  };
  run.log = log;
  return run;
}
const tableFor = ({db, schedules, backups, bucket}) => ({
  'firestore databases describe': db,
  'firestore backups schedules': schedules,
  'firestore backups list': backups,
  'storage buckets describe': bucket,
});

test('gatherState reads all four places, and a failing read is "unknown", not a crash', () => {
  const ok = gatherState(
    fakeRun(
      tableFor({
        db: DB_ON,
        schedules: [SCHEDULE],
        backups: [backup('b', 5)],
        bucket: BUCKET_ON,
      }),
    ),
  );
  assert.equal(evaluateStatus(ok, CONFIG, NOW).ok, true);
  const denied = gatherState(
    fakeRun(
      tableFor({
        db: new Error('PERMISSION_DENIED: nope\nmore'),
        schedules: [],
        backups: [],
        bucket: BUCKET_ON,
      }),
    ),
  );
  assert.equal(denied.database.known, false);
  assert.equal(denied.database.error, 'PERMISSION_DENIED: nope');
  // Without the database there is no location, so no backup list was asked for.
  assert.equal(denied.backups.known, false);
});

const BARE = tableFor({
  db: DB_OFF,
  schedules: [],
  backups: [],
  bucket: BUCKET_OFF,
});
const isChange = a =>
  ['update', 'create', 'restore', 'delete'].includes(a[2]) ||
  (a[1] === 'buckets' && a[2] === 'update');

test('enable: a dry run reads and prints but changes nothing', () => {
  const run = fakeRun(BARE);
  const lines = [];
  const result = enableBackups({run, log: l => lines.push(l)});
  assert.equal(run.log.filter(isChange).length, 0);
  assert.equal(result.ran, 0);
  assert.match(lines.join('\n'), /Dry run: nothing was changed/);
  assert.match(lines.join('\n'), /would run +Firestore point-in-time recovery/);
});

test('enable --apply runs each missing step once, in order, and skips what is set', () => {
  const run = fakeRun(BARE);
  enableBackups({run, apply: true, log: () => {}});
  const changes = run.log.filter(
    a =>
      a.includes('--enable-pitr') ||
      a.includes('--delete-protection') ||
      a.includes('--recurrence=daily') ||
      a.some(x => x.startsWith('--soft-delete-duration')),
  );
  assert.equal(changes.length, 4);
  assert.ok(changes[0].includes('--enable-pitr'));
  assert.ok(changes[1].includes('--delete-protection'));
  assert.ok(changes[2].includes('--recurrence=daily'));
  assert.ok(changes[3].some(x => x.startsWith('--soft-delete-duration')));

  const healthy = fakeRun(
    tableFor({
      db: DB_ON,
      schedules: [SCHEDULE],
      backups: [backup('b', 5)],
      bucket: BUCKET_ON,
    }),
  );
  const again = enableBackups({run: healthy, apply: true, log: () => {}});
  assert.equal(again.ran, 0);
  assert.equal(
    healthy.log.filter(
      a => a.includes('--enable-pitr') || a.includes('--recurrence=daily'),
    ).length,
    0,
  );
});

test('enable refuses to act on what it could not read, unless forced', () => {
  // Only the READ of the schedules is denied; creating one would work.
  const table = tableFor({
    db: DB_ON,
    schedules: args => {
      if (args[3] === 'list') throw new Error('PERMISSION_DENIED');
      return '';
    },
    backups: [],
    bucket: BUCKET_ON,
  });
  const run = fakeRun(table);
  const result = enableBackups({run, apply: true, log: () => {}});
  assert.equal(result.refused, 1);
  assert.equal(run.log.filter(a => a.includes('--recurrence=daily')).length, 0);
  const forced = fakeRun(table);
  enableBackups({run: forced, apply: true, force: true, log: () => {}});
  assert.equal(
    forced.log.filter(a => a.includes('--recurrence=daily')).length,
    1,
  );
});

test('the command lines accept only their own options', () => {
  assert.deepEqual(parseEnable([]), {apply: false, force: false});
  assert.deepEqual(parseEnable(['--apply', '--force']), {
    apply: true,
    force: true,
  });
  assert.throws(() => parseEnable(['--yes']), /unknown option/);
  assert.deepEqual(parseDrill(['--files', '--keep']), {
    files: true,
    keep: true,
    database: null,
  });
  assert.equal(
    parseDrill(['--database', 'drill-20261007-0329']).database,
    'drill-20261007-0329',
  );
  assert.throws(() => parseDrill(['--database']), /needs a name/);
  assert.throws(() => parseDrill(['--force']), /unknown option/);
});

test('status: exit-worthy result, sizes parsed, gcloud notes shown', () => {
  const run = fakeRun({
    ...tableFor({
      db: DB_ON,
      schedules: [SCHEDULE],
      backups: [backup('b', 40)],
      bucket: BUCKET_ON,
    }),
    'storage du --summarize': args =>
      args.at(-1).endsWith('/archive')
        ? '5000000000  gs://x/archive/'
        : '12000  gs://x/other/',
  });
  const lines = [];
  const result = showStatus({
    run,
    sizes: true,
    now: NOW,
    log: l => lines.push(l),
  });
  assert.equal(result.ok, false); // the newest backup is 40 h old
  assert.match(lines.join('\n'), /archive +5\.00 GB/);
  assert.equal(parseDu('123  gs://b/x'), 123);
  assert.equal(parseDu(''), null);
});

// -- the drill ---------------------------------------------------------------------

function fakeDbs({live, restored, sessions}) {
  const writes = [];
  const handle = counts => ({
    collection: name => ({
      count: () => ({
        get: async () => ({data: () => ({count: counts[name] ?? 0})}),
      }),
      select: () => ({
        get: async () => ({
          docs: (name === 'sessions' ? sessions : []).map(d => ({
            data: () => d,
          })),
        }),
      }),
      set: () => writes.push(['set', name]),
      add: () => writes.push(['add', name]),
      doc: () => ({
        set: () => writes.push(['doc-set', name]),
        delete: () => writes.push(['doc-delete', name]),
      }),
    }),
  });
  return {liveDb: handle(live), openRestored: () => handle(restored), writes};
}

const GOOD_LIVE = {
  sessions: 12,
  laps: 130,
  recordings: 15,
  tracks: 17,
  trackBoundaries: 17,
  users: 2,
  uploaders: 1,
};
const SNAP_SESSIONS = [
  {updatedAt: hoursAgo(10), lapCount: 100, recordingIds: Array(12).fill('r')},
  {updatedAt: hoursAgo(9), lapCount: 0, recordingIds: []},
  ...Array.from({length: 8}, () => ({
    updatedAt: hoursAgo(8),
    lapCount: 0,
    recordingIds: [],
  })),
  {updatedAt: hoursAgo(1), lapCount: 30, recordingIds: ['n']},
  {updatedAt: hoursAgo(1), lapCount: 0, recordingIds: ['m', 'o']},
];
const DRILL_TABLE = tableFor({
  db: DB_ON,
  schedules: [SCHEDULE],
  backups: [backup('b2', 5)],
  bucket: BUCKET_ON,
});

test('drill: restores into a scratch database, passes, deletes the scratch, never writes to live', async () => {
  const run = fakeRun(DRILL_TABLE);
  const dbs = fakeDbs({
    live: GOOD_LIVE,
    restored: {...GOOD_LIVE, sessions: 10, laps: 100, recordings: 12},
    sessions: SNAP_SESSIONS,
  });
  const lines = [];
  const result = await runDrill({
    run,
    ...dbs,
    now: new Date(NOW),
    log: l => lines.push(l),
  });
  assert.equal(result.pass, true, lines.join('\n'));
  const restore = run.log.find(a => a[1] === 'databases' && a[2] === 'restore');
  assert.ok(restore.includes('--destination-database=drill-20261006-1200'));
  assert.ok(
    restore.some(x =>
      x.startsWith(
        '--source-backup=projects/botracing-61/locations/nam5/backups/b2',
      ),
    ),
  );
  const del = run.log.find(a => a[1] === 'databases' && a[2] === 'delete');
  assert.ok(del.includes('--database=drill-20261006-1200'));
  assert.equal(dbs.writes.length, 0, 'production was written');
});

test('drill: a short restore fails the drill, and the scratch database is still deleted', async () => {
  const run = fakeRun(DRILL_TABLE);
  const dbs = fakeDbs({
    live: GOOD_LIVE,
    restored: {...GOOD_LIVE, sessions: 4, laps: 10, recordings: 3},
    sessions: SNAP_SESSIONS,
  });
  const result = await runDrill({
    run,
    ...dbs,
    now: new Date(NOW),
    log: () => {},
  });
  assert.equal(result.pass, false);
  assert.ok(run.log.some(a => a[1] === 'databases' && a[2] === 'delete'));
});

test('drill: if the restore itself blows up the scratch database is still cleaned up', async () => {
  const run = fakeRun({
    ...DRILL_TABLE,
    'firestore databases restore': new Error('FAILED_PRECONDITION'),
  });
  const dbs = fakeDbs({live: GOOD_LIVE, restored: GOOD_LIVE, sessions: []});
  await assert.rejects(
    runDrill({run, ...dbs, now: new Date(NOW), log: () => {}}),
    /FAILED_PRECONDITION/,
  );
  assert.ok(run.log.some(a => a[1] === 'databases' && a[2] === 'delete'));
});

test('drill: --keep leaves the scratch database and says how to delete it', async () => {
  const run = fakeRun(DRILL_TABLE);
  const dbs = fakeDbs({
    live: GOOD_LIVE,
    restored: {...GOOD_LIVE, sessions: 10, laps: 100, recordings: 12},
    sessions: SNAP_SESSIONS,
  });
  const lines = [];
  await runDrill({
    run,
    ...dbs,
    now: new Date(NOW),
    keep: true,
    log: l => lines.push(l),
  });
  assert.equal(
    run.log.some(a => a[1] === 'databases' && a[2] === 'delete'),
    false,
  );
  assert.match(
    lines.join('\n'),
    /gcloud firestore databases delete --database=drill-20261006-1200/,
  );
});

test('drill: no backup, or a stale one, never starts a restore', async () => {
  for (const backups of [[], [backup('b', 40)], [backup('b', 5, 'CREATING')]]) {
    const run = fakeRun(
      tableFor({db: DB_ON, schedules: [SCHEDULE], backups, bucket: BUCKET_ON}),
    );
    const dbs = fakeDbs({live: GOOD_LIVE, restored: GOOD_LIVE, sessions: []});
    const result = await runDrill({
      run,
      ...dbs,
      now: new Date(NOW),
      log: () => {},
    });
    assert.equal(result.pass, false);
    assert.equal(
      run.log.some(a => a[2] === 'restore' || a[2] === 'delete'),
      false,
    );
  }
});

test('the drill only ever touches a drill database', () => {
  assert.doesNotThrow(() => assertScratch('drill-20261006-1200', CONFIG));
  for (const bad of [
    '(default)',
    'default',
    'botracing',
    'drill-1',
    'drill-20261006-1200x',
    'xdrill-20261006-1200',
    '',
    'prod-20261006-1200',
  ])
    assert.throws(
      () => assertScratch(bad, CONFIG),
      /not a drill database/,
      bad,
    );
  // Even a well-formed name is refused when it is the configured live database.
  assert.throws(
    () =>
      assertScratch('drill-20261006-1200', {
        ...CONFIG,
        database: 'drill-20261006-1200',
      }),
    /not a drill database/,
  );
});

test('file drill: write, delete, find it soft-deleted, restore, read back, clean up', () => {
  const object = 'gs://botracing-61-lmu/backup-drill/drill-20261006-1200.txt';
  const calls = [];
  const run = args => {
    calls.push(args.slice(0, 2).join(' '));
    if (args[1] === 'ls') return `${object}#1759752000000000\n`;
    if (args[1] === 'cat') return 'backup drill 2026-10-06T12:00:00.000Z\n';
    return '';
  };
  assert.equal(
    runFileDrill({run, now: new Date(NOW), log: () => {}}).pass,
    true,
  );
  assert.deepEqual(calls, [
    'storage cp',
    'storage rm',
    'storage ls',
    'storage restore',
    'storage cat',
    'storage rm',
  ]);
});

test('file drill: an object that never shows as soft-deleted fails the drill and is removed', () => {
  const calls = [];
  const run = args => {
    calls.push(args[1]);
    return args[1] === 'ls' ? '' : '';
  };
  const result = runFileDrill({run, now: new Date(NOW), log: () => {}});
  assert.equal(result.pass, false);
  assert.equal(calls.at(-1), 'rm');
  assert.equal(calls.includes('restore'), false);
});

// -- waiting for the restore (apex: the real run died on FAILED_PRECONDITION) ----

const RESTORING = Object.assign(
  new Error('9 FAILED_PRECONDITION: database is undergoing a restore'),
  {code: 9},
);

/** A scratch database that refuses reads and deletes for the first N calls. */
function restoringDbs(busyReads, events) {
  const dbs = fakeDbs({
    live: GOOD_LIVE,
    restored: {...GOOD_LIVE, sessions: 10, laps: 100, recordings: 12},
    sessions: SNAP_SESSIONS,
  });
  let reads = 0;
  const good = dbs.openRestored();
  dbs.openRestored = () => ({
    collection: name => ({
      count: () => ({
        get: async () => {
          events.push('read');
          if (reads++ < busyReads) throw RESTORING;
          return good.collection(name).count().get();
        },
      }),
    }),
  });
  return dbs;
}

test('drill: waits out the restore before counting, and deletes only after the compare', async () => {
  const events = [];
  const run = fakeRun(DRILL_TABLE);
  const inner = run;
  const traced = args => (events.push(args[2]), inner(args));
  traced.log = run.log;
  const dbs = restoringDbs(3, events);
  const sleeps = [];
  const result = await runDrill({
    run: traced,
    ...dbs,
    now: new Date(NOW),
    sleep: async ms => sleeps.push(ms),
    intervalMs: 10,
    maxMs: 1000,
    log: () => {},
  });
  assert.equal(result.pass, true);
  assert.equal(sleeps.length, 3, 'slept once per refused read');
  const firstGoodRead = events.indexOf('read', events.indexOf('restore'));
  assert.ok(events.indexOf('restore') < firstGoodRead);
  assert.ok(events.lastIndexOf('read') < events.indexOf('delete'));
});

test('drill: a delete refused while still restoring is retried, not abandoned', async () => {
  let refused = 2;
  const run = fakeRun({
    ...DRILL_TABLE,
    'firestore databases delete': () => {
      if (refused-- > 0) throw RESTORING;
      return '';
    },
  });
  const dbs = fakeDbs({
    live: GOOD_LIVE,
    restored: {...GOOD_LIVE, sessions: 10, laps: 100, recordings: 12},
    sessions: SNAP_SESSIONS,
  });
  const lines = [];
  await runDrill({
    run,
    ...dbs,
    now: new Date(NOW),
    sleep: async () => {},
    intervalMs: 10,
    maxMs: 1000,
    log: l => lines.push(l),
  });
  assert.equal(run.log.filter(a => a[2] === 'delete').length, 3);
  assert.match(lines.join(' | '), /Deleted scratch database/);
});

const withSource = (table, source) => ({
  ...table,
  'firestore databases describe': args =>
    args.includes('--database=(default)')
      ? table['firestore databases describe']
      : {sourceInfo: {backup: {backup: source}}},
});
const NEWEST = 'projects/botracing-61/locations/nam5/backups/b2';

test('drill --database: compares an existing scratch database, restores nothing, then deletes it', async () => {
  const run = fakeRun(withSource(DRILL_TABLE, NEWEST));
  const dbs = fakeDbs({
    live: GOOD_LIVE,
    restored: {...GOOD_LIVE, sessions: 10, laps: 100, recordings: 12},
    sessions: SNAP_SESSIONS,
  });
  const result = await runDrill({
    run,
    ...dbs,
    now: new Date(NOW),
    database: 'drill-20261007-0329',
    log: () => {},
  });
  assert.equal(result.pass, true);
  assert.equal(
    run.log.some(a => a[2] === 'restore'),
    false,
  );
  const del = run.log.find(a => a[2] === 'delete');
  assert.ok(del.includes('--database=drill-20261007-0329'));
});

test('drill --database refuses anything that is not a drill database', async () => {
  for (const database of ['(default)', 'prod', 'drill-1']) {
    const run = fakeRun(DRILL_TABLE);
    const dbs = fakeDbs({live: GOOD_LIVE, restored: GOOD_LIVE, sessions: []});
    await assert.rejects(
      runDrill({run, ...dbs, now: new Date(NOW), database, log: () => {}}),
      /not a drill database/,
    );
    assert.equal(
      run.log.some(a => a[2] === 'delete'),
      false,
    );
  }
});

test('drill --database refuses a database restored from an older backup, and does not delete it', async () => {
  for (const source of [
    'projects/botracing-61/locations/nam5/backups/b1',
    undefined,
  ]) {
    const run = fakeRun(withSource(DRILL_TABLE, source));
    const dbs = fakeDbs({live: GOOD_LIVE, restored: GOOD_LIVE, sessions: []});
    const lines = [];
    const result = await runDrill({
      run,
      ...dbs,
      now: new Date(NOW),
      database: 'drill-20261007-0329',
      log: l => lines.push(l),
    });
    assert.equal(result.pass, false);
    assert.match(lines.join(' | '), /not restored from the newest backup/);
    assert.equal(
      run.log.some(a => ['delete', 'update', 'restore'].includes(a[2])),
      false,
    );
  }
});

test('whileRestoring: only a restoring error is retried, and only so long', async () => {
  assert.equal(isRestoring(RESTORING), true);
  assert.equal(isRestoring(new Error('permission denied')), false);
  // Delete protection and a missing index are FAILED_PRECONDITION too: not retried.
  assert.equal(
    isRestoring(
      new Error(
        '9 FAILED_PRECONDITION: database has delete protection enabled',
      ),
    ),
    false,
  );
  assert.equal(
    isRestoring(Object.assign(new Error('index'), {code: 9})),
    false,
  );
  await assert.rejects(
    whileRestoring(
      async () => {
        throw new Error('permission denied');
      },
      {
        sleep: async () => {},
      },
    ),
    /permission denied/,
  );
  let calls = 0;
  await assert.rejects(
    whileRestoring(
      async () => {
        calls++;
        throw RESTORING;
      },
      {
        sleep: async () => {},
        intervalMs: 10,
        maxMs: 50,
      },
    ),
    /undergoing a restore/,
  );
  assert.equal(calls, 5);
});

test('drill: delete protection is switched off on the scratch database only, before the delete', async () => {
  for (const database of [null, 'drill-20261007-0329']) {
    const run = fakeRun(withSource(DRILL_TABLE, NEWEST));
    const dbs = fakeDbs({
      live: GOOD_LIVE,
      restored: {...GOOD_LIVE, sessions: 10, laps: 100, recordings: 12},
      sessions: SNAP_SESSIONS,
    });
    await runDrill({run, ...dbs, now: new Date(NOW), database, log: () => {}});
    const updates = run.log.filter(
      a => a[1] === 'databases' && a[2] === 'update',
    );
    assert.equal(updates.length, 1);
    assert.ok(updates[0].includes('--no-delete-protection'));
    assert.match(
      updates[0].find(x => x.startsWith('--database=')),
      /^--database=drill-[0-9]{8}-[0-9]{4}$/,
    );
    const names = run.log.map(a => a[2]);
    assert.ok(names.indexOf('update') < names.indexOf('delete'));
    // Nothing anywhere names the production database for a write.
    assert.equal(
      run.log.some(
        a =>
          ['update', 'delete'].includes(a[2]) &&
          a.some(x => x === '--database=(default)'),
      ),
      false,
    );
  }
});

test('drill --keep leaves delete protection alone too', async () => {
  const run = fakeRun(DRILL_TABLE);
  const dbs = fakeDbs({
    live: GOOD_LIVE,
    restored: {...GOOD_LIVE, sessions: 10, laps: 100, recordings: 12},
    sessions: SNAP_SESSIONS,
  });
  await runDrill({run, ...dbs, now: new Date(NOW), keep: true, log: () => {}});
  assert.equal(
    run.log.some(a => a[2] === 'update'),
    false,
  );
});
