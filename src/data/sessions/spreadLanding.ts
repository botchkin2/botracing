import {spreadShares} from '@/src/analysis/spreadShare';

import {type Lap, type TrackMapData} from './adapters';
import {firstCornerOf, trackCorners} from './corners';
import {useSessionLaps, useTrackMapOfSession} from './queries';
import {turnSegmentTimes} from './segments';

/**
 * The first corner of the section holding the most of the comparable laps'
 * lap-to-lap spread (analysis/spreadShare.ts), where the Corner tab opens when
 * nothing else says where; null without a map, sections or ten laps. Pure.
 */
export function topSpreadCorner(
  laps: Lap[],
  map: TrackMapData | null,
): number | null {
  if (!map) return null;
  const times = turnSegmentTimes(laps, map);
  if (!times) return null;
  const picked = times.laps.filter(l => l.comparable);
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

/** `topSpreadCorner` of an open session; null while it loads. */
export function useTopSpreadCorner(sessionId: string | null): number | null {
  const laps = useSessionLaps(sessionId);
  const map = useTrackMapOfSession(sessionId);
  return laps.data ? topSpreadCorner(laps.data, map.data ?? null) : null;
}
