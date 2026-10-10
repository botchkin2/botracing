// GET /uploaders (pit-wall thread 30 #456): one heartbeat per sim PC that
// runs the uploader. Raw documents stop here; screens see Uploader.

export type UploaderState =
  | 'idle'
  | 'waiting-for-game'
  | 'in-game'
  | 'syncing'
  | 'retrying'
  | 'error';

/**
 * What is wrong on a PC now (pit-wall thread 1 #3327): a session that failed
 * and waits on a retry, a crashed sync, a recorder that stopped writing (all
 * from its heartbeat), or not seen for days (the server adds that one).
 */
export type UploaderProblemKind =
  | 'session-failed'
  | 'sync-crashed'
  | 'recorder-layout'
  | 'uploader-stopped'
  | 'not-seen';

export type UploaderProblem = {
  kind: UploaderProblemKind;
  /** Epoch ms it last happened (not-seen: when the PC was last seen). */
  at: number | null;
  message: string;
  sessionId: string | null;
  /** Failures in a row, for a session. */
  count: number | null;
  retryAt: number | null;
};

export type Uploader = {
  hostId: string;
  host: string;
  version: string;
  lmuFound: boolean;
  state: UploaderState;
  /** Epoch ms. */
  lastSeenAt: number | null;
  lastUploadAt: number | null;
  lastSessionId: string | null;
  queue: number;
  /**
   * Sessions done of total during a resync (uploader heartbeat, #90); null
   * otherwise. phase 'surface' is the track-surface fold after the sessions
   * (done of total tracks); absent while sessions are being analysed.
   */
  progress: {done: number; total: number; phase?: 'surface'} | null;
  /** Epoch ms the earliest failed session is tried again; null with none. */
  retryAt: number | null;
  sessionsDone: number;
  /** Newest first, as the PC sent them; unknown kinds are dropped. */
  problems: UploaderProblem[];
  disk: {captureBytes: number; freeBytes: number} | null;
  /** The shared-memory recorder (thread 30 #460). layoutOk false means the
   *  game changed its struct layout and the recorder stopped writing. */
  recorder: {
    state: string;
    gameVersion: string | null;
    layoutOk: boolean;
    /** Why the recorder refused to write, when it did. */
    layoutReason: string | null;
    lastChunkAt: number | null;
    /** When the recorder last wrote its status (freshness). */
    updatedAt: number | null;
  } | null;
};

export type UploadersResponse = {items: unknown[]};

const STATES: readonly UploaderState[] = [
  'idle',
  'waiting-for-game',
  'in-game',
  'syncing',
  'retrying',
  'error',
];

const obj = (v: unknown): Record<string, unknown> =>
  v != null && typeof v === 'object' ? (v as Record<string, unknown>) : {};
const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
// Timestamps arrive as ISO strings or epoch ms.
const time = (v: unknown): number | null => {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const t = Date.parse(v);
    return Number.isNaN(t) ? null : t;
  }
  return null;
};

const PROBLEM_KINDS: readonly UploaderProblemKind[] = [
  'session-failed',
  'sync-crashed',
  'recorder-layout',
  'uploader-stopped',
  'not-seen',
];

function toProblems(v: unknown): UploaderProblem[] {
  if (!Array.isArray(v)) return [];
  return v.flatMap(raw => {
    const p = obj(raw);
    const kind = str(p.kind) as UploaderProblemKind | null;
    if (!kind || !PROBLEM_KINDS.includes(kind)) return [];
    return [
      {
        kind,
        at: time(p.at),
        message: str(p.message) ?? '',
        sessionId: str(p.sessionId),
        count: num(p.count),
        retryAt: time(p.retryAt),
      },
    ];
  });
}

function toProgress(v: unknown): Uploader['progress'] {
  if (v == null) return null;
  const p = obj(v);
  const done = num(p.done);
  const total = num(p.total);
  // A finished resync (done = total) is not in progress; drop a stale one.
  if (done == null || total == null || done >= total) return null;
  return p.phase === 'surface'
    ? {done, total, phase: 'surface'}
    : {done, total};
}

export function toUploader(raw: unknown): Uploader {
  const x = obj(raw);
  const hostId = str(x.hostId) ?? str(x.id);
  if (!hostId) throw new Error('uploader: missing hostId');
  const state = str(x.state);
  const disk = x.disk == null ? null : obj(x.disk);
  const rec = x.recorder == null ? null : obj(x.recorder);
  return {
    hostId,
    // A label from the uploader's config ("Race PC"); hostId is a hash.
    host: str(x.label) ?? hostId,
    version: str(x.version) ?? '',
    lmuFound: x.lmuFound === true,
    state: STATES.includes(state as UploaderState)
      ? (state as UploaderState)
      : 'idle',
    lastSeenAt: time(x.lastSeenAt),
    lastUploadAt: time(x.lastUploadAt),
    lastSessionId: str(x.lastSessionId),
    queue: num(x.queue) ?? 0,
    progress: toProgress(x.progress),
    retryAt: time(x.retryAt),
    sessionsDone: num(x.sessionsDone) ?? 0,
    problems: toProblems(x.problems),
    disk: disk
      ? {
          captureBytes: num(disk.captureBytes) ?? 0,
          freeBytes: num(disk.freeBytes) ?? 0,
        }
      : null,
    recorder: rec
      ? {
          state: str(rec.state) ?? 'idle',
          // The game reports its version as a number.
          gameVersion:
            str(rec.gameVersion) ??
            (num(rec.gameVersion) != null ? String(rec.gameVersion) : null),
          layoutOk: rec.layoutOk !== false,
          layoutReason: str(rec.layoutReason),
          lastChunkAt: time(rec.lastChunkAt),
          updatedAt: time(rec.updatedAt),
        }
      : null,
  };
}
