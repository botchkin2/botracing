// The uploader's status doc, uploaders/{hostId}, as the app's Settings reads
// it (contract: pit wall thread 30, #456 and #460). Pure, so it is tested
// without Firestore.

import {createHash} from 'node:crypto';

// The endpoint is public (the app has no sign-in), so the doc carries no
// machine name or user paths: a short hash as id, a label from config.
export function hostIdOf(machineName) {
  return createHash('sha1').update(machineName).digest('hex').slice(0, 8);
}

// First line only, with Windows user folders and home paths replaced.
export function scrub(message) {
  return String(message ?? '')
    .split(/\r?\n/)[0]
    .replace(/[A-Za-z]:[\\/]Users[\\/][^\\/\s'"]+/gi, '~')
    .slice(0, 300);
}

// The recorder rewrites its status.json at least every 30 s; older than this
// means it is not running.
export const RECORDER_STALE_SEC = 120;

const iso0 = ms => (ms != null ? new Date(ms).toISOString() : null);

/**
 * Each sim's own part of the heartbeat, so the tray's sim lines say what that
 * sim is doing and not what the whole watcher is: its queue, whether the sync
 * running now is its own (and how far it is), when its earliest failed session
 * is tried again, and its last error. `entries`: [{id, queue, retryAtMs,
 * lastError}]; `syncingSim`: the id of the sim being synced, or null;
 * `progress`: that sync's done/total.
 */
export function simsDoc(entries, syncingSim = null, progress = null) {
  return Object.fromEntries(
    entries.map(e => {
      const syncing = e.id === syncingSim;
      return [
        e.id,
        {
          queue: e.queue,
          syncing,
          progress: syncing ? progress ?? null : null,
          retryAt: iso0(e.retryAtMs ?? null),
          lastError: e.lastError
            ? {at: e.lastError.at ?? null, message: scrub(e.lastError.message)}
            : null,
        },
      ];
    }),
  );
}

// watch: the watcher's own state. recorder: tools/capture's status.json, or
// null when there is none. sims: simsDoc() of each sim.
export function heartbeatDoc({
  hostId,
  label,
  version,
  lmuFound,
  state,
  watch,
  queue,
  progress,
  sims = {},
  freeBytes,
  recorder,
  retryAtMs = null,
  problems = [],
  nowMs,
}) {
  return {
    hostId,
    label,
    version,
    lmuFound,
    state,
    lastSeenAt: new Date(nowMs).toISOString(),
    lastUploadAt: watch.lastUploadAt ?? null,
    lastSessionId: watch.lastSessionId ?? null,
    queue,
    // done/total of the sync running now, else null.
    progress: progress ?? null,
    // Per sim (simsDoc): the tray words each sim's line from its own part.
    sims,
    // When the earliest failed session is tried again, or null with none.
    retryAt: retryAtMs != null ? new Date(retryAtMs).toISOString() : null,
    sessionsDone: watch.sessionsDone ?? 0,
    lastError: watch.lastError
      ? {...watch.lastError, message: scrub(watch.lastError.message)}
      : null,
    disk: {captureBytes: recorder?.captureBytes ?? 0, freeBytes},
    recorder: recorderBlock(recorder, nowMs),
    problems,
  };
}

// A failure message can echo a token or an address from the server (rake
// #3328); the server redacts the same two before it stores them.
export const redact = text =>
  text
    .replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, '<token>')
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '<email>');

export const MAX_PROBLEMS = 10;
export const PROBLEM_MESSAGE_MAX = 120;

const iso = ms => (ms != null ? new Date(ms).toISOString() : null);

// What is wrong on this PC now, for the Settings Problems list (pit-wall
// thread 1 #3327/#3328): a crashed sync, each session waiting on a retry, a
// recorder that stopped writing. Built from the state the watcher keeps, so a
// problem that is fixed is gone from the next beat. Newest first, at most 10;
// messages scrubbed like lastError and cut to 120 characters.
// sims: each sim's watcher state ({lastError, retryAtMs, retries}).
export function problemsOf({sims, recorder, nowMs}) {
  const out = [];
  const message = m => redact(scrub(m)).slice(0, PROBLEM_MESSAGE_MAX);
  for (const st of sims) {
    // A crashed sync waits as a whole (retryAtMs); a finished one does not.
    if (st.retryAtMs != null && st.lastError)
      out.push({
        kind: 'sync-crashed',
        at: st.lastError.at ?? null,
        message: message(st.lastError.message),
        retryAt: iso(st.retryAtMs),
      });
    for (const [sessionId, r] of Object.entries(st.retries ?? {}))
      out.push({
        kind: 'session-failed',
        at: iso(r.lastAtMs ?? null),
        message: message(r.message ?? 'failed'),
        sessionId,
        count: r.failures,
        retryAt: iso(r.atMs),
      });
  }
  const rec = recorder ? recorderBlock(recorder, nowMs) : null;
  if (rec && rec.layoutOk === false)
    out.push({
      kind: 'recorder-layout',
      at: rec.updatedAt,
      message: message(rec.layoutReason ?? 'game data layout not recognised'),
    });
  const t = p => (p.at ? Date.parse(p.at) : 0);
  return out.sort((a, b) => t(b) - t(a)).slice(0, MAX_PROBLEMS);
}

function recorderBlock(status, nowMs) {
  if (!status) return null;
  const updated = Date.parse(status.updatedAt);
  const stale = !(nowMs - updated <= RECORDER_STALE_SEC * 1000);
  return {
    state: stale ? 'not-running' : status.state,
    gameVersion: status.gameVersion ?? null,
    layoutOk: status.layoutOk ?? null,
    layoutReason: status.layoutReason ?? null,
    lastChunkAt: status.lastChunkAt ?? null,
    updatedAt: status.updatedAt ?? null,
  };
}

// The state between syncs. A crash is an error. In game comes before
// retrying: nothing is retried while LMU runs, so a stale retry time would
// mislead (camber #780). After that, failed sessions on a backoff are
// 'retrying' (the app shows when), not an error.
export function idleState({crashed, gameRunning, retryPending}) {
  if (crashed) return 'error';
  if (gameRunning) return 'in-game';
  return retryPending ? 'retrying' : 'waiting-for-game';
}

// What changed enough to write now rather than at the next 5-minute beat.
export function beatKey(doc) {
  return JSON.stringify([
    doc.state,
    doc.lmuFound,
    doc.lastUploadAt,
    doc.lastError?.at,
    doc.queue,
    doc.progress?.done,
    doc.progress?.total,
    doc.progress?.phase,
    doc.retryAt,
    doc.recorder?.state,
    doc.recorder?.layoutOk,
    Object.entries(doc.sims ?? {}).map(([id, s]) => [
      id,
      s.queue,
      s.syncing,
      s.progress?.done,
      s.progress?.total,
      s.retryAt,
      s.lastError?.at,
    ]),
    (doc.problems ?? []).map(p => [p.kind, p.sessionId, p.at]),
  ]);
}
