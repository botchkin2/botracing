// The measured track surface artifact (pit-wall thread 40, E9).
//
// One file per track layout, built from every session's lap traces: the
// centre path and the edges the game itself measured (PathLateral and
// TrackEdge), summed per 10 m bin so a new session adds to the old ones
// (src/analysis/trackSurface.ts has the rules and the evidence). It reads what
// is already uploaded (trace CSVs), so it needs no analysisVersion bump and no
// resync; run it after a sync to fold new sessions in. Sessions already in the
// artifact are skipped, so re-running changes nothing.
//
//   gs://BUCKET/surface/{trackId}/v1.json.gz
//   Firestore tracks/{trackId}.surface = {path, format, sessions, laps, bins, updatedAt}
//
// Run:
//   node tools/sessions/surface.mjs --api https://botracing-61.web.app/api/lmu --out DIR [--track ID]
//       read-only from the public API, writes DIR/{trackId}.json (no cloud access)
//   node tools/sessions/surface.mjs [--track ID] [--dry]
//       from Firestore and the bucket, writes the artifact and the track's pointer
// Tests: node --test tools/sessions/surface.test.mjs
import {mkdirSync, writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {Buffer} from 'node:buffer';
import {gunzipSync, gzipSync} from 'node:zlib';
import {LMU_FAKE_ORIGIN, toLocalMetres} from '../../src/analysis/geo.ts';
import {parseTraceCsv} from '../../src/analysis/traceCsv.ts';
import {
  addSession,
  emptySurface,
  SURFACE_STEP_M,
} from '../../src/analysis/trackSurface.ts';

export const SURFACE_FORMAT = 1;
export const surfacePath = trackId => `surface/${trackId}/v1.json.gz`;

// A lap the surface may use: a whole, timed, comparable lap with no pit lane
// (the pit lane's lateral is not the racing surface's: Daytona reads -17..+29 m).
export function usableLap(lap) {
  return (
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
 * Folds sessions into a track's surface. `existing` is the stored artifact or
 * null; sessions whose id it already holds are skipped. `sessions` is
 * [{id, csvs: string[]}] (one CSV per usable lap). Returns the surface and what
 * this call added.
 */
export function buildSurface(existing, lengthM, sessions) {
  const usable =
    existing &&
    existing.lengthM === lengthM &&
    existing.stepM === SURFACE_STEP_M
      ? existing
      : null;
  const surface = usable ?? emptySurface(lengthM);
  let sessionsAdded = 0;
  let lapsAdded = 0;
  for (const s of sessions) {
    if (surface.sessions.includes(s.id)) continue;
    const laps = s.csvs
      .map(csv => surfaceLapFromCsv(csv, lengthM))
      .filter(lap => lap != null);
    // A session with no lap that carries the channels (an older upload) is
    // not recorded as merged: a later resync can bring its traces up to date.
    if (laps.length === 0) continue;
    addSession(surface, s.id, laps);
    sessionsAdded += 1;
    lapsAdded += laps.length;
  }
  return {
    surface,
    sessionsAdded,
    lapsAdded,
    replaced: existing != null && usable == null,
  };
}

// The stored file: rounded so it is small, plain JSON.
export function serializeSurface(surface) {
  const r = v => Math.round(v * 1000) / 1000;
  return JSON.stringify({
    ...surface,
    bins: surface.bins.map(b => ({
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
  const res = await fetch(`${base}${path}`);
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
        const res = await fetch(`${base}/laps/${lap.id}/csv`);
        if (res.ok) csvs.push(await res.text());
      }
      input.push({id: s.id, csvs});
    }
    const {surface, sessionsAdded, lapsAdded} = buildSurface(
      null,
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

async function fromStore(trackFilter, dry) {
  const {connect, bucketName} = await import('./store.mjs');
  const {db, bucket} = connect();
  const trackDocs = trackFilter
    ? [await db.collection('tracks').doc(trackFilter).get()]
    : (await db.collection('tracks').get()).docs;
  for (const doc of trackDocs) {
    if (!doc.exists) continue;
    const trackId = doc.id;
    const track = doc.data();
    if (!track.lengthM) continue;
    let existing = null;
    try {
      const [gz] = await bucket
        .file(surfacePath(trackId))
        .download({decompress: false});
      existing = parseSurface(gz);
    } catch (error) {
      if (error?.code !== 404) throw error;
    }
    const sessionDocs = (
      await db.collection('sessions').where('trackId', '==', trackId).get()
    ).docs.filter(s => !(existing?.sessions ?? []).includes(s.id));
    const input = [];
    for (const s of sessionDocs) {
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
    const {surface, sessionsAdded, lapsAdded, replaced} = buildSurface(
      existing,
      track.lengthM,
      input,
    );
    console.log(
      `${trackId}: +${sessionsAdded} sessions, +${lapsAdded} laps${
        replaced ? ' (track length changed: rebuilt)' : ''
      }, ${surface.sessions.length} sessions in all`,
    );
    if (dry || (sessionsAdded === 0 && !replaced)) continue;
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
          sessions: surface.sessions.length,
          bins: surface.bins.length,
          updatedAt: new Date().toISOString(),
        },
      });
    console.log(
      `  wrote gs://${bucketName}/${surfacePath(trackId)} (${gz.length} bytes)`,
    );
  }
}

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : null;
}

if (import.meta.url === `file:///${process.argv[1]?.replace(/\\/g, '/')}`) {
  const track = arg('--track');
  if (arg('--api')) {
    await fromApi(arg('--api'), track, arg('--out') ?? 'surface-out');
  } else {
    await fromStore(track, process.argv.includes('--dry'));
  }
}
