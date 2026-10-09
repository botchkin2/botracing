// The measured track surface artifact (pit-wall thread 40, E9).
//
// One file per track layout, rebuilt from a named set of sessions' lap traces:
// the centre path and the edges the game itself measured (PathLateral and
// TrackEdge), summed per 10 m bin (src/analysis/trackSurface.ts). Each run
// starts from an empty surface. The file does not record which sessions it
// came from, so rebuilding twice from the same set gives the same file.
//
//   gs://BUCKET/surface/{trackId}/v1.json.gz
//   Firestore tracks/{trackId}.surface = {path, format, laps, bins, updatedAt}
//
// Run:
//   node tools/sessions/surface.mjs --api https://botracing-61.web.app/api/lmu --out DIR [--track ID]
//       read-only from the public API, writes DIR/{trackId}.json (no cloud access)
//   node tools/sessions/surface.mjs [--track ID] --sessions id,id [--dry]
//   node tools/sessions/surface.mjs [--track ID] --owner UID [--dry]
//       rebuild from that named set. One of the two is required. Omitting
//       both would count every owner's copy of the same laps.
// Tests: node --test tools/sessions/surface.test.mjs
import {mkdirSync, writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {Buffer} from 'node:buffer';
import {gunzipSync, gzipSync} from 'node:zlib';
import {LMU_FAKE_ORIGIN, toLocalMetres} from '../../src/analysis/geo.ts';
import {parseTraceCsv} from '../../src/analysis/traceCsv.ts';
import {surfaceProgressLine} from './surfaceProgress.mjs';
import {apiAuthHeaders} from './apiAuth.mjs';
import {
  addSession,
  emptySurface,
  SURFACE_STEP_M,
} from '../../src/analysis/trackSurface.ts';

export const SURFACE_FORMAT = 1;
export const surfacePath = trackId => `surface/${trackId}/v1.json.gz`;
// Which laps and samples went in. A stored artifact built under other rules is
// thrown away and rebuilt from every session. 2: grid laps (lap number 0) are
// left out: a race's lap 0 sits on the grid with LapDistPct 0 for a minute and
// pulled Sebring's first bin 80 m off the road (pit-wall thread 44, E).
export const SURFACE_RULES = 2;

// A lap the surface may use: a whole, timed, comparable lap with no pit lane
// (the pit lane's lateral is not the racing surface's: Daytona reads -17..+29 m).
export function usableLap(lap) {
  return (
    lap.lapNumber !== 0 &&
    lap.timed === true &&
    lap.comparable === true &&
    lap.partial !== true &&
    lap.pitlane !== true &&
    lap.pitIn !== true &&
    lap.pitOut !== true
  );
}

/**
 * One lap's samples that have a position, in the game's own metres (the
 * fake-origin frame, before any georef), ready for addLap. Null when the CSV
 * predates PathLateral and TrackEdge (analysis version 9). Samples after the
 * lap counter wraps belong to the next lap and are left out.
 */
export function surfaceLapFromCsv(csv, lengthM) {
  const raw = parseTraceCsv(csv);
  if (!raw.pathLateralM || !raw.trackEdgeM) return null;
  const lap = {distM: [], x: [], y: [], pathLateralM: [], trackEdgeM: []};
  for (let i = 0; i < raw.lat.length; i++) {
    if (i > 0 && raw.lapDistPct[i] < raw.lapDistPct[i - 1] - 0.5) break;
    if (!Number.isFinite(raw.lat[i]) || !Number.isFinite(raw.lon[i])) continue;
    const p = toLocalMetres(
      {lat: raw.lat[i], lon: raw.lon[i]},
      LMU_FAKE_ORIGIN,
    );
    lap.distM.push(raw.lapDistPct[i] * lengthM);
    lap.x.push(p.x);
    lap.y.push(p.y);
    lap.pathLateralM.push(raw.pathLateralM[i]);
    lap.trackEdgeM.push(raw.trackEdgeM[i]);
  }
  return lap.x.length > 0 ? lap : null;
}

/**
 * Builds a track's surface from scratch. `sessions` is [{id, csvs: string[]}]
 * (one CSV per usable lap). The same set twice returns equal bins.
 */
export function buildSurface(lengthM, sessions) {
  const surface = {...emptySurface(lengthM), rules: SURFACE_RULES};
  let sessionsAdded = 0;
  let lapsAdded = 0;
  for (const s of sessions) {
    const laps = s.csvs
      .map(csv => surfaceLapFromCsv(csv, lengthM))
      .filter(lap => lap != null);
    if (laps.length === 0) continue;
    addSession(surface, s.id, laps);
    sessionsAdded += 1;
    lapsAdded += laps.length;
  }
  return {surface, sessionsAdded, lapsAdded};
}

// The stored file: rounded so it is small, plain JSON.
export function serializeSurface(surface) {
  const r = v => Math.round(v * 1000) / 1000;
  const {sessions: _ids, ...rest} = surface;
  return JSON.stringify({
    ...rest,
    bins: rest.bins.map(b => ({
      ...b,
      sx: r(b.sx),
      sy: r(b.sy),
      sL: r(b.sL),
      sR: r(b.sR),
    })),
  });
}

export function gzipSurface(surface) {
  return gzipSync(Buffer.from(serializeSurface(surface), 'utf8'), {level: 9});
}

export function parseSurface(gz) {
  const s = JSON.parse(gunzipSync(gz).toString('utf8'));
  if (s.v !== 1) throw new Error(`surface format ${s.v} is not supported`);
  return s;
}

// ---------------------------------------------------------------------------

async function apiJson(base, path) {
  const res = await fetch(`${base}${path}`, {headers: apiAuthHeaders()});
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.json();
}

async function fromApi(base, trackFilter, outDir) {
  mkdirSync(outDir, {recursive: true});
  const {items} = await apiJson(base, '/sessions?age=3650');
  const byTrack = new Map();
  for (const s of items) {
    if (trackFilter && s.trackId !== trackFilter) continue;
    if (!byTrack.has(s.trackId)) byTrack.set(s.trackId, []);
    byTrack.get(s.trackId).push(s);
  }
  for (const [trackId, sessions] of byTrack) {
    const map = await apiJson(base, `/sessions/${sessions[0].id}/map`);
    if (!map.lengthM) {
      console.log(`${trackId}: no track map length, skipped`);
      continue;
    }
    const input = [];
    for (const s of sessions) {
      const {items: laps} = await apiJson(base, `/sessions/${s.id}/laps`);
      const csvs = [];
      for (const lap of laps.filter(usableLap)) {
        const res = await fetch(`${base}/laps/${lap.id}/csv`, {
          headers: apiAuthHeaders(),
        });
        if (res.ok) csvs.push(await res.text());
      }
      input.push({id: s.id, csvs});
    }
    const {surface, sessionsAdded, lapsAdded} = buildSurface(
      map.lengthM,
      input,
    );
    const file = resolve(outDir, `${trackId}.json`);
    writeFileSync(file, serializeSurface(surface));
    console.log(
      `${trackId}: ${sessionsAdded}/${
        sessions.length
      } sessions, ${lapsAdded} laps, ${surface.bins.length} bins, ${
        gzipSurface(surface).length
      } bytes gzipped`,
    );
  }
}

export class SurfaceSetError extends Error {}

/**
 * Rebuilds each track's surface from scratch and writes the artifact and the
 * pointer. `trackIds` limits the tracks; null does every track. The set is
 * `sessionIds`, or every session `ownerId` has on the track. One of those is
 * required: every owner at once would count the same laps twice while a
 * copied owner still exists. `dry` reports and writes nothing. The same set
 * twice writes the same bytes. `connectStore` is for tests.
 */
export async function foldSurfaces({
  trackIds = null,
  sessionIds = null,
  ownerId = null,
  dry = false,
  log = console.log,
  connectStore = async () => {
    const store = await import('./store.mjs');
    return {...store.connect(), bucketName: store.bucketName};
  },
} = {}) {
  const ids = (sessionIds ?? []).filter(Boolean);
  if (ids.length === 0 && !ownerId) {
    throw new SurfaceSetError(
      'a named set is required: --sessions id,id or --owner <uid>',
    );
  }
  const {db, bucket, bucketName} = await connectStore();
  const trackDocs = trackIds
    ? await Promise.all(
        trackIds.map(id => db.collection('tracks').doc(id).get()),
      )
    : (await db.collection('tracks').get()).docs;
  // The uploader's watcher reads these lines for its heartbeat: "surface N/M
  // tracks" before each track (N finished so far) and once more at the end.
  const tracks = trackDocs.filter(doc => doc.exists && doc.data().lengthM);
  const named = ids.length > 0 ? new Set(ids) : null;
  let finished = 0;
  for (const doc of tracks) {
    log(surfaceProgressLine(finished, tracks.length));
    finished += 1;
    const trackId = doc.id;
    const track = doc.data();
    const allSessions = (
      await db.collection('sessions').where('trackId', '==', trackId).get()
    ).docs.filter(
      s =>
        (!named || named.has(s.id)) &&
        (!ownerId || s.data().ownerId === ownerId),
    );
    const input = [];
    for (const s of allSessions) {
      const laps = (
        await db.collection('laps').where('sessionId', '==', s.id).get()
      ).docs
        .map(l => ({id: l.id, ...l.data()}))
        .filter(usableLap);
      const csvs = [];
      for (const lap of laps) {
        if (!lap.trace?.path) continue;
        try {
          const [gz] = await bucket
            .file(lap.trace.path)
            .download({decompress: false});
          csvs.push(gunzipSync(gz).toString('utf8'));
        } catch (error) {
          if (error?.code !== 404) throw error;
        }
      }
      input.push({id: s.id, csvs});
    }
    const {surface, sessionsAdded, lapsAdded} = buildSurface(
      track.lengthM,
      input,
    );
    log(
      `${trackId}: ${sessionsAdded} sessions, ${lapsAdded} laps, ${surface.bins.length} bins`,
    );
    if (dry || sessionsAdded === 0) continue;
    const gz = gzipSurface(surface);
    await bucket.file(surfacePath(trackId)).save(gz, {
      resumable: false,
      metadata: {
        contentType: 'application/json',
        contentEncoding: 'gzip',
        cacheControl: 'private, no-cache',
      },
    });
    await db
      .collection('tracks')
      .doc(trackId)
      .update({
        surface: {
          path: surfacePath(trackId),
          format: SURFACE_FORMAT,
          laps: lapsAdded,
          bins: surface.bins.length,
          updatedAt: new Date().toISOString(),
        },
      });
    log(
      `  wrote gs://${bucketName}/${surfacePath(trackId)} (${gz.length} bytes)`,
    );
  }
  if (tracks.length > 0) log(surfaceProgressLine(tracks.length, tracks.length));
}

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : null;
}

// argv[1] is relative when run as `node tools/sessions/surface.mjs`: resolve it,
// or this block is skipped and the command prints nothing.
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const track = arg('--track');
  if (arg('--api')) {
    await fromApi(arg('--api'), track, arg('--out') ?? 'surface-out');
  } else {
    const sessions = arg('--sessions');
    const owner = arg('--owner');
    const sessionIds = sessions ? sessions.split(',').filter(Boolean) : [];
    if (sessionIds.length === 0 && !owner) {
      console.error(
        'a named set is required: --sessions id,id or --owner <uid>',
      );
      process.exit(2);
    }
    await foldSurfaces({
      trackIds: track ? [track] : null,
      sessionIds,
      ownerId: owner,
      dry: process.argv.includes('--dry'),
    });
  }
}
