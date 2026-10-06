// Copy one owner's data to another owner key: a dry run, the copy, and the
// checks. Run by whoever has the project's Admin credentials (gcloud auth
// application-default login), never from the app. The runbook is
// docs/OWNER_COPY.md; the rules are in ownerCopy.mjs and ownerCopyRun.mjs.
//
//   node tools/sessions/migrateOwner.mjs plan   --to <uid> [--from botkin] [--map-out FILE]
//        dry run: reads, writes nothing, prints counts, problems, a sample and
//        how fast it read (so the copy can be estimated). --map-out writes
//        which new id is which old one, to keep (a later server-side fold of
//        the shared track data needs it). --sessions N looks at the first N
//        sessions only.
//   node tools/sessions/migrateOwner.mjs apply  --to <uid> --backup-confirmed "<which backup, when>"
//        the copy, then the same checks as verify. One session at a time, with
//        bounded concurrency, and it prints its real rate as it goes. Safe to
//        run again: a session whose copy is current (same updatedAt) is
//        skipped without looking at its files, so the final pass after the
//        freeze costs only what changed. --full checks every file instead.
//   node tools/sessions/migrateOwner.mjs verify --to <uid> [--sessions N]
//        read-only: counts (by the database), every document and file against
//        its original
//   node tools/sessions/migrateOwner.mjs api-snapshot [--token-file F] --out FILE
//        what the API lists now; take it BEFORE the switch (no token = anonymous)
//   node tools/sessions/migrateOwner.mjs verify-api --to <uid> --token-file F --baseline FILE
//        AFTER the switch: the API with the user's token, against the snapshot
//
// Both plan and apply take --concurrency N (default 8 copies at a time).
// Nothing here deletes anything.
import {readFileSync, writeFileSync} from 'node:fs';
import {LEGACY_OWNER} from './ownerCopy.mjs';
import {copyOwner, verifyCopy} from './ownerCopyRun.mjs';
import {
  checkRead,
  compareSnapshots,
  snapshotSessions,
} from './ownerCopyApi.mjs';

const args = process.argv.slice(2);
const command = args[0] && !args[0].startsWith('--') ? args[0] : 'plan';
const flag = name => {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args[i + 1];
};
const has = name => args.includes(name);

const from = flag('--from') ?? LEGACY_OWNER;
const to = flag('--to');
const api = flag('--api') ?? 'https://botracing-61.web.app/api/lmu';
const SAFE_KEY = /^[A-Za-z0-9][A-Za-z0-9._-]{5,127}$/;

function stop(message) {
  console.error(message);
  process.exit(2);
}

// Guards that need no network, and run before any credential is touched.
const needsTo = ['plan', 'apply', 'verify', 'verify-api'].includes(command);
if (
  !['plan', 'apply', 'verify', 'api-snapshot', 'verify-api'].includes(command)
)
  stop(
    `unknown command "${command}". See the header of tools/sessions/migrateOwner.mjs`,
  );
if (needsTo) {
  if (!to) stop('--to <uid> is required');
  if (!SAFE_KEY.test(to)) stop(`--to ${to} does not look like an owner key`);
  if (to === from) stop('--from and --to are the same');
}
if (command === 'apply' && !(flag('--backup-confirmed') ?? '').trim())
  stop(
    'apply needs --backup-confirmed "<which backup exists, and when it was taken>": nothing runs against production until a backup does',
  );

const tokenOf = file => readFileSync(file, 'utf8').trim();

async function adminBackend() {
  const {connect} = await import('./store.mjs');
  const {adminCopyBackend} = await import('./ownerCopyAdmin.mjs');
  return adminCopyBackend(connect());
}

function report(result) {
  const {problems, warnings, counts, throughput, idMap} = result;
  console.log(`from ${from} to ${to}`);
  console.log(JSON.stringify(counts));
  for (const [oldId, newId] of Object.entries(idMap.sessions).slice(0, 3))
    console.log(`  session ${oldId} -> ${newId}`);
  for (const w of warnings.slice(0, 30)) console.log(`  warning: ${w}`);
  if (warnings.length > 30)
    console.log(`  ... and ${warnings.length - 30} more warnings`);
  for (const p of problems) console.log(`  PROBLEM: ${p}`);
  const t = throughput;
  console.log(
    `read ${counts.sessions} sessions in ${t.planSeconds.toFixed(
      1,
    )} s: ${t.sessionsPerSecond.toFixed(
      2,
    )} sessions/s, ${t.filesPerSecond.toFixed(
      1,
    )} files/s; ${t.megabytes.toFixed(1)} MB in ${
      counts.files
    } files to copy (${counts.skippedUnchanged} sessions already current)`,
  );
  // An estimate, labelled as one: a copy costs more than the metadata read
  // above, so the real rate (printed while applying) decides.
  const mbps = Number(flag('--assume-mbps') ?? 20);
  const minutes = t.megabytes / mbps / 60;
  console.log(
    `estimate: at an assumed ${mbps} MB/s the copy would take about ${minutes.toFixed(
      1,
    )} minutes (an assumption, not a measurement: apply prints the real rate every 10 sessions)`,
  );
}

const conc = (() => {
  const n = Number(flag('--concurrency') ?? 8);
  return {stat: n * 2, copy: n, docs: n};
})();
const limit = flag('--sessions') ? Number(flag('--sessions')) : Infinity;

if (command === 'plan' || command === 'apply') {
  const backend = await adminBackend();
  const apply = command === 'apply';
  if (apply) console.log(`applying (backup: ${flag('--backup-confirmed')})`);
  const result = await copyOwner(backend, {
    from,
    to,
    apply,
    full: has('--full'),
    limit,
    conc,
    progress: line => console.log(`  ${line}`),
  });
  report(result);
  const mapOut = flag('--map-out');
  if (mapOut && result.problems.length === 0) {
    writeFileSync(mapOut, JSON.stringify(result.idMap));
    console.log(`id map written to ${mapOut}`);
  }
  if (result.problems.length > 0) {
    console.log(`\n${result.problems.length} problem(s): nothing was written.`);
    process.exit(1);
  }
  if (!apply) {
    console.log(
      '\ndry run: nothing was written. Review the above, then apply.',
    );
  } else {
    console.log(`\n${JSON.stringify(result.applied)}`);
    const diffs = await verifyCopy(backend, {from, to, limit, conc});
    for (const d of diffs.slice(0, 50)) console.log(`  DIFFERENCE: ${d}`);
    if (diffs.length > 0) {
      console.log(
        `\n${diffs.length} difference(s) between the copy and the original.`,
      );
      process.exit(1);
    }
    console.log(
      '\ncopy verified: counts, documents, files and file metadata match the originals.',
    );
  }
} else if (command === 'verify') {
  const backend = await adminBackend();
  const diffs = await verifyCopy(backend, {from, to, limit, conc});
  for (const d of diffs.slice(0, 50)) console.log(`  DIFFERENCE: ${d}`);
  console.log(
    diffs.length === 0 ? 'copy verified.' : `${diffs.length} difference(s).`,
  );
  process.exit(diffs.length === 0 ? 0 : 1);
} else if (command === 'api-snapshot') {
  const file = flag('--out');
  if (!file) stop('--out FILE is required');
  const tokenFile = flag('--token-file');
  const snapshot = await snapshotSessions(fetch, {
    api,
    token: tokenFile ? tokenOf(tokenFile) : null,
  });
  writeFileSync(file, JSON.stringify(snapshot));
  console.log(
    `${snapshot.total} sessions written to ${file} (${
      tokenFile ? 'with a token' : 'anonymous'
    })`,
  );
} else if (command === 'verify-api') {
  const tokenFile = flag('--token-file');
  const baselineFile = flag('--baseline');
  if (!tokenFile || !baselineFile)
    stop('--token-file and --baseline are required');
  const token = tokenOf(tokenFile);
  const baseline = JSON.parse(readFileSync(baselineFile, 'utf8'));
  const after = await snapshotSessions(fetch, {api, token});
  const diffs = compareSnapshots(baseline, after);
  // Read a sample of the copies through the API, as the user would.
  const sample = Number(flag('--sample') ?? 20);
  const newIds = after.items.slice(0, sample).map(i => i.id);
  const read = await checkRead(fetch, {api, token, newIds});
  diffs.push(...read.diffs);
  for (const n of read.notes) console.log(`  note: ${n}`);
  for (const d of diffs) console.log(`  DIFFERENCE: ${d}`);
  console.log(
    diffs.length === 0
      ? `API check passed: ${after.total} sessions equal to the baseline apart from ids, ${newIds.length} read through the API.`
      : `${diffs.length} difference(s).`,
  );
  process.exit(diffs.length === 0 ? 0 : 1);
}
