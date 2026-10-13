import assert from 'node:assert/strict';
import {mkdtempSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {rows, sqlPath} from './duck.mjs';
import {samplesCsvToParquet} from './iracing.mjs';

// The Fuji 4 Oct case (pit-wall thread 1 #4851): tyre wear sits at a whole
// 100 for the whole sample the CSV sniffer reads, then wears to decimals.
test('a channel whose first rows are whole numbers keeps its later decimals', () => {
  const dir = mkdtempSync(join(tmpdir(), 'irtypes-'));
  const csv = join(dir, 's.csv');
  const lines = ['tick,tyres_wear_fl,throttle_pct'];
  for (let i = 0; i < 30_000; i++) {
    const wear = i < 25_000 ? 100 : 98.51;
    const throttle = i < 25_000 ? 0 : 37.25;
    lines.push(`${i},${wear},${throttle}`);
  }
  // A missing reading is an empty cell.
  lines.push('30000,,');
  writeFileSync(csv, lines.join('\n'));
  const out = join(dir, 's.parquet');
  samplesCsvToParquet(csv, ['tick', 'tyres_wear_fl', 'throttle_pct'], out);
  const types = Object.fromEntries(
    rows(':memory:', `SELECT column_name c, column_type t FROM (DESCRIBE SELECT * FROM read_parquet(${sqlPath(out)}))`).map(r => [r.c, r.t]),
  );
  assert.deepEqual(types, {tick: 'BIGINT', tyres_wear_fl: 'DOUBLE', throttle_pct: 'DOUBLE'});
  const [last] = rows(':memory:', `SELECT tyres_wear_fl w, throttle_pct t FROM read_parquet(${sqlPath(out)}) WHERE tick = 29999`);
  assert.equal(Number(last.w), 98.51);
  assert.equal(Number(last.t), 37.25);
  const [n] = rows(':memory:', `SELECT count(*) n, count(tyres_wear_fl) w FROM read_parquet(${sqlPath(out)})`);
  assert.equal(Number(n.n), 30_001);
  assert.equal(Number(n.w), 30_000);
});
