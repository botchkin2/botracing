// GET /api/tray/latest and /api/tray/download: the tray's update manifest and
// the installer download. The rules are in trayCore.ts; this binds them to
// Storage. Anonymous and read-only (see the header there).
import * as admin from 'firebase-admin';
import {onRequest} from 'firebase-functions/v2/https';
import {RUNTIME_ACCOUNT} from './runtime';
import {TrayDeps, handleTray} from './trayCore';

if (!admin.apps.length) {
  admin.initializeApp();
}

const BUCKET = 'botracing-61-lmu';

function storage(): TrayDeps {
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

// The /api/tray prefix the hosting rewrite adds.
function subPath(req: {path?: string; url?: string}): string {
  const full = req.path || (req.url ?? '').split('?')[0];
  const at = full.indexOf('/api/tray');
  return at === -1 ? full : full.slice(at + '/api/tray'.length) || '/';
}

export const trayApi = onRequest(
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
      const out = await handleTray(storage(), {
        method: req.method,
        path: subPath(req),
      });
      if (out.location) {
        res.redirect(out.status, out.location);
      } else {
        res.status(out.status).json(out.json);
      }
    } catch (error) {
      console.error('tray failed', error);
      res.status(500).json({error: 'tray failed'});
    }
  },
);
