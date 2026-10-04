// iRacing adapter: one .ibt recording → sim-neutral archive.
// Analysis never reads iRacing names. Conversions live in CHANNELS.
import {mkdirSync, writeFileSync} from 'node:fs';
import {basename, dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {run, sqlPath} from './duck.mjs';
import {
  openIbt,
  readColumn,
  sampleAt,
  yamlField,
  yamlKmToM,
} from './ibt.mjs';

export const sim = 'iracing';

export const defaultFolder =
  'C:\\Users\\Botkin\\Documents\\iRacing\\telemetry';

export const describeVersion = 2;

export function slug(name) {
  return String(name)
    .replace(/([a-z])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '_')
    .replace(/^_|_$/g, '');
}

export function isRecording(path) {
  return path.toLowerCase().endsWith('.ibt');
}

export function readEventWindows() {
  return [];
}

export function eventFor() {
  return null;
}

// source: iRacing var. scale applied in the adapter. Missing source → column
// omitted (null downstream). Do not invent VE, field, or damage.
export const CHANNELS = [
  {source: 'SessionTime', name: 't', unit: 's', scale: 1},
  {source: 'Speed', name: 'speed_kmh', unit: 'km/h', scale: 3.6},
  {source: 'Throttle', name: 'throttle_pct', unit: '%', scale: 100},
  {source: 'Brake', name: 'brake_pct', unit: '%', scale: 100},
  {source: 'ThrottleRaw', name: 'throttle_pos_unfiltered', unit: '%', scale: 100},
  {source: 'SteeringWheelAngle', name: 'steer_pct', unit: '%', scale: 'steer'},
  {source: 'RPM', name: 'rpm', unit: 'RPM', scale: 1},
  {source: 'LapDist', name: 'lap_dist_m', unit: 'm', scale: 1},
  {source: 'Lat', name: 'lat_deg', unit: 'deg', scale: 1},
  {source: 'Lon', name: 'lon_deg', unit: 'deg', scale: 1},
  {source: 'FuelLevel', name: 'fuel_l', unit: 'L', scale: 1},
  {source: 'LFtempCM', name: 'tyres_carcass_temp_fl', unit: 'C', scale: 1},
  {source: 'RFtempCM', name: 'tyres_carcass_temp_fr', unit: 'C', scale: 1},
  {source: 'LRtempCM', name: 'tyres_carcass_temp_rl', unit: 'C', scale: 1},
  {source: 'RRtempCM', name: 'tyres_carcass_temp_rr', unit: 'C', scale: 1},
  {source: 'LFwearL', name: 'tyres_wear_fl', unit: '%', scale: 100},
  {source: 'RFwearL', name: 'tyres_wear_fr', unit: '%', scale: 100},
  {source: 'LRwearL', name: 'tyres_wear_rl', unit: '%', scale: 100},
  {source: 'RRwearL', name: 'tyres_wear_rr', unit: '%', scale: 100},
  {source: 'LFpressure', name: 'tyres_pressure_fl', unit: 'kPa', scale: 1},
  {source: 'RFpressure', name: 'tyres_pressure_fr', unit: 'kPa', scale: 1},
  {source: 'LRpressure', name: 'tyres_pressure_rl', unit: 'kPa', scale: 1},
  {source: 'RRpressure', name: 'tyres_pressure_rr', unit: 'kPa', scale: 1},
  {source: 'LFtempM', name: 'tyres_rubber_temp_fl', unit: 'C', scale: 1},
  {source: 'RFtempM', name: 'tyres_rubber_temp_fr', unit: 'C', scale: 1},
  {source: 'LRtempM', name: 'tyres_rubber_temp_rl', unit: 'C', scale: 1},
  {source: 'RRtempM', name: 'tyres_rubber_temp_rr', unit: 'C', scale: 1},
  {source: 'LFtempL', name: 'tyres_temp_left_fl', unit: 'C', scale: 1},
  {source: 'RFtempL', name: 'tyres_temp_left_fr', unit: 'C', scale: 1},
  {source: 'LRtempL', name: 'tyres_temp_left_rl', unit: 'C', scale: 1},
  {source: 'RRtempL', name: 'tyres_temp_left_rr', unit: 'C', scale: 1},
  {source: 'LFtempR', name: 'tyres_temp_right_fl', unit: 'C', scale: 1},
  {source: 'RFtempR', name: 'tyres_temp_right_fr', unit: 'C', scale: 1},
  {source: 'LRtempR', name: 'tyres_temp_right_rl', unit: 'C', scale: 1},
  {source: 'RRtempR', name: 'tyres_temp_right_rr', unit: 'C', scale: 1},
];

const YELLOW =
  0x00000008 | 0x00000100 | 0x00004000 | 0x00008000;

function sessionTypeOf(yaml) {
  const num = yamlField(yaml, 'CurrentSessionNum');
  const block = yaml.match(
    new RegExp(
      `- SessionNum:\\s*${num}\\s*[\\s\\S]*?SessionType:\\s*(.+)`,
    ),
  );
  return (block ? block[1] : yamlField(yaml, 'SessionType') || 'Session').trim();
}

function playerCar(yaml) {
  const idx = yamlField(yaml, 'DriverCarIdx');
  const drivers = yaml.split(/\n\s*Drivers:\s*\n/)[1] || '';
  const block = drivers.match(
    new RegExp(`- CarIdx:\\s*${idx}\\n((?:[ ]{2,}.+\\n)+)`),
  );
  const pick = key => {
    if (!block) return '';
    const m = block[1].match(new RegExp(`${key}:\\s*(.+)`));
    return m ? m[1].trim() : '';
  };
  return {
    name: pick('CarScreenName') || pick('CarPath') || 'Unknown car',
    carClass: pick('CarClassShortName') || '',
    path: pick('CarPath'),
  };
}

function fuelFromYaml(yaml) {
  const tank = Number(yamlField(yaml, 'DriverCarFuelMaxLtr'));
  const pct = Number(yamlField(yaml, 'DriverCarMaxFuelPct'));
  return {
    fillLimitL:
      tank > 0 && pct > 0 ? Math.round(tank * pct * 10) / 10 : tank > 0 ? tank : null,
    tankL: tank > 0 ? tank : null,
  };
}

export function describe(path) {
  const ibt = openIbt(path);
  try {
    const {header, yaml, byName} = ibt;
    const n = header.sessionRecordCount;
    if (!n) throw new Error(`${basename(path)} has no samples`);
    const t0 = sampleAt(ibt, 'SessionTime', 0);
    const t1 = sampleAt(ibt, 'SessionTime', n - 1);
    const trackId = yamlField(yaml, 'TrackID') || '0';
    const config = yamlField(yaml, 'TrackConfigName') || yamlField(yaml, 'TrackName');
    const layout = `${trackId}-${slug(config)}`;
    const car = playerCar(yaml);
    const hz = header.tickRate || 60;
    const present = CHANNELS.filter(c => byName.has(c.source));
    const recordedAt =
      header.sessionStartDate > 0
        ? new Date(header.sessionStartDate * 1000).toISOString()
        : null;
    const sub = yamlField(yaml, 'SubSessionID') || '0';
    const sess = yamlField(yaml, 'CurrentSessionNum') || '0';
    return {
      sim,
      source: basename(path),
      driver: yamlField(yaml, 'UserName'),
      recordedAt,
      sessionClock: `${sub}:${sess}`,
      groupId: `${sim}|${sub}|${sess}`,
      sessionType: sessionTypeOf(yaml),
      track: yamlField(yaml, 'TrackDisplayName') || 'Unknown track',
      layout,
      trackLengthM: yamlKmToM(yamlField(yaml, 'TrackLength')),
      car: car.name,
      carClass: car.carClass,
      fuelSetup: fuelFromYaml(yaml),
      weather: yamlField(yaml, 'TrackSkies'),
      baseHz: hz,
      ticks: n,
      startT: Number(t0) || 0,
      endT: Number(t1) || 0,
      channels: present.map(c => ({
        source: c.source,
        name: c.name,
        hz,
        unit: c.unit,
        columns: [c.name],
      })),
      events: [
        {source: 'Lap', name: 'lap', unit: '', width: 1},
        {source: 'LapLastLapTime', name: 'lap_time', unit: 's', width: 1},
        {source: 'OnPitRoad', name: 'in_pits', unit: '', width: 1},
        {source: 'Gear', name: 'gear', unit: '', width: 1},
        {source: 'PlayerTrackSurface', name: 'surface', unit: '', width: 1},
        {source: 'SessionFlags', name: 'yellow_flag', unit: '', width: 1},
      ],
    };
  } finally {
    ibt.close();
  }
}

function scaleOf(channel, ibt) {
  if (channel.scale !== 'steer') return channel.scale;
  const max = ibt.byName.has('SteeringWheelAngleMax')
    ? Math.abs(sampleAt(ibt, 'SteeringWheelAngleMax', 0) || 0)
    : 0;
  return 100 / (max > 0.1 ? max : Math.PI);
}

function csvEscape(v) {
  if (v == null || v === '') return '';
  if (typeof v === 'string') {
    return /[",\n]/.test(v) ? `"${v.replaceAll('"', '""')}"` : v;
  }
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
  return String(v);
}

function writeCsv(path, headers, rows) {
  mkdirSync(dirname(path), {recursive: true});
  const lines = [headers.join(',')];
  for (const row of rows) lines.push(row.map(csvEscape).join(','));
  writeFileSync(path, lines.join('\n'));
}

function emitChanges(t, values, name, map = v => v) {
  const rows = [];
  let prev = null;
  for (let i = 0; i < values.length; i++) {
    const v = map(values[i], i);
    if (i === 0 || v !== prev) rows.push([t[i], name, v, '', '', '']);
    prev = v;
  }
  return rows;
}

function surfaceCode(loc, material) {
  if (loc === 0) return 2;
  if (material >= 15 && material <= 18) return 2;
  if (material >= 19 && material <= 22) return 3;
  if (material === 23 || material === 24 || material === 25) return 4;
  return 0;
}

export function writeArchive(path, info, samplesOut, eventsOut) {
  const ibt = openIbt(path);
  try {
    const cols = {};
    for (const ch of CHANNELS) {
      if (!ibt.byName.has(ch.source)) continue;
      const raw = readColumn(ibt, ch.source);
      const k = scaleOf(ch, ibt);
      cols[ch.name] = Float64Array.from(raw, x => x * k);
    }
    const headers = ['tick', ...Object.keys(cols)];
    const n = info.ticks;
    const rows = [];
    for (let i = 0; i < n; i++) {
      rows.push([i, ...headers.slice(1).map(name => cols[name][i])]);
    }
    mkdirSync(dirname(samplesOut), {recursive: true});
    mkdirSync(dirname(eventsOut), {recursive: true});
    const tmp = `${tmpdir()}/ibt-${process.pid}-${basename(path).replace(/\s+/g, '_')}`;
    writeCsv(`${tmp}.samples.csv`, headers, rows);
    run(
      ':memory:',
      `COPY (SELECT * FROM read_csv(${sqlPath(
        `${tmp}.samples.csv`,
      )}, AUTO_DETECT=true, HEADER=true) ORDER BY tick) TO ${sqlPath(
        samplesOut,
      )} (FORMAT parquet, COMPRESSION zstd, COMPRESSION_LEVEL 9, ROW_GROUP_SIZE 100000)`,
      {readonly: false},
    );

    const t = cols.t;
    const events = [];
    if (ibt.byName.has('Lap')) {
      events.push(...emitChanges(t, readColumn(ibt, 'Lap'), 'lap'));
    }
    if (ibt.byName.has('LapLastLapTime')) {
      const times = readColumn(ibt, 'LapLastLapTime');
      const laps = ibt.byName.has('Lap') ? readColumn(ibt, 'Lap') : null;
      for (let i = 1; i < n; i++) {
        if (laps && laps[i] !== laps[i - 1] && times[i] > 0) {
          events.push([t[i], 'lap_time', times[i], '', '', '']);
        }
      }
    }
    if (ibt.byName.has('OnPitRoad')) {
      events.push(
        ...emitChanges(t, readColumn(ibt, 'OnPitRoad'), 'in_pits', v =>
          v ? 1 : 0,
        ),
      );
    }
    if (ibt.byName.has('Gear')) {
      events.push(...emitChanges(t, readColumn(ibt, 'Gear'), 'gear'));
    }
    if (ibt.byName.has('PlayerTrackSurface')) {
      const loc = readColumn(ibt, 'PlayerTrackSurface');
      const mat = ibt.byName.has('PlayerTrackSurfaceMaterial')
        ? readColumn(ibt, 'PlayerTrackSurfaceMaterial')
        : new Float64Array(n);
      events.push(
        ...emitChanges(t, loc, 'surface', (_, i) =>
          surfaceCode(loc[i], mat[i]),
        ),
      );
    }
    if (ibt.byName.has('SessionFlags')) {
      events.push(
        ...emitChanges(t, readColumn(ibt, 'SessionFlags'), 'yellow_flag', v =>
          v & YELLOW ? 1 : 0,
        ),
      );
    }
    events.sort((a, b) => a[0] - b[0] || a[1].localeCompare(b[1]));
    writeCsv(`${tmp}.events.csv`, ['t', 'event_name', 'v1', 'v2', 'v3', 'v4'], events);
    run(
      ':memory:',
      `COPY (SELECT t, event_name AS name, TRY_CAST(v1 AS DOUBLE) AS v1, TRY_CAST(v2 AS DOUBLE) AS v2, TRY_CAST(v3 AS DOUBLE) AS v3, TRY_CAST(v4 AS DOUBLE) AS v4 FROM read_csv(${sqlPath(
        `${tmp}.events.csv`,
      )}, HEADER=true, ALL_VARCHAR=true) ORDER BY t, event_name) TO ${sqlPath(
        eventsOut,
      )} (FORMAT parquet, COMPRESSION zstd)`,
      {readonly: false},
    );
  } finally {
    ibt.close();
  }
}
