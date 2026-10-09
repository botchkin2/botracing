// Read laps from the lasting store (Firestore sessions/laps + bucket traces)
// and hand them back in the lap shape the app already reads.
// Layout: docs/STORAGE.md. Written by tools/sessions/sync.mjs.
import * as admin from 'firebase-admin';
import {
  pathInsideOwner,
  trustedTrackPath,
  uploaderItems,
} from './ownerAccess';

// Every reader takes the owner key of the request (ownerAccess.ts). A request
// with no token is refused before it gets here.
const BUCKET = 'botracing-61-lmu';
// Firestore caps `in` at 30 values.
const IN_LIMIT = 30;
// A request without an age still stops here, never scanning all history.
const DEFAULT_AGE_DAYS = 30;

// The app filters tracks and cars by number. Same hash the old pack used,
// so ids stay stable across the switch.
export function stableId(text: string): number {
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  }
  return (hash % 900000) + 1000;
}

const sessionTypeNumber: Record<string, number> = {
  Practice: 1,
  Qualify: 2,
  Qualifying: 2,
  Race: 3,
};

function trackOf(session: any) {
  return {
    id: stableId(session.track?.name || ''),
    name: session.track?.name || 'Unknown track',
    variant: session.track?.variant || session.track?.name || '',
    platform: session.sim || 'lmu',
  };
}

function toAppLap(lap: any, session: any) {
  const carName = String(lap.car?.name || 'Unknown car');
  return {
    id: lap.id,
    event: lap.sessionId,
    session: 1,
    sessionType: sessionTypeNumber[lap.sessionType] ?? 1,
    run: lap.stint ?? 1,
    season: {id: 2026, name: 'LMU', year: 2026, platform: lap.sim || 'lmu'},
    car: {
      id: stableId(carName),
      name: carName.split('#').join('No.'),
      class: lap.car?.class || '',
    },
    track: trackOf(session),
    startTime: lap.startTime,
    lapNumber: lap.lapNumber,
    lapTime: lap.lapTime,
    clean: Boolean(lap.clean),
    joker: false,
    discontinuity: false,
    missing: false,
    incomplete: Boolean(lap.incomplete),
    offtrack: Boolean(lap.offtrack),
    pitlane: Boolean(lap.pitlane),
    sectors: (lap.sectors || []).map((sectorTime: number) => ({
      sectorTime,
      incomplete: false,
    })),
    pitIn: Boolean(lap.pitIn),
    pitOut: Boolean(lap.pitOut),
    telemetry: {available: true},
    rows: lap.trace?.rows ?? 0,
    // Extra fields from the new analysis. The app ignores what it doesn't know.
    stint: lap.stint,
    comparable: lap.comparable,
    reasons: lap.reasons,
    offTrackSec: lap.offTrackSec,
  };
}

// A track's doc: shared app data in tracks/, the same for every owner and
// written only by the admin tools.
function trackDoc(trackId: string) {
  return admin.firestore().collection('tracks').doc(trackId);
}

async function sessionsSince(
  owner: string,
  cutoffIso: string | null,
): Promise<any[]> {
  let query = admin
    .firestore()
    .collection('sessions')
    .where('ownerId', '==', owner)
    .orderBy('startedAt', 'desc');
  if (cutoffIso) query = query.where('startedAt', '>=', cutoffIso);
  const snap = await query
    .select('sim', 'track', 'trackId', 'startedAt', 'sessionType')
    .get();
  return snap.docs.map(doc => ({id: doc.id, ...doc.data()}));
}

// Status of each of the owner's PCs: the tray sends it through the upload
// endpoint (POST /heartbeat), which stamps the owner from the token.
export async function listUploaders(owner: string): Promise<any[]> {
  const snap = await admin
    .firestore()
    .collection('uploaders')
    .where('ownerId', '==', owner)
    .get();
  // Second guard behind the query.
  return uploaderItems(
    owner,
    snap.docs.map(doc => ({id: doc.id, data: doc.data()})),
  );
}

// Tracks the owner has driven, for the track picker.
export async function listTracks(owner: string): Promise<any[]> {
  const byId = new Map<number, any>();
  for (const session of await sessionsSince(owner, null)) {
    const track = trackOf(session);
    byId.set(track.id, track);
  }
  return Array.from(byId.values());
}

// Laps in the app's shape. `ageDays` limits by session start, `trackIds` are
// the app's numeric track ids, `event` is one session id.
export async function listLaps(
  owner: string,
  opts: {
    ageDays?: number;
    trackIds?: number[];
    event?: string;
  },
): Promise<any[]> {
  const db = admin.firestore();
  let sessions: any[];
  if (opts.event) {
    const doc = await db.collection('sessions').doc(opts.event).get();
    sessions =
      doc.exists && doc.get('ownerId') === owner
        ? [{id: doc.id, ...doc.data()}]
        : [];
  } else {
    const days =
      opts.ageDays && opts.ageDays > 0 ? opts.ageDays : DEFAULT_AGE_DAYS;
    const cutoff = new Date(Date.now() - days * 86400000).toISOString();
    sessions = await sessionsSince(owner, cutoff);
  }
  if (opts.trackIds && opts.trackIds.length > 0) {
    const wanted = new Set(opts.trackIds);
    sessions = sessions.filter(s => wanted.has(trackOf(s).id));
  }
  const byId = new Map(sessions.map(s => [s.id, s]));
  const ids = Array.from(byId.keys());
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += IN_LIMIT) {
    chunks.push(ids.slice(i, i + IN_LIMIT));
  }
  const snaps = await Promise.all(
    chunks.map(chunk =>
      db
        .collection('laps')
        .where('sessionId', 'in', chunk)
        .where('ownerId', '==', owner)
        .get(),
    ),
  );
  const laps: any[] = [];
  for (const snap of snaps) {
    for (const doc of snap.docs) {
      const lap = doc.data();
      // Second guard behind the query: never another owner's lap.
      if (lap.ownerId !== owner) continue;
      laps.push(toAppLap(lap, byId.get(lap.sessionId)));
    }
  }
  return laps.sort(
    (a, b) =>
      b.startTime.localeCompare(a.startTime) || a.lapNumber - b.lapNumber,
  );
}

// ---- API v2: shaped for the redesigned screens, straight from the store ----

// Fields of the session list. The full doc (lap table, consistency, corners)
// is on /sessions/{id}.
const SESSION_LIST_FIELDS = [
  'sim',
  'trackId',
  'track',
  'carId',
  'car',
  'sessionType',
  'startedAt',
  'endedAt',
  'weather',
  'lapCount',
  'comparableCount',
  'bestLapTime',
  'medianLapTime',
  'stdevLapTime',
  'bestLapId',
  'trackMapSource',
  'stints',
  'series',
  'eventId',
  // Five numbers per class, so the Plan can pool class pace without opening
  // every session's full doc.
  'classLaps',
  'analysisVersion',
  'updatedAt',
];

export async function listSessions(
  owner: string,
  opts: {
    ageDays?: number;
    trackId?: string;
  },
): Promise<any[]> {
  const days =
    opts.ageDays && opts.ageDays > 0 ? opts.ageDays : DEFAULT_AGE_DAYS;
  const cutoff = new Date(Date.now() - days * 86400000).toISOString();
  let query = admin
    .firestore()
    .collection('sessions')
    .where('ownerId', '==', owner);
  if (opts.trackId) query = query.where('trackId', '==', opts.trackId);
  const snap = await query
    .where('startedAt', '>=', cutoff)
    .orderBy('startedAt', 'desc')
    .select(...SESSION_LIST_FIELDS)
    .get();
  return snap.docs.map(doc => ({id: doc.id, ...doc.data()}));
}

export async function readSession(
  owner: string,
  id: string,
): Promise<any | null> {
  const doc = await admin.firestore().collection('sessions').doc(id).get();
  if (!doc.exists) return null;
  const data = doc.data() || {};
  if (data.ownerId !== owner) return null;
  return {id: doc.id, ...data};
}

// Every lap doc of a session, in order: sectors, stint, exclusion and why,
// off-track, conditions, per-section facts with their parts, trace pointer.
export async function readSessionLaps(
  owner: string,
  id: string,
): Promise<any | null> {
  const snap = await admin
    .firestore()
    .collection('laps')
    .where('sessionId', '==', id)
    .where('ownerId', '==', owner)
    .orderBy('lapNumber')
    .get();
  if (snap.empty) return (await readSession(owner, id)) ? {items: []} : null;
  const items = snap.docs
    .map(doc => doc.data())
    .filter(lap => lap.ownerId === owner)
    // A session can span recordings; lap numbers restart per recording.
    .sort(
      (a, b) =>
        a.startTime.localeCompare(b.startTime) || a.lapNumber - b.lapNumber,
    );
  return {items};
}

// The precomputed consistency band: median and p10/p90 of speed, throttle and
// brake every stepM metres over the session's comparable laps.
export async function readBand(owner: string, id: string): Promise<any | null> {
  const session = await readSession(owner, id);
  const path = pathInsideOwner('band', owner, session?.band?.path);
  if (!path) return null;
  try {
    const [body] = await admin.storage().bucket(BUCKET).file(path).download();
    return JSON.parse(body.toString('utf8'));
  } catch (error: any) {
    if (error?.code === 404) return null;
    throw error;
  }
}

// Every car in the session at 5 Hz (tools/sessions/field.mjs), as the stored
// gzip bytes. Not inflated here: a race-hour is ~12 MB of JSON, and the client
// decompresses it anyway (the route sends Content-Encoding: gzip).
// With a hash, only that version: a stale URL gets a 404, not other content.
export async function readFieldGzip(
  owner: string,
  id: string,
  hash?: string,
): Promise<Buffer | null> {
  const session = await readSession(owner, id);
  const path = pathInsideOwner('field', owner, session?.field?.path);
  if (!path) return null;
  if (hash && session.field.hash !== hash) return null;
  try {
    const [body] = await admin
      .storage()
      .bucket(BUCKET)
      .file(path)
      .download({decompress: false});
    return body;
  } catch (error: any) {
    if (error?.code === 404) return null;
    throw error;
  }
}

// Every lap's window around one corner (tools/sessions/cornerSlices.mjs), as
// the stored gzip bytes. Small (~80 KB for a 44-lap race), and named by
// content: with a hash, only that version, so a stale URL gets a 404 and a
// resync never serves an old slice from cache.
export async function readCornerSlicesGzip(
  owner: string,
  id: string,
  corner: number,
  hash?: string,
): Promise<Buffer | null> {
  const session = await readSession(owner, id);
  const slices = session?.slices;
  if (!slices?.prefix || !slices.corners?.includes(corner)) return null;
  if (hash && slices.hash !== hash) return null;
  const file = pathInsideOwner(
    'slices',
    owner,
    `${slices.prefix}/c${corner}.json.gz`,
  );
  if (!file) return null;
  try {
    const [body] = await admin
      .storage()
      .bucket(BUCKET)
      .file(file)
      .download({decompress: false});
    return body;
  } catch (error: any) {
    if (error?.code === 404) return null;
    throw error;
  }
}

// The track's measured surface (tools/sessions/surface.mjs, src/analysis/
// trackSurface.ts): the stored gzip as is, per 10 m bin sums the app turns into
// the centre path and edges. It grows as sessions are folded in, so it is
// always revalidated. Null when the track has none yet.
export async function readSurfaceGzip(
  owner: string,
  sessionId: string,
): Promise<Buffer | null> {
  const db = admin.firestore();
  const session = await db.collection('sessions').doc(sessionId).get();
  const trackId = session.get('trackId');
  if (!session.exists || session.get('ownerId') !== owner || !trackId)
    return null;
  const track = await trackDoc(trackId).get();
  const path = trustedTrackPath(track.get('surface.path'));
  if (!path) return null;
  try {
    const [body] = await admin
      .storage()
      .bucket(BUCKET)
      .file(path)
      .download({decompress: false});
    return body;
  } catch (error: any) {
    if (error?.code === 404) return null;
    throw error;
  }
}

// The track a session was driven on: its corner map (sections, from
// src/analysis/corners.ts), and when a real-map fit exists (tools/track-fit),
// the georef that places the recording's coordinates on the real world plus
// the OSM outline. quality 'poor' means: don't draw it on a real basemap.
export async function readTrackMap(
  owner: string,
  sessionId: string,
): Promise<any | null> {
  const db = admin.firestore();
  const session = await db.collection('sessions').doc(sessionId).get();
  const trackId = session.get('trackId');
  if (!session.exists || session.get('ownerId') !== owner || !trackId)
    return null;
  const doc = await trackDoc(trackId).get();
  const track = doc.exists ? doc.data() || {} : {};
  let outline = null;
  const outlinePath = trustedTrackPath(track.outline?.path);
  if (outlinePath) {
    try {
      const [body] = await admin
        .storage()
        .bucket(BUCKET)
        .file(outlinePath)
        .download();
      outline = JSON.parse(body.toString('utf8'));
    } catch (error: any) {
      if (error?.code !== 404) throw error;
    }
  }
  return {
    trackId,
    track: session.get('track') ?? track.track ?? null,
    lengthM: track.lengthM ?? null,
    corners: track.corners ?? [],
    // Where each section's window starts and the windows that tile the lap
    // (tools/sessions/layoutBoundaries.mjs); null before the first resync.
    boundaries: track.boundaries ?? null,
    quality: track.quality ?? null,
    qualityNote: track.qualityNote ?? null,
    georef: track.georef ?? null,
    attribution: track.outline?.attribution ?? null,
    outline,
  };
}

// The lap's chart trace. Stored gzip-encoded; the client library unzips it.
export async function readTrace(
  owner: string,
  lapId: string,
): Promise<string | null> {
  if (!/^[0-9a-f]{16}-\d{3}$/.test(lapId)) return null;
  const file = admin
    .storage()
    .bucket(BUCKET)
    .file(`traces/${owner}/${lapId}/v2.csv.gz`);
  try {
    const [body] = await file.download();
    return body.toString('utf8');
  } catch (error: any) {
    if (error?.code === 404) return null;
    throw error;
  }
}
