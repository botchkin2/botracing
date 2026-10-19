// Garage61 as a lap source for the curator (pit-wall thread 78, row K, PR B):
// a track nobody on this PC has driven gets its corner map from other drivers'
// telemetry laps. Curator side only: nothing here is in src/ or functions/, and
// the app never talks to Garage61 (decision 2026-09-27 stands).
//
//   node tools/curate/curate.mjs plan-add <trackId> --from garage61 [--car <id>] [--laps N]
//
// One map builder: this file only turns Garage61's rows into the same laps a
// recording gives (`onGrid`), and `buildFromLaps` (loader.mjs) does the rest, so
// plan-add's refusals (8 laps, GPS, the boundaries) are the ones every map meets.
//
// The token is `GARAGE61_TOKEN` in the repo's gitignored .env. It is sent as a
// Bearer header and is never printed, logged, cached or put in an error.
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {gridNOf, onGrid} from '../sessions/analyze.mjs';
import {slug} from '../sessions/iracing.mjs';
import {buildFromLaps, LoaderError} from './loader.mjs';

const API = 'https://garage61.net/api/v1';
/** The rate Garage61 samples at (verified per CSV: rows / this must equal the lap time). */
export const HZ = 60;
/** A CSV whose row count over HZ is further from the lap's own time than this is not at HZ. */
export const RATE_TOLERANCE_S = 0.25;
/** The speed-integrated length and the GPS length must agree to this share. */
export const LENGTH_TOLERANCE = 0.01;
/** How many laps are fetched unless --laps says otherwise: more than a map needs (8), and past the onset pool (20 laps, 2 drivers). */
export const DEFAULT_LAPS = 30;

// -- the token and the client ---------------------------------------------------------

/** GARAGE61_TOKEN from the text of a .env file (or null). */
export function tokenOf(envText) {
  const m = /^GARAGE61_TOKEN=(.*)$/m.exec(envText ?? '');
  const v = m?.[1]?.trim().replace(/^["']|["']$/g, '');
  return v || null;
}

export function readToken(envPath) {
  if (!existsSync(envPath))
    throw new LoaderError(
      `no .env at ${envPath}: GARAGE61_TOKEN belongs there`,
    );
  const token = tokenOf(readFileSync(envPath, 'utf8'));
  if (!token) throw new LoaderError('GARAGE61_TOKEN is not set in the .env');
  return token;
}

/** One lap's CSV is not readable with this token (HTTP 403 or 404). */
export class LapHidden extends Error {
  constructor(status) {
    super(`telemetry not readable (HTTP ${status})`);
    this.status = status;
  }
}

/**
 * A Garage61 client. `fetchImpl` and `sleep` are test seams; `cacheDir` keeps
 * each lap's CSV, so a rerun asks for nothing it has. A 429 waits as long as
 * the server says (default 5 s) and tries again, up to `retries` times. No
 * error carries the token, the headers or the response body.
 */
export function createClient({
  token,
  fetchImpl = fetch,
  sleep = ms => new Promise(r => setTimeout(r, ms)),
  cacheDir = null,
  retries = 5,
}) {
  async function request(path) {
    for (let attempt = 0; ; attempt++) {
      const res = await fetchImpl(`${API}${path}`, {
        headers: {Authorization: `Bearer ${token}`},
      });
      if (res.status === 429 && attempt < retries) {
        const wait = Number(res.headers?.get?.('retry-after'));
        await sleep((Number.isFinite(wait) && wait > 0 ? wait : 5) * 1000);
        continue;
      }
      // One lap's telemetry can be private even when the row says it is
      // visible: that lap is skipped, the run goes on (see buildFromGarage61).
      if (path.endsWith('/csv') && (res.status === 403 || res.status === 404))
        throw new LapHidden(res.status);
      if (res.status === 401 || res.status === 403)
        throw new LoaderError(
          `Garage61 refused the token (HTTP ${res.status}) on ${
            path.split('?')[0]
          }`,
        );
      if (!res.ok)
        throw new LoaderError(
          `Garage61 answered HTTP ${res.status} on ${path.split('?')[0]}`,
        );
      return res;
    }
  }
  return {
    async tracks() {
      return (await (await request('/tracks')).json()).items;
    },
    /** One personal best per driver on a track (sorted fastest first by the API), optionally one car. */
    async bests(trackId, {car = null, limit = 1000} = {}) {
      const q = `tracks=${trackId}&group=driver&limit=${limit}${
        car != null ? `&cars=${car}` : ''
      }`;
      const j = await (await request(`/laps?${q}`)).json();
      return {items: j.items, total: j.total};
    },
    async csv(lapId) {
      const file = cacheDir ? join(cacheDir, `${lapId}.csv`) : null;
      if (file && existsSync(file)) return readFileSync(file, 'utf8');
      const text = await (await request(`/laps/${lapId}/csv`)).text();
      if (file) {
        mkdirSync(cacheDir, {recursive: true});
        writeFileSync(file, text);
      }
      return text;
    },
  };
}

// -- track and lap selection (pure) ---------------------------------------------------

/**
 * The Garage61 track for one of our track ids. Our iRacing id is
 * `iracing-<TrackID>-<slug(config)>`: Garage61's `platform_id` is the TrackID
 * and its `variant` the config name. A track whose variant does not slug to ours
 * is refused with both names printed (an empty variant has no config name to
 * check; its TrackID alone names it, and the report says so).
 */
export function matchTrack(g61Tracks, trackId) {
  const m = /^iracing-(\d+)-(.+)$/.exec(trackId);
  if (!m)
    throw new LoaderError(
      `${trackId} is not an iRacing layout id (iracing-<TrackID>-<name>): Garage61 only has iRacing tracks`,
    );
  const [, platformId, ours] = m;
  const sameId = g61Tracks.filter(
    t => t.platform === 'iracing' && String(t.platform_id) === platformId,
  );
  if (sameId.length === 0)
    throw new LoaderError(
      `Garage61 has no iRacing track with TrackID ${platformId} (${trackId})`,
    );
  const named = sameId.filter(t => t.variant && slug(t.variant) === ours);
  if (named.length === 1) return {track: named[0], checkedName: true};
  const unnamed = sameId.filter(t => !t.variant);
  if (named.length === 0 && unnamed.length === 1 && sameId.length === 1)
    return {track: unnamed[0], checkedName: false};
  throw new LoaderError(
    `${trackId} does not match one Garage61 track: ${
      sameId.map(t => `"${t.name}" / "${t.variant}" (id ${t.id})`).join(', ') ||
      'none'
    } (our name "${ours}")`,
  );
}

/** A lap's own flags say it is a clean full lap whose telemetry this token may read. */
export const usable = l =>
  l.clean === true &&
  l.canViewTelemetry === true &&
  !l.offtrack &&
  !l.pitIn &&
  !l.pitOut &&
  !l.pitlane &&
  !l.discontinuity &&
  !l.missing &&
  !l.incomplete;

/** The car with the most usable personal bests: one car, so the laps share braking points and speeds. */
export function commonCar(items) {
  const count = new Map();
  for (const l of items.filter(usable))
    count.set(l.car?.id, (count.get(l.car?.id) ?? 0) + 1);
  let best = null;
  for (const [id, n] of count)
    if (id != null && (best == null || n > best.n)) best = {id, n};
  return best;
}

/** The fastest `n` usable laps (the API lists them fastest first; sorted again to be sure). */
export function pickLaps(items, n) {
  return items
    .filter(usable)
    .sort((a, b) => a.lapTime - b.lapTime)
    .slice(0, n);
}

// -- one CSV to one lap ---------------------------------------------------------------

/** The CSV's header and numeric rows (an empty or NaN cell is NaN). */
export function parseCsv(text) {
  const lines = String(text).trim().split(/\r?\n/);
  const head = lines[0].split(',');
  const rows = lines.slice(1).map(l => l.split(',').map(Number));
  return {head, rows, col: name => head.indexOf(name)};
}

const NEEDED = ['Speed', 'LapDistPct', 'Lat', 'Lon', 'Brake', 'Throttle'];

const metres = (lat0, lon0, lat1, lon1) =>
  Math.hypot(
    (lat1 - lat0) * 111320,
    (lon1 - lon0) * 111320 * Math.cos((lat1 * Math.PI) / 180),
  );

/**
 * One Garage61 lap CSV as the lap a recording would give: `rec` and `lap` for
 * `onGrid`, plus its two lengths. Refused, with the numbers, when a column is
 * missing, the rows are not at HZ (rows / HZ against the lap's own time), the
 * car was in the pit lane, or the speed-integrated length and the GPS length
 * differ by more than LENGTH_TOLERANCE. Returns {refused} or {rec, lap, ...}.
 */
export function lapFromCsv(text, {lapTime}) {
  const {head, rows, col} = parseCsv(text);
  const missing = NEEDED.filter(n => col(n) < 0);
  if (missing.length)
    return {refused: `no ${missing.join(', ')} column (has ${head.join(' ')})`};
  const n = rows.length;
  if (n < 100) return {refused: `only ${n} rows`};
  const seconds = n / HZ;
  if (Math.abs(seconds - lapTime) > RATE_TOLERANCE_S)
    return {
      refused: `${n} rows at ${HZ} Hz is ${seconds.toFixed(
        2,
      )} s, the lap says ${lapTime.toFixed(2)} s: not ${HZ} Hz`,
    };
  const pos = col('PositionType');
  if (pos >= 0 && rows.some(r => r[pos] === 1 || r[pos] === 2))
    return {refused: 'the car was in the pit lane'};
  const [cS, cLat, cLon, cB, cT] = [
    'Speed',
    'Lat',
    'Lon',
    'Brake',
    'Throttle',
  ].map(col);
  if (rows.some(r => !Number.isFinite(r[cLat]) || !Number.isFinite(r[cLon])))
    return {refused: 'a row has no GPS'};
  const t = new Float64Array(n);
  const speed = new Float64Array(n);
  const brake = new Float64Array(n);
  const throttle = new Float64Array(n);
  const lat = new Float64Array(n);
  const lon = new Float64Array(n);
  const dist = new Float64Array(n);
  let gps = 0;
  for (let i = 0; i < n; i++) {
    const r = rows[i];
    t[i] = i / HZ;
    speed[i] = r[cS] * 3.6;
    brake[i] = r[cB] * 100;
    throttle[i] = r[cT] * 100;
    lat[i] = r[cLat];
    lon[i] = r[cLon];
    if (i > 0) {
      dist[i] = dist[i - 1] + r[cS] / HZ;
      gps += metres(lat[i - 1], lon[i - 1], lat[i], lon[i]);
    }
  }
  const length = dist[n - 1];
  if (!(length > 100) || Math.abs(length - gps) / gps > LENGTH_TOLERANCE)
    return {
      refused: `speed length ${length.toFixed(
        1,
      )} m and GPS length ${gps.toFixed(1)} m differ by more than ${
        LENGTH_TOLERANCE * 100
      } %`,
    };
  return {
    rec: {
      s: {
        t,
        speed_kmh: speed,
        throttle_pct: throttle,
        brake_pct: brake,
        lat_deg: lat,
        lon_deg: lon,
      },
    },
    lap: {dist, i0: 0, i1: n - 1},
    distanceM: length,
    gpsM: gps,
    lapTime: seconds,
  };
}

// -- the map --------------------------------------------------------------------------

/**
 * The `built` plan-add takes, from other drivers' Garage61 laps on one track.
 * Each driver is one "session" in the boundary fold, so the fold's minimum
 * sessions counts distinct drivers. `report` says what was asked and what
 * became of each lap, with no driver names and no lap ids (app data holds no
 * user references, DATA_MODEL.md).
 */
export async function buildFromGarage61({
  client,
  trackId,
  car = null,
  laps = DEFAULT_LAPS,
  log = () => {},
}) {
  const {track, checkedName} = matchTrack(await client.tracks(), trackId);
  if (!checkedName)
    log(
      `note: Garage61's variant for "${track.name}" is empty, so only the TrackID ${track.platform_id} names it`,
    );
  const all = await client.bests(track.id);
  const chosenCar = car ?? commonCar(all.items)?.id ?? null;
  if (chosenCar == null)
    throw new LoaderError(
      `no clean lap with visible telemetry on ${trackId} (${all.items.length} personal bests listed)`,
    );
  // That car's personal best of every driver who has driven it.
  const pool = (await client.bests(track.id, {car: chosenCar})).items;
  const picked = pickLaps(
    pool.filter(l => l.car?.id === chosenCar),
    laps,
  );
  const report = {
    garage61Track: `${track.name}${track.variant ? ` / ${track.variant}` : ''}`,
    visibleDrivers: all.total,
    carId: chosenCar,
    asked: picked.length,
    refused: [],
    used: 0,
  };
  const sessions = [];
  for (const l of picked) {
    let csv;
    try {
      csv = await client.csv(l.id);
    } catch (error) {
      if (!(error instanceof LapHidden)) throw error;
      report.refused.push(error.message);
      continue;
    }
    const made = lapFromCsv(csv, {lapTime: l.lapTime});
    if (made.refused) {
      report.refused.push(made.refused);
      continue;
    }
    const gridN = gridNOf(made.distanceM);
    const grid = onGrid(made.rec, made.lap, gridN);
    sessions.push({
      id: `driver-${sessions.length + 1}`,
      laps: [
        {
          grid,
          dist: made.lap.dist,
          i0: made.lap.i0,
          i1: made.lap.i1,
          distanceM: made.distanceM,
          lapTime: made.lapTime,
          timed: true,
          partial: false,
          comparable: true,
          clean: true,
          pitlane: false,
          pitIn: false,
          pitOut: false,
        },
      ],
    });
  }
  report.used = sessions.length;
  if (sessions.length === 0)
    throw new LoaderError(
      `none of the ${picked.length} laps could be used: ${[
        ...new Set(report.refused),
      ].join('; ')}`,
    );
  const built = buildFromLaps({
    sim: 'iracing',
    track: {name: track.name, variant: trackId.replace(/^iracing-/, '')},
    sessions,
  });
  built.source = {
    kind: 'garage61',
    laps: report.used,
    drivers: report.used,
    query: `tracks=<id>&group=driver, the fastest ${laps} clean laps with visible telemetry of one car`,
  };
  built.report = report;
  return built;
}
