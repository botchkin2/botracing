import {type SessionSummary} from '@/src/data/sessions';
import {shortTrackName} from '@/src/design';

// The Sessions screen's Game and Track filter. The URL owns it (`?game=&track=`);
// these are the pure parts: which choices exist, and which sessions pass.

export type SessionsFilter = {game: string | null; track: string | null};
export const NO_FILTER: SessionsFilter = {game: null, track: null};

export type FilterChoice = {key: string; label: string; count: number};
export type FilterOptions = {games: FilterChoice[]; tracks: FilterChoice[]};

const GAME_LABEL: Record<string, string> = {lmu: 'LMU', iracing: 'iRacing'};
const gameLabel = (sim: string) => GAME_LABEL[sim] ?? sim;

function tally(
  sessions: SessionSummary[],
  keyOf: (s: SessionSummary) => string,
  labelOf: (s: SessionSummary) => string,
): FilterChoice[] {
  const byKey = new Map<string, FilterChoice>();
  for (const s of sessions) {
    const key = keyOf(s);
    const c = byKey.get(key) ?? {key, label: labelOf(s), count: 0};
    c.count += 1;
    byKey.set(key, c);
  }
  return [...byKey.values()].sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * Games present in the data, and the tracks of the picked game (every game's
 * when none is picked). Only things that exist are offered, so no choice
 * leads to an empty list.
 */
export function filterOptions(
  sessions: SessionSummary[],
  filter: SessionsFilter,
): FilterOptions {
  const inGame = filter.game
    ? sessions.filter(s => s.sim === filter.game)
    : sessions;
  return {
    games: tally(
      sessions,
      s => s.sim,
      s => gameLabel(s.sim),
    ),
    tracks: tally(
      inGame,
      s => s.trackId,
      s => shortTrackName(s.track),
    ),
  };
}

/**
 * The filter that can be applied: a game or track no session has (a stale
 * link) drops out, and a track that is not in the picked game drops too.
 */
export function effectiveFilter(
  sessions: SessionSummary[],
  wanted: SessionsFilter,
): SessionsFilter {
  const game = sessions.some(s => s.sim === wanted.game) ? wanted.game : null;
  const {tracks} = filterOptions(sessions, {game, track: null});
  const track = tracks.some(t => t.key === wanted.track) ? wanted.track : null;
  return {game, track};
}

export function applyFilter(
  sessions: SessionSummary[],
  filter: SessionsFilter,
): SessionSummary[] {
  return sessions.filter(
    s =>
      (!filter.game || s.sim === filter.game) &&
      (!filter.track || s.trackId === filter.track),
  );
}
