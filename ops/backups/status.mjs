// Read-only: are the backups on, and is the newest one recent?
//
//   node ops/backups/status.mjs             prints a line per check; exit 1 when
//                                           anything fails (so a scheduled run can alert)
//   node ops/backups/status.mjs --sizes     also the bucket size by top folder
//
// Run it daily from somewhere that can alert (pit wall thread 3 #10): a backup
// check nobody reads is no check. Needs gcloud logged in with read access.
import {pathToFileURL} from 'node:url';
import {gatherState, gcloudRunner} from './gcloud.mjs';
import {CONFIG, evaluateStatus} from './lib.mjs';

const FOLDERS = [
  'archive',
  'traces',
  'bands',
  'field',
  'slices',
  'surface',
  'trackmaps',
];

/** `gcloud storage du --summarize` prints "<bytes>  gs://...". */
export function parseDu(text) {
  const match = String(text)
    .trim()
    .match(/^(\d+)\s/);
  return match ? Number(match[1]) : null;
}

const human = bytes =>
  bytes === null
    ? 'unknown'
    : bytes > 1e9
    ? `${(bytes / 1e9).toFixed(2)} GB`
    : `${(bytes / 1e6).toFixed(1)} MB`;

export function showStatus({
  run,
  sizes = false,
  config = CONFIG,
  now = Date.now(),
  log = console.log,
}) {
  const state = gatherState(run, config);
  const result = evaluateStatus(state, config, now);
  log(result.lines.join('\n'));
  const errors = [state.database, state.schedules, state.backups, state.bucket]
    .map(part => part.error)
    .filter(Boolean);
  for (const message of errors) log(`note: gcloud said: ${message}`);
  if (sizes) {
    log('\nBucket size by folder:');
    for (const folder of FOLDERS) {
      let bytes = null;
      try {
        bytes = parseDu(
          run([
            'storage',
            'du',
            '--summarize',
            `gs://${config.bucket}/${folder}`,
          ]),
        );
      } catch {
        // an empty or missing folder is not an error here
      }
      log(`  ${folder.padEnd(10)} ${human(bytes)}`);
    }
  }
  return result;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const args = process.argv.slice(2);
  const bad = args.filter(a => a !== '--sizes');
  if (bad.length) {
    console.error(`unknown option: ${bad[0]}`);
    process.exit(2);
  }
  const result = showStatus({
    run: gcloudRunner(),
    sizes: args.includes('--sizes'),
  });
  process.exit(result.ok ? 0 : 1);
}
