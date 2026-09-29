import {type SessionSummary} from '@/src/data/sessions';
import {type TrackInfo} from '@/src/data/tracks';
import {formatDate} from '@/src/design';

// Tracks index: every layout in the game with facts, the ones driven first
// (most recent first), then the rest by name. Not drawn in the handoff; it
// uses the Sessions list's row style.

export type TracksRow = {
  trackId: string;
  name: string;
  place: string;
  /** "14 sessions · 21 Sep 2026", or null when never driven. */
  driven: string | null;
};

export function buildTracksModel(
  catalog: TrackInfo[],
  sessions: SessionSummary[],
): TracksRow[] {
  const byTrack = new Map<string, {count: number; lastAt: string}>();
  for (const s of sessions) {
    const t = byTrack.get(s.trackId) ?? {count: 0, lastAt: ''};
    t.count += 1;
    if (s.startedAt > t.lastAt) t.lastAt = s.startedAt;
    byTrack.set(s.trackId, t);
  }
  const rows = catalog.map(t => {
    const h = byTrack.get(t.trackId);
    return {
      lastAt: h?.lastAt ?? '',
      row: {
        trackId: t.trackId,
        name: t.layout,
        place: [t.place, t.country].filter(Boolean).join(', '),
        driven: h
          ? `${h.count} session${h.count === 1 ? '' : 's'} · ${formatDate(
              h.lastAt,
            )}`
          : null,
      },
    };
  });
  rows.sort(
    (a, b) =>
      b.lastAt.localeCompare(a.lastAt) || a.row.name.localeCompare(b.row.name),
  );
  return rows.map(r => r.row);
}
