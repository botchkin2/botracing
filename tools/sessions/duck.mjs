// Run SQL through the DuckDB CLI and read the result back as columns.
import {spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {
  closeSync,
  existsSync,
  openSync,
  readFileSync,
  readSync,
  rmSync,
} from 'node:fs';
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

// Found on first use, not on load: the cloud stages its binary only where
// analysis runs (functions/src/engine.ts), after the engine is loaded.
let duckdbPath = null;
const bin = () => (duckdbPath ??= findDuckdb());

// db is a database file, or ':memory:' for queries over Parquet files.
export function run(db, query, {readonly = true} = {}) {
  const args = [];
  if (readonly && db !== ':memory:') args.push('-readonly');
  args.push(db, '-csv', '-c', query);
  const duckdb = bin();
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

// A SELECT's result as a CSV file, handed to `read` and removed after. The CLI's
// own -csv renderer takes 12 s for a 66-minute LMU race (95 MB of text); COPY
// writes the same CSV in 0.25 s (pit-wall thread 1, #4550).
function withCsv(db, query, {readonly = true}, read) {
  const file = join(tmpdir(), `duck-${randomUUID()}.csv`);
  const body = query.trim().replace(/;$/, '');
  try {
    run(db, `COPY (${body}) TO ${sqlPath(file)} (FORMAT csv, HEADER)`, {
      readonly,
    });
    return read(file);
  } finally {
    rmSync(file, {force: true});
  }
}

// A SELECT's result as CSV text: for the small ones (rows). The big ones
// (columns) are read in chunks, never as one string.
function select(db, query, options = {}) {
  return withCsv(db, query, options, file => readFileSync(file, 'utf8'));
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

// A CSV file is read in pieces of this size: a 2 h LMU race is about 150 MB of
// text and a long one passes the longest string V8 can hold, so no step may
// need the whole text (pit-wall ticket 88).
const CHUNK_BYTES = 4 * 1024 * 1024;

// How many lines a file has: a last line without a newline counts.
function countLines(fd, chunk) {
  let lines = 0;
  let endedOnNewline = true;
  for (let n; (n = readSync(fd, chunk, 0, chunk.length, null)) > 0; ) {
    for (let at = chunk.indexOf(10); at !== -1 && at < n; ) {
      lines++;
      at = chunk.indexOf(10, at + 1);
    }
    endedOnNewline = chunk[n - 1] === 10;
  }
  return endedOnNewline ? lines : lines + 1;
}

// Numeric columns as Float64Arrays, keyed by column name. Empty cells are NaN.
// The file is read twice in chunks (lines, then cells) so the arrays are the
// only thing that grows with the drive.
export function readColumns(file) {
  const fd = openSync(file, 'r');
  try {
    const chunk = Buffer.allocUnsafe(CHUNK_BYTES);
    const lines = countLines(fd, chunk);
    const out = {};
    let arrays = null;
    let row = 0;
    const onLine = raw => {
      const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
      if (line === '') return;
      if (arrays === null) {
        const names = splitLine(line.replace(/^\uFEFF/, ''));
        arrays = names.map(name => (out[name] = new Float64Array(lines - 1)));
        return;
      }
      const cells = line.split(',');
      for (let c = 0; c < arrays.length; c++) {
        const cell = cells[c];
        arrays[c][row] =
          cell === '' || cell === undefined
            ? NaN
            : cell === 'true'
            ? 1
            : cell === 'false'
            ? 0
            : Number(cell);
      }
      row++;
    };
    const text = new TextDecoder('utf-8');
    let carry = '';
    for (
      let n, at = 0;
      (n = readSync(fd, chunk, 0, chunk.length, at)) > 0;
      at += n
    ) {
      const piece = carry + text.decode(chunk.subarray(0, n), {stream: true});
      let from = 0;
      for (let end; (end = piece.indexOf('\n', from)) !== -1; from = end + 1)
        onLine(piece.slice(from, end));
      carry = piece.slice(from);
    }
    onLine(carry + text.decode());
    // Blank lines were counted but hold no row (the whole-text reader skipped them).
    if (arrays !== null && row < lines - 1)
      for (const name of Object.keys(out))
        out[name] = out[name].subarray(0, row);
    return out;
  } finally {
    closeSync(fd);
  }
}

export function columns(db, query) {
  return withCsv(db, query, {}, readColumns);
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
