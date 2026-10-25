// GET and PUT /api/fuel-presets: binds fuelPresetsCore.ts to Auth and Firestore. One doc per
// owner key in `fuelPresets/{ownerKey}` (an Admin-only collection: firestore.rules deny every
// client), written here with the Admin SDK in a transaction that checks the version.
import * as admin from 'firebase-admin';
import {onRequest} from 'firebase-functions/v2/https';

import {type PresetsDeps, type PresetsDoc, handleFuelPresets} from './fuelPresetsCore';
import {Unauthorized, resolveOwner} from './ownerAccess';
import {RUNTIME_ACCOUNT} from './runtime';

if (!admin.apps.length) admin.initializeApp();

// The same origins dataApi.ts allows: the site, its preview channels, a local dev server.
const ALLOWED_ORIGIN =
  /^(https:\/\/botracing-61(--[a-z0-9-]+)?\.(web\.app|firebaseapp\.com)|http:\/\/(localhost|127\.0\.0\.1)(:\d+)?)$/;

const asDoc = (data: admin.firestore.DocumentData | undefined): PresetsDoc | null =>
  data
    ? {
        presets: data.presets ?? [],
        removed: data.removed ?? {},
        version: typeof data.version === 'number' ? data.version : 0,
        updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : null,
      }
    : null;

function depsFor(db: admin.firestore.Firestore): Omit<PresetsDeps, 'owner'> {
  const ref = (owner: string) => db.doc(`fuelPresets/${owner}`);
  return {
    read: async owner => asDoc((await ref(owner).get()).data()),
    writeIf: (owner, baseVersion, next) =>
      db.runTransaction(async tx => {
        const current = asDoc((await tx.get(ref(owner))).data()) ?? {
          presets: [],
          removed: {},
          version: 0,
          updatedAt: null,
        };
        if (current.version !== baseVersion) return {ok: false as const, current};
        tx.set(ref(owner), next);
        return {ok: true as const};
      }),
    now: () => Date.now(),
  };
}

export const fuelPresetsApi = onRequest(
  {memory: '256MiB', timeoutSeconds: 30, cors: false, serviceAccount: RUNTIME_ACCOUNT},
  async (req, res) => {
    const origin = req.headers.origin;
    res.set(
      'Access-Control-Allow-Origin',
      typeof origin === 'string' && ALLOWED_ORIGIN.test(origin)
        ? origin
        : 'https://botracing-61.web.app',
    );
    res.set('Access-Control-Allow-Methods', 'GET, PUT, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.set('Vary', 'Authorization, Origin');
    // A list read from a cache could undo a write the same device just made.
    res.set('Cache-Control', 'no-store');
    if (req.method === 'OPTIONS') {
      res.status(200).end();
      return;
    }
    const db = admin.firestore();
    try {
      const reply = await handleFuelPresets(
        {
          owner: authorization =>
            resolveOwner(
              {
                verifyToken: async idToken => ({
                  uid: (await admin.auth().verifyIdToken(idToken)).uid,
                }),
                readOwnerKey: async uid => {
                  const key = (await db.doc(`users/${uid}`).get()).get('ownerKey');
                  return typeof key === 'string' ? key : null;
                },
              },
              authorization,
            ),
          ...depsFor(db),
        },
        req.method,
        req.headers.authorization,
        req.body,
      );
      res.status(reply.status).json(reply.body);
    } catch (error) {
      if (error instanceof Unauthorized) {
        res.status(401).json({error: error.message});
        return;
      }
      console.error('fuel presets failed', error);
      res.status(500).json({error: 'fuel presets failed'});
    }
  },
);
