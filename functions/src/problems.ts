// reportError for every function's catch-all (problemsCore.ts has the rules):
// a structured error log, which Cloud Error Reporting groups, and for a 5xx a
// count in `problems/{fingerprint}`. No client reads or writes problems/*
// (firestore.rules); the admin view reads it through a function.
import * as admin from 'firebase-admin';
import {error as logError} from 'firebase-functions/logger';

import {makeReporter, problemDoc} from './problemsCore.ts';

export const reportError = makeReporter({
  log: (message, fields) => logError(message, fields),
  now: () => Date.now(),
  write: async w => {
    const db = admin.firestore();
    const ref = db.doc(`problems/${w.id}`);
    await db.runTransaction(async tx => {
      const doc = await tx.get(ref);
      tx.set(ref, problemDoc(doc.exists ? doc.data() : undefined, w));
    });
  },
});
