// The Admin SDK behind ownerCopyRun.mjs's backend: Firestore and the bucket,
// with the credentials of whoever runs it. Only what the copy needs. There is
// no delete here either, and nothing that merges: a document is written whole.
import {gunzipSync} from 'node:zlib';

const isNotFound = error => error?.code === 404 || error?.code === 5;

/** db: a Firestore, bucket: a Storage bucket (store.mjs connect()). */
export function adminCopyBackend({db, bucket}) {
  const meta = m => ({
    size: Number(m.size),
    md5: m.md5Hash,
    contentType: m.contentType ?? null,
    contentEncoding: m.contentEncoding ?? null,
    cacheControl: m.cacheControl ?? null,
  });
  return {
    async listDocs(coll, ownerId) {
      const snap = await db
        .collection(coll)
        .where('ownerId', '==', ownerId)
        .get();
      return snap.docs.map(doc => ({id: doc.id, data: doc.data()}));
    },
    async getDoc(path) {
      const doc = await db.doc(path).get();
      return doc.exists ? doc.data() : null;
    },
    async setDoc(path, data) {
      await db.doc(path).set(data);
    },
    async statFile(path) {
      try {
        const [m] = await bucket.file(path).getMetadata();
        return meta(m);
      } catch (error) {
        if (isNotFound(error)) return null;
        throw error;
      }
    },
    async readFile(path) {
      try {
        const file = bucket.file(path);
        const [m] = await file.getMetadata();
        // As stored: a gzipped file is not decompressed on the way.
        const [bytes] = await file.download({decompress: false});
        return {bytes, meta: meta(m)};
      } catch (error) {
        if (isNotFound(error)) return null;
        throw error;
      }
    },
    async writeFile(path, bytes, m) {
      await bucket.file(path).save(bytes, {
        resumable: false,
        metadata: {
          contentType: m.contentType ?? undefined,
          contentEncoding: m.contentEncoding ?? undefined,
          cacheControl: m.cacheControl ?? undefined,
        },
      });
    },
    // Server side, so a large archive is not downloaded to this machine; the
    // object keeps its metadata.
    async copyFile(from, to) {
      await bucket.file(from).copy(bucket.file(to));
    },
  };
}

// gunzip is exported for the tool's report of a file's size on disk.
export const gunzipText = bytes => gunzipSync(bytes).toString('utf8');
