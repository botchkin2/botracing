// The session engine bundled from tools/sessions (scripts/buildEngine.mjs ->
// lib/engine.cjs), loaded on first use: analysis on open (analyzeApi.ts) and
// the staleness test the session route answers with (dataApi.ts).
import {chmodSync, copyFileSync, existsSync} from 'fs';
import {tmpdir} from 'os';
import {join, resolve} from 'path';

export interface Engine {
  analyzeStored(o: {
    backend: unknown;
    sessionId: string;
    owner: string;
    workDir: string;
    log?: (line: string) => void;
  }): Promise<{laps: number}>;
  adminBackend(o: {db: unknown; bucket: unknown}): unknown;
  isStale(
    stamp: unknown,
    analysisVersion: number,
    blockVersions: Record<string, number>,
  ): boolean;
  staleNow(
    session: Record<string, unknown>,
    getDoc: (coll: string, id: string) => Promise<unknown>,
  ): Promise<boolean>;
  analysisVersion: number;
  blockVersions: Record<string, number>;
}

let engine: Engine | undefined;

export function loadEngine(): Engine {
  if (engine) return engine;
  // The DuckDB CLI the deploy ships (bin/duckdb). The zip a deploy uploads may
  // drop the exec bit, so a copy in /tmp runs. duck.mjs reads DUCKDB on load.
  const shipped = resolve(__dirname, '../bin/duckdb');
  if (existsSync(shipped)) {
    const runnable = join(tmpdir(), 'duckdb');
    if (!existsSync(runnable)) {
      copyFileSync(shipped, runnable);
      chmodSync(runnable, 0o755);
    }
    process.env.DUCKDB = runnable;
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  engine = require('./engine.cjs') as Engine;
  return engine;
}

// The curated track docs staleNow reads, kept per instance for a minute: every
// session open would otherwise read both (two reads, ~10-20 ms in region, 200
// ms from a PC; thread 1 #4629). A curator's edit reaches opens within it.
export const TRACK_DOC_TTL_MS = 60_000;
const trackDocs = new Map<string, {at: number; doc: Promise<unknown>}>();

function trackDoc(
  coll: string,
  id: string,
  getDoc: (coll: string, id: string) => Promise<unknown>,
  now = Date.now(),
): Promise<unknown> {
  const key = `${coll}/${id}`;
  const hit = trackDocs.get(key);
  if (hit && now - hit.at < TRACK_DOC_TTL_MS) return hit.doc;
  const doc = getDoc(coll, id);
  trackDocs.set(key, {at: now, doc});
  // A failed read is not kept.
  doc.catch(() => trackDocs.delete(key));
  return doc;
}

/**
 * Whether a stored session needs analysing again under the deployed code and
 * today's curated track. An engine that fails to load must not take the
 * session route down with it: the session reads as fresh, and the error is
 * logged.
 */
export async function sessionStale(
  session: Record<string, unknown>,
  getDoc: (coll: string, id: string) => Promise<unknown>,
): Promise<boolean> {
  try {
    return await loadEngine().staleNow(session, (coll, id) =>
      trackDoc(coll, id, getDoc),
    );
  } catch (error) {
    console.error('staleness not known', error);
    return false;
  }
}
