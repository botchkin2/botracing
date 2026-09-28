// GET /uploaders (pit-wall thread 30 #456): one heartbeat per sim PC that
// runs the uploader. Raw documents stop here; screens see Uploader.

export type UploaderState =
  | 'idle'
  | 'waiting-for-game'
  | 'recording'
  | 'syncing'
  | 'error';

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
  sessionsDone: number;
  lastError: {at: number | null; message: string; path: string | null} | null;
  disk: {captureBytes: number; freeBytes: number} | null;
  /** The shared-memory recorder (thread 30 #460). layoutOk false means the
   *  game changed its struct layout and the recorder stopped writing. */
  recorder: {
    state: string;
    gameVersion: string | null;
    layoutOk: boolean;
    lastChunkAt: number | null;
  } | null;
};

export type UploadersResponse = {items: unknown[]};

const STATES: readonly UploaderState[] = [
  'idle',
  'waiting-for-game',
  'recording',
  'syncing',
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

export function toUploader(raw: unknown): Uploader {
  const x = obj(raw);
  const hostId = str(x.hostId) ?? str(x.id);
  if (!hostId) throw new Error('uploader: missing hostId');
  const state = str(x.state);
  const err = x.lastError == null ? null : obj(x.lastError);
  const disk = x.disk == null ? null : obj(x.disk);
  const rec = x.recorder == null ? null : obj(x.recorder);
  return {
    hostId,
    host: str(x.host) ?? hostId,
    version: str(x.version) ?? '',
    lmuFound: x.lmuFound === true,
    state: STATES.includes(state as UploaderState)
      ? (state as UploaderState)
      : 'idle',
    lastSeenAt: time(x.lastSeenAt),
    lastUploadAt: time(x.lastUploadAt),
    lastSessionId: str(x.lastSessionId),
    queue: num(x.queue) ?? 0,
    sessionsDone: num(x.sessionsDone) ?? 0,
    lastError: err
      ? {
          at: time(err.at),
          message: str(err.message) ?? '',
          path: str(err.path),
        }
      : null,
    disk: disk
      ? {
          captureBytes: num(disk.captureBytes) ?? 0,
          freeBytes: num(disk.freeBytes) ?? 0,
        }
      : null,
    recorder: rec
      ? {
          state: str(rec.state) ?? 'idle',
          gameVersion: str(rec.gameVersion),
          layoutOk: rec.layoutOk !== false,
          lastChunkAt: time(rec.lastChunkAt),
        }
      : null,
  };
}
