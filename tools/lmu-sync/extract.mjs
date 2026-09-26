// Read one LMU .duckdb stint and write distance-aligned laps as JSON.
//
//   node tools/lmu-sync/extract.mjs --file "...\Telemetry\track_P_....duckdb"
//   node tools/lmu-sync/extract.mjs --file stint.duckdb --reference-file other.duckdb --points 400
//
// --points is the stored samples per lap. The try screen can draw fewer.
// Every start/finish segment is kept, including pits, untimed laps, and the
// partial lap at the end of the file.

import {spawnSync} from 'node:child_process';
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../..');

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  if (i === -1) return fallback;
  return process.argv[i + 1];
}

const file = arg('--file');
const referenceFile = arg('--reference-file');
const points = Math.max(50, Number(arg('--points', '400')));
const outPath = resolve(
  arg('--out', resolve(repoRoot, 'sample_data/lmu/stint.json')),
);

if (!file) {
  console.error('Pass --file path\\to\\session.duckdb');
  process.exit(1);
}

function findDuckdb() {
  const candidates = [
    process.env.DUCKDB,
    resolve(here, 'duckdb.exe'),
    'C:\\Users\\Botkin\\AppData\\Local\\Temp\\duckdb-cli\\duckdb.exe',
    'duckdb',
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (candidate === 'duckdb' || existsSync(candidate)) return candidate;
  }
  console.error('duckdb executable not found. Set DUCKDB to duckdb.exe.');
  process.exit(1);
}

const duckdb = findDuckdb();

function sql(db, query) {
  const result = spawnSync(duckdb, [db, '-csv', '-c', query], {
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 512,
  });
  if (result.status !== 0) {
    throw new Error(
      (result.stderr || result.stdout || 'duckdb failed').slice(0, 800),
    );
  }
  return result.stdout;
}

function parseCsv(text) {
  const lines = text
    .replace(/^\uFEFF/, '')
    .trim()
    .split(/\r?\n/);
  if (lines.length === 0 || lines[0] === '') return [];
  const header = splitCsvLine(lines[0]);
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i]) continue;
    const cols = splitCsvLine(lines[i]);
    const row = {};
    for (let c = 0; c < header.length; c++) row[header[c]] = cols[c];
    rows.push(row);
  }
  return rows;
}

function splitCsvLine(line) {
  return line.split(',');
}

function column(db, table) {
  const rows = parseCsv(sql(db, `SELECT value FROM "${table}"`));
  const out = new Float64Array(rows.length);
  for (let i = 0; i < rows.length; i++) out[i] = Number(rows[i].value);
  return out;
}

function events(db, table, fields) {
  const select = ['ts', ...fields].map(field => `"${field}"`).join(', ');
  return parseCsv(sql(db, `SELECT ${select} FROM "${table}" ORDER BY ts`)).map(
    row => {
      const event = {ts: Number(row.ts)};
      for (const field of fields) event[field] = Number(row[field]);
      return event;
    },
  );
}

function metadata(db) {
  const rows = parseCsv(sql(db, 'SELECT key, value FROM metadata'));
  const meta = {};
  for (const row of rows) {
    if (row.key !== 'CarSetup') meta[row.key] = row.value;
  }
  return meta;
}

function idxAt(times, t) {
  let lo = 0;
  let hi = times.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (times[mid] < t) lo = mid + 1;
    else hi = mid;
  }
  if (lo > 0 && Math.abs(times[lo - 1] - t) <= Math.abs(times[lo] - t)) {
    return lo - 1;
  }
  return lo;
}

function scaledIndex(i100, srcLen, gpsLen) {
  if (srcLen <= 1 || gpsLen <= 1) return 0;
  if (srcLen === gpsLen) return Math.min(i100, srcLen - 1);
  const i = Math.round((i100 * (srcLen - 1)) / (gpsLen - 1));
  return Math.max(0, Math.min(srcLen - 1, i));
}

function gpsIndexFor(channelIndex, channelLen, gpsLen) {
  if (channelLen <= 1 || gpsLen <= 1) return 0;
  if (channelLen === gpsLen) return Math.min(channelIndex, gpsLen - 1);
  const i = Math.round((channelIndex * (gpsLen - 1)) / (channelLen - 1));
  return Math.max(0, Math.min(gpsLen - 1, i));
}

function cleanGears(raw) {
  const out = [];
  for (let i = 0; i < raw.length; i++) {
    const event = raw[i];
    const next = raw[i + 1];
    if (
      event.value === 0 &&
      next &&
      next.value !== 0 &&
      next.ts - event.ts < 0.08
    ) {
      continue;
    }
    out.push(event);
  }
  return out;
}

function gearAt(gears, t) {
  let value = 0;
  let lo = 0;
  let hi = gears.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (gears[mid].ts <= t) {
      value = gears[mid].value;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return value;
}

function pitIntervals(raw) {
  const intervals = [];
  let open = null;
  for (const event of raw) {
    if (event.value === 1 && open == null) open = event.ts;
    if (event.value === 0 && open != null) {
      intervals.push([open, event.ts]);
      open = null;
    }
  }
  if (open != null) intervals.push([open, Number.POSITIVE_INFINITY]);
  return intervals;
}

function overlapsPit(intervals, start, end) {
  return intervals.some(([s, e]) => s < end && e > start);
}

function isLooseSurface(event) {
  if (!event) return false;
  return [event.value1, event.value2, event.value3, event.value4].some(
    value => value === 2 || value === 3 || value === 4,
  );
}

function lapTimeNear(lapTimes, endTs) {
  let best = null;
  let bestDt = 0.75;
  for (const event of lapTimes) {
    const dt = Math.abs(event.ts - endTs);
    if (dt < bestDt) {
      bestDt = dt;
      best = event.value;
    }
  }
  return best;
}

function maybeColumn(db, table) {
  try {
    return column(db, table);
  } catch {
    return null;
  }
}

function round(value, digits) {
  const p = 10 ** digits;
  return Math.round(value * p) / p;
}

function extractStint(dbPath, idPrefix) {
  const meta = metadata(dbPath);
  const gps = column(dbPath, 'GPS Time');
  const speed = column(dbPath, 'Ground Speed');
  const steer = column(dbPath, 'Steering Pos');
  const rpm = column(dbPath, 'Engine RPM');
  const brake = column(dbPath, 'Brake Pos');
  const throttle = column(dbPath, 'Throttle Pos');
  const lapDist = column(dbPath, 'Lap Dist');
  const lat = column(dbPath, 'GPS Latitude');
  const lon = column(dbPath, 'GPS Longitude');
  const pathLat = maybeColumn(dbPath, 'Path Lateral');
  const trackEdge = maybeColumn(dbPath, 'Track Edge');
  const lapEvents = events(dbPath, 'Lap', ['value']);
  const lapTimeEvents = events(dbPath, 'Lap Time', ['value']);
  const gearEvents = cleanGears(events(dbPath, 'Gear', ['value']));
  const pits = pitIntervals(events(dbPath, 'In Pits', ['value']));
  const surface = events(dbPath, 'SurfaceTypes', [
    'value1',
    'value2',
    'value3',
    'value4',
  ]);

  if (gps.length < 2) throw new Error(`No GPS time in ${dbPath}`);

  const tStart = gps[0];
  const tEnd = gps[gps.length - 1];
  const segments = [];
  if (lapEvents.length === 0) {
    segments.push({
      start: tStart,
      end: tEnd,
      lapNumber: 1,
      partial: true,
    });
  } else {
    if (lapEvents[0].ts - tStart > 1) {
      segments.push({
        start: tStart,
        end: lapEvents[0].ts,
        lapNumber: lapEvents[0].value,
        partial: true,
      });
    }
    for (let i = 0; i < lapEvents.length; i++) {
      const start = lapEvents[i].ts;
      const end = i + 1 < lapEvents.length ? lapEvents[i + 1].ts : tEnd;
      if (end - start < 0.5) continue;
      segments.push({
        start,
        end,
        lapNumber: lapEvents[i].value,
        partial: i === lapEvents.length - 1,
      });
    }
  }

  const laps = segments.map((segment, index) => {
    const distSamples = [];
    for (let i = 0; i < lapDist.length; i++) {
      const t = gps[gpsIndexFor(i, lapDist.length, gps.length)];
      if (t >= segment.start && t <= segment.end) {
        distSamples.push({i, t, d: lapDist[i]});
      }
    }
    // The beacon fires while distance is still the previous lap's total,
    // then it resets to ~0. Keep this lap's climb, and drop the next reset.
    let cut = 0;
    for (let i = 1; i < distSamples.length; i++) {
      if (distSamples[i - 1].d - distSamples[i].d > 150) {
        cut = i;
        break;
      }
    }
    let endCut = distSamples.length;
    for (let i = cut + 1; i < distSamples.length; i++) {
      if (distSamples[i - 1].d - distSamples[i].d > 150) {
        endCut = i;
        break;
      }
    }
    const lapSamples = distSamples.slice(cut, endCut);
    let dMax = 0;
    for (const sample of lapSamples) if (sample.d > dMax) dMax = sample.d;
    const useDistance = dMax > 100 && lapSamples.length > 10;

    const speedOut = new Array(points);
    const throttleOut = new Array(points);
    const brakeOut = new Array(points);
    const steerOut = new Array(points);
    const rpmOut = new Array(points);
    const gearOut = new Array(points);
    const latOut = new Array(points);
    const lonOut = new Array(points);
    const offOut = new Array(points);
    const edgeOut = new Array(points);

    let distCursor = 0;
    let surfI = 0;
    while (
      surfI + 1 < surface.length &&
      surface[surfI + 1].ts <= segment.start
    ) {
      surfI++;
    }
    for (let k = 0; k < points; k++) {
      let t;
      if (useDistance) {
        const target = (dMax * k) / (points - 1);
        while (
          distCursor < lapSamples.length - 1 &&
          lapSamples[distCursor].d < target
        ) {
          distCursor++;
        }
        t = lapSamples[distCursor].t;
      } else {
        t = segment.start + ((segment.end - segment.start) * k) / (points - 1);
      }
      const i100 = idxAt(gps, t);
      const i50b = scaledIndex(i100, brake.length, gps.length);
      const i50t = scaledIndex(i100, throttle.length, gps.length);
      const iSteer = scaledIndex(i100, steer.length, gps.length);
      const iRpm = scaledIndex(i100, rpm.length, gps.length);
      const iSpeed = scaledIndex(i100, speed.length, gps.length);
      const iLat = scaledIndex(i100, lat.length, gps.length);
      const iLon = scaledIndex(i100, lon.length, gps.length);
      speedOut[k] = round(speed[iSpeed], 1);
      throttleOut[k] = round(throttle[i50t] / 100, 3);
      brakeOut[k] = round(brake[i50b] / 100, 3);
      steerOut[k] = round(steer[iSteer], 2);
      rpmOut[k] = Math.round(rpm[iRpm]);
      gearOut[k] = gearAt(gearEvents, t);
      latOut[k] = round(lat[iLat], 6);
      lonOut[k] = round(lon[iLon], 6);
      let crossedOff = false;
      while (surfI + 1 < surface.length && surface[surfI + 1].ts <= t) {
        surfI++;
        if (isLooseSurface(surface[surfI])) crossedOff = true;
      }
      const surf = surface[surfI];
      const heldOff = Boolean(surf && surf.ts <= t && isLooseSurface(surf));
      offOut[k] = heldOff || crossedOff ? 1 : 0;
      if (pathLat && trackEdge) {
        const iEdge = scaledIndex(i100, pathLat.length, gps.length);
        const lateral = pathLat[Math.min(iEdge, pathLat.length - 1)];
        const edge = trackEdge[Math.min(iEdge, trackEdge.length - 1)];
        edgeOut[k] = Math.abs(lateral) > Math.abs(edge) + 0.25 ? 1 : 0;
      } else {
        edgeOut[k] = 0;
      }
    }

    const gameLapTime = lapTimeNear(lapTimeEvents, segment.end);
    const timed = gameLapTime != null && gameLapTime > 0;
    return {
      id: `${idPrefix}-${index}`,
      lapNumber: segment.lapNumber,
      durationSec: round(segment.end - segment.start, 3),
      gameLapTime: timed ? round(gameLapTime, 3) : null,
      partial: segment.partial,
      inPit: overlapsPit(pits, segment.start, segment.end),
      leftAsphalt: offOut.some(value => value === 1),
      pastEdge: edgeOut.some(value => value === 1),
      gameDidNotTime: !timed,
      distanceM: round(dMax, 1),
      speed: speedOut,
      throttle: throttleOut,
      brake: brakeOut,
      steer: steerOut,
      rpm: rpmOut,
      gear: gearOut,
      lat: latOut,
      lon: lonOut,
      off: offOut,
      edge: edgeOut,
    };
  });

  const timedFlying = laps.filter(
    lap => lap.gameLapTime != null && !lap.partial && !lap.inPit,
  );
  const pool =
    timedFlying.length > 0 ? timedFlying : laps.filter(lap => lap.gameLapTime);
  let bestLapId = null;
  let best = Infinity;
  for (const lap of pool) {
    if (lap.gameLapTime != null && lap.gameLapTime < best) {
      best = lap.gameLapTime;
      bestLapId = lap.id;
    }
  }

  return {
    id: idPrefix,
    track: meta.TrackName || meta.TrackLayout || 'Unknown track',
    layout: meta.TrackLayout || '',
    car: meta.CarName || 'Unknown car',
    carClass: meta.CarClass || '',
    sessionType: meta.SessionType || '',
    recordingTime: meta.RecordingTime || '',
    weather: meta.WeatherConditions || '',
    points,
    sample: 'distance',
    units: {
      speed: 'km/h',
      throttle: '0-1',
      brake: '0-1',
      steer: 'percent of lock',
      rpm: 'rpm',
      gear: 'gear',
    },
    bestLapId,
    laps,
  };
}

function idFromMeta(dbPath) {
  const meta = metadata(dbPath);
  const stamp = (meta.RecordingTime || 'stint').replace(/[^0-9T]/g, '');
  const track = (meta.TrackName || 'track').replace(/\s+/g, '');
  return `${track}-${stamp}`;
}

const stint = extractStint(file, idFromMeta(file));
if (referenceFile) {
  const reference = extractStint(
    referenceFile,
    `ref-${idFromMeta(referenceFile)}`,
  );
  const best =
    reference.laps.find(lap => lap.id === reference.bestLapId) ||
    reference.laps.find(lap => lap.gameLapTime != null);
  if (best) {
    stint.reference = {
      ...best,
      id: `ref-${best.id}`,
      from: {
        track: reference.track,
        car: reference.car,
        sessionType: reference.sessionType,
        recordingTime: reference.recordingTime,
        gameLapTime: best.gameLapTime,
      },
    };
  }
}

mkdirSync(dirname(outPath), {recursive: true});
const json = JSON.stringify(stint);
writeFileSync(outPath, json);
const kb = (Buffer.byteLength(json) / 1024).toFixed(0);
console.log(
  `${stint.track} ${stint.sessionType} ${stint.car}\n` +
    `${stint.laps.length} laps, ${points} pts, ${kb} KB -> ${outPath}\n` +
    stint.laps
      .map(lap => {
        const tags = [
          lap.partial ? 'partial' : '',
          lap.inPit ? 'pit' : '',
          lap.leftAsphalt ? `off:${lap.off.filter(v => v).length}` : '',
          lap.pastEdge ? `edge:${lap.edge.filter(v => v).length}` : '',
          lap.gameDidNotTime ? 'untimed' : '',
        ]
          .filter(Boolean)
          .join(',');
        const time = lap.gameLapTime ?? lap.durationSec;
        const mark = lap.id === stint.bestLapId ? '*' : ' ';
        return `${mark} L${String(lap.lapNumber).padStart(3)} ${time.toFixed(
          3,
        )} ${tags}`;
      })
      .join('\n'),
);
if (stint.reference) {
  console.log(
    `reference ${stint.reference.gameLapTime}s from ${stint.reference.from.recordingTime}`,
  );
}
