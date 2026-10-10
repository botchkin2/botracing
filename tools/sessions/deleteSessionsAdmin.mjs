// The Admin SDK behind deleteSessions.mjs: Firestore and the bucket, with the
// credentials of whoever runs it. Only what a delete needs: read a document,
// find an owner's laps of one session, list objects under an exact prefix,
// delete documents in batches, delete one object.
const isNotFound = error => error?.code === 404 || error?.code === 5;

/** db: a Firestore, bucket: a Storage bucket (store.mjs connect()). */
export function adminDeleteBackend({db, bucket}) {
  return {
    async getDoc(path) {
      const doc = await db.doc(path).get();
      return doc.exists ? doc.data() : null;
    },
    async listBySession(coll, sessionId, ownerId) {
      const snap = await db
        .collection(coll)
        .where('sessionId', '==', sessionId)
        .where('ownerId', '==', ownerId)
        .get();
      return snap.docs.map(doc => ({id: doc.id, data: doc.data()}));
    },
    // The prefix ends in "/" (the caller's job): `abc/` never lists `abcd/...`.
    async listFiles(prefix) {
      const [files] = await bucket.getFiles({prefix});
      return files.map(f => ({
        path: f.name,
        size: Number(f.metadata?.size ?? 0),
      }));
    },
    async deleteDocs(paths) {
      const batch = db.batch();
      for (const path of paths) batch.delete(db.doc(path));
      await batch.commit();
    },
    async deleteFile(path) {
      try {
        await bucket.file(path).delete();
      } catch (error) {
        if (!isNotFound(error)) throw error;
      }
    },
  };
}
