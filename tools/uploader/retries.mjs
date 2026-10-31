// Per-session retry backoff. Pure, so it is tested without a sync.
//
// A session that fails waits on its own backoff; every other session, and the
// version resync, carries on (apex #741, scrutineer #742). The map is
// {sessionId: {failures, atMs, lastAtMs, message}}: failures in a row, when it
// may run again, when it last failed and why (the heartbeat's problems).
import {isTransient} from '../sessions/netRetry.mjs';
import {retryDelayMin} from './trigger.mjs';

// Ids still waiting at nowMs, for sync.mjs --skip.
export function waitingIds(retries, nowMs) {
  return Object.keys(retries).filter(id => retries[id].atMs > nowMs);
}

// The map after a sync: sessions that failed now get a longer wait, sessions
// that were skipped keep theirs, everything else is done and drops out.
export function nextRetries({
  retries,
  failedIds,
  skippedIds,
  messages = {},
  nowMs,
}) {
  const next = {};
  for (const id of skippedIds) if (retries[id]) next[id] = retries[id];
  for (const id of failedIds) {
    const failures = (retries[id]?.failures ?? 0) + 1;
    next[id] = {
      failures,
      atMs: nowMs + retryDelayMin(failures) * 60 * 1000,
      lastAtMs: nowMs,
      message: messages[id] ?? null,
    };
  }
  return next;
}

// When the earliest retry is due, or null with none pending.
export function earliestRetryMs(retries) {
  const times = Object.values(retries).map(r => r.atMs);
  return times.length ? Math.min(...times) : null;
}

// The network came back: a heartbeat the server accepted, sent at `sentAtMs`.
// A failure whose message is a network error (netRetry.mjs isTransient) was the
// network's, not a bad file's, so its wait ends and the next tick retries; the
// whole run's (retryAtMs, failuresInRow) and each session's own. Only a failure
// recorded at or before the beat's send time counts: a beat already in flight
// when a fresh failure lands says nothing about that failure. A failure that is
// not a network one keeps its backoff. `st` is one sim's watcher state; returns
// how many waits it ended.
export function clearNetworkBackoff(st, sentAtMs) {
  let cleared = 0;
  const failedAt = Date.parse(st.lastError?.at ?? '');
  if (
    st.retryAtMs != null &&
    failedAt <= sentAtMs &&
    isTransient({message: st.lastError?.message ?? ''})
  ) {
    st.retryAtMs = null;
    st.failuresInRow = 0;
    cleared++;
  }
  for (const [id, r] of Object.entries(st.retries ?? {})) {
    if (r.lastAtMs <= sentAtMs && isTransient({message: r.message ?? ''})) {
      delete st.retries[id];
      cleared++;
    }
  }
  return cleared;
}
