// Per-session retry backoff. Pure, so it is tested without a sync.
//
// A session that fails waits on its own backoff; every other session, and the
// version resync, carries on (apex #741, scrutineer #742). The map is
// {sessionId: {failures, atMs}}: failures in a row, and when it may run again.
import {retryDelayMin} from './trigger.mjs';

// Ids still waiting at nowMs, for sync.mjs --skip.
export function waitingIds(retries, nowMs) {
  return Object.keys(retries).filter(id => retries[id].atMs > nowMs);
}

// The map after a sync: sessions that failed now get a longer wait, sessions
// that were skipped keep theirs, everything else is done and drops out.
export function nextRetries({retries, failedIds, skippedIds, nowMs}) {
  const next = {};
  for (const id of skippedIds) if (retries[id]) next[id] = retries[id];
  for (const id of failedIds) {
    const failures = (retries[id]?.failures ?? 0) + 1;
    next[id] = {failures, atMs: nowMs + retryDelayMin(failures) * 60 * 1000};
  }
  return next;
}

// When the earliest retry is due, or null with none pending.
export function earliestRetryMs(retries) {
  const times = Object.values(retries).map(r => r.atMs);
  return times.length ? Math.min(...times) : null;
}
