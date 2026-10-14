// Analysis on open (pit-wall thread 1 #4572): POST /api/analyze/{sessionId}
// analyses one stored session again from its archive and writes it back. No
// Firebase imports, so node --test runs it (functions/test/analyzeCore.test.mjs);
// analyzeApi.ts binds it to Firestore and the bundled engine.

// One run per session (pit-wall #621 Design): a run holds analysisRuns/{id}
// for LEASE_MS, longer than either function's timeout (analyzeApi 120 s,
// liveAnalyze 300 s), so a lease cannot run out while its run is alive and no
// renewal is needed; a crashed run frees it within LEASE_MS. Each lease
// carries its run's token: a run releases only its own, and its session write
// is fenced on it (spring #5375, #5389).
export const LEASE_MS = 330_000;
const SESSION_ID = /^[0-9a-f]{16}$/;

/** analysisRuns/{id} inside one transaction (Firestore, or a test's map). */
export interface LeaseTx {
  get(): Promise<{until: number; token: string} | null>;
  set(lease: {owner: string; until: number; token: string}): void;
  delete(): void;
}
export type RunTx = <T>(id: string, fn: (tx: LeaseTx) => Promise<T>) => Promise<T>;

/** The lease rules, the same for Firestore and the tests. */
export function leases(runTx: RunTx) {
  return {
    /** True when taken for this token; false while another run holds it. */
    take: (id: string, owner: string, now: number, token: string) =>
      runTx(id, async tx => {
        const held = await tx.get();
        if (held && held.until > now) return false;
        tx.set({owner, until: now + LEASE_MS, token});
        return true;
      }),
    /** Whether `token` still holds the lease at `now`. */
    holds: (id: string, now: number, token: string) =>
      runTx(id, async tx => {
        const held = await tx.get();
        return !!held && held.token === token && held.until > now;
      }),
    /** Deletes the lease only while it carries `token`. */
    release: (id: string, token: string) =>
      runTx(id, async tx => {
        if ((await tx.get())?.token === token) tx.delete();
      }),
  };
}

export class LeaseLost extends Error {
  status = 409 as const;
}

export interface AnalyzeDeps {
  /** The caller's owner key (ownerAccess.ts resolveOwner); throws Unauthorized. */
  owner(authorization: string | undefined): Promise<string>;
  /** analysisRuns/{id} in a transaction: `leases` applies the rules. */
  runTx: RunTx;
  /**
   * The engine: analyzeStored. Calls `fence` right before it writes the
   * session; `fence` throws LeaseLost when this run no longer holds the lease.
   * Rejects with {status} for 404 and 409.
   */
  analyze(
    sessionId: string,
    owner: string,
    fence: () => Promise<void>,
  ): Promise<{laps: number}>;
  /**
   * The session's live upload stamp (sessions/{id}.live.updatedAt), null when
   * it was never live. A lap uploaded during a run moves it.
   */
  liveStamp?(sessionId: string): Promise<string | null>;
  /** A run's lease token, unique per run. */
  token(): string;
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
  const lease = leases(deps.runTx);
  const token = deps.token();
  if (!(await lease.take(sessionId, owner, deps.now(), token)))
    return {state: 'running'};
  const fence = async () => {
    if (!(await lease.holds(sessionId, deps.now(), token)))
      throw new LeaseLost('analysis lease lost: another run holds it');
  };
  try {
    let laps = 0;
    for (let run = 1; run <= MAX_RUNS; run++) {
      const before = deps.liveStamp ? await deps.liveStamp(sessionId) : null;
      ({laps} = await deps.analyze(sessionId, owner, fence));
      if (!deps.liveStamp || before === null) break;
      if ((await deps.liveStamp(sessionId)) === before) break;
    }
    return {state: 'done', laps};
  } catch (error) {
    // Another run holds the session now and writes it: as if it had been
    // running when this one asked.
    if (error instanceof LeaseLost) return {state: 'running'};
    const status = (error as {status?: unknown})?.status;
    if (status === 404 || status === 409)
      return {state: 'refused', status, message: (error as Error).message};
    throw error;
  } finally {
    await lease.release(sessionId, token);
  }
}

type Doc = Record<string, unknown> | undefined;

/**
 * The live upload of a new lap (tools/sessions/liveSession.mjs) stamps
 * `live.updatedAt`; nothing else moves it. Analysis writes the stamp it read
 * back unchanged (analyzeStored.mjs) and its own lap count, which need not
 * equal the live part count, so the lap count is no trigger (sidepod #5258).
 * A create counts: lap 1's upload creates the doc.
 */
export function liveLapLanded(before: Doc, after: Doc): boolean {
  const stamp = (d: Doc) =>
    (d?.live as {updatedAt?: unknown} | null | undefined)?.updatedAt;
  const now = stamp(after);
  return typeof now === 'string' && now !== stamp(before);
}
