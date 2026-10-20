// POST /api/auth/handoff: binds handoffCore.ts to Firebase Auth and Firestore. The per-minute count lives in
// `handoffLimits/{uid}` (an Admin-only collection: firestore.rules deny every client).
import * as admin from 'firebase-admin';
import {onRequest} from 'firebase-functions/v2/https';

import {HANDOFFS_PER_MINUTE, HandoffDeps, MINUTE_MS, handleHandoff} from './handoffCore';
import {reportError} from './problems';
import {RUNTIME_ACCOUNT} from './runtime';

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

const deps: HandoffDeps = {
  // checkRevoked: "sign out everywhere" must also stop minting a token with an ID token still valid for an hour.
  verifyToken: async idToken => ({uid: (await admin.auth().verifyIdToken(idToken, true)).uid}),
  allow: async (uid, nowMs) => {
    const ref = db.doc(`handoffLimits/${uid}`);
    return db.runTransaction(async tx => {
      const snap = await tx.get(ref);
      const data = snap.data() as {startMs: number; count: number} | undefined;
      const fresh = !data || nowMs - data.startMs >= MINUTE_MS;
      const count = fresh ? 0 : data.count;
      if (count >= HANDOFFS_PER_MINUTE) return false;
      tx.set(ref, {startMs: fresh ? nowMs : data.startMs, count: count + 1});
      return true;
    });
  },
  mint: uid => admin.auth().createCustomToken(uid),
  now: () => Date.now(),
};

export const handoffApi = onRequest(
  {memory: '256MiB', timeoutSeconds: 30, cors: false, serviceAccount: RUNTIME_ACCOUNT},
  async (req, res) => {
    // An answer here is a credential: never cached, never kept, never logged.
    res.set('Cache-Control', 'no-store');
    try {
      const out = await handleHandoff(deps, {method: req.method, authorization: req.headers.authorization});
      res.status(out.status).json(out.json);
    } catch (error) {
      // The message can name a uid or a token: reportError masks both.
      await reportError('handoffApi', error, {route: '/api/auth/handoff'});
      res.status(500).json({error: 'sign-in failed'});
    }
  },
);
