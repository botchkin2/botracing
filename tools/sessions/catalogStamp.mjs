// Which sessions a remote sync must analyse again because the curated track
// catalog changed under them (pit wall thread 2 #156, #169).
//
// Track data (the corner map and its boundaries) is curated by one person, and
// every user's analysis is cut at it. Two things can happen to a track:
//   (a) it did not have a map when a session was synced (the session has no
//       corner analysis) and now does;
//   (b) the curator edits it, so sessions cut at the old one are stale.
// A session records the stamp of its track as the catalog stood when it was
// analysed. A later sync compares it with the stamp now.
//
// The stamp is per track, never a catalog-wide version: editing one track must
// not send every user's sessions on every other track back through analysis.
import {createHash} from 'node:crypto';
import {mapKeyOf} from './layoutBoundaries.mjs';

/**
 * The state of one track's curated data: 'none' when the catalog has no map for
 * it, otherwise the map version, the boundaries' rev, and a short hash of the
 * map the boundaries belong to (a re-cut map with the same rev still changes it).
 * A curated edit also carries the track's `catalogRev`: it is appended only
 * when it is above 0, so every stamp recorded before curation existed stays
 * valid, and a curated change that moves no boundary (a corner renamed, a map
 * replaced with the same starts) still changes the stamp.
 */
export function catalogStamp(trackMap, boundaries) {
  // A track document with no corners (the curator undid the only map) is no map.
  if (!trackMap || !trackMap.corners?.length) return 'none';
  const key = createHash('sha1')
    .update(mapKeyOf(trackMap.corners ?? []))
    .digest('hex')
    .slice(0, 8);
  const rev = trackMap.catalogRev > 0 ? `:r${trackMap.catalogRev}` : '';
  return `m${trackMap.mapVersion ?? 0}:b${
    boundaries ? boundaries.rev : 'none'
  }:${key}${rev}`;
}

export const DEFAULT_RESYNC_CAP = 25;

/**
 * sessions: [{id, trackId}], newest first. stamps: the stamp each session was
 * analysed under (id -> stamp). current: trackId -> the stamp now.
 * cap: at most this many sessions are sent back through analysis per run.
 *
 * Returns
 *   stale     Set of session ids to analyse again now (the newest, up to cap)
 *   adopt     Map id -> stamp for sessions with no recorded stamp (synced before
 *             stamps existed): they take the stamp as it is now and are NOT
 *             re-analysed, or the first run would send everything back through
 *   deferred  how many more are stale and wait for a later run
 */
export function staleByCatalog({
  sessions,
  stamps,
  current,
  cap = DEFAULT_RESYNC_CAP,
}) {
  const stale = new Set();
  const adopt = new Map();
  let deferred = 0;
  for (const {id, trackId} of sessions) {
    const now = current.get(trackId);
    if (now === undefined) continue;
    const was = stamps[id];
    if (was === undefined) adopt.set(id, now);
    else if (was !== now) {
      if (stale.size < cap) stale.add(id);
      else deferred++;
    }
  }
  return {stale, adopt, deferred};
}
