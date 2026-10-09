// Sends the tray's status to POST /api/upload/heartbeat (chicane #247, marshal
// #236, #249): on a state change and at most every 10 minutes otherwise, never
// on a progress tick, never twice for one host within the server's 30 s, and
// after a 429 only the latest state is kept and sent once the wait is over.
// The server stamps the owner and the time; this sends no identity.
import {readFileSync} from 'node:fs';
import {defaultApi} from '../sessions/storeClient.mjs';

export const KEEP_ALIVE_MS = 10 * 60 * 1000;
/** The server's minimum gap for one host. */
export const MIN_GAP_MS = 30 * 1000;
/** Wait after a failure that carries no Retry-After (offline, 401, 5xx). */
export const FAILURE_WAIT_MS = 60 * 1000;

/** What counts as a change worth a request: not progress, not the queue. */
export function statusKey(doc) {
  return JSON.stringify([
    doc.state,
    doc.lmuFound,
    doc.lastUploadAt,
    doc.lastError?.at,
    doc.retryAt,
    doc.recorder?.state,
    doc.recorder?.layoutOk,
  ]);
}

/** The body: the doc without what the server stamps itself. */
export function bodyOf(doc) {
  const {lastSeenAt: _stamped, ...body} = doc;
  return body;
}

/**
 * send(body) -> {status, retryAfterSec?, reason?}; it may throw (offline).
 * now / setTimer are injectable for the tests. log gets one line per refusal.
 */
export function createHeartbeatSender({
  send,
  now = Date.now,
  setTimer = (fn, ms) => setTimeout(fn, ms).unref?.(),
  log = () => {},
}) {
  let lastKey = null;
  let lastSentAt = -Infinity;
  let notBefore = 0;
  let pending = null;
  let busy = false;
  let timerSet = false;

  const due = doc =>
    statusKey(doc) !== lastKey || now() - lastSentAt >= KEEP_ALIVE_MS;

  const schedule = () => {
    if (timerSet || !pending) return;
    timerSet = true;
    setTimer(() => {
      timerSet = false;
      return attempt();
    }, Math.max(0, notBefore - now()) + 50);
  };

  async function attempt() {
    if (busy || !pending) return;
    if (now() < notBefore) return schedule();
    const doc = pending;
    busy = true;
    try {
      const res = await send(bodyOf(doc));
      if (res.status >= 200 && res.status < 300) {
        lastKey = statusKey(doc);
        lastSentAt = now();
        notBefore = lastSentAt + MIN_GAP_MS;
        if (pending === doc) pending = null;
      } else if (res.status === 429) {
        notBefore = now() + Math.max(1, res.retryAfterSec ?? 30) * 1000;
        // `pending` stays: the latest state goes out after the wait.
      } else {
        log(
          `status not accepted: HTTP ${res.status}${
            res.reason ? ` ${res.reason}` : ''
          }`,
        );
        notBefore = now() + FAILURE_WAIT_MS;
        if (pending === doc) pending = null; // the same body would be refused again
      }
    } catch (error) {
      log(`status not sent: ${String(error.message ?? error)}`);
      notBefore = now() + FAILURE_WAIT_MS;
    } finally {
      busy = false;
    }
    if (pending) schedule();
  }

  return {
    /** The latest status. Sent now, or when it is due, or after a wait. */
    async offer(doc) {
      if (!pending && !due(doc)) return;
      pending = doc;
      await attempt();
    },
  };
}

/** The real send: POST with the tray's current ID token (read per request). */
export function httpSend({
  api = defaultApi,
  tokenFile,
  fetch = globalThis.fetch,
}) {
  return async body => {
    const token = readFileSync(tokenFile, 'utf8').trim();
    const res = await fetch(`${api}/heartbeat`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (res.status === 429) {
      const wait = Number(res.headers.get('retry-after'));
      return {status: 429, retryAfterSec: Number.isFinite(wait) ? wait : 30};
    }
    if (res.ok) return {status: res.status};
    return {status: res.status, reason: (await res.text()).slice(0, 120)};
  };
}
