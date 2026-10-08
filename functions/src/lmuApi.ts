import * as admin from 'firebase-admin';
import {onRequest} from 'firebase-functions/v2/https';
import {existsSync, readFileSync} from 'fs';
import {join} from 'path';
import {
  listLaps,
  listUploaders,
  listTracks,
  readTrace,
  readTrackMap,
  listSessions,
  readSession,
  readSessionLaps,
  readBand,
  readCornerSlicesGzip,
  readSurfaceGzip,
  readFieldGzip,
  storeHasSessions,
} from './sessionStore';
import {LEGACY_OWNER, Unauthorized, resolveOwner} from './ownerAccess';

if (!admin.apps.length) {
  admin.initializeApp();
}

const BUCKET = 'botracing-61-lmu';

// The API is read-only and public, so any local dev server (any port) and any
// PR preview channel may read it. Seats kept building proxies because only
// three localhost ports were allowed.
const ALLOWED_ORIGIN =
  /^(https:\/\/botracing-61(--[a-z0-9-]+)?\.(web\.app|firebaseapp\.com)|http:\/\/(localhost|127\.0\.0\.1)(:\d+)?)$/;

function allowCors(req: any, res: any) {
  const origin = req.headers.origin;
  const allowOrigin =
    typeof origin === 'string' && ALLOWED_ORIGIN.test(origin)
      ? origin
      : 'https://botracing-61.web.app';
  res.set('Access-Control-Allow-Origin', allowOrigin);
  res.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.set('Access-Control-Allow-Credentials', 'true');
  res.set('Cache-Control', 'private');
}

function pathname(req: any): string {
  let path =
    req.path ||
    (typeof req.url === 'string' ? req.url.split('?')[0] : '') ||
    '';
  if (path.startsWith('http://') || path.startsWith('https://')) {
    try {
      path = new URL(path).pathname;
    } catch {
      path = '';
    }
  }
  return path;
}

const SEED = join(__dirname, '../lmu-seed');

function readSeedManifest(): any[] {
  const file = join(SEED, 'manifest.json');
  if (!existsSync(file)) return [];
  const parsed = JSON.parse(readFileSync(file, 'utf8'));
  return Array.isArray(parsed) ? parsed : [];
}

async function readManifest(): Promise<any[]> {
  try {
    const [buf] = await admin
      .storage()
      .bucket(BUCKET)
      .file('lmu/manifest.json')
      .download();
    const parsed = JSON.parse(buf.toString('utf8'));
    if (Array.isArray(parsed) && parsed.length > 0) return parsed;
  } catch {
    // Bucket is empty until the PC uploader runs. The seed ships with the function.
  }
  return readSeedManifest();
}

async function readLapCsv(id: string): Promise<string | null> {
  try {
    const file = admin.storage().bucket(BUCKET).file(`lmu/laps/${id}.csv`);
    const [exists] = await file.exists();
    if (exists) {
      const [body] = await file.download();
      return body.toString('utf8');
    }
  } catch {
    // Fall through to the copy that deployed with the function.
  }
  const seeded = join(SEED, 'laps', `${id}.csv`);
  if (!existsSync(seeded)) return null;
  return readFileSync(seeded, 'utf8');
}

export const lmuApi = onRequest(async (req, res) => {
  allowCors(req, res);
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }
  if (req.method !== 'GET') {
    res.status(405).json({error: 'GET only'});
    return;
  }

  const path = pathname(req);
  // Who is asking: the signed-in user's owner key, or the legacy owner for a
  // request with no token (ownerAccess.ts). A bad token is a 401.
  res.set('Vary', 'Authorization, Origin');
  let owner: string;
  try {
    owner = await resolveOwner(
      {
        verifyToken: async idToken => ({
          uid: (await admin.auth().verifyIdToken(idToken)).uid,
        }),
        readOwnerKey: async uid => {
          const key = (await admin.firestore().doc(`users/${uid}`).get()).get(
            'ownerKey',
          );
          return typeof key === 'string' ? key : null;
        },
      },
      req.headers.authorization,
    );
  } catch (error) {
    if (error instanceof Unauthorized) {
      res.status(401).json({error: error.message});
      return;
    }
    throw error;
  }
  try {
    // API v2, shaped for the redesigned screens (Sessions, Session, Compare,
    // Corner). Straight from the store, no legacy lap shape.
    if (/\/uploaders$/.test(path)) {
      res.status(200).json({items: await listUploaders(owner)});
      return;
    }
    if (/\/sessions$/.test(path)) {
      const age = Number(req.query.age);
      const items = await listSessions(owner, {
        ageDays: Number.isFinite(age) ? age : undefined,
        trackId: req.query.track ? String(req.query.track) : undefined,
      });
      res.status(200).json({items, total: items.length});
      return;
    }
    const field = path.match(
      /\/sessions\/([0-9a-f]{16})\/field(?:\/([0-9a-f]{12}))?$/,
    );
    if (field) {
      const [, id, hash] = field;
      const gz = await readFieldGzip(owner, id, hash);
      if (!gz) {
        res.status(404).json({error: 'Not found'});
        return;
      }
      // The stored gzip as-is. Under /field/{hash} the content can never
      // change (a new field has a new hash); plain /field must revalidate.
      res.set('Content-Type', 'application/json');
      res.set('Content-Encoding', 'gzip');
      res.set(
        'Cache-Control',
        hash ? 'private, max-age=31536000, immutable' : 'private, no-cache',
      );
      res.status(200).send(gz);
      return;
    }
    const slices = path.match(
      /\/sessions\/([0-9a-f]{16})\/corners\/(\d{1,3})\/laps(?:\/([0-9a-f]{12}))?$/,
    );
    if (slices) {
      const [, id, corner, hash] = slices;
      const gz = await readCornerSlicesGzip(owner, id, Number(corner), hash);
      if (!gz) {
        res.status(404).json({error: 'Not found'});
        return;
      }
      // Same caching as /field: under /laps/{hash} the bytes never change.
      res.set('Content-Type', 'application/json');
      res.set('Content-Encoding', 'gzip');
      res.set(
        'Cache-Control',
        hash ? 'private, max-age=31536000, immutable' : 'private, no-cache',
      );
      res.status(200).send(gz);
      return;
    }
    const surface = path.match(/\/sessions\/([0-9a-f]{16})\/surface$/);
    if (surface) {
      const gz = await readSurfaceGzip(owner, surface[1]);
      if (!gz) {
        res.status(404).json({error: 'Not found'});
        return;
      }
      // The stored gzip as is; it changes whenever a session is folded in.
      res.set('Content-Type', 'application/json');
      res.set('Content-Encoding', 'gzip');
      res.set('Cache-Control', 'private, no-cache');
      res.status(200).send(gz);
      return;
    }
    const v2 = path.match(/\/sessions\/([0-9a-f]{16})(?:\/(laps|band|map))?$/);
    if (v2) {
      const [, id, part] = v2;
      const body =
        part === 'laps'
          ? await readSessionLaps(owner, id)
          : part === 'band'
          ? await readBand(owner, id)
          : part === 'map'
          ? await readTrackMap(owner, id)
          : await readSession(owner, id);
      if (!body) {
        res.status(404).json({error: 'Not found'});
        return;
      }
      res.status(200).json(body);
      return;
    }

    // The lasting store (sessions/laps in Firestore) is the source. The old
    // manifest answers only while the store is still empty; it goes away at
    // cutover.
    if (path.endsWith('/tracks')) {
      const stored = await listTracks(owner);
      if (stored.length > 0 || owner !== LEGACY_OWNER) {
        res.status(200).json({items: stored});
        return;
      }
      const byId = new Map<number, any>();
      for (const lap of await readManifest()) {
        if (lap.track?.id != null) byId.set(lap.track.id, lap.track);
      }
      res.status(200).json({items: Array.from(byId.values())});
      return;
    }

    const csv = path.match(/\/laps\/([^/]+)\/csv$/);
    if (csv) {
      const id = decodeURIComponent(csv[1]);
      // The seed copy shipped with the function is the legacy owner's.
      const body =
        (await readTrace(owner, id)) ??
        (owner === LEGACY_OWNER ? await readLapCsv(id) : null);
      if (!body) {
        res.status(404).json({error: 'Lap telemetry not found'});
        return;
      }
      res.set('Content-Type', 'text/csv');
      res.status(200).send(body);
      return;
    }

    if (path.endsWith('/laps')) {
      const trackFilter = String(req.query.tracks || '')
        .split(',')
        .map(value => Number(value))
        .filter(value => Number.isFinite(value) && value !== 0);
      const event = String(req.query.event || '');
      const age = Number(req.query.age);
      const stored = await listLaps(owner, {
        ageDays: Number.isFinite(age) ? age : undefined,
        trackIds: trackFilter,
        event: event || undefined,
      });
      if (
        stored.length > 0 ||
        owner !== LEGACY_OWNER ||
        (await storeHasSessions(owner))
      ) {
        res.status(200).json({items: stored, total: stored.length});
        return;
      }
      const items = (await readManifest()).filter(lap => {
        if (event && lap.event !== event) return false;
        if (trackFilter.length > 0 && !trackFilter.includes(lap.track?.id)) {
          return false;
        }
        return true;
      });
      res.status(200).json({items, total: items.length});
      return;
    }

    res.status(404).json({error: 'Not found', path});
  } catch (error: any) {
    res.status(500).json({
      error: 'LMU data is not available',
      message: error?.message || String(error),
    });
  }
});
