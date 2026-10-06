// The Admin SDK behind ownerCopyRun.mjs's backend: Firestore and the bucket,
// with the credentials of whoever runs it. Only what the copy needs. There is
// no delete here either, and nothing that merges: a document is written whole.
//
// Reads are paged and narrow so an owner with tens of thousands of laps is
// never held in memory: sessions come a page at a time, ids come without
// fields, counts come from the database, and a session's laps and recordings
// are read by that session only.
const isNotFound = error => error?.code === 404 || error?.code === 5;
const PAGE = 100;

/** db: a Firestore, bucket: a Storage bucket (store.mjs connect()). */
export function adminCopyBackend({db, bucket}) {
  const meta = m => ({
    size: Number(m.size),
    md5: m.md5Hash,
    contentType: m.contentType ?? null,
    contentEncoding: m.contentEncoding ?? null,
    cacheControl: m.cacheControl ?? null,
  });
  const owned = (coll, ownerId) =>
    db.collection(coll).where('ownerId', '==', ownerId);
  return {
    // Pages by document id, so a long list is read a hundred at a time.
    async *iterDocs(coll, ownerId) {
      let last = null;
      for (;;) {
        let query = owned(coll, ownerId).orderBy('__name__').limit(PAGE);
        if (last) query = query.startAfter(last);
        const snap = await query.get();
        for (const doc of snap.docs) yield {id: doc.id, data: doc.data()};
        if (snap.docs.length < PAGE) return;
        last = snap.docs[snap.docs.length - 1];
      }
    },
    // Ids only: no field is read.
    async listIds(coll, ownerId) {
      const snap = await owned(coll, ownerId).select().get();
      return snap.docs.map(doc => doc.id);
    },
    async countDocs(coll, ownerId) {
      const snap = await owned(coll, ownerId).count().get();
      return snap.data().count;
    },
    async listBySession(coll, sessionId, ownerId) {
      const snap = await db
        .collection(coll)
        .where('sessionId', '==', sessionId)
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
