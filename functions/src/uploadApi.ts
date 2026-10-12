// POST/PUT/GET /api/upload/**: the authenticated write side of the store, for
// PCs without Admin credentials (the BotRacing tray). Rules and limits are in
// uploadCore.ts; this binds them to Firebase Auth, Firestore and Storage.
import * as admin from 'firebase-admin';
import {onRequest} from 'firebase-functions/v2/https';
import {RUNTIME_ACCOUNT} from './runtime';
import {reportError} from './problems';
import {
  DocStore,
  FileStore,
  Json,
  UploadDeps,
  handleUpload,
} from './uploadCore';

if (!admin.apps.length) {
  admin.initializeApp();
}

const BUCKET = 'botracing-61-lmu';
const MAX_BODY_BYTES = 8_000_000;

function firebaseDocs(): DocStore {
  const db = admin.firestore();
  return {
    async get(path) {
      const snap = await db.doc(path).get();
      return snap.exists ? (snap.data() as Record<string, Json>) : null;
    },
    async lapIds(collectionPath, sessionId, ownerKey) {
      const snap = await db
        .collection(collectionPath)
        .where('sessionId', '==', sessionId)
        .where('ownerId', '==', ownerKey)
        .select()
        .get();
      return snap.docs.map(doc => doc.id);
    },
    async commit(writes) {
      const batch = db.batch();
      for (const w of writes) {
        const ref = db.doc(w.path);
        if (w.op === 'delete') batch.delete(ref);
        else if (w.op === 'update') batch.update(ref, w.data);
        else if (w.merge) batch.set(ref, w.data, {merge: true});
        else batch.set(ref, w.data);
      }
      await batch.commit();
    },
    async addUsage(uid, delta) {
      const inc = admin.firestore.FieldValue.increment;
      await db.doc(`users/${uid}`).set(
        {
          usage: {
            docs: inc(delta.docs),
            docBytes: inc(delta.docBytes),
            files: inc(delta.files),
            fileBytes: inc(delta.fileBytes),
            heartbeats: inc(delta.heartbeats ?? 0),
          },
          usageUpdatedAt: new Date().toISOString(),
        },
        {merge: true},
      );
    },
  };
}

function firebaseFiles(): FileStore {
  const bucket = admin.storage().bucket(BUCKET);
  return {
    async stat(path) {
      const file = bucket.file(path);
      const [exists] = await file.exists();
      if (!exists) return null;
      const [meta] = await file.getMetadata();
      return {md5Hash: String(meta.md5Hash), size: Number(meta.size)};
    },
    async signedUpload(
      path,
      {contentType, contentEncoding, maxBytes, expiresMs},
    ) {
      const headers: Record<string, string> = {
        'Content-Type': contentType,
        'Cache-Control': 'private, max-age=31536000',
        'x-goog-content-length-range': `0,${maxBytes}`,
      };
      if (contentEncoding) headers['Content-Encoding'] = contentEncoding;
      const [url] = await bucket.file(path).getSignedUrl({
        version: 'v4',
        action: 'write',
        expires: Date.now() + expiresMs,
        contentType,
        extensionHeaders: {
          'cache-control': headers['Cache-Control'],
          'x-goog-content-length-range': headers['x-goog-content-length-range'],
          ...(contentEncoding ? {'content-encoding': contentEncoding} : {}),
        },
      });
      return {url, headers};
    },
    async read(path) {
      const file = bucket.file(path);
      const [exists] = await file.exists();
      if (!exists) return null;
      const [bytes] = await file.download({decompress: false});
      return bytes;
    },
    async remove(path) {
      await bucket.file(path).delete({ignoreNotFound: true});
    },
    async list(prefix) {
      const [files] = await bucket.getFiles({prefix});
      return files.map(f => f.name);
    },
  };
}

const deps: UploadDeps = {
  verifyToken: async idToken => {
    const decoded = await admin.auth().verifyIdToken(idToken);
    return {uid: decoded.uid};
  },
  docs: firebaseDocs(),
  files: firebaseFiles(),
};

// The /api/upload prefix the hosting rewrite adds.
function subPath(req: {path?: string; url?: string}): string {
  const full = req.path || (req.url ?? '').split('?')[0];
  const at = full.indexOf('/api/upload');
  return at === -1 ? full : full.slice(at + '/api/upload'.length) || '/';
}

export const uploadApi = onRequest(
  // Bodies are small JSON; file bytes never come through here.
  {
    memory: '256MiB',
    timeoutSeconds: 60,
    cors: false,
    serviceAccount: RUNTIME_ACCOUNT,
  },
  async (req, res) => {
    // Bodies are JSON docs (at most 400 ops); file bytes go to Storage by
    // signed URL, so a big request is a mistake or an attack.
    // A chunked request has no content-length, so the received bytes count too.
    if (
      Number(req.headers['content-length'] ?? 0) > MAX_BODY_BYTES ||
      (req.rawBody?.length ?? 0) > MAX_BODY_BYTES
    ) {
      res.status(413).json({error: 'request too large'});
      return;
    }
    const query: Record<string, string | undefined> = {};
    for (const [k, v] of Object.entries(req.query))
      query[k] = typeof v === 'string' ? v : undefined;
    try {
      const out = await handleUpload(deps, {
        method: req.method,
        path: subPath(req),
        query,
        authorization: req.headers.authorization,
        json: req.body,
      });
      for (const [name, value] of Object.entries(out.headers ?? {}))
        res.set(name, value);
      if (out.bytes) {
        res
          .status(200)
          .type('application/octet-stream')
          .send(Buffer.from(out.bytes));
      } else if (out.json === undefined) {
        res.status(out.status).end();
      } else {
        res.status(out.status).json(out.json);
      }
    } catch (error) {
      await reportError('uploadApi', error, {route: subPath(req)});
      res.status(500).json({error: 'upload failed'});
    }
  },
);
