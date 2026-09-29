// Read laps from the lasting store (Firestore sessions/laps + bucket traces)
// and hand them back in the lap shape the app already reads.
// Layout: docs/STORAGE.md. Written by tools/sessions/sync.mjs.
import * as admin from 'firebase-admin';

const OWNER = 'botkin';
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

async function sessionsSince(cutoffIso: string | null): Promise<any[]> {
  let query = admin
    .firestore()
    .collection('sessions')
    .where('ownerId', '==', OWNER)
    .orderBy('startedAt', 'desc');
  if (cutoffIso) query = query.where('startedAt', '>=', cutoffIso);
  const snap = await query
    .select('sim', 'track', 'trackId', 'startedAt', 'sessionType')
    .get();
  return snap.docs.map(doc => ({id: doc.id, ...doc.data()}));
}

// Whether the store has anything yet (the old manifest answers until it does).
export async function storeHasSessions(): Promise<boolean> {
  const snap = await admin
    .firestore()
    .collection('sessions')
    .where('ownerId', '==', OWNER)
    .limit(1)
    .select()
    .get();
  return !snap.empty;
}

// Status of each PC uploader (tools/uploader/heartbeat.mjs writes them).
export async function listUploaders(): Promise<any[]> {
  const snap = await admin.firestore().collection('uploaders').get();
  return snap.docs.map(doc => ({hostId: doc.id, ...doc.data()}));
}

// Tracks the owner has driven, for the track picker.
export async function listTracks(): Promise<any[]> {
  const byId = new Map<number, any>();
  for (const session of await sessionsSince(null)) {
    const track = trackOf(session);
    byId.set(track.id, track);
  }
  return Array.from(byId.values());
}

// Laps in the app's shape. `ageDays` limits by session start, `trackIds` are
// the app's numeric track ids, `event` is one session id.
export async function listLaps(opts: {
  ageDays?: number;
  trackIds?: number[];
  event?: string;
}): Promise<any[]> {
  const db = admin.firestore();
  let sessions: any[];
  if (opts.event) {
    const doc = await db.collection('sessions').doc(opts.event).get();
    sessions = doc.exists ? [{id: doc.id, ...doc.data()}] : [];
  } else {
    const days =
      opts.ageDays && opts.ageDays > 0 ? opts.ageDays : DEFAULT_AGE_DAYS;
    const cutoff = new Date(Date.now() - days * 86400000).toISOString();
    sessions = await sessionsSince(cutoff);
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
      db.collection('laps').where('sessionId', 'in', chunk).get(),
    ),
  );
  const laps: any[] = [];
  for (const snap of snaps) {
    for (const doc of snap.docs) {
      const lap = doc.data();
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
  'analysisVersion',
  'updatedAt',
];

export async function listSessions(opts: {
  ageDays?: number;
  trackId?: string;
}): Promise<any[]> {
  const days =
    opts.ageDays && opts.ageDays > 0 ? opts.ageDays : DEFAULT_AGE_DAYS;
  const cutoff = new Date(Date.now() - days * 86400000).toISOString();
  let query = admin
    .firestore()
    .collection('sessions')
    .where('ownerId', '==', OWNER);
  if (opts.trackId) query = query.where('trackId', '==', opts.trackId);
  const snap = await query
    .where('startedAt', '>=', cutoff)
    .orderBy('startedAt', 'desc')
    .select(...SESSION_LIST_FIELDS)
    .get();
  return snap.docs.map(doc => ({id: doc.id, ...doc.data()}));
}

export async function readSession(id: string): Promise<any | null> {
  const doc = await admin.firestore().collection('sessions').doc(id).get();
  if (!doc.exists) return null;
  const data = doc.data() || {};
  if (data.ownerId !== OWNER) return null;
  return {id: doc.id, ...data};
}

// Every lap doc of a session, in order: sectors, stint, exclusion and why,
// off-track, conditions, per-section facts with their parts, trace pointer.
export async function readSessionLaps(id: string): Promise<any | null> {
  const snap = await admin
    .firestore()
    .collection('laps')
    .where('sessionId', '==', id)
    .orderBy('lapNumber')
    .get();
  if (snap.empty) return (await readSession(id)) ? {items: []} : null;
  const items = snap.docs
    .map(doc => doc.data())
    .filter(lap => lap.ownerId === OWNER)
    // A session can span recordings; lap numbers restart per recording.
    .sort(
      (a, b) =>
        a.startTime.localeCompare(b.startTime) || a.lapNumber - b.lapNumber,
    );
  return {items};
}

// The precomputed consistency band: median and p10/p90 of speed, throttle and
// brake every stepM metres over the session's comparable laps.
export async function readBand(id: string): Promise<any | null> {
  const session = await readSession(id);
  if (!session?.band?.path) return null;
  try {
    const [body] = await admin
      .storage()
      .bucket(BUCKET)
      .file(session.band.path)
      .download();
    return JSON.parse(body.toString('utf8'));
  } catch (error: any) {
    if (error?.code === 404) return null;
    throw error;
  }
}

// The track a session was driven on: its corner map (sections, from
// src/analysis/corners.ts), and when a real-map fit exists (tools/track-fit),
// the georef that places the recording's coordinates on the real world plus
// the OSM outline. quality 'poor' means: don't draw it on a real basemap.
export async function readTrackMap(sessionId: string): Promise<any | null> {
  const db = admin.firestore();
  const session = await db.collection('sessions').doc(sessionId).get();
  const trackId = session.get('trackId');
  if (!session.exists || !trackId) return null;
  const doc = await db.collection('tracks').doc(trackId).get();
  const track = doc.exists ? doc.data() || {} : {};
  let outline = null;
  if (track.outline?.path) {
    try {
      const [body] = await admin
        .storage()
        .bucket(BUCKET)
        .file(track.outline.path)
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
    quality: track.quality ?? null,
    qualityNote: track.qualityNote ?? null,
    georef: track.georef ?? null,
    attribution: track.outline?.attribution ?? null,
    outline,
  };
}

// The lap's chart trace. Stored gzip-encoded; the client library unzips it.
export async function readTrace(lapId: string): Promise<string | null> {
  if (!/^[0-9a-f]{16}-\d{3}$/.test(lapId)) return null;
  const file = admin
    .storage()
    .bucket(BUCKET)
    .file(`traces/${OWNER}/${lapId}/v2.csv.gz`);
  try {
    const [body] = await file.download();
    return body.toString('utf8');
  } catch (error: any) {
    if (error?.code === 404) return null;
    throw error;
  }
}
