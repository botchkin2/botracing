// POST/PUT/GET /api/upload/**: the authenticated write side of the store, for
// PCs without Admin credentials (the BotRacing tray). Rules and limits are in
// uploadCore.ts; this binds them to Firebase Auth, Firestore and Storage.
import * as admin from 'firebase-admin';
import {onRequest} from 'firebase-functions/v2/https';
import {gzipSync} from 'zlib';
import {
  DocStore,
  FileStore,
  Json,
  MAX_FILE_BYTES,
  UploadDeps,
  handleUpload,
} from './uploadCore';

if (!admin.apps.length) {
  admin.initializeApp();
}

const BUCKET = 'botracing-61-lmu';

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
    async put(path, bytes, meta) {
      await bucket.file(path).save(Buffer.from(bytes), {
        resumable: false,
        metadata: {
          contentType: meta.contentType,
          contentEncoding: meta.contentEncoding,
          cacheControl: 'private, max-age=31536000',
        },
      });
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
  gzip: bytes => gzipSync(bytes, {level: 9}),
};

// The /api/upload prefix the hosting rewrite adds.
function subPath(req: {path?: string; url?: string}): string {
  const full = req.path || (req.url ?? '').split('?')[0];
  const at = full.indexOf('/api/upload');
  return at === -1 ? full : full.slice(at + '/api/upload'.length) || '/';
}

export const uploadApi = onRequest(
  // The request cap is 32 MB; MAX_FILE_BYTES stays under it.
  {memory: '512MiB', timeoutSeconds: 120, cors: false},
  async (req, res) => {
    // Cheap early refusal before anything is parsed or verified.
    const length = Number(req.headers['content-length'] ?? 0);
    if (length > MAX_FILE_BYTES + 100_000) {
      res.status(413).json({error: 'request too large'});
      return;
    }
    const isJson = String(req.headers['content-type'] ?? '').includes(
      'application/json',
    );
    const query: Record<string, string | undefined> = {};
    for (const [k, v] of Object.entries(req.query))
      query[k] = typeof v === 'string' ? v : undefined;
    try {
      const out = await handleUpload(deps, {
        method: req.method,
        path: subPath(req),
        query,
        authorization: req.headers.authorization,
        contentType: req.headers['content-type'],
        json: isJson ? req.body : undefined,
        body: isJson ? undefined : req.rawBody,
      });
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
      console.error('upload failed', error);
      res.status(500).json({error: 'upload failed'});
    }
  },
);
