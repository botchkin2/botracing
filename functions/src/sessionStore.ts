// Read laps from the lasting store (Firestore sessions/laps + bucket traces)
// and hand them back in the lap shape the app already reads.
// Layout: docs/STORAGE.md. Written by tools/sessions/sync.mjs.
import * as admin from 'firebase-admin';

const OWNER = 'botkin';
const BUCKET = 'botracing-61-lmu';
// Firestore caps `in` at 30 values.
const IN_LIMIT = 30;

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
    const cutoff =
      opts.ageDays && opts.ageDays > 0
        ? new Date(Date.now() - opts.ageDays * 86400000).toISOString()
        : null;
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

// The lap's chart trace. Stored gzip-encoded; the client library unzips it.
export async function readTrace(lapId: string): Promise<string | null> {
  if (!/^[0-9a-f]{16}-\d{3}$/.test(lapId)) return null;
  const file = admin
    .storage()
    .bucket(BUCKET)
    .file(`traces/${OWNER}/${lapId}/v1.csv.gz`);
  const [exists] = await file.exists();
  if (!exists) return null;
  const [body] = await file.download();
  return body.toString('utf8');
}
