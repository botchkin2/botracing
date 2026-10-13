import {createHash} from 'node:crypto';

// The pure parts of the session list: how far back it reads, and the facets
// (games and tracks) that fill the Sessions filter chips. No Firebase here, so
// node tests import it directly.

// A request without an age still stops here, never scanning all history.
export const DEFAULT_AGE_DAYS = 30;

/**
 * The earliest `startedAt` a list reads, or null for no limit. A list for one
 * track or one game with no age (or 0) reads that whole history: the
 * (ownerId, trackId, startedAt) and (ownerId, sim, startedAt) indexes bound
 * it. With neither, no age means the default window.
 */
export function listCutoff(
  opts: {ageDays?: number; trackId?: string; sim?: string},
  now = Date.now(),
): string | null {
  const days = opts.ageDays && opts.ageDays > 0 ? opts.ageDays : null;
  if (days == null && (opts.trackId || opts.sim)) return null;
  return new Date(now - (days ?? DEFAULT_AGE_DAYS) * 86400000).toISOString();
}

export type Facets = {
  games: {sim: string; count: number}[];
  tracks: {
    trackId: string;
    track: string;
    sim: string;
    count: number;
    variant: string;
  }[];
};

/** The name a session stores as `track` ({name, variant}, or a bare string in old docs). */
function trackNameOf(track: unknown, trackId: string): string {
  if (typeof track === 'string' && track) return track;
  const name = (track as {name?: unknown} | null | undefined)?.name;
  return typeof name === 'string' && name ? name : trackId;
}

/** The layout a session stores as `track.variant`, or '' for a bare string or none. */
function variantOf(track: unknown): string {
  const variant = (track as {variant?: unknown} | null | undefined)?.variant;
  return typeof variant === 'string' ? variant : '';
}

/** Counts of sessions per game and per track, from `{sim, trackId, track}` rows.
 * Each track carries its layout (`variant`); the app builds the chip label from it. */
export function foldFacets(
  rows: {sim?: unknown; trackId?: unknown; track?: unknown}[],
): Facets {
  const games = new Map<string, number>();
  const tracks = new Map<
    string,
    {
      trackId: string;
      track: string;
      sim: string;
      count: number;
      variant: string;
    }
  >();
  for (const row of rows) {
    const sim = typeof row.sim === 'string' && row.sim ? row.sim : 'lmu';
    games.set(sim, (games.get(sim) ?? 0) + 1);
    if (typeof row.trackId !== 'string' || !row.trackId) continue;
    const key = `${sim}|${row.trackId}`;
    const t = tracks.get(key) ?? {
      trackId: row.trackId,
      track: trackNameOf(row.track, row.trackId),
      sim,
      count: 0,
      variant: variantOf(row.track),
    };
    t.count += 1;
    tracks.set(key, t);
  }
  return {
    games: [...games].map(([sim, count]) => ({sim, count})),
    tracks: [...tracks.values()],
  };
}

/**
 * The version of an owner's session list: it changes when a session is added,
 * removed or written (count and the newest server stamp `changedAt`), and when
 * the day turns (the default 30-day window slides). It names the owner, so a
 * cached answer of another person never matches. Hosting does not pass
 * If-None-Match to the function, so the client sends this as `?v=` and gets
 * `{unchanged: true}` for two cheap reads instead of every session doc.
 */
export function listVersion(
  owner: string,
  count: number,
  newestChangedAt: string | null,
  now = Date.now(),
): string {
  const day = Math.floor(now / 86400000);
  return createHash('sha1')
    .update(`${owner}|${count}|${newestChangedAt ?? ''}|${day}`)
    .digest('hex')
    .slice(0, 16);
}
