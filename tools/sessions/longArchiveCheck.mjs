// Child process of duck.test.mjs: a synthetic 2 h LMU recording (720,000 rows at
// 100 Hz, 102 numeric columns, the shape of a real one) read through columns(),
// and what it cost. Prints one JSON line: {rows, cols, ms, maxRssMB}.
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import {columns, run, sqlPath} from './duck.mjs';

const ROWS = 720_000;
const COLS = 102;
const dir = mkdtempSync(join(tmpdir(), 'long-archive-'));
try {
  const file = join(dir, 'samples.parquet');
  const names = Array.from({length: COLS}, (_, i) => `c${i}`);
  // Values that print the way a telemetry channel does: long decimals.
  const select = names
    .map((name, i) => `(i * ${(i + 1) / 7}) % 1000.123456789 AS ${name}`)
    .join(', ');
  run(
    ':memory:',
    `COPY (SELECT i AS tick, ${select} FROM range(${ROWS}) t(i)) TO ${sqlPath(
      file,
    )} (FORMAT parquet)`,
  );
  const started = Date.now();
  const out = columns(
    ':memory:',
    `SELECT * FROM read_parquet(${sqlPath(file)}) ORDER BY tick`,
  );
  const ms = Date.now() - started;
  const maxRssMB = Math.round(process.resourceUsage().maxRSS / 1024);
  console.log(
    JSON.stringify({
      rows: out.tick.length,
      cols: Object.keys(out).length,
      ms,
      maxRssMB,
    }),
  );
} finally {
  rmSync(dir, {recursive: true, force: true});
}
