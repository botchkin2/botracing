// POST /api/upload/heartbeat: what the server accepts from a PC's uploader
// (the node watcher's beat, tools/uploader/heartbeat.mjs, and the Rust tray's
// failure report, desktop/src-tauri/src/failure_report.rs). One contract for
// both ends: the server validates with it, and the senders' tests put their
// real bodies through it (contract/README.md, roadmap row 0). Its tests run
// on real payloads from trays (contract/payloads/heartbeat), never on
// hand-written bodies: #597 shipped because a test sent gameVersion '1.2', a
// value the tray never sends.
//
// No imports beyond node and problemsCore, so node --test can load it from
// tools/ and contract/ as well as the functions build.

import {redactSecrets} from '../problemsCore.ts';

import {SAFE_SEGMENT} from './segment.ts';

type Json = null | boolean | number | string | Json[] | {[key: string]: Json};

export const HEARTBEAT_STATES = [
  'idle',
  'waiting-for-game',
  'in-game',
  'syncing',
  'retrying',
  'error',
];
export const MAX_HEARTBEAT_BYTES = 8_000;
export const LABEL_MAX = 64;
export const LAYOUT_REASON_MAX = 200;
export const PROBLEM_MESSAGE_MAX = 120;

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown, max: number): v is string =>
  typeof v === 'string' && v.length <= max;
const count = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1e15;
// A time as the app reads it: ISO text, epoch milliseconds, or none.
const when = (v: unknown): boolean =>
  v === null || (typeof v === 'string' && v.length <= 40) || count(v);
const absent = (v: unknown) => v === null || v === undefined;

// What is wrong on the PC now (tools/uploader/heartbeat.mjs problemsOf), for
// the Settings Problems list. Each entry is rebuilt from its known fields, so
// nothing else rides along; the message was scrubbed on the PC.
export const PROBLEM_KINDS = [
  'session-failed',
  'sync-crashed',
  'recorder-layout',
  'uploader-stopped',
  'file-unreadable',
];
export const MAX_PROBLEMS = 10;
// A kind this server does not know yet is a newer tray talking to an older
// server: it is dropped, not refused, so the rest of the status (and the
// PC's heartbeat) still lands. A known kind with a bad field is still a 400.
const unknownKind = (p: unknown): boolean =>
  isObj(p) && typeof p.kind === 'string' && !PROBLEM_KINDS.includes(p.kind);
const optional = (v: unknown, ok: (x: unknown) => boolean) =>
  absent(v) || ok(v);
const problemOk = (p: unknown): boolean =>
  isObj(p) &&
  typeof p.kind === 'string' &&
  PROBLEM_KINDS.includes(p.kind) &&
  when(p.at) &&
  str(p.message, PROBLEM_MESSAGE_MAX) &&
  optional(
    p.sessionId,
    v => typeof v === 'string' && /^[0-9a-f]{16}$/.test(v),
  ) &&
  optional(p.count, count) &&
  optional(p.retryAt, when);
function cleanProblems(v: unknown): Json {
  const all = v as Record<string, unknown>[];
  const known = all.filter(p => !unknownKind(p));
  if (known.length < all.length)
    console.warn(
      `heartbeat: dropped ${
        all.length - known.length
      } problem(s) of an unknown kind: ${all
        .filter(unknownKind)
        .map(p => String(p.kind).slice(0, 32))
        .join(', ')}`,
    );
  return known.map(p => {
    const out: Record<string, Json> = {
      kind: p.kind as string,
      at: (p.at ?? null) as Json,
      message: redactSecrets(p.message as string),
    };
    for (const k of ['sessionId', 'count', 'retryAt'])
      if (!absent(p[k])) out[k] = p[k] as Json;
    return out;
  });
}

// One validator per field the Settings card reads; anything else is dropped
// (the watcher's `sims` and `lastError` ride along unread).
const HEARTBEAT_FIELDS: Record<string, (v: unknown) => boolean> = {
  label: v => str(v, LABEL_MAX),
  version: v => str(v, 32),
  // The version of a downloaded update the tray holds ready to install.
  updateWaiting: v => str(v, 32),
  lmuFound: v => typeof v === 'boolean',
  state: v => typeof v === 'string' && HEARTBEAT_STATES.includes(v),
  lastUploadAt: when,
  lastSessionId: v => v === null || str(v, 64),
  queue: count,
  progress: v =>
    v === null ||
    (isObj(v) &&
      count(v.done) &&
      count(v.total) &&
      (v.phase === undefined || str(v.phase, 32))),
  retryAt: when,
  sessionsDone: count,
  problems: v =>
    Array.isArray(v) &&
    v.length <= MAX_PROBLEMS &&
    v.every(p => unknownKind(p) || problemOk(p)),
  // freeBytes is null when the PC cannot read its free space (watch.mjs
  // statfsSync throws): unknown, not a bad status.
  disk: v =>
    isObj(v) &&
    count(v.captureBytes) &&
    (v.freeBytes === null || count(v.freeBytes)),
  recorder: v =>
    v === null ||
    (isObj(v) &&
      str(v.state, 32) &&
      // The tray's recorder writes LMU's version as the integer the game
      // reports (14200; 0 when it reports none): a string-only check refused
      // every heartbeat sent while LMU recorded (0.1.9, thread 1 #4983).
      (absent(v.gameVersion) ||
        str(v.gameVersion, 64) ||
        (Number.isInteger(v.gameVersion) && count(v.gameVersion))) &&
      (absent(v.layoutOk) || typeof v.layoutOk === 'boolean') &&
      (absent(v.layoutReason) || str(v.layoutReason, LAYOUT_REASON_MAX)) &&
      (absent(v.lastChunkAt) || when(v.lastChunkAt)) &&
      (absent(v.updatedAt) || when(v.updatedAt))),
};
const HEARTBEAT_REQUIRED = ['label', 'version', 'state'];

export type HeartbeatCheck =
  | {ok: true; hostId: string; doc: Record<string, Json>}
  | {ok: false; status: 400 | 413; error: string};

/**
 * The heartbeat body as the server stores it (known fields only, problems
 * rebuilt), or why it is refused. The server adds hostId, the times and the
 * owner itself.
 */
export function checkHeartbeat(body: Record<string, unknown>): HeartbeatCheck {
  const hostId = body.hostId;
  // Part of a document id: the same rule as every other id.
  if (
    typeof hostId !== 'string' ||
    hostId.length > 64 ||
    !SAFE_SEGMENT.test(hostId) ||
    hostId.includes('..')
  )
    return {ok: false, status: 400, error: 'bad hostId'};
  const doc: Record<string, Json> = {};
  for (const [field, valid] of Object.entries(HEARTBEAT_FIELDS)) {
    if (body[field] === undefined) {
      if (HEARTBEAT_REQUIRED.includes(field))
        return {ok: false, status: 400, error: `missing ${field}`};
      continue;
    }
    if (!valid(body[field]))
      return {ok: false, status: 400, error: `bad ${field}`};
    doc[field] =
      field === 'problems' ? cleanProblems(body[field]) : (body[field] as Json);
  }
  if (JSON.stringify(doc).length > MAX_HEARTBEAT_BYTES)
    return {ok: false, status: 413, error: 'status too large'};
  return {ok: true, hostId, doc};
}
