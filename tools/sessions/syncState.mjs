// The sync's record of what it has uploaded, kept apart from the logon task's
// and keyed by owner (pit-wall thread 54, #2442). The installed tray keeps its
// own state in %LOCALAPPDATA%\BotRacing\sessions; inside it, a session counts
// as done only for the account that uploaded it, so signing in as someone else
// (or as the real uid after the old uploader wrote as "botkin") sends the
// backlog again instead of skipping it. Pure: sync.mjs does the file I/O.

const DAY_MS = 86_400_000;

/** A day, YYYY-MM-DD, `days` before `now`: the oldest recording a first run uploads. */
export function windowFloor(days, now) {
  return new Date(now.getTime() - days * DAY_MS).toISOString().slice(0, 10);
}

/** The state of a profile that has never synced. A positive `windowDays` bounds its first run. */
export function freshState({windowDays = 0, now = new Date()} = {}) {
  return {
    files: {},
    sessions: {},
    owners: {},
    since: windowDays > 0 ? windowFloor(windowDays, now) : null,
  };
}

/** The owner a session was uploaded for; null for an entry written before owners were recorded. */
export function ownerOf(state, id) {
  return state.owners?.[id] ?? null;
}

/** Records a session as uploaded for `ownerId`. */
export function markDone(state, id, fingerprint, ownerId) {
  state.sessions[id] = fingerprint;
  state.owners ??= {};
  state.owners[id] = ownerId;
}

/**
 * Forgets every session not done for `ownerId`, with its analysis revision and
 * catalog stamp, so the sync counts it as new. An entry with no recorded owner
 * (the old uploader's state) is unknown, so it is forgotten for every owner:
 * the worst case is a session uploaded again to the id it already has, an
 * upsert. Returns how many it forgot.
 */
export function forgetOtherOwners(state, ownerId) {
  let forgotten = 0;
  for (const id of Object.keys(state.sessions)) {
    if (ownerOf(state, id) === ownerId) continue;
    delete state.sessions[id];
    delete state.revs?.[id];
    delete state.stamps?.[id];
    delete state.owners?.[id];
    forgotten++;
  }
  return forgotten;
}

/**
 * The oldest day (YYYY-MM-DD) that still counts, or null for no limit: the
 * state's own window once it has one, else the one a first run is about to
 * get. A state that exists without `since` (the old uploader's, or one whose
 * window was lifted) has no limit.
 */
export function floorOf(state, {windowDays = 0, now = new Date()} = {}) {
  if (state) return state.since ?? null;
  return windowDays > 0 ? windowFloor(windowDays, now) : null;
}
