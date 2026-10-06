// Backups of the lap store (pit wall thread 3 #5, thread 2 #140/#151/#176).
// Pure planning and checking, no gcloud and no Firebase here, so the tests run
// anywhere; enable.mjs, status.mjs and restoreDrill.mjs do the calling.
//
// What protects what, all platform features (no copy of the bucket):
//   Firestore PITR            undo a bad write or delete, to the second, for 7 days
//   Firestore daily backups   a managed backup, 7 days, restorable into a NEW database
//   Bucket soft delete        a deleted or overwritten object comes back for 7 days
//   Firestore delete protection   the database itself cannot be deleted by accident

export const CONFIG = {
  project: 'botracing-61',
  database: '(default)',
  bucket: 'botracing-61-lmu',
  retentionDays: 7,
  // A daily backup that is older than this means the schedule has stopped.
  maxBackupAgeHours: 26,
};

// The collections the drill counts (docs/STORAGE.md).
export const COLLECTIONS = [
  'sessions',
  'laps',
  'recordings',
  'tracks',
  'trackBoundaries',
  'users',
  'uploaders',
];

/** "604800s" or 604800 or "604800" -> 604800; null when it is not a duration. */
export function seconds(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return null;
  const match = value.trim().match(/^(\d+(?:\.\d+)?)s?$/);
  return match ? Number(match[1]) : null;
}

const DAY_S = 86_400;

// -- reading what gcloud printed ---------------------------------------------
// The field names are from gcloud's JSON output for these commands; anything
// that does not look like them reads as `known: false`, and enable.mjs then
// refuses to guess (a second backup schedule would double the cost).

/** From `gcloud firestore databases describe --format=json`. */
export function readDatabase(json) {
  if (!json || typeof json !== 'object')
    return {known: false, location: null, pitr: null, deleteProtection: null};
  const pitrText = String(json.pointInTimeRecoveryEnablement ?? '');
  const protectText = String(json.deleteProtectionState ?? '');
  return {
    known: typeof json.pointInTimeRecoveryEnablement === 'string',
    location: typeof json.locationId === 'string' ? json.locationId : null,
    pitr: pitrText.includes('ENABLED') && !pitrText.includes('DISABLED'),
    pitrRetentionSeconds: seconds(json.versionRetentionPeriod),
    deleteProtection:
      protectText === '' ? null : protectText.includes('ENABLED') && !protectText.includes('DISABLED'),
  };
}

/** From `gcloud firestore backups schedules list --format=json`. */
export function readSchedules(json) {
  if (!Array.isArray(json)) return {known: false, items: []};
  return {
    known: true,
    items: json.map(s => ({
      name: String(s.name ?? ''),
      daily: s.dailyRecurrence !== undefined,
      weekly: s.weeklyRecurrence !== undefined,
      retentionSeconds: seconds(s.retention),
    })),
  };
}

/** From `gcloud firestore backups list --location=L --format=json`, newest first. */
export function readBackups(json, database = CONFIG.database) {
  if (!Array.isArray(json)) return {known: false, items: []};
  const wanted = database === '(default)' ? '/databases/(default)' : `/databases/${database}`;
  const items = json
    .filter(b => String(b.database ?? '').endsWith(wanted))
    .map(b => ({
      name: String(b.name ?? ''),
      snapshotTime: typeof b.snapshotTime === 'string' ? b.snapshotTime : null,
      state: String(b.state ?? ''),
    }))
    .filter(b => b.snapshotTime)
    .sort((a, b) => Date.parse(b.snapshotTime) - Date.parse(a.snapshotTime));
  return {known: true, items};
}

/** From `gcloud storage buckets describe gs://B --format=json`. */
export function readBucket(json) {
  if (!json || typeof json !== 'object') return {known: false, softDeleteSeconds: null};
  const policy = json.soft_delete_policy ?? json.softDeletePolicy;
  if (policy === undefined) return {known: false, softDeleteSeconds: null};
  const raw = policy?.retention_duration_seconds ?? policy?.retentionDurationSeconds;
  return {known: true, softDeleteSeconds: seconds(raw) ?? 0};
}

// -- what to turn on -----------------------------------------------------------

/**
 * The steps that bring the project to the wanted state, in order, each marked
 * `done` when it is already so (so a re-run changes nothing). `args` are the
 * gcloud arguments, no shell involved.
 */
export function planEnable(state, config = CONFIG) {
  const {project, database, bucket, retentionDays} = config;
  const wantSeconds = retentionDays * DAY_S;
  const db = ['--database=' + database, '--project=' + project];
  const steps = [];

  steps.push({
    id: 'pitr',
    title: `Firestore point-in-time recovery, ${retentionDays} days`,
    known: state.database.known,
    done: state.database.pitr === true,
    args: ['firestore', 'databases', 'update', ...db, '--enable-pitr'],
  });
  steps.push({
    id: 'delete-protection',
    title: 'Firestore delete protection (the database cannot be deleted by accident)',
    known: state.database.deleteProtection !== null,
    done: state.database.deleteProtection === true,
    args: ['firestore', 'databases', 'update', ...db, '--delete-protection'],
  });
  const dailyOk = state.schedules.items.some(
    s => s.daily && s.retentionSeconds !== null && s.retentionSeconds >= wantSeconds,
  );
  steps.push({
    id: 'backup-schedule',
    title: `Firestore daily backups, kept ${retentionDays} days`,
    known: state.schedules.known,
    done: dailyOk,
    args: [
      'firestore',
      'backups',
      'schedules',
      'create',
      ...db,
      '--recurrence=daily',
      `--retention=${retentionDays}d`,
    ],
  });
  steps.push({
    id: 'soft-delete',
    title: `Bucket soft delete, ${retentionDays} days (deleted or overwritten objects come back)`,
    known: state.bucket.known,
    done: (state.bucket.softDeleteSeconds ?? 0) >= wantSeconds,
    args: [
      'storage',
      'buckets',
      'update',
      `gs://${bucket}`,
      `--soft-delete-duration=${retentionDays}d`,
      `--project=${project}`,
    ],
  });
  return steps;
}

// -- is it healthy now -----------------------------------------------------------

/** Problems and a printable line per check; `ok` when there are no problems. */
export function evaluateStatus(state, config = CONFIG, now = Date.now()) {
  const problems = [];
  const lines = [];
  const check = (label, good, detail) => {
    lines.push(`${good ? 'ok  ' : 'FAIL'} ${label}: ${detail}`);
    if (!good) problems.push(`${label}: ${detail}`);
  };
  const days = config.retentionDays;
  const want = days * DAY_S;

  check(
    'Firestore PITR',
    state.database.known && state.database.pitr === true,
    state.database.known ? (state.database.pitr ? 'enabled' : 'DISABLED') : 'could not read the database',
  );
  check(
    'Firestore delete protection',
    state.database.deleteProtection === true,
    state.database.deleteProtection === null ? 'unknown' : state.database.deleteProtection ? 'enabled' : 'DISABLED',
  );
  const daily = state.schedules.items.filter(s => s.daily);
  check(
    'Firestore backup schedule',
    daily.some(s => (s.retentionSeconds ?? 0) >= want),
    daily.length
      ? daily.map(s => `daily, kept ${Math.round((s.retentionSeconds ?? 0) / DAY_S)} d`).join('; ')
      : 'no daily schedule',
  );
  if (daily.length > 1)
    lines.push(`warn ${daily.length} daily schedules: each one is billed; keep one`);
  const newest = state.backups.items.find(b => b.state === 'READY');
  if (!newest) {
    check('Newest backup', false, 'none READY');
  } else {
    const ageH = (now - Date.parse(newest.snapshotTime)) / 3_600_000;
    check(
      'Newest backup',
      ageH <= config.maxBackupAgeHours,
      `${newest.snapshotTime} (${ageH.toFixed(1)} h old, limit ${config.maxBackupAgeHours} h)`,
    );
  }
  check(
    'Bucket soft delete',
    (state.bucket.softDeleteSeconds ?? 0) >= want,
    state.bucket.known
      ? `${Math.round((state.bucket.softDeleteSeconds ?? 0) / DAY_S)} d (want ${days})`
      : 'could not read the bucket',
  );
  return {ok: problems.length === 0, problems, lines};
}

// -- the restore drill -------------------------------------------------------------

const pad = n => String(n).padStart(2, '0');

/** drill-YYYYMMDD-HHMM, a valid Firestore database id. */
export function scratchName(date = new Date()) {
  return `drill-${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}-${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}`;
}

/**
 * What the restored copy must at least hold. Live counts move while the drill
 * runs (the tray uploads), so "restored == live" would flake and train people
 * to ignore a FAIL (marshal #176). Instead: a document last written at or
 * before the backup's snapshot was in the backup, so
 *   restored >= (what the live docs say existed by then)  and  restored <= live.
 * Only sessions carry an updatedAt; their lapCount and recordingIds give the
 * laps and recordings that belonged to them. The other collections are small
 * and rarely written: they must simply not be empty when live is not.
 *
 * `sessions` is [{updatedAt, lapCount, recordingIds}] from the live database.
 */
export function drillLowerBounds(sessions, snapshotTime) {
  const cutoff = Date.parse(snapshotTime);
  const before = sessions.filter(s => Date.parse(s.updatedAt) <= cutoff);
  return {
    sessions: before.length,
    laps: before.reduce((n, s) => n + (Number(s.lapCount) || 0), 0),
    recordings: before.reduce(
      (n, s) => n + (Array.isArray(s.recordingIds) ? s.recordingIds.length : 0),
      0,
    ),
  };
}

/**
 * live and restored: {collection: count}. bounds from drillLowerBounds.
 * Returns {pass, rows} with one row per collection and why it passed or failed.
 */
export function compareDrill({live, restored, bounds}) {
  const rows = [];
  for (const name of Object.keys(live)) {
    const l = live[name];
    const r = restored[name] ?? 0;
    const lower = bounds[name] ?? (l > 0 ? 1 : 0);
    let pass = true;
    let why = `restored ${r}, live ${l}, at least ${lower}`;
    if (r < lower) {
      pass = false;
      why += `: restored is below what the backup must hold`;
    } else if (r > l) {
      pass = false;
      why += `: restored has more than live now (a delete since the backup would explain a few; investigate more)`;
    }
    rows.push({collection: name, live: l, restored: r, lower, pass, why});
  }
  return {pass: rows.every(r => r.pass), rows};
}
