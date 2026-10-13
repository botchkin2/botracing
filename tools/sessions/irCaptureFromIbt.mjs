// An .ibt written as the tray's iRacing capture would hold the same drive
// (desktop/src-tauri/src/capture/ir_recorder.rs, ir_store.rs): player-NNNN
// with the PLAYER whitelist at 60 Hz plus wall_ms and tick, session-NNNN with
// the SESSION whitelist every 200 ms plus wall_ms and update, meta.json. Column
// names and types as the recorder writes them (float FLOAT, double DOUBLE,
// int and bitfield BIGINT, bool BOOLEAN; columns in name order). For parity
// runs of irLiveCapture.mjs against iracing.mjs on one drive, and for fixtures.
// It proves the adapter's mapping, never the recorder's fidelity: an .ibt has
// no field (CarIdx*) arrays, so no field chunks are written, wall_ms is the
// session clock from the file's start, and tick is the .ibt's SessionTick.
//
//   node tools/sessions/irCaptureFromIbt.mjs <file.ibt> <outDir> --meta <meta.json>
//     [--from <s>] [--to <s>] [--drop <from>-<to>] [--open] [--no-steer-max]
//
// --meta: ir_session.rs's to_json of the .ibt's session text (its ignored test
// session_text_to_meta writes it). --drop: leave out rows on that span of the
// session clock (the player out of the car). --open: no endUtc, a capture still
// being written. --no-steer-max: the PLAYER list before SteeringWheelAngleMax.
import {mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {run, sqlPath} from './duck.mjs';
import {openIbt, readColumns} from './ibt.mjs';

// ir_recorder.rs PLAYER and SESSION.
export const PLAYER = [
  'SessionTime',
  'SessionNum',
  'Speed',
  'Throttle',
  'ThrottleRaw',
  'Brake',
  'BrakeRaw',
  'Clutch',
  'SteeringWheelAngle',
  'SteeringWheelAngleMax',
  'RPM',
  'Gear',
  'LapDist',
  'LapDistPct',
  'Lap',
  'LapCompleted',
  'LapLastLapTime',
  'LapBestLapTime',
  'LapCurrentLapTime',
  'Lat',
  'Lon',
  'Alt',
  'FuelLevel',
  'OnPitRoad',
  'PlayerCarInPitStall',
  'PlayerTrackSurface',
  'PlayerTrackSurfaceMaterial',
  'SessionFlags',
  'PlayerCarPosition',
  'PlayerCarClassPosition',
  'CarDistAhead',
  'CarDistBehind',
  'LatAccel',
  'LongAccel',
  'VertAccel',
  'YawRate',
  'CarLeftRight',
  'LFtempCM',
  'RFtempCM',
  'LRtempCM',
  'RRtempCM',
  'LFtempL',
  'RFtempL',
  'LRtempL',
  'RRtempL',
  'LFtempM',
  'RFtempM',
  'LRtempM',
  'RRtempM',
  'LFtempR',
  'RFtempR',
  'LRtempR',
  'RRtempR',
  'LFwearL',
  'RFwearL',
  'LRwearL',
  'RRwearL',
  'LFwearM',
  'RFwearM',
  'LRwearM',
  'RRwearM',
  'LFwearR',
  'RFwearR',
  'LRwearR',
  'RRwearR',
  'LFpressure',
  'RFpressure',
  'LRpressure',
  'RRpressure',
  'TrackTemp',
  'AirTemp',
];
export const SESSION = [
  'SessionTime',
  'SessionNum',
  'SessionState',
  'SessionFlags',
  'SessionTimeRemain',
  'SessionLapsRemain',
  'TrackTemp',
  'TrackTempCrew',
  'AirTemp',
  'TrackWetness',
  'WeatherDeclaredWet',
  'Skies',
  'WindVel',
  'WindDir',
  'RelativeHumidity',
];
// irsdk var types (ibt.mjs) to what ir_store.rs Cell writes.
const SQL_TYPE = {
  1: 'BOOLEAN',
  2: 'BIGINT',
  3: 'BIGINT',
  4: 'FLOAT',
  5: 'DOUBLE',
};
const CHUNK_MS = 60_000;
const FIELD_EVERY_MS = 200;

const iso = ms => new Date(ms).toISOString();

/**
 * Writes the capture. `meta`: ir_session.rs to_json. Returns the folder's
 * player and session row counts.
 */
export function writeCapture(ibtPath, outDir, meta, opts = {}) {
  const {
    from = -Infinity,
    to = Infinity,
    drop = null,
    open = false,
    steerMax = true,
  } = opts;
  const ibt = openIbt(ibtPath);
  try {
    const player = PLAYER.filter(
      n => ibt.byName.has(n) && (steerMax || n !== 'SteeringWheelAngleMax'),
    );
    const session = SESSION.filter(n => ibt.byName.has(n));
    const cols = readColumns(ibt, [
      ...new Set([...player, ...session, 'SessionTick']),
    ]);
    const t = cols.SessionTime;
    const startMs = ibt.header.sessionStartDate * 1000;
    let tFirst = null;
    const keep = [];
    for (let i = 0; i < t.length; i++) {
      if (t[i] < from || t[i] >= to) continue;
      if (drop && t[i] >= drop[0] && t[i] < drop[1]) continue;
      tFirst ??= t[i];
      keep.push(i);
    }
    if (!keep.length) throw new Error('no rows in that span');
    const wall = i => startMs + Math.round((t[i] - tFirst) * 1000);
    mkdirSync(outDir, {recursive: true});
    const tmp = join(tmpdir(), `ircap-${process.pid}`);
    mkdirSync(tmp, {recursive: true});
    try {
      // 60 s chunks by the recorder's wall clock.
      const playerCsv = join(tmp, 'player.csv');
      const sessionCsv = join(tmp, 'session.csv');
      const cell = (name, i) => {
        const v = cols[name][i];
        return ibt.byName.get(name).type === 1
          ? v
            ? 'true'
            : 'false'
          : String(v);
      };
      const pLines = [['chunk', 'wall_ms', 'tick', ...player].join(',')];
      const sLines = [['chunk', 'wall_ms', 'update', ...session].join(',')];
      let chunk = 0;
      let chunkStart = wall(keep[0]);
      let lastField = -Infinity;
      let update = 0;
      for (const i of keep) {
        const w = wall(i);
        pLines.push(
          [chunk, w, cols.SessionTick[i], ...player.map(n => cell(n, i))].join(
            ',',
          ),
        );
        if (w - lastField >= FIELD_EVERY_MS) {
          lastField = w;
          sLines.push(
            [chunk, w, update++, ...session.map(n => cell(n, i))].join(','),
          );
        }
        if (w - chunkStart >= CHUNK_MS) {
          chunk++;
          chunkStart = w;
        }
      }
      writeFileSync(playerCsv, pLines.join('\n'));
      writeFileSync(sessionCsv, sLines.join('\n'));
      const typed = (names, extra) =>
        [
          ...names.map(n => [n, SQL_TYPE[ibt.byName.get(n).type]]),
          ...extra,
        ].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
      const select = list =>
        list.map(([n, ty]) => `${n}::${ty} AS ${n}`).join(', ');
      const pCols = typed(player, [
        ['wall_ms', 'BIGINT'],
        ['tick', 'BIGINT'],
      ]);
      const sCols = typed(session, [
        ['wall_ms', 'BIGINT'],
        ['update', 'BIGINT'],
      ]);
      // Typed once, then one COPY per chunk, from a file: the SQL overruns the
      // command line the CLI gets it on.
      const names = list => list.map(([n]) => n).join(', ');
      const sql = [
        `CREATE TEMP TABLE p AS SELECT chunk::INT AS chunk, ${select(
          pCols,
        )} FROM read_csv(${sqlPath(
          playerCsv,
        )}, HEADER=true, ALL_VARCHAR=true);`,
        `CREATE TEMP TABLE s AS SELECT chunk::INT AS chunk, ${select(
          sCols,
        )} FROM read_csv(${sqlPath(
          sessionCsv,
        )}, HEADER=true, ALL_VARCHAR=true);`,
      ];
      for (let c = 0; c <= chunk; c++) {
        const n = String(c).padStart(4, '0');
        sql.push(
          `COPY (SELECT ${names(pCols)} FROM p WHERE chunk = ${c}) TO ${sqlPath(
            join(outDir, `player-${n}.parquet`),
          )} (FORMAT parquet, COMPRESSION zstd);`,
          `COPY (SELECT ${names(sCols)} FROM s WHERE chunk = ${c}) TO ${sqlPath(
            join(outDir, `session-${n}.parquet`),
          )} (FORMAT parquet, COMPRESSION zstd);`,
        );
      }
      const sqlFile = join(tmp, 'write.sql');
      writeFileSync(sqlFile, sql.join('\n'));
      run(':memory:', `.read ${sqlFile.replaceAll('\\', '/')}`, {
        readonly: false,
      });
      const endMs = wall(keep[keep.length - 1]);
      // IrCapture::new's keys, then what ir_session.rs kept, then the recorder's.
      writeFileSync(
        join(outDir, 'meta.json'),
        JSON.stringify(
          {
            version: 1,
            sim: 'iracing',
            startUtc: iso(startMs),
            endUtc: open ? null : iso(endMs + 1000),
            chunks: chunk + 1,
            playerRows: keep.length,
            fieldUpdates: update,
            ...meta,
            sessionKey: `local-${startMs}:${meta.sessionNum ?? 0}`,
            firstSeenUtc: iso(startMs),
          },
          null,
          2,
        ),
      );
      return {playerRows: keep.length, sessionRows: update, chunks: chunk + 1};
    } finally {
      rmSync(tmp, {recursive: true, force: true});
    }
  } finally {
    ibt.close();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const argv = process.argv.slice(2);
  const opt = name => {
    const k = argv.indexOf(name);
    return k >= 0 ? argv[k + 1] : undefined;
  };
  const [ibtPath, outDir] = argv;
  const metaPath = opt('--meta');
  if (!ibtPath || !outDir || !metaPath) {
    console.error(
      'usage: irCaptureFromIbt.mjs <file.ibt> <outDir> --meta <meta.json> [--from s] [--to s] [--drop a-b] [--open] [--no-steer-max]',
    );
    process.exit(2);
  }
  const drop = opt('--drop')?.split('-').map(Number) ?? null;
  const r = writeCapture(
    ibtPath,
    outDir,
    JSON.parse(readFileSync(metaPath, 'utf8')),
    {
      from: opt('--from') != null ? Number(opt('--from')) : -Infinity,
      to: opt('--to') != null ? Number(opt('--to')) : Infinity,
      drop,
      open: argv.includes('--open'),
      steerMax: !argv.includes('--no-steer-max'),
    },
  );
  console.error(JSON.stringify(r));
}
