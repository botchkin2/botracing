// Cuts an LMU .duckdb to the window of a golden capture of the same drive, for
// the parity pair (docs/SESSION_PIPELINE.md): every sampled channel to the rows
// up to `untilT` on the GPS Time clock, every event to `ts <= untilT`, and the
// driver's name replaced. The result is read by lmu.mjs like any game file.
//
//   node tools/golden/cutGameFile.mjs <in.duckdb> <out.duckdb> <untilT>
import {existsSync, rmSync} from 'node:fs';
import {rows, run, sqlPath} from '../sessions/duck.mjs';

const q = name => `"${name.replace(/"/g, '""')}"`;

export function cutGameFile(input, output, untilT) {
  if (existsSync(output)) rmSync(output);
  const src = sqlPath(input);
  const tables = rows(
    input,
    "SELECT table_name, string_agg(column_name, '|') AS cols FROM duckdb_columns() WHERE NOT internal AND schema_name = 'main' GROUP BY 1",
  );
  const hz = new Map(
    rows(input, 'SELECT channelName, frequency FROM channelsList').map(r => [
      r.channelName,
      Number(r.frequency),
    ]),
  );
  const [base] = rows(
    input,
    `SELECT count(*) FILTER (WHERE value <= ${untilT}) AS n, any_value(f.frequency) AS hz
       FROM "GPS Time", channelsList f WHERE f.channelName = 'GPS Time'`,
  );
  const keep = Number(base.n);
  const baseHz = Number(base.hz);
  const sql = [`ATTACH ${src} AS s (READ_ONLY);`];
  for (const {table_name: t, cols} of tables) {
    const columns = cols.split('|');
    let where = '';
    if (columns.includes('ts')) where = `WHERE ts <= ${untilT}`;
    else if (hz.has(t)) where = `WHERE rowid < ${Math.ceil((keep * hz.get(t)) / baseHz)}`;
    sql.push(`CREATE TABLE ${q(t)} AS SELECT * FROM s.${q(t)} ${where};`);
  }
  sql.push("UPDATE metadata SET value = 'seat-test' WHERE key = 'DriverName';");
  sql.push("UPDATE metadata SET value = '' WHERE key = 'SteamID';");
  run(output, sql.join('\n'), {readonly: false});
  return {tables: tables.length, gpsRows: keep};
}

if (process.argv[1]?.endsWith('cutGameFile.mjs')) {
  const [input, output, untilT] = process.argv.slice(2);
  console.log(cutGameFile(input, output, Number(untilT)));
}
