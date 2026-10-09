import * as admin from 'firebase-admin';
import {onRequest} from 'firebase-functions/v2/https';
import {
  listLaps,
  listUploaders,
  listTracks,
  readTrace,
  readTrackMap,
  listFacets,
  listSessions,
  readSession,
  readSessionLaps,
  readBand,
  readCornerSlicesGzip,
  readSurfaceGzip,
  readFieldGzip,
} from './sessionStore';
import {Unauthorized, resolveOwner} from './ownerAccess';
import {RUNTIME_ACCOUNT} from './runtime';
import {reportError} from './problems';

if (!admin.apps.length) {
  admin.initializeApp();
}

// The API is read-only. Any local dev server (any port) and any PR preview
// channel may call it with a signed-in token. Seats kept building proxies
// because only three localhost ports were allowed.
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

export const lmuApi = onRequest(
  {serviceAccount: RUNTIME_ACCOUNT},
  async (req, res) => {
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
    // Who is asking: the signed-in user's owner key (ownerAccess.ts). A missing
    // or bad token is a 401.
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
      if (/\/sessions\/facets$/.test(path)) {
        res.status(200).json(await listFacets(owner));
        return;
      }
      if (/\/sessions$/.test(path)) {
        const age = Number(req.query.age);
        const items = await listSessions(owner, {
          ageDays: Number.isFinite(age) ? age : undefined,
          trackId: req.query.track ? String(req.query.track) : undefined,
          sim: req.query.sim ? String(req.query.sim) : undefined,
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
      const v2 = path.match(
        /\/sessions\/([0-9a-f]{16})(?:\/(laps|band|map))?$/,
      );
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

      if (path.endsWith('/tracks')) {
        res.status(200).json({items: await listTracks(owner)});
        return;
      }

      const csv = path.match(/\/laps\/([^/]+)\/csv$/);
      if (csv) {
        const id = decodeURIComponent(csv[1]);
        const body = await readTrace(owner, id);
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
        res.status(200).json({items: stored, total: stored.length});
        return;
      }

      res.status(404).json({error: 'Not found', path});
    } catch (error: unknown) {
      await reportError('lmuApi', error, {route: path});
      res.status(500).json({error: 'LMU data is not available'});
    }
  },
);
