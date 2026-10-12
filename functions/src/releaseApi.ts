// The HTTP side of a release endpoint (releaseCore.ts): Storage as the
// release bucket, CORS for the app's own origins, no caching (a signed URL
// expires), and the /api/<kind> prefix the hosting rewrite adds. Anonymous
// and read-only. Shared by the tray (trayApi.ts) and Android (androidApi.ts).
import * as admin from 'firebase-admin';
import {onRequest} from 'firebase-functions/v2/https';
import {RUNTIME_ACCOUNT} from './runtime';
import {reportError} from './problems';
import type {
  ReleaseDeps,
  ReleaseRequest,
  ReleaseResponse,
} from './releaseCore.ts';

if (!admin.apps.length) {
  admin.initializeApp();
}

const BUCKET = 'botracing-61-lmu';

function storage(): ReleaseDeps {
  const bucket = admin.storage().bucket(BUCKET);
  return {
    async read(path) {
      const file = bucket.file(path);
      const [exists] = await file.exists();
      if (!exists) return null;
      const [bytes] = await file.download();
      return bytes;
    },
    async exists(path) {
      const [exists] = await bucket.file(path).exists();
      return exists;
    },
    async signedDownload(path, expiresMs) {
      const [url] = await bucket.file(path).getSignedUrl({
        version: 'v4',
        action: 'read',
        expires: Date.now() + expiresMs,
      });
      return url;
    },
  };
}

// The same origins the lap API allows: the app, any local dev server and any
// PR preview channel read the manifest for the Download card.
const ALLOWED_ORIGIN =
  /^(https:\/\/botracing-61(--[a-z0-9-]+)?\.(web\.app|firebaseapp\.com)|http:\/\/(localhost|127\.0\.0\.1)(:\d+)?)$/;

/** The path after `prefix` ("/api/tray"), which the hosting rewrite keeps. */
export function subPath(
  req: {path?: string; url?: string},
  prefix: string,
): string {
  const full = req.path || (req.url ?? '').split('?')[0];
  const at = full.indexOf(prefix);
  return at === -1 ? full : full.slice(at + prefix.length) || '/';
}

export function releaseFunction(
  prefix: string,
  handle: (deps: ReleaseDeps, req: ReleaseRequest) => Promise<ReleaseResponse>,
) {
  return onRequest(
    {
      memory: '256MiB',
      timeoutSeconds: 30,
      cors: false,
      serviceAccount: RUNTIME_ACCOUNT,
    },
    async (req, res) => {
      const origin = req.headers.origin;
      if (typeof origin === 'string' && ALLOWED_ORIGIN.test(origin)) {
        res.set('Access-Control-Allow-Origin', origin);
        res.set('Vary', 'Origin');
      }
      if (req.method === 'OPTIONS') {
        res.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
        res.status(204).end();
        return;
      }
      // A signed URL expires; a cached manifest would hand out a dead one.
      res.set('Cache-Control', 'no-store');
      try {
        const out = await handle(storage(), {
          method: req.method,
          path: subPath(req, prefix),
        });
        if (out.location) {
          res.redirect(out.status, out.location);
        } else {
          res.status(out.status).json(out.json);
        }
      } catch (error) {
        await reportError(prefix, error, {route: subPath(req, prefix)});
        res.status(500).json({error: 'release failed'});
      }
    },
  );
}
