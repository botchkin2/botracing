// The curator's backend over Firestore with Admin credentials (pit wall thread 2
// #210, option 1): the same interface as the in-memory catalog in fixture.mjs,
// with `commit` as one Firestore transaction. The curator endpoint with his own
// sign-in replaces this later; plans and apply do not change.
//
// Collections: tracks/{trackId} (the curated fields live here), trackBoundaries/
// {trackId}, trackHistory/{trackId}__{rev} (append-only), sessions (read only,
// to count the sessions on a track and read their lap lengths).
import {docProblems} from '../sessions/docShape.mjs';

const staleError = currentRev =>
  Object.assign(new Error('stale plan'), {code: 'STALE_PLAN', currentRev});

/**
 * db: a Firestore (Admin). FieldValue: admin.firestore.FieldValue.
 * regenerateCatalogFile: optional, run by applyPlan after the commit.
 */
export function adminBackend({db, FieldValue, regenerateCatalogFile}) {
  const backend = {
    async readCatalog(trackId) {
      const [track, boundaries] = await Promise.all([
        db.collection('tracks').doc(trackId).get(),
        db.collection('trackBoundaries').doc(trackId).get(),
      ]);
      const doc = track.exists ? track.data() : null;
      return {
        track: doc,
        boundaries: boundaries.exists ? boundaries.data() : null,
        catalogRev: doc?.catalogRev ?? 0,
      };
    },

    /** Map of rev -> history doc for the track. */
    async readHistory(trackId) {
      const snap = await db
        .collection('trackHistory')
        .where('trackId', '==', trackId)
        .get();
      return new Map(snap.docs.map(d => [d.data().rev, d.data()]));
    },

    /** The lap lengths (m) of the sessions on this track, for the length check. */
    async sessionLengths(trackId) {
      const snap = await db
        .collection('sessions')
        .where('trackId', '==', trackId)
        .select('band')
        .get();
      return snap.docs.map(d => d.data().band?.lengthM).filter(Number.isFinite);
    },

    async sessionCount(trackId) {
      const snap = await db
        .collection('sessions')
        .where('trackId', '==', trackId)
        .count()
        .get();
      return snap.data().count;
    },

    async commit({
      trackId,
      expectedRev,
      history,
      set,
      deleteFields,
      boundaries,
    }) {
      // What Firestore would refuse, found before the transaction starts.
      const docs = {history, track: set};
      if (boundaries.action === 'set') docs.boundaries = boundaries.doc;
      for (const [name, doc] of Object.entries(docs)) {
        const problems = docProblems(doc);
        if (problems.length)
          throw new Error(
            `the ${name} doc is not storable: ${problems.join('; ')}`,
          );
      }
      const trackRef = db.collection('tracks').doc(trackId);
      const boundariesRef = db.collection('trackBoundaries').doc(trackId);
      const historyRef = db
        .collection('trackHistory')
        .doc(`${trackId}__${history.rev}`);
      await db.runTransaction(async tx => {
        const [track, past] = await Promise.all([
          tx.get(trackRef),
          tx.get(historyRef),
        ]);
        const current = track.exists ? track.data().catalogRev ?? 0 : 0;
        if (current !== expectedRev) throw staleError(current);
        if (past.exists)
          throw new Error(`history ${trackId}__${history.rev} already exists`);
        tx.create(historyRef, history);
        if (track.exists) {
          // update() replaces each named field whole, so a nested field of an
          // older map (source, corners) does not linger.
          const patch = {...set};
          for (const k of deleteFields) patch[k] = FieldValue.delete();
          tx.update(trackRef, patch);
        } else {
          tx.set(trackRef, set);
        }
        if (boundaries.action === 'set') tx.set(boundariesRef, boundaries.doc);
        else if (boundaries.action === 'delete') tx.delete(boundariesRef);
      });
    },
  };
  if (regenerateCatalogFile)
    backend.regenerateCatalogFile = regenerateCatalogFile;
  return backend;
}
