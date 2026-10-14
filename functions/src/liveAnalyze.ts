// A live session is analysed when a lap lands, not when someone opens it
// (roadmap row 1, pit wall #5232-#5252): the live upload writes the parts and
// the session doc, and lap docs exist only after analysis. Tonight that left
// the opened session empty for the 21 s analysis-on-open took.
//
// Fired by the session doc's own update, so it works for every tray version
// and when the tray dies after an upload. It runs the analysis in-process: an
// event function keeps its CPU until it returns, which an HTTP call fired
// from the upload handler would not (pit wall #5250). Same lease, re-runs and
// engine as analysis on open (analyzeCore runAnalysis, analyzeApi engineDeps);
// the owner is the session doc's own, never a caller's.
import * as admin from 'firebase-admin';
import {onDocumentUpdated} from 'firebase-functions/v2/firestore';
import {gainedLiveLap, runAnalysis} from './analyzeCore';
import {engineDeps} from './analyzeApi';
import {RUNTIME_ACCOUNT} from './runtime';

if (!admin.apps.length) admin.initializeApp();

export const liveAnalyze = onDocumentUpdated(
  {
    document: 'sessions/{sessionId}',
    // As analyzeApi: one run per instance, and a cap.
    memory: '2GiB',
    cpu: 2,
    concurrency: 1,
    maxInstances: 10,
    // Up to MAX_RUNS runs back to back on a long race.
    timeoutSeconds: 300,
    serviceAccount: RUNTIME_ACCOUNT,
  },
  async event => {
    const before = event.data?.before.data();
    const after = event.data?.after.data();
    if (!gainedLiveLap(before, after)) return;
    const owner = after?.ownerId;
    if (typeof owner !== 'string' || !owner) return;
    const sessionId = event.params.sessionId;
    const run = await runAnalysis(
      engineDeps(admin.firestore()),
      sessionId,
      owner,
    );
    console.log(`live analyze ${sessionId}: ${run.state}`);
  },
);
