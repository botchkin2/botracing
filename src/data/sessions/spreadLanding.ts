import {basisOf} from '@/src/analysis/lapBasis';
import {type PooledSession, sectionVary} from '@/src/analysis/sectionVary';

import {type Lap, type TrackMapData} from './adapters';
import {firstCornerOf, trackCorners} from './corners';
import {defaultSessionOf, openingLapIds} from './defaultLaps';
import {useSession, useSessionLaps, useTrackMapOfSession} from './queries';
import {turnSegmentTimes} from './segments';
import {needsPool, useSpreadPool} from './spreadPool';

/**
 * The first corner of the first row of the Session screen's "Varies most"
 * block (analysis/sectionVary.ts, the one ranking both read), where the Corner
 * tab opens when nothing else says where; null without a map, sections or
 * enough laps. `ticked` is the lap set the Session rows read: the ticked laps,
 * else the comparable ones (`basisOf`, the one rule the screen's rows read
 * too); `pool` the earlier sessions a short session borrows. Pure.
 */
export function topSpreadCorner(
  laps: Lap[],
  map: TrackMapData | null,
  ticked: ReadonlySet<string>,
  pool: readonly PooledSession[] = [],
): number | null {
  if (!map) return null;
  const times = turnSegmentTimes(laps, map);
  if (!times) return null;
  const picked = basisOf(times.laps, ticked);
  const vary = sectionVary(
    picked.map(l => ({timesS: l.timesS, offs: l.offs})),
    pool,
    times.segments.length,
  );
  if (!vary) return null;
  const corners = trackCorners(map);
  for (const s of vary.rows) {
    const section = times.segments[s.index].section;
    const corner = section == null ? null : firstCornerOf(corners, section);
    if (corner != null) return corner;
  }
  return null;
}

/**
 * `topSpreadCorner` of an open session, over the laps the URL ticks, else the
 * laps the session opens on (`openingLapIds`: what the Session screen reads
 * when the URL names none); null while it loads.
 */
export function useTopSpreadCorner(
  sessionId: string | null,
  urlLaps: string[],
): number | null {
  const session = useSession(sessionId ?? '', sessionId != null);
  const laps = useSessionLaps(sessionId);
  const map = useTrackMapOfSession(sessionId);
  const pool = useSpreadPool(
    session.data ?? null,
    map.data ?? null,
    laps.data != null && map.data != null && needsPool(laps.data),
  );
  if (!laps.data || !session.data) return null;
  const ticked =
    urlLaps.length > 0
      ? urlLaps
      : openingLapIds(laps.data, defaultSessionOf(session.data));
  return topSpreadCorner(laps.data, map.data ?? null, new Set(ticked), pool);
}
