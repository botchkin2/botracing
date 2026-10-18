import {basisOf} from '@/src/analysis/lapBasis';
import {spreadShares} from '@/src/analysis/spreadShare';

import {type Lap, type TrackMapData} from './adapters';
import {firstCornerOf, trackCorners} from './corners';
import {defaultSessionOf, openingLapIds} from './defaultLaps';
import {useSession, useSessionLaps, useTrackMapOfSession} from './queries';
import {turnSegmentTimes} from './segments';

/**
 * The first corner of the section holding the most of the set's lap-to-lap
 * spread (analysis/spreadShare.ts), where the Corner tab opens when nothing
 * else says where; null without a map, sections or ten laps. `ticked` is the
 * lap set the Session rows read: the ticked laps, else the comparable ones
 * (`basisOf`, the one rule the screen's rows read too). Pure.
 */
export function topSpreadCorner(
  laps: Lap[],
  map: TrackMapData | null,
  ticked: ReadonlySet<string>,
): number | null {
  if (!map) return null;
  const times = turnSegmentTimes(laps, map);
  if (!times) return null;
  const picked = basisOf(times.laps, ticked);
  const shares = spreadShares(
    times.segments.map((_, i) => picked.map(l => l.timesS[i] ?? null)),
  );
  if (!shares) return null;
  const corners = trackCorners(map);
  for (const s of shares) {
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
  if (!laps.data || !session.data) return null;
  const ticked =
    urlLaps.length > 0
      ? urlLaps
      : openingLapIds(laps.data, defaultSessionOf(session.data));
  return topSpreadCorner(laps.data, map.data ?? null, new Set(ticked));
}
