// Analysis on open (pit-wall thread 1 #4572): POST /api/analyze/{sessionId}
// analyses one stored session again from its archive and writes it back. No
// Firebase imports, so node --test runs it (functions/test/analyzeCore.test.mjs);
// analyzeApi.ts binds it to Firestore and the bundled engine.

export const LEASE_MS = 150_000;
const SESSION_ID = /^[0-9a-f]{16}$/;

export interface AnalyzeDeps {
  /** The caller's owner key (ownerAccess.ts resolveOwner); throws Unauthorized. */
  owner(authorization: string | undefined): Promise<string>;
  /**
   * Takes analysisRuns/{id} for LEASE_MS in a transaction: true when taken,
   * false while another run holds it.
   */
  takeLease(sessionId: string, owner: string, now: number): Promise<boolean>;
  releaseLease(sessionId: string): Promise<void>;
  /** The engine: analyzeStored. Rejects with {status} for 404 and 409. */
  analyze(sessionId: string, owner: string): Promise<{laps: number}>;
  /**
   * The session's live upload stamp (sessions/{id}.live.updatedAt), null when
   * it was never live. A lap uploaded during a run moves it.
   */
  liveStamp?(sessionId: string): Promise<string | null>;
  /** Moves the held lease's end to now + LEASE_MS, before another run. */
  extendLease?(sessionId: string, owner: string, now: number): Promise<void>;
  now(): number;
}

export interface Reply {
  status: number;
  body: Record<string, unknown>;
}

export async function handleAnalyze(
  deps: AnalyzeDeps,
  method: string,
  path: string,
  authorization: string | undefined,
): Promise<Reply> {
  if (method !== 'POST') return {status: 405, body: {error: 'POST only'}};
  const match = path.match(/\/analyze\/([^/]+)$/);
  if (!match || !SESSION_ID.test(match[1]))
    return {status: 404, body: {error: 'Not found'}};
  const sessionId = match[1];
  // Throws Unauthorized: the caller maps it to 401.
  const owner = await deps.owner(authorization);
  const run = await runAnalysis(deps, sessionId, owner);
  // Another open of the same session is running it: the app reads the
  // session again until it is fresh.
  if (run.state === 'running') return {status: 202, body: {state: 'running'}};
  if (run.state === 'refused')
    return {status: run.status, body: {error: run.message}};
  return {status: 200, body: {state: 'done', laps: run.laps}};
}

/**
 * Runs while the lease is held: a lap that lands during a run has its own
 * start refused (the lease), so the run goes again until no lap came in, or
 * MAX_RUNS. The last lap of a drive lands without anyone opening it.
 */
export const MAX_RUNS = 3;

export type Run =
  | {state: 'done'; laps: number}
  | {state: 'running'}
  | {state: 'refused'; status: 404 | 409; message: string};

/** One analysis under the lease, for an open (handleAnalyze) or a live lap. */
export async function runAnalysis(
  deps: Omit<AnalyzeDeps, 'owner'>,
  sessionId: string,
  owner: string,
): Promise<Run> {
  if (!(await deps.takeLease(sessionId, owner, deps.now())))
    return {state: 'running'};
  try {
    let laps = 0;
    for (let run = 1; run <= MAX_RUNS; run++) {
      if (run > 1) await deps.extendLease?.(sessionId, owner, deps.now());
      const before = deps.liveStamp ? await deps.liveStamp(sessionId) : null;
      ({laps} = await deps.analyze(sessionId, owner));
      if (!deps.liveStamp || before === null) break;
      if ((await deps.liveStamp(sessionId)) === before) break;
    }
    return {state: 'done', laps};
  } catch (error) {
    const status = (error as {status?: unknown})?.status;
    if (status === 404 || status === 409)
      return {state: 'refused', status, message: (error as Error).message};
    throw error;
  } finally {
    await deps.releaseLease(sessionId);
  }
}

type Doc = Record<string, unknown> | undefined;

/**
 * The live upload of a new lap (tools/sessions/liveSession.mjs): a live
 * session doc whose lap count went up. Analysis writes the same lap count,
 * so its own write never starts another run.
 */
export function gainedLiveLap(before: Doc, after: Doc): boolean {
  if (!after?.live) return false;
  const n = (d: Doc) => (typeof d?.lapCount === 'number' ? d.lapCount : 0);
  return n(after) > n(before);
}
