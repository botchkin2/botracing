// POST /api/tray/code, /api/tray/token and /api/tray/viewer: the tray's sign-in
// through the web app (and its own window's) (the read side, /latest and /download, is trayApi). The rules are in trayCodeCore.ts; this binds them to Firebase Auth and
// Firestore. Codes live in `trayCodes/{sha256(code)}` (an Admin-only
// collection: firestore.rules deny every client), with a TTL policy on
// `expiresAt` that deletes the ones nobody used (ops/iam/README.md).
import * as admin from 'firebase-admin';
import {onRequest} from 'firebase-functions/v2/https';
import {RUNTIME_ACCOUNT} from './runtime';
import {reportError} from './problems';
import {
  CODES_PER_HOUR,
  HOUR_MS,
  TrayDeps,
  handleTray,
  randomCode,
} from './trayCodeCore';

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

const deps: TrayDeps = {
  verifyToken: async idToken => {
    // checkRevoked: "sign out everywhere" must also stop minting a tray sign-in
    // with an ID token that is still valid for up to an hour.
    const decoded = await admin.auth().verifyIdToken(idToken, true);
    return {uid: decoded.uid, email: decoded.email ?? null};
  },
  put: async (codeHash, record) => {
    await db.doc(`trayCodes/${codeHash}`).set({
      uid: record.uid,
      email: record.email,
      challenge: record.challenge,
      expiresAtMs: record.expiresAtMs,
      // The TTL policy reads this field (it needs a Timestamp).
      expiresAt: new Date(record.expiresAtMs),
    });
  },
  take: async codeHash => {
    const ref = db.doc(`trayCodes/${codeHash}`);
    return db.runTransaction(async tx => {
      const snap = await tx.get(ref);
      if (!snap.exists) return null;
      tx.delete(ref);
      const data = snap.data() as {
        uid: string;
        email: string | null;
        challenge: string;
        expiresAtMs: number;
      };
      return {
        uid: data.uid,
        email: data.email ?? null,
        challenge: data.challenge,
        expiresAtMs: data.expiresAtMs,
      };
    });
  },
  // CODES_PER_HOUR per user, counted in a window that starts with the first ask.
  allow: async (uid, nowMs) => {
    const ref = db.doc(`trayCodeLimits/${uid}`);
    return db.runTransaction(async tx => {
      const snap = await tx.get(ref);
      const data = snap.data() as {startMs: number; count: number} | undefined;
      const fresh = !data || nowMs - data.startMs >= HOUR_MS;
      const count = fresh ? 0 : data.count;
      if (count >= CODES_PER_HOUR) return false;
      tx.set(ref, {startMs: fresh ? nowMs : data.startMs, count: count + 1});
      return true;
    });
  },
  // Signs as the runtime account on itself (Token Creator, ops/iam step 1). It
  // reads nothing from Firebase Auth: the email travelled in the code's record.
  mint: uid => admin.auth().createCustomToken(uid),
  now: () => Date.now(),
  newCode: randomCode,
};

// The /api/tray prefix the hosting rewrite adds.
function subPath(req: {path?: string; url?: string}): string {
  const full = req.path || (req.url ?? '').split('?')[0];
  const at = full.indexOf('/api/tray');
  return at === -1 ? full : full.slice(at + '/api/tray'.length) || '/';
}

export const traySignInApi = onRequest(
  {
    memory: '256MiB',
    timeoutSeconds: 30,
    cors: false,
    serviceAccount: RUNTIME_ACCOUNT,
  },
  async (req, res) => {
    // Codes, tokens and challenges are small; anything big is a mistake.
    if ((req.rawBody?.length ?? 0) > 4096) {
      res.status(413).json({error: 'request too large'});
      return;
    }
    // Never cached, never kept: an answer here can carry a code or a token.
    res.set('Cache-Control', 'no-store');
    try {
      const out = await handleTray(deps, {
        method: req.method,
        path: subPath(req),
        authorization: req.headers.authorization,
        json: req.body,
      });
      res.status(out.status).json(out.json);
    } catch (error) {
      // The message can name a uid or a token: reportError masks both.
      await reportError('traySignInApi', error, {route: subPath(req)});
      res.status(500).json({error: 'sign-in failed'});
    }
  },
);
