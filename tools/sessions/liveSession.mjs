// Live laps (pit-wall thread 66): what the tray writes for a session while it
// is being driven, before any analysis. The capture's laps go up as archive
// parts (lmuCapture.mjs); the session doc carries what the Sessions list shows
// (track, car, type, times, lap count, best lap) and a stamp older than any
// analysis, so the first open analyses it in the cloud (analysis on open).
// Pure: sync.mjs --live reads the capture and uploads; this only shapes docs.
import {existsSync, readFileSync, writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {slugId} from './analyzeFromArchive.mjs';
import {analysisStamp} from './versionKey.mjs';

/** The stamp of a session nobody analysed yet: stale under any rules. */
export const LIVE_STAMP = analysisStamp(0, {});

/**
 * @param {object} input
 * @param {string} input.ownerId
 * @param {string} input.sessionId
 * @param {{id: string, info: object, parts: {lapNumber: number, t0: number, t1: number, lapTimeS?: number|null, partial?: boolean}[]}[]} input.recordings
 *   in order; `info` is the stretch's description (lmuCapture.describeCapture).
 * @param {string} input.nowIso
 */
export function liveSessionDoc({ownerId, sessionId, recordings, nowIso}) {
  const first = recordings[0].info;
  const last = recordings[recordings.length - 1];
  const sim = first.sim;
  // Whole laps the game timed: the out lap and a lap cut by a reset are not.
  const timed = recordings
    .flatMap(r => r.parts)
    .filter(p => !p.partial && p.lapTimeS > 0)
    .map(p => p.lapTimeS);
  const endT = last.parts.length ? last.parts[last.parts.length - 1].t1 : last.info.startT;
  const endMs = Date.parse(last.info.recordedAt) + (endT - last.info.startT) * 1000;
  return {
    id: sessionId,
    ownerId,
    sim,
    trackId: slugId(sim, first.layout),
    track: {name: first.track, variant: first.layoutName ?? first.layout},
    carId: slugId(sim, first.car),
    car: {name: first.car, class: first.carClass},
    sessionType: first.sessionType,
    weather: first.weather ?? '',
    startedAt: first.recordedAt,
    endedAt: new Date(endMs).toISOString(),
    recordingIds: recordings.map(r => r.id),
    archiveParts: recordings.reduce((n, r) => n + r.parts.length, 0),
    lapCount: recordings.reduce((n, r) => n + r.parts.length, 0),
    bestLapTime: timed.length ? Math.min(...timed) : null,
    live: {updatedAt: nowIso},
    analysis: LIVE_STAMP,
    updatedAt: nowIso,
  };
}

/** A recording doc whose archive is stored in parts, one per lap. */
export function liveRecordingDoc({ownerId, sessionId, recording}) {
  const {id, info, parts} = recording;
  const prefix = `archive/${info.sim}/${sessionId}/${id}`;
  return {
    ...info,
    id,
    ownerId,
    sessionId,
    durationSec: parts.length
      ? Math.round((parts[parts.length - 1].t1 - info.startT) * 1000) / 1000
      : 0,
    archive: {
      parts: parts.map((_, i) => ({
        samples: `${prefix}/samples.${partName(i)}.parquet`,
        events: `${prefix}/events.${partName(i)}.parquet`,
      })),
    },
  };
}

export const partName = i => String(i).padStart(3, '0');

// What --live uploaded, by capture stretch: {key: {sessionId, sim, layout,
// startMs, endMs}}. The game-file sync skips a recording a live stretch
// covers, so one drive is one session with the live laps' ids.
export const liveIndexPath = work => resolve(work, 'live', 'index.json');

export function readLiveIndex(work) {
  const path = liveIndexPath(work);
  try {
    return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {};
  } catch {
    return {};
  }
}

export function writeLiveIndex(work, index) {
  writeFileSync(liveIndexPath(work), JSON.stringify(index, null, 1));
}

/**
 * The live stretch covering a game recording, or null: same sim and layout,
 * and the recording starts within the stretch (the game file and the capture
 * open on the same realtime flag, ~2 s apart, lmuCapture.mjs).
 */
export function liveCover(index, info, slackMs = 15_000) {
  const start = Date.parse(info.recordedAt);
  for (const span of Object.values(index)) {
    if (span.sim !== info.sim || span.layout !== info.layout) continue;
    if (start >= span.startMs - slackMs && start <= span.endMs) return span;
  }
  return null;
}
