// Walks every session of the signed-in user through the app's own API client
// (src/data/sessions/client.ts), so what the audit reads is what the app reads
// (pit-wall thread 1 #4835). Read only: GET requests as seat-test, no writes.
//
// The token: `node functions/scripts/mintTestToken.mjs --id-token-file <path>`
// (docs/TESTING.md), then AUDIT_TOKEN_FILE=<path>. Run from a jest test, since
// the client imports through the app's `@/` alias.
import {readFileSync} from 'node:fs';
import {request} from 'node:https';

import {setIdTokenProvider} from '@/src/data/tokenSource';
import {
  fetchSession,
  fetchSessionLaps,
  fetchSessions,
  fetchTrackMap,
} from '@/src/data/sessions/client';
import {
  type Lap,
  type SessionDetail,
  type SessionSummary,
  type TrackMapData,
} from '@/src/data/sessions/adapters';

export type WalkedSession = {
  summary: SessionSummary;
  session: SessionDetail;
  laps: Lap[];
  map: TrackMapData | null;
};

/**
 * jest-expo replaces the global fetch with React Native's (XMLHttpRequest, no
 * status in Node), so the audit brings its own GET over node:https.
 */
function nodeFetch(url: string | URL | Request, init?: RequestInit) {
  const headers = new Headers(init?.headers);
  return new Promise<Response>((resolve, reject) => {
    const req = request(
      String(url),
      {method: init?.method ?? 'GET', headers: Object.fromEntries(headers)},
      res => {
        const chunks: Buffer[] = [];
        res.on('data', c => chunks.push(c as Buffer));
        res.on('end', () => {
          const body = Buffer.concat(chunks);
          const status = res.statusCode ?? 0;
          resolve({
            status,
            ok: status >= 200 && status < 300,
            json: async () => JSON.parse(body.toString('utf8')),
            text: async () => body.toString('utf8'),
            headers: new Headers(res.headers as Record<string, string>),
          } as unknown as Response);
        });
      },
    );
    req.on('error', reject);
    req.end();
  });
}

/** Signs the data layer in with an ID token file (seat-test's, an hour long). */
export function signInFromFile(tokenFile: string): void {
  const token = readFileSync(tokenFile, 'utf8').trim();
  setIdTokenProvider(async () => token);
  globalThis.fetch = nodeFetch as typeof fetch;
}

/**
 * Calls `visit` for every session, newest first, `concurrency` at a time. A
 * session that fails to load is reported to `onError` and skipped.
 */
export async function walkSessions(
  visit: (s: WalkedSession) => void | Promise<void>,
  {
    concurrency = 4,
    limit = Infinity,
    onError = () => {},
  }: {
    concurrency?: number;
    limit?: number;
    onError?: (id: string, error: unknown) => void;
  } = {},
): Promise<{listed: number; visited: number}> {
  const {items} = await fetchSessions({});
  const todo = items.slice(0, limit);
  const maps = new Map<string, Promise<TrackMapData | null>>();
  const mapOf = (trackId: string) => {
    if (!maps.has(trackId)) maps.set(trackId, fetchTrackMap(trackId));
    return maps.get(trackId)!;
  };
  let next = 0;
  let visited = 0;
  async function worker() {
    for (;;) {
      const i = next++;
      if (i >= todo.length) return;
      const summary = todo[i];
      try {
        const [session, laps] = await Promise.all([
          fetchSession(summary.id),
          fetchSessionLaps(summary.id),
        ]);
        const map = await mapOf(session.trackId);
        await visit({summary, session, laps, map});
        visited++;
      } catch (error) {
        onError(summary.id, error);
      }
    }
  }
  await Promise.all(Array.from({length: concurrency}, worker));
  return {listed: items.length, visited};
}
