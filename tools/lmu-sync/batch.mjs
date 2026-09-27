// Walk LMU's telemetry folder and append any stint not already in the pack.
// Skips a file that is still being written. If a packed file is newer than
// its CSVs, extract it again. One failure does not stop the rest.

import {spawnSync} from 'node:child_process';
import {
  existsSync,
  readdirSync,
  statSync,
  appendFileSync,
  mkdirSync,
} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {sinceDay} from './window.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../..');
const packDir = resolve(repoRoot, 'sample_data/lmu/pack');
const logPath = resolve(repoRoot, 'sample_data/lmu/batch.log');
const telemetry =
  process.env.LMU_TELEMETRY ||
  'C:\\Program Files (x86)\\Steam\\steamapps\\common\\Le Mans Ultimate\\UserData\\Telemetry';
const quietMs = 3 * 60 * 1000;
const since = sinceDay();
const lapsDir = resolve(packDir, 'laps');

mkdirSync(dirname(logPath), {recursive: true});

function log(line) {
  const text = `${new Date().toISOString()} ${line}`;
  console.log(text);
  appendFileSync(logPath, text + '\n');
}

function stampOf(file) {
  const stamp = file.match(/(\d{4}-\d{2}-\d{2})T(\d{2})_(\d{2})_(\d{2})/);
  if (!stamp) return '';
  return `${stamp[1].replaceAll('-', '')}T${stamp[2]}${stamp[3]}${stamp[4]}`;
}

function packMtime(stamp) {
  if (!stamp || !existsSync(lapsDir)) return 0;
  let newest = 0;
  for (const name of readdirSync(lapsDir)) {
    if (!name.endsWith('.csv') || !name.includes(stamp)) continue;
    const mtime = statSync(resolve(lapsDir, name)).mtimeMs;
    if (mtime > newest) newest = mtime;
  }
  return newest;
}

if (!existsSync(telemetry)) {
  log(`missing telemetry ${telemetry}`);
  process.exit(1);
}

const files = readdirSync(telemetry)
  .filter(name => name.endsWith('.duckdb'))
  .map(name => resolve(telemetry, name));

log(`start files=${files.length} since=${since}`);
let done = 0;
let skipped = 0;
let failed = 0;

for (const file of files) {
  const stamp = stampOf(file);
  if (!stamp || stamp.slice(0, 8) < since) {
    skipped++;
    continue;
  }
  const stat = statSync(file);
  if (Date.now() - stat.mtimeMs < quietMs) {
    skipped++;
    log(`skip quiet ${file}`);
    continue;
  }
  const packedAt = packMtime(stamp);
  if (packedAt && stat.mtimeMs <= packedAt) {
    skipped++;
    continue;
  }
  if (packedAt) log(`refresh ${file}`);
  const result = spawnSync(
    process.execPath,
    [resolve(here, 'extract.mjs'), '--file', file, '--format', 'csv', '--pack', packDir],
    {encoding: 'utf8', maxBuffer: 1024 * 1024 * 32},
  );
  if (result.status !== 0) {
    failed++;
    log(`fail ${file}\n${(result.stderr || result.stdout || '').slice(-500)}`);
    continue;
  }
  done++;
  log(`ok ${done} ${file}`);
}

log(`finish ok=${done} skipped=${skipped} failed=${failed}`);
