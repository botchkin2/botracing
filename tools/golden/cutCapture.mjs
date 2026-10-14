// Cuts a tray capture to its first chunks, for a parity pair: chunk files
// 0..lastChunk are copied, every driver's name in the field is blanked, and
// meta.json says the player is seat-test, names no server, and ends where the
// last kept chunk ends (`endUtc`).
//
//   node tools/golden/cutCapture.mjs <capture folder> <out folder> <lastChunk> <endUtc>
import {mkdirSync, readdirSync, readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {run, sqlPath} from '../sessions/duck.mjs';

export function cutCapture(input, output, lastChunk, endUtc) {
  mkdirSync(output, {recursive: true});
  let kept = 0;
  for (const name of readdirSync(input)) {
    const m = name.match(/^(player|field|session)-(\d+)\.parquet$/);
    if (!m || Number(m[2]) > lastChunk) continue;
    const from = sqlPath(join(input, name));
    const to = sqlPath(join(output, name));
    const select =
      m[1] === 'field'
        ? `SELECT * REPLACE ('' AS mDriverName) FROM ${from}`
        : `SELECT * FROM ${from}`;
    run(':memory:', `COPY (${select}) TO ${to} (FORMAT parquet, COMPRESSION zstd)`);
    kept++;
  }
  const meta = JSON.parse(readFileSync(join(input, 'meta.json'), 'utf8'));
  writeFileSync(
    join(output, 'meta.json'),
    JSON.stringify(
      {...meta, endUtc, chunks: lastChunk + 1, playerName: 'seat-test', serverName: ''},
      null,
      1,
    ),
  );
  return {files: kept};
}

if (process.argv[1]?.endsWith('cutCapture.mjs')) {
  const [input, output, lastChunk, endUtc] = process.argv.slice(2);
  console.log(cutCapture(input, output, Number(lastChunk), endUtc));
}
