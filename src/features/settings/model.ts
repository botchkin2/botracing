import {useMemo} from 'react';

import Constants from 'expo-constants';

import {type Uploader, useUploaders} from '@/src/data/uploaders';

// Settings view model (handoff v2 M5, uploader card). Pure given `now`;
// buildSettingsModel is unit-tested, useSettingsModel wires it to data.

/** Green = seen within 10 min; grey otherwise. Never red (red = slower). */
export type UploaderDot = 'connected' | 'unseen';

export type UploaderCard = {
  hostId: string;
  dot: UploaderDot;
  title: string;
  /** "v0.3.1 · LMU found". */
  subtitle: string;
  /** "Syncing · seen 2 min ago", or "Not seen for 3 days". */
  status: string;
  /** Detail lines, in order; empty ones are left out. */
  lines: string[];
  /** Last error: message, then the path it names. */
  error: {message: string; path: string | null; when: string} | null;
  /** The recorder refuses to write after a game update changed the layout. */
  recorderWarning: string | null;
};

export type SettingsModel = {
  uploaders:
    | {state: 'loading'}
    | {state: 'error'; message: string}
    | {state: 'none'}
    | {state: 'ready'; cards: UploaderCard[]};
  version: string;
};

const SEEN_MS = 10 * 60_000;
// States from tools/capture/recorder.py's status.json (thread 30, #461/#472).
const RECORDER_LABEL: Record<string, string> = {
  recording: 'recording',
  'no-game': 'waiting for LMU',
  waiting: 'waiting for LMU',
  'waiting-for-game': 'waiting for LMU',
  idle: 'idle',
  'not-running': 'not running',
  stopped: 'stopped',
  refused: 'stopped',
};

// The uploader judges the recorder's staleness when it writes the heartbeat
// (state 'not-running'), and the heartbeat is only rewritten every few
// minutes, so the app trusts the state (scrutineer and kerb, #663/#666).
function recorderState(r: NonNullable<Uploader['recorder']>): string {
  return RECORDER_LABEL[r.state] ?? r.state;
}

const STATE_LABEL: Record<Uploader['state'], string> = {
  idle: 'Idle',
  'waiting-for-game': 'Waiting for LMU',
  'in-game': 'In game',
  syncing: 'Syncing',
  retrying: 'Retrying',
  error: 'Error',
};

/** "just now", "4 min", "3 h", "2 days". */
export function formatAgo(thenMs: number, nowMs: number): string {
  const s = Math.max(0, (nowMs - thenMs) / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h} h`;
  return `${Math.floor(h / 24)} days`;
}

/** Local 24-hour clock, "14:05". */
export function formatClock(ms: number): string {
  const d = new Date(ms);
  const two = (n: number) => String(n).padStart(2, '0');
  return `${two(d.getHours())}:${two(d.getMinutes())}`;
}

/** Bytes as "5.0 GB", "830 MB". */
export function formatBytes(bytes: number): string {
  const gb = bytes / 1e9;
  if (gb >= 1) return `${gb.toFixed(gb >= 100 ? 0 : 1)} GB`;
  return `${Math.round(bytes / 1e6)} MB`;
}

export function uploaderCard(u: Uploader, nowMs: number): UploaderCard {
  const seen = u.lastSeenAt != null && nowMs - u.lastSeenAt <= SEEN_MS;
  const ago = (t: number) => {
    const a = formatAgo(t, nowMs);
    return a === 'just now' ? a : `${a} ago`;
  };
  // A failed session waiting on its backoff says when it tries again.
  const stateText =
    u.state === 'retrying' && u.retryAt != null
      ? `Retrying at ${formatClock(u.retryAt)}`
      : STATE_LABEL[u.state];
  const status = seen
    ? `${stateText} · seen ${ago(u.lastSeenAt!)}`
    : u.lastSeenAt == null
    ? 'Not seen yet'
    : `Not seen for ${formatAgo(u.lastSeenAt, nowMs)}`;
  const lines = [
    u.lastUploadAt != null
      ? `Last upload ${ago(u.lastUploadAt)}${
          u.lastSessionId ? ` · session ${u.lastSessionId.slice(0, 8)}` : ''
        }`
      : 'No uploads yet',
    `${u.sessionsDone} session${u.sessionsDone === 1 ? '' : 's'} uploaded${
      u.queue > 0 ? ` · ${u.queue} queued` : ''
    }`,
    u.disk
      ? `Capture ${formatBytes(u.disk.captureBytes)} · ${formatBytes(
          u.disk.freeBytes,
        )} free`
      : '',
    u.recorder && u.recorder.layoutOk
      ? `Recorder ${recorderState(u.recorder)}${
          u.recorder.gameVersion ? ` · LMU ${u.recorder.gameVersion}` : ''
        }`
      : '',
  ].filter(Boolean);
  return {
    hostId: u.hostId,
    dot: seen ? 'connected' : 'unseen',
    title: u.host,
    subtitle: [
      u.version && `v${u.version}`,
      u.lmuFound ? 'LMU found' : 'LMU not found',
    ]
      .filter(Boolean)
      .join(' · '),
    status,
    lines,
    error: u.lastError
      ? {
          message: u.lastError.message,
          path: u.lastError.path,
          when: u.lastError.at != null ? ago(u.lastError.at) : '',
        }
      : null,
    recorderWarning:
      u.recorder && !u.recorder.layoutOk
        ? `Recorder stopped writing${
            u.recorder.gameVersion ? ` on LMU ${u.recorder.gameVersion}` : ''
          }: ${
            u.recorder.layoutReason ??
            'it did not recognise the game data layout'
          }.`
        : null,
  };
}

export function buildSettingsModel(input: {
  uploaders:
    | {state: 'loading'}
    | {state: 'error'; message: string}
    | {state: 'ready'; items: Uploader[]};
  version: string;
  nowMs: number;
}): SettingsModel {
  const u = input.uploaders;
  return {
    uploaders:
      u.state === 'loading' || u.state === 'error'
        ? u
        : u.items.length === 0
        ? {state: 'none'}
        : {
            state: 'ready',
            cards: [...u.items]
              .sort((a, b) => (b.lastSeenAt ?? 0) - (a.lastSeenAt ?? 0))
              .map(x => uploaderCard(x, input.nowMs)),
          },
    version: input.version,
  };
}

export function useSettingsModel(): SettingsModel {
  const q = useUploaders();
  // Re-read on every refetch (each minute), which also moves "seen … ago".
  const nowMs = q.dataUpdatedAt || q.errorUpdatedAt;
  return useMemo(
    () =>
      buildSettingsModel({
        uploaders: q.isPending
          ? {state: 'loading'}
          : q.isError
          ? {
              state: 'error',
              message:
                q.error instanceof Error ? q.error.message : String(q.error),
            }
          : {state: 'ready', items: q.data},
        version: Constants.expoConfig?.version ?? '',
        nowMs,
      }),
    [q.isPending, q.isError, q.error, q.data, nowMs],
  );
}
