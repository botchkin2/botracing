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
  if (!(await deps.takeLease(sessionId, owner, deps.now())))
    // Another open of the same session is running it: the app reads the
    // session again until it is fresh.
    return {status: 202, body: {state: 'running'}};
  try {
    const {laps} = await deps.analyze(sessionId, owner);
    return {status: 200, body: {state: 'done', laps}};
  } catch (error) {
    const status = (error as {status?: unknown})?.status;
    if (status === 404 || status === 409)
      return {status, body: {error: (error as Error).message}};
    throw error;
  } finally {
    await deps.releaseLease(sessionId);
  }
}
