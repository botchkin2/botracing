// LMU adapter: turn one LMU .duckdb recording into our own archive.
//
// The archive is sim-neutral, so analysis never reads LMU tables:
//   samples.parquet  one row per base tick (100 Hz), every channel as a column.
//                    Slower channels hold their last value between samples.
//                    Values are fixed-point decimals by unit, which is what
//                    keeps a race-hour near 16 MB.
//   events.parquet   (t, name, v1..v4), one row per event change.
// Core channels and events get neutral names (speed_kmh, lap, in_pits, ...).
// Everything else keeps a slug of the LMU name so nothing is thrown away.
import {basename} from 'node:path';
import {rows, run, sqlPath} from './duck.mjs';
import {fuelSetup} from './fuelFacts.mjs';

export {eventFor, readEventWindows} from './lmuEvents.mjs';

export const sim = 'lmu';

export const defaultFolder =
  'C:\\Program Files (x86)\\Steam\\steamapps\\common\\Le Mans Ultimate\\UserData\\Telemetry';

// tasklist IMAGENAME. watch.mjs uses this as the game that blocks a sync.
export const gameExe = 'Le Mans Ultimate.exe';

// How tools/uploader/watch.mjs treats this sim. legacyLayout: its sync state is
// the top level of the watcher's state.json and its sync work folder is the
// one passed in (installs from before the second sim keep their record).
// quietMin: --quiet-min for the sync, null for sync.mjs's default; the game
// is closed when the watcher syncs, so nothing is still being written.
// gameExeEnv: an env var that stands in for gameExe (a test seam).
export const watcher = {
  legacyLayout: true,
  quietMin: 0,
  gameExeEnv: 'LAP_GAME_EXE',
};

const channelNames = {
  'GPS Time': 't',
  'Ground Speed': 'speed_kmh',
  'Engine RPM': 'rpm',
  'Throttle Pos': 'throttle_pct',
  'Brake Pos': 'brake_pct',
  'Clutch Pos': 'clutch_pct',
  'Steering Pos': 'steer_pct',
  'Lap Dist': 'lap_dist_m',
  'Total Dist': 'total_dist_m',
  'GPS Latitude': 'lat_deg',
  'GPS Longitude': 'lon_deg',
  'G Force Lat': 'g_lat',
  'G Force Long': 'g_long',
  'G Force Vert': 'g_vert',
  'Fuel Level': 'fuel_l',
  'Virtual Energy': 'virtual_energy_pct',
  'Path Lateral': 'path_lateral_m',
  'Track Edge': 'track_edge_m',
};

const eventNames = {
  Lap: 'lap',
  'Lap Time': 'lap_time',
  'In Pits': 'in_pits',
  Gear: 'gear',
  LastImpactMagnitude: 'impact',
  SurfaceTypes: 'surface',
  'Yellow Flag State': 'yellow_flag',
  'Current Sector1': 'sector1_time',
  'Current Sector2': 'sector2_through_time',
};

// Precision per unit, kept finer than anything the analysis or charts use.
const typeByUnit = {
  s: 'DECIMAL(12,4)',
  'km/h': 'DECIMAL(7,2)',
  'm/s': 'DECIMAL(7,2)',
  RPM: 'INTEGER',
  '%': 'DECIMAL(5,1)',
  m: 'DECIMAL(10,4)',
  C: 'DECIMAL(5,1)',
  Nm: 'DECIMAL(7,2)',
  kW: 'DECIMAL(6,1)',
  Pa: 'INTEGER',
  deg: 'DECIMAL(11,7)',
  G: 'DECIMAL(6,3)',
  kPa: 'DECIMAL(6,1)',
  L: 'DECIMAL(6,2)',
};

// LMU stores four-wheel channels as value1..value4 in this order.
const wheels = ['fl', 'fr', 'rl', 'rr'];

export function slug(name) {
  return name
    .replace(/([a-z])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}

function quote(name) {
  return `"${name.replaceAll('"', '""')}"`;
}

export function isRecording(path) {
  return path.toLowerCase().endsWith('.duckdb');
}

// Bump this whenever describe() computes something differently or adds a field:
// the uploader re-describes every file whose cached result carries another
// version (describeCache.mjs). 1: before versions existed; 2: the fuel setup's
// LMP2 gallons string and flat-0 VE (#144), which never reached files described
// earlier.
export const describeVersion = 2;

// Metadata, channels, and events of one recording, without reading samples.
export function describe(path) {
  const meta = {};
  let setupJson = null;
  for (const row of rows(path, 'SELECT key, value FROM metadata')) {
    if (row.key === 'CarSetup') setupJson = row.value;
    else meta[row.key] = row.value;
  }
  const tableColumns = {};
  for (const row of rows(
    path,
    "SELECT table_name, string_agg(column_name, '|' ORDER BY column_index) AS cols FROM duckdb_columns() GROUP BY 1",
  )) {
    tableColumns[row.table_name] = row.cols.split('|');
  }
  const channels = rows(
    path,
    'SELECT channelName, frequency, unit FROM channelsList',
  )
    .filter(row => tableColumns[row.channelName])
    .map(row => ({
      source: row.channelName,
      name: channelNames[row.channelName] || slug(row.channelName),
      hz: Number(row.frequency),
      unit: row.unit || '',
      parts: tableColumns[row.channelName].filter(col =>
        col.startsWith('value'),
      ),
    }));
  const events = rows(path, 'SELECT eventName, unit FROM eventsList')
    .filter(row => tableColumns[row.eventName])
    .map(row => ({
      source: row.eventName,
      name: eventNames[row.eventName] || slug(row.eventName),
      unit: row.unit || '',
      parts: tableColumns[row.eventName].filter(col => col.startsWith('value')),
    }));
  const base = channels.find(channel => channel.source === 'GPS Time');
  if (!base) throw new Error(`${basename(path)} has no GPS Time channel`);
  const [span] = rows(
    path,
    'SELECT count(*) AS n, min(value) AS t0, max(value) AS t1 FROM "GPS Time"',
  );
  return {
    sim,
    source: basename(path),
    driver: meta.DriverName || '',
    recordedAt: isoFromStamp(meta.RecordingTime) || null,
    sessionClock: meta.SessionTime || '',
    sessionType: meta.SessionType || '',
    track: meta.TrackName || 'Unknown track',
    layout: meta.TrackLayout || meta.TrackName || '',
    car: meta.CarName || 'Unknown car',
    carClass: meta.CarClass || '',
    // The fuel fill limit and tank from the car setup (fuelFacts.mjs).
    fuelSetup: fuelSetup(setupJson),
    weather: meta.WeatherConditions || '',
    baseHz: base.hz,
    ticks: Number(span.n),
    startT: Number(span.t0),
    endT: Number(span.t1),
    channels: channels.map(({source, name, hz, unit, parts}) => ({
      source,
      name,
      hz,
      unit,
      columns: columnNames(name, parts),
    })),
    events: events.map(({source, name, unit, parts}) => ({
      source,
      name,
      unit,
      width: parts.length,
    })),
    _channels: channels,
    _events: events,
  };
}

function columnNames(name, parts) {
  if (parts.length <= 1) return [name];
  if (parts.length === 4) return wheels.map(wheel => `${name}_${wheel}`);
  return parts.map((_, i) => `${name}_${i + 1}`);
}

function isoFromStamp(stamp) {
  const match = String(stamp || '').match(
    /(\d{4}-\d{2}-\d{2})T(\d{2})_(\d{2})_(\d{2})/,
  );
  return match ? `${match[1]}T${match[2]}:${match[3]}:${match[4]}Z` : '';
}

// Largest magnitude a column type holds.
function typeLimit(type) {
  if (type === 'INTEGER') return 2 ** 31 - 1;
  const match = type.match(/DECIMAL\((\d+),(\d+)\)/);
  if (!match) return Infinity;
  const [p, scale] = [Number(match[1]), Number(match[2])];
  // The cast rounds, so stay half a step below the largest value it holds.
  return 10 ** (p - scale) - 0.5 * 10 ** -scale;
}

// Some channels carry values the unit does not predict: regen in watts under
// a kW label, raw virtual energy on some cars, NaN. A channel whose values do
// not fit its fixed-point type is kept as a float instead, so nothing is lost.
function valuesFit(path, channels) {
  const parts = [];
  channels.forEach((channel, k) => {
    const type = typeByUnit[channel.unit];
    if (!type) return;
    for (const part of channel.parts) {
      parts.push(
        `SELECT ${k} AS k, max(abs(${quote(
          part,
        )})) FILTER (WHERE isfinite(${quote(part)})) AS m, ` +
          `count(*) FILTER (WHERE NOT isfinite(${quote(
            part,
          )})) AS bad FROM ${quote(channel.source)}`,
      );
    }
  });
  const ok = new Map();
  if (parts.length) {
    for (const row of rows(path, parts.join(' UNION ALL '))) {
      const channel = channels[Number(row.k)];
      const limit = typeLimit(typeByUnit[channel.unit]);
      const fine = Number(row.bad) === 0 && !(Number(row.m) >= limit);
      ok.set(channel, (ok.get(channel) ?? true) && fine);
    }
  }
  return channel => ok.get(channel) ?? true;
}

// Write samples.parquet and events.parquet for one recording.
export function writeArchive(path, info, samplesOut, eventsOut) {
  const base = info._channels.find(channel => channel.source === 'GPS Time');
  const select = ['g.i AS tick', `b.value::${typeByUnit.s} AS t`];
  const joins = [
    'JOIN (SELECT rowid AS r, value FROM "GPS Time") b ON b.r = g.i',
  ];
  const fits = valuesFit(path, info._channels);
  info._channels.forEach((channel, k) => {
    if (channel === base) return;
    const alias = `c${k}`;
    const type =
      typeByUnit[channel.unit] && fits(channel)
        ? typeByUnit[channel.unit]
        : 'FLOAT';
    const ratio = channel.hz / base.hz;
    joins.push(
      `LEFT JOIN (SELECT rowid AS r, * FROM ${quote(
        channel.source,
      )}) ${alias} ` + `ON ${alias}.r = CAST(floor(g.i * ${ratio}) AS BIGINT)`,
    );
    const names = columnNames(channel.name, channel.parts);
    channel.parts.forEach((part, i) => {
      select.push(`${alias}.${quote(part)}::${type} AS ${quote(names[i])}`);
    });
  });
  run(
    path,
    `COPY (SELECT ${select.join(', ')} FROM (SELECT range AS i FROM range(${
      info.ticks
    })) g ` +
      `${joins.join(' ')} ORDER BY g.i) TO ${sqlPath(samplesOut)} ` +
      '(FORMAT parquet, COMPRESSION zstd, COMPRESSION_LEVEL 9, ROW_GROUP_SIZE 100000)',
  );

  const parts = info._events.map(event => {
    const values = [0, 1, 2, 3].map(i => {
      const col = event.parts[i];
      return col
        ? `TRY_CAST(${quote(col)} AS DOUBLE) AS v${i + 1}`
        : `NULL::DOUBLE AS v${i + 1}`;
    });
    return `SELECT ts::DOUBLE AS t, '${event.name}' AS name, ${values.join(
      ', ',
    )} FROM ${quote(event.source)}`;
  });
  run(
    path,
    `COPY (${parts.join(' UNION ALL ')} ORDER BY t, name) TO ${sqlPath(
      eventsOut,
    )} ` + '(FORMAT parquet, COMPRESSION zstd)',
  );
}
