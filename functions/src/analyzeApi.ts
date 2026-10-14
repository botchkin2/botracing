// POST /api/analyze/{sessionId}: analysis on open (analyzeCore.ts). Runs the
// session engine bundled from tools/sessions (scripts/buildEngine.mjs) with
// the DuckDB CLI it ships with, one run per instance.
import {randomUUID} from 'crypto';
import * as admin from 'firebase-admin';
import {mkdtempSync, rmSync} from 'fs';
import {tmpdir} from 'os';
import {join} from 'path';
import {onRequest} from 'firebase-functions/v2/https';
import {type AnalyzeDeps, handleAnalyze} from './analyzeCore';
import {loadEngine} from './engine';
import {Unauthorized, resolveOwner} from './ownerAccess';
import {RUNTIME_ACCOUNT} from './runtime';

if (!admin.apps.length) admin.initializeApp();

const BUCKET = 'botracing-61-lmu';
// The same origins dataApi.ts allows: the site, its preview channels, a local
// dev server.
const ALLOWED_ORIGIN =
  /^(https:\/\/botracing-61(--[a-z0-9-]+)?\.(web\.app|firebaseapp\.com)|http:\/\/(localhost|127\.0\.0\.1)(:\d+)?)$/;

/**
 * The lease, the engine run and the live stamp, for an open (analyzeApi) and a
 * live lap (liveAnalyze.ts): one place, so both run the same way.
 */
export function engineDeps(
  db: admin.firestore.Firestore,
): Omit<AnalyzeDeps, 'owner'> {
  return {
    runTx: (id, fn) =>
      db.runTransaction(tx => {
        const ref = db.doc(`analysisRuns/${id}`);
        return fn({
          get: async () => {
            const held = await tx.get(ref);
            return held.exists
              ? {until: held.get('until') as number, token: held.get('token') as string}
              : null;
          },
          set: lease => void tx.set(ref, lease),
          delete: () => void tx.delete(ref),
        });
      }),
    token: () => randomUUID(),
    liveStamp: async id => {
      const at = (await db.doc(`sessions/${id}`).get()).get(
        'live.updatedAt',
      );
      return typeof at === 'string' ? at : null;
    },
    analyze: async (sessionId, owner, fence) => {
      const {analyzeStored, adminBackend} = loadEngine();
      const workDir = mkdtempSync(
        join(tmpdir(), `analyze-${sessionId}-`),
      );
      try {
        return await analyzeStored({
          backend: adminBackend({
            db,
            bucket: admin.storage().bucket(BUCKET),
          }),
          sessionId,
          owner,
          workDir,
          beforeWrite: fence,
          log: (line: string) =>
            console.log(`analyze ${sessionId}: ${line}`),
        });
      } finally {
        // /tmp is memory on Cloud Run: the archive must not stay.
        rmSync(workDir, {recursive: true, force: true});
      }
    },
    now: () => Date.now(),
  };
}

export const analyzeApi = onRequest(
  {
    // A 66-minute LMU race peaks near 0.9 GB (thread 1 #4550); one run per
    // instance, and a cap so a loop cannot run up a bill (apex #4573).
    memory: '2GiB',
    // Two: the analysis is CPU-bound, and DuckDB's reads run beside Node's
    // work (13.6 s per open on one vCPU, thread 1).
    cpu: 2,
    concurrency: 1,
    maxInstances: 10,
    timeoutSeconds: 120,
    serviceAccount: RUNTIME_ACCOUNT,
  },
  async (req, res) => {
    const origin = req.headers.origin;
    res.set(
      'Access-Control-Allow-Origin',
      typeof origin === 'string' && ALLOWED_ORIGIN.test(origin)
        ? origin
        : 'https://botracing-61.web.app',
    );
    res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.set('Vary', 'Authorization, Origin');
    res.set('Cache-Control', 'no-store');
    if (req.method === 'OPTIONS') {
      res.status(200).end();
      return;
    }
    const db = admin.firestore();
    try {
      const reply = await handleAnalyze(
        {
          owner: authorization =>
            resolveOwner(
              {
                verifyToken: async idToken => ({
                  uid: (await admin.auth().verifyIdToken(idToken)).uid,
                }),
                readOwnerKey: async uid => {
                  const key = (await db.doc(`users/${uid}`).get()).get(
                    'ownerKey',
                  );
                  return typeof key === 'string' ? key : null;
                },
              },
              authorization,
            ),
          ...engineDeps(db),
        },
        req.method,
        req.path,
        req.headers.authorization,
      );
      res.status(reply.status).json(reply.body);
    } catch (error) {
      if (error instanceof Unauthorized) {
        res.status(401).json({error: error.message});
        return;
      }
      console.error('analyze failed', error);
      res.status(500).json({error: 'analysis failed'});
    }
  },
);
