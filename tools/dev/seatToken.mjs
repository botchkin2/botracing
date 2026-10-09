// Live slots sign the pane in as seat-test by themselves: Metro serves one
// custom token at GET /__seat-token and the dev build (src/auth/devSeatSignIn.ts)
// picks it up. Added to Metro only by live.mjs (LIVE_SEAT_SIGNIN_PORT); a plain
// `expo start` and every export never see it. Conditions: pit-wall thread 54 #2742.
//
// - Host must be exactly localhost:<port> or 127.0.0.1:<port>: a page on another
//   name that resolves to 127.0.0.1 (DNS rebinding) is refused.
// - No CORS headers, so a hostile page cannot read the answer; no-store.
// - Anything else is passed on to Metro untouched.
// - The token is never written to stdout or stderr: seats read the Metro log.
import {createRequire} from 'node:module';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export const SEAT_TOKEN_PATH = '/__seat-token';
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

const here = path.dirname(fileURLToPath(import.meta.url));

/** Mints a fresh seat-test custom token with the Admin SDK (needs SMOKE_SERVICE_ACCOUNT). */
export async function mintSeatToken() {
  const serviceAccountId = process.env.SMOKE_SERVICE_ACCOUNT;
  if (!serviceAccountId)
    throw new Error('SMOKE_SERVICE_ACCOUNT is not set (docs/TESTING.md)');
  process.env.GOOGLE_CLOUD_QUOTA_PROJECT ??= 'botracing-61';
  // Imported here: that script has top-level await, which metro.config.js
  // (CommonJS) cannot require.
  const {TEST_UID, mintTestLinks} = await import(
    '../../functions/scripts/mintTestToken.mjs'
  );
  const require = createRequire(path.join(here, '../../functions/package.json'));
  const admin = require('firebase-admin');
  if (!admin.apps.length)
    admin.initializeApp({projectId: 'botracing-61', serviceAccountId});
  const {token} = await mintTestLinks({
    auth: admin.auth(),
    origins: [],
    uid: TEST_UID,
  });
  return token;
}

/**
 * Connect-style middleware for one slot port. `mint` is injectable for tests.
 * Errors are reported without the token.
 */
export function seatTokenMiddleware({port, mint = mintSeatToken, log = console.error}) {
  const hosts = new Set([`localhost:${port}`, `127.0.0.1:${port}`]);
  return async (req, res, next) => {
    const url = (req.url ?? '').split('?')[0];
    if (url !== SEAT_TOKEN_PATH) return next();
    // Host is only a header: a LAN client can forge it, so the peer must be
    // this machine too (live.mjs also binds Metro to loopback).
    const peer = req.socket?.remoteAddress ?? '';
    if (
      req.method !== 'GET' ||
      !hosts.has(req.headers.host ?? '') ||
      !LOOPBACK.has(peer)
    ) {
      res.statusCode = 404;
      res.setHeader('Cache-Control', 'no-store');
      return res.end();
    }
    try {
      const token = await mint();
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Cache-Control', 'no-store');
      res.end(JSON.stringify({token}));
    } catch (error) {
      log(`seat sign-in: ${error.message}`);
      res.statusCode = 503;
      res.setHeader('Cache-Control', 'no-store');
      res.end();
    }
  };
}
