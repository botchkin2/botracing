// Run: node --test tools/sessions/duck.test.mjs
// columns() reads a result in chunks (pit-wall ticket 88): the same arrays the
// whole-string reader gave, and a result longer than V8's longest string.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';

import {columns, readColumns, run, sqlPath} from './duck.mjs';
import {needsDuckdb} from './duckTestSupport.mjs';

const here = dirname(fileURLToPath(import.meta.url));

// What columns() did before: the whole text as one string, split into lines.
function wholeTextColumns(text) {
  const lines = text
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .filter(Boolean);
  const header = (lines[0] || '').split(',');
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

function assertSameColumns(actual, expected) {
  assert.deepEqual(Object.keys(actual), Object.keys(expected));
  for (const name of Object.keys(expected)) {
    assert.equal(actual[name].length, expected[name].length, name);
    for (let i = 0; i < expected[name].length; i++)
      assert.ok(Object.is(actual[name][i], expected[name][i]), `${name}[${i}]`);
  }
}

function withFile(text, read) {
  const dir = mkdtempSync(join(tmpdir(), 'duck-test-'));
  try {
    const file = join(dir, 'in.csv');
    writeFileSync(file, text);
    return read(file);
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
}

const same = text =>
  withFile(text, file =>
    assertSameColumns(readColumns(file), wholeTextColumns(text)),
  );

test('empty cells are NaN, true and false are 1 and 0, numbers are numbers', () => {
  same('a,b,c\n1.5,true,\n-2,false,3\n1e-7,,1e+22\n');
});

test('a BOM, CRLF line ends, a last line without a newline and a header only read the same', () => {
  same('\uFEFFa,b\r\n1,2\r\n3,4');
  same('a,b\n1,2\n3,4');
  same('a,b\n');
  same('a,b');
  same('a,b\n1,2\n\n3,4\n');
});

test('a row with fewer cells than the header leaves NaN', () => {
  same('a,b,c\n1,2\n4,5,6\n');
});

test('a file larger than one read chunk, with lines cut by the chunk end, reads the same', () => {
  const rows = [];
  for (let i = 0; i < 400_000; i++)
    rows.push(`${i},${i * 0.001},${i % 3 === 0 ? '' : i / 7}`);
  same(`tick,x,y\n${rows.join('\n')}\n`);
});

test(
  'a query through DuckDB reads the same as the whole text',
  needsDuckdb,
  () => {
    const query =
      'SELECT i AS a, i / 7.0 AS b, i % 5 = 0 AS c, CASE WHEN i % 4 = 0 THEN NULL ELSE i * 1e-9 END AS d FROM range(300000) t(i)';
    const dir = mkdtempSync(join(tmpdir(), 'duck-test-'));
    try {
      const file = join(dir, 'q.csv');
      run(
        ':memory:',
        `COPY (${query}) TO ${sqlPath(file)} (FORMAT csv, HEADER)`,
      );
      const text = readFileSync(file, 'utf8');
      assertSameColumns(columns(':memory:', query), wholeTextColumns(text));
    } finally {
      rmSync(dir, {recursive: true, force: true});
    }
  },
);

// A synthetic stress file shaped like a 2 h LMU recording (720,000 rows at
// 100 Hz, 102 columns) whose long decimals make a CSV past the longest string
// V8 can build, so the whole-text reader threw ERR_STRING_TOO_LONG on it. A
// real 2 h recording is about 150 MB of text, well under that cap: this is a
// guard beyond it, not a description of a real race. It runs in a child process so the peak memory is
// its own. The memory bound is the CI runner's own measurement (853 MB, run
// 41166135001) plus 25 %, so a regression of that size fails; the cloud
// instance is 2 GiB (analyzeApi.ts). The read must also fit the function's 120 s
// (32 s on the runner); the child's own limit is wider, as it first builds the
// file (86 s in all).
const RSS_BOUND_MB = 1070;
const WALL_BOUND_MS = 120_000;
const CHILD_LIMIT_MS = 300_000;

test(
  'a 2 h recording is read within the memory and time of the cloud instance',
  needsDuckdb,
  () => {
    const started = Date.now();
    const child = spawnSync(
      process.execPath,
      [join(here, 'longArchiveCheck.mjs')],
      {
        encoding: 'utf8',
        timeout: CHILD_LIMIT_MS,
      },
    );
    assert.equal(child.status, 0, child.stderr.slice(0, 600));
    const seen = JSON.parse(child.stdout.trim().split('\n').pop());
    console.log(
      `2 h read: ${JSON.stringify(seen)} (child wall ${
        Date.now() - started
      } ms)`,
    );
    assert.equal(seen.rows, 720_000);
    assert.equal(seen.cols, 103);
    assert.ok(seen.maxRssMB < RSS_BOUND_MB, `peak ${seen.maxRssMB} MB`);
    assert.ok(seen.ms < WALL_BOUND_MS, `read took ${seen.ms} ms`);
  },
);
