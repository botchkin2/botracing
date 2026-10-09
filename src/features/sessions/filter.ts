import {
  type SessionFacets,
  type SessionFilter,
  type SessionSummary,
} from '@/src/data/sessions';
import {shortTrackName} from '@/src/design';

// The Sessions screen's Game and Track filter. The URL owns it (`?game=&track=`);
// these are the pure parts: which choices exist, and which sessions pass. The
// choices come from the facets (all history), not from the 30-day list, so an
// old track is pickable; a picked track is fetched on its own, all of its history.

export type SessionsFilter = {game: string | null; track: string | null};
export const NO_FILTER: SessionsFilter = {game: null, track: null};

export type FilterChoice = {key: string; label: string; count: number};
export type FilterOptions = {games: FilterChoice[]; tracks: FilterChoice[]};

const GAME_LABEL: Record<string, string> = {lmu: 'LMU', iracing: 'iRacing'};
const gameLabel = (sim: string) => GAME_LABEL[sim] ?? sim;

const byLabel = (a: FilterChoice, b: FilterChoice) =>
  a.label.localeCompare(b.label);

/**
 * Games present in the data, and the tracks of the picked game (every game's
 * when none is picked). Only things that exist are offered, so no choice
 * leads to an empty list. The same track in two games is one chip.
 */
export function filterOptions(
  facets: SessionFacets,
  filter: SessionsFilter,
): FilterOptions {
  const tracks = new Map<string, FilterChoice>();
  for (const t of facets.tracks) {
    if (filter.game && t.sim !== filter.game) continue;
    const c = tracks.get(t.trackId) ?? {
      key: t.trackId,
      label: shortTrackName(t.track),
      count: 0,
    };
    c.count += t.count;
    tracks.set(t.trackId, c);
  }
  return {
    games: facets.games
      .map(g => ({key: g.sim, label: gameLabel(g.sim), count: g.count}))
      .sort(byLabel),
    tracks: [...tracks.values()].sort(byLabel),
  };
}

/**
 * The filter that can be applied: a game or track nothing was driven in (a
 * stale link) drops out, and a track that is not in the picked game drops too.
 */
export function effectiveFilter(
  facets: SessionFacets,
  wanted: SessionsFilter,
): SessionsFilter {
  const game = facets.games.some(g => g.sim === wanted.game)
    ? wanted.game
    : null;
  const {tracks} = filterOptions(facets, {game, track: null});
  const track = tracks.some(t => t.key === wanted.track) ? wanted.track : null;
  return {game, track};
}

/**
 * What to read: a picked track or game is read on its own, all of its history;
 * the unfiltered list is the server's recent window. A track id already implies
 * its game, so a game on top of a track filters the track's sessions.
 */
export function listQuery(filter: SessionsFilter): SessionFilter {
  if (filter.track) return {trackId: filter.track};
  if (filter.game) return {sim: filter.game};
  return {};
}

/** The sessions of the picked game (a track's list is read whole, whatever the game). */
export function applyGame(
  sessions: SessionSummary[],
  filter: SessionsFilter,
): SessionSummary[] {
  return filter.game ? sessions.filter(s => s.sim === filter.game) : sessions;
}
