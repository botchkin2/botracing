// Run SQL through the DuckDB CLI and read the result back as columns.
import {spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {existsSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

function findDuckdb() {
  const candidates = [
    process.env.DUCKDB,
    resolve(here, 'duckdb.exe'),
    // Where tools/runtime/update.ps1 and tools/capture/duckdb_cli.py look too.
    process.env.LOCALAPPDATA &&
      resolve(process.env.LOCALAPPDATA, 'Temp', 'duckdb-cli', 'duckdb.exe'),
  ].filter(Boolean);
  const found = candidates.find(candidate => existsSync(candidate));
  return found || 'duckdb';
}

const duckdb = findDuckdb();

// db is a database file, or ':memory:' for queries over Parquet files.
export function run(db, query, {readonly = true} = {}) {
  const args = [];
  if (readonly && db !== ':memory:') args.push('-readonly');
  args.push(db, '-csv', '-c', query);
  const result = spawnSync(duckdb, args, {
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 1024,
  });
  if (result.error) {
    if (result.error.code === 'ENOENT')
      throw new Error(
        `DuckDB CLI not found (tried "${duckdb}"). Put duckdb.exe at ${resolve(
          here,
          'duckdb.exe',
        )}, set DUCKDB to its path, or install it from https://duckdb.org/docs/installation/ (tools/runtime/update.ps1 copies one into lap-runtime).`,
      );
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(
      (result.stderr || result.stdout || 'duckdb failed').slice(0, 800),
    );
  }
  return result.stdout;
}

// A SELECT's result as CSV text. The CLI's own -csv renderer takes 12 s for
// a 66-minute LMU race (95 MB of text); COPY writes the same CSV in 0.25 s
// (pit-wall thread 1, #4550).
function select(db, query, {readonly = true} = {}) {
  const file = join(tmpdir(), `duck-${randomUUID()}.csv`);
  const body = query.trim().replace(/;$/, '');
  try {
    run(db, `COPY (${body}) TO ${sqlPath(file)} (FORMAT csv, HEADER)`, {
      readonly,
    });
    return readFileSync(file, 'utf8');
  } finally {
    rmSync(file, {force: true});
  }
}

// Rows as objects. Values stay strings; callers convert what they need.
export function rows(db, query) {
  const lines = select(db, query)
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .filter(Boolean);
  if (lines.length === 0) return [];
  const header = splitLine(lines[0]);
  return lines.slice(1).map(line => {
    const cols = splitLine(line);
    const row = {};
    header.forEach((name, i) => (row[name] = cols[i]));
    return row;
  });
}

// Numeric columns as Float64Arrays, keyed by column name. Empty cells are NaN.
export function columns(db, query) {
  const lines = select(db, query)
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .filter(Boolean);
  const header = splitLine(lines[0] || '');
  const out = {};
  header.forEach(name => (out[name] = new Float64Array(lines.length - 1)));
  for (let r = 1; r < lines.length; r++) {
    const cols = lines[r].split(',');
    for (let c = 0; c < header.length; c++) {
      const cell = cols[c];
      out[header[c]][r - 1] =
        cell === '' || cell === undefined
          ? NaN
          : cell === 'true'
          ? 1
          : cell === 'false'
          ? 0
          : Number(cell);
    }
  }
  return out;
}

// Quoted CSV cells only appear in text columns (names, metadata).
function splitLine(line) {
  const out = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      out.push(cell);
      cell = '';
    } else cell += ch;
  }
  out.push(cell);
  return out;
}

export function sqlString(text) {
  return `'${String(text).replaceAll("'", "''")}'`;
}

export function sqlPath(path) {
  return sqlString(path.replaceAll('\\', '/'));
}
