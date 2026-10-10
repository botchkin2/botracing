// A phone that reopens the app draws the track map and the Plan at once, from
// the last answer it had, then checks with the server (thread 1 #3638/#3639).
// HTTP caching cannot do it: Firebase Hosting turns our `private, max-age` into
// `private` and does not pass If-None-Match on, so every reopen was a full
// fetch. Only these queries are kept: a layout's map and surface (shared app
// data) and the Plan's one answer (the signed-in person's own), never laps or
// traces. The snapshot names its owner and its version; another person, an
// old version or an old snapshot is dropped, not shown.
import {
  dehydrate,
  hydrate,
  type QueryClient,
  type QueryKey,
} from '@tanstack/react-query';

/** Bump when a kept query's data shape changes: the old snapshot is dropped. */
export const PERSIST_VERSION = 1;
const STORAGE_KEY = 'query-cache';
/** A snapshot older than this is dropped rather than drawn. */
export const MAX_AGE_MS = 7 * 24 * 60 * 60_000;
/** Writes wait for the cache to settle. */
const WRITE_DELAY_MS = 2_000;

export type KeyValueStore = {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
  removeItem: (key: string) => Promise<void>;
};

/** The queries a reopen draws from: a layout's map and surface, and the Plan. */
export function isPersisted(key: QueryKey): boolean {
  if (key[0] === 'tracks') return key[2] === 'map' || key[2] === 'surface';
  return key[0] === 'sessions' && key[1] === 'plan';
}

type Snapshot = {v: number; uid: string; savedAt: number; state: unknown};

/** The kept queries that have data, as one string for the store. */
export function snapshotOf(client: QueryClient, uid: string, now: number): string {
  const state = dehydrate(client, {
    shouldDehydrateQuery: q =>
      isPersisted(q.queryKey) && q.state.status === 'success',
  });
  const snap: Snapshot = {v: PERSIST_VERSION, uid, savedAt: now, state};
  return JSON.stringify(snap);
}

/**
 * Puts a snapshot back into the cache when it is this version, this person's
 * and recent. Its queries keep their old fetch time, so a screen that mounts
 * refetches them once they are stale, and newer data already in the cache is
 * never replaced. Returns whether anything was restored.
 */
export function restoreSnapshot(
  client: QueryClient,
  raw: string | null,
  uid: string,
  now: number,
): boolean {
  if (!raw) return false;
  let snap: Snapshot;
  try {
    snap = JSON.parse(raw) as Snapshot;
  } catch {
    return false;
  }
  if (
    snap?.v !== PERSIST_VERSION ||
    snap.uid !== uid ||
    typeof snap.savedAt !== 'number' ||
    now - snap.savedAt > MAX_AGE_MS
  )
    return false;
  hydrate(client, snap.state as Parameters<typeof hydrate>[1]);
  return true;
}

/**
 * The stored snapshot, read once at launch so it is in hand by the time
 * sign-in resolves (an unreadable store is an empty one).
 */
export async function loadSnapshot(store: KeyValueStore): Promise<string | null> {
  try {
    return await store.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

/**
 * Puts this person's snapshot `raw` back, at once (before the screens fetch,
 * so they draw from it), then keeps it up to date while they stay signed in.
 * Returns the stop function; `forgetQueryPersist` drops the stored snapshot
 * (sign-out, another person).
 */
export function startQueryPersist(
  client: QueryClient,
  store: KeyValueStore,
  uid: string,
  raw: string | null,
  now: () => number = Date.now,
): () => void {
  restoreSnapshot(client, raw, uid, now());
  let timer: ReturnType<typeof setTimeout> | null = null;
  const unsubscribe = client.getQueryCache().subscribe(event => {
    if (event.type !== 'updated' || !isPersisted(event.query.queryKey)) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      store.setItem(STORAGE_KEY, snapshotOf(client, uid, now())).catch(() => {
        // A full or blocked store only costs the next reopen its head start.
      });
    }, WRITE_DELAY_MS);
  });
  return () => {
    if (timer) clearTimeout(timer);
    unsubscribe();
  };
}

export async function forgetQueryPersist(store: KeyValueStore): Promise<void> {
  try {
    await store.removeItem(STORAGE_KEY);
  } catch {
    // Nothing kept, or nothing to remove.
  }
}
