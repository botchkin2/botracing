// Calls gcloud and reads what it prints. The only file here that runs a
// process; everything it decides is in lib.mjs. `exec` is injectable so the
// tests never need gcloud.
import {execFileSync} from 'node:child_process';
import {
  CONFIG,
  readBackups,
  readBucket,
  readDatabase,
  readSchedules,
} from './lib.mjs';

// On Windows gcloud is gcloud.cmd, which Node only runs through a shell, and a
// shell reads ( ) & and friends: quote anything that is not plainly safe.
export function quoteForWindows(arg) {
  return /^[A-Za-z0-9_.\/:=@+,-]+$/.test(arg)
    ? arg
    : `"${String(arg).replace(/"/g, '\\"')}"`;
}

export function gcloudRunner({
  exec = execFileSync,
  platform = process.platform,
} = {}) {
  const windows = platform === 'win32';
  return function run(args) {
    const out = exec(
      windows ? 'gcloud.cmd' : 'gcloud',
      windows ? args.map(quoteForWindows) : args,
      {encoding: 'utf8', shell: windows, maxBuffer: 64 * 1024 * 1024},
    );
    return args.includes('--format=json') ? JSON.parse(out || 'null') : out;
  };
}

const attempt = (fn, fallback) => {
  try {
    return fn();
  } catch (error) {
    return {...fallback, error: String(error.message ?? error).split('\n')[0]};
  }
};

/** Everything status, enable and the drill need to know, read-only. */
export function gatherState(run, config = CONFIG) {
  const {project, database, bucket} = config;
  const dbArgs = [`--database=${database}`, `--project=${project}`, '--format=json'];
  const db = attempt(
    () => readDatabase(run(['firestore', 'databases', 'describe', ...dbArgs])),
    {known: false, location: null, pitr: null, deleteProtection: null},
  );
  const schedules = attempt(
    () => readSchedules(run(['firestore', 'backups', 'schedules', 'list', ...dbArgs])),
    {known: false, items: []},
  );
  const backups = db.location
    ? attempt(
        () =>
          readBackups(
            run([
              'firestore',
              'backups',
              'list',
              `--location=${db.location}`,
              `--project=${project}`,
              '--format=json',
            ]),
            database,
          ),
        {known: false, items: []},
      )
    : {known: false, items: []};
  const bucketState = attempt(
    () =>
      readBucket(
        run(['storage', 'buckets', 'describe', `gs://${bucket}`, `--project=${project}`, '--format=json']),
      ),
    {known: false, softDeleteSeconds: null},
  );
  return {database: db, schedules, backups, bucket: bucketState};
}
