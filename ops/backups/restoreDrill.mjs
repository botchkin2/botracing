// Proves a restore: the newest Firestore backup is restored into a SCRATCH
// database, its document counts are checked against what the live database must
// contain, and the scratch database is deleted. Production is only read.
//
//   node ops/backups/restoreDrill.mjs                   Firestore restore drill
//   node ops/backups/restoreDrill.mjs --files           also prove bucket soft delete:
//                                                       write, delete and restore one
//                                                       tiny object under backup-drill/
//   node ops/backups/restoreDrill.mjs --keep            leave the scratch database
//                                                       for inspection (delete it yourself)
//   node ops/backups/restoreDrill.mjs --database drill-YYYYMMDD-HHMM
//                                                       do not restore: compare an
//                                                       already-restored scratch database
//                                                       (e.g. one a failed run left behind)
//
// A restore takes minutes and the new database refuses reads and deletes while
// it runs (FAILED_PRECONDITION "undergoing a restore"), so the drill waits for it
// to finish before counting, and deletes the scratch database only afterwards.
//
// Needs `gcloud auth login` and `gcloud auth application-default login` as an
// owner of the project. Exit 0 only when every check passes.
import {mkdtempSync, writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {gatherState, gcloudRunner} from './gcloud.mjs';
import {
  COLLECTIONS,
  CONFIG,
  compareDrill,
  drillLowerBounds,
  scratchName,
} from './lib.mjs';

export function parseArgs(argv) {
  const out = {files: false, keep: false, database: null};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--files') out.files = true;
    else if (a === '--keep') out.keep = true;
    else if (a === '--database') {
      const v = argv[++i];
      if (!v || v.startsWith('--')) throw new Error('--database needs a name');
      out.database = v;
    } else throw new Error(`unknown option: ${a}`);
  }
  return out;
}

/**
 * Firestore's wording for a database that is still being restored. Other
 * FAILED_PRECONDITIONs (delete protection, a missing index) are real errors
 * and must not be waited on.
 */
export const isRestoring = error =>
  /undergoing a restore/i.test(String(error?.message ?? error));

const WAIT = {intervalMs: 15_000, maxMs: 45 * 60_000};
const realSleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Runs fn() until it stops failing with "still restoring"; any other error is
 * thrown at once, and so is the last one after maxMs.
 */
export async function whileRestoring(
  fn,
  {
    sleep = realSleep,
    intervalMs = WAIT.intervalMs,
    maxMs = WAIT.maxMs,
    onWait,
  } = {},
) {
  const attempts = Math.max(1, Math.ceil(maxMs / intervalMs));
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (error) {
      if (!isRestoring(error) || i >= attempts) throw error;
      onWait?.(i);
      await sleep(intervalMs);
    }
  }
}

const countOf = async (db, name) =>
  (await db.collection(name).count().get()).data().count;

// A deletion must only ever name the scratch database this run created.
export function assertScratch(name, config) {
  if (!/^drill-\d{8}-\d{4}$/.test(name) || name === config.database)
    throw new Error(
      `refusing to touch database '${name}': not a drill database`,
    );
}

/**
 * run(args): gcloud; liveDb: the production Firestore (read only here);
 * openRestored(name): a Firestore handle on the scratch database.
 */
export async function runDrill({
  run,
  liveDb,
  openRestored,
  config = CONFIG,
  now = new Date(),
  keep = false,
  database = null,
  sleep,
  intervalMs,
  maxMs,
  log = console.log,
}) {
  const wait = fn =>
    whileRestoring(fn, {
      sleep,
      intervalMs,
      maxMs,
      onWait: i => i % 4 === 1 && log('  still restoring, waiting...'),
    });
  const state = gatherState(run, config);
  const backup = state.backups.items.find(b => b.state === 'READY');
  if (!backup) {
    log(
      'FAIL no READY backup to restore (is the schedule on, and has a day passed?)',
    );
    return {pass: false, reason: 'no backup'};
  }
  const ageH = (now.getTime() - Date.parse(backup.snapshotTime)) / 3_600_000;
  log(
    `Newest backup: ${backup.name}\n  snapshot ${
      backup.snapshotTime
    } (${ageH.toFixed(1)} h old)`,
  );
  if (ageH > config.maxBackupAgeHours) {
    log(
      `FAIL the newest backup is older than ${config.maxBackupAgeHours} h: the schedule has stopped`,
    );
    return {pass: false, reason: 'backup too old'};
  }

  const scratch = database ?? scratchName(now);
  assertScratch(scratch, config);
  if (database) {
    // The lower bounds come from the newest backup, so the database must too.
    const info = run([
      'firestore',
      'databases',
      'describe',
      `--database=${scratch}`,
      `--project=${config.project}`,
      '--format=json',
    ]);
    const source = info?.sourceInfo?.backup?.backup;
    if (!source || source.split('/').pop() !== backup.name.split('/').pop()) {
      log(
        `FAIL '${scratch}' was not restored from the newest backup (it says: ${
          source ?? 'no source backup'
        }; newest: ${backup.name}). Not comparing, not deleting it.`,
      );
      return {pass: false, reason: 'wrong source backup', scratch, backup};
    }
  }
  let result;
  try {
    if (database) {
      log(
        `Using the already-restored database '${scratch}' (no restore started; it must come from the backup above).`,
      );
    } else {
      log(
        `Restoring into scratch database '${scratch}' (production is not written)...`,
      );
      run([
        'firestore',
        'databases',
        'restore',
        `--source-backup=${backup.name}`,
        `--destination-database=${scratch}`,
        `--project=${config.project}`,
      ]);
    }
    const restoredDb = openRestored(scratch);
    // The first read doubles as the wait: it fails until the restore is done.
    await wait(() => countOf(restoredDb, COLLECTIONS[0]));
    log('Restore finished; counting.');
    const live = {};
    const restored = {};
    for (const name of COLLECTIONS) {
      live[name] = await countOf(liveDb, name);
      restored[name] = await wait(() => countOf(restoredDb, name));
    }
    const sessionDocs = (
      await liveDb
        .collection('sessions')
        .select('updatedAt', 'lapCount', 'recordingIds')
        .get()
    ).docs.map(d => d.data());
    const bounds = drillLowerBounds(sessionDocs, backup.snapshotTime);
    result = compareDrill({live, restored, bounds});
    for (const row of result.rows)
      log(
        `${row.pass ? 'PASS' : 'FAIL'} ${row.collection.padEnd(16)} ${row.why}`,
      );
  } finally {
    if (keep) {
      log(
        `Kept '${scratch}'. Delete it when done: gcloud firestore databases delete --database=${scratch} --project=${config.project}`,
      );
    } else {
      try {
        // After the compare (or a failure): wait out a restore still running.
        // A restored database inherits delete protection; switch it off on
        // the scratch database only (assertScratch ran above, and again here).
        assertScratch(scratch, config);
        await wait(() =>
          run([
            'firestore',
            'databases',
            'update',
            `--database=${scratch}`,
            '--no-delete-protection',
            `--project=${config.project}`,
          ]),
        );
        await wait(() =>
          run([
            'firestore',
            'databases',
            'delete',
            `--database=${scratch}`,
            `--project=${config.project}`,
          ]),
        );
        log(`Deleted scratch database '${scratch}'.`);
      } catch (error) {
        log(
          `COULD NOT DELETE '${scratch}' (${
            String(error.message).split('\n')[0]
          }): delete it by hand, it is billed.`,
        );
      }
    }
  }
  return {pass: result?.pass === true, rows: result?.rows, scratch, backup};
}

/** Soft delete, proven with one tiny object under backup-drill/. */
export function runFileDrill({
  run,
  config = CONFIG,
  now = new Date(),
  log = console.log,
}) {
  const object = `gs://${config.bucket}/backup-drill/${scratchName(now)}.txt`;
  const dir = mkdtempSync(join(tmpdir(), 'backup-drill-'));
  const local = join(dir, 'probe.txt');
  writeFileSync(local, `backup drill ${now.toISOString()}\n`);
  const stage = (label, fn) => {
    try {
      const out = fn();
      log(`PASS ${label}`);
      return out;
    } catch (error) {
      log(`FAIL ${label}: ${String(error.message).split('\n')[0]}`);
      throw error;
    }
  };
  try {
    stage('write a probe object', () =>
      run(['storage', 'cp', local, object, `--project=${config.project}`]),
    );
    stage('delete it (it goes to soft delete)', () =>
      run(['storage', 'rm', object, `--project=${config.project}`]),
    );
    const listing = stage('see it among the soft-deleted objects', () => {
      const out = run([
        'storage',
        'ls',
        '--soft-deleted',
        object,
        `--project=${config.project}`,
      ]);
      if (!String(out).includes(`${object}#`))
        throw new Error('not listed as soft-deleted');
      return String(out);
    });
    const versioned = listing
      .split(/\r?\n/)
      .find(l => l.startsWith(`${object}#`))
      .trim();
    stage('restore it', () =>
      run(['storage', 'restore', versioned, `--project=${config.project}`]),
    );
    stage('read it back', () => {
      const text = run([
        'storage',
        'cat',
        object,
        `--project=${config.project}`,
      ]);
      if (!String(text).startsWith('backup drill'))
        throw new Error('content does not match');
    });
    run(['storage', 'rm', object, `--project=${config.project}`]);
    return {pass: true};
  } catch {
    try {
      run(['storage', 'rm', object, `--project=${config.project}`]);
    } catch {
      // nothing left to remove
    }
    return {pass: false};
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    const opts = parseArgs(process.argv.slice(2));
    const here = dirname(fileURLToPath(import.meta.url));
    const require = createRequire(
      resolve(here, '../../functions/package.json'),
    );
    const admin = require('firebase-admin');
    const {getFirestore} = require('firebase-admin/firestore');
    process.env.GOOGLE_CLOUD_QUOTA_PROJECT ??= CONFIG.project;
    admin.initializeApp({projectId: CONFIG.project});
    const run = gcloudRunner();
    const result = await runDrill({
      run,
      liveDb: admin.firestore(),
      openRestored: name => getFirestore(admin.app(), name),
      keep: opts.keep,
      database: opts.database,
    });
    let pass = result.pass;
    if (opts.files) pass = runFileDrill({run}).pass && pass;
    console.log(pass ? '\nDRILL PASSED' : '\nDRILL FAILED');
    process.exit(pass ? 0 : 1);
  } catch (error) {
    console.error(error.message);
    process.exit(2);
  }
}
