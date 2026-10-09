// The sync's record of what it has uploaded, kept apart from the logon task's
// and keyed by owner (pit-wall thread 54, #2442). The installed tray keeps its
// own state in %LOCALAPPDATA%\BotRacing\sessions; inside it, a session counts
// as done only for the account that uploaded it, so signing in as someone else
// (or as the real uid after the old uploader wrote as "botkin") sends the
// backlog again instead of skipping it. Pure: sync.mjs does the file I/O.

/**
 * Entries written before owners were recorded belong to whoever the old
 * uploader ran as: its default owner.
 */
export const LEGACY_OWNER = 'botkin';

/** The file the tray menu's "Upload older sessions…" drops in the work folder; the next sync reads it and lifts the window. */
export const OLDER_REQUEST = 'include-older';

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

export function ownerOf(state, id) {
  return state.owners?.[id] ?? LEGACY_OWNER;
}

/** Records a session as uploaded for `ownerId`. */
export function markDone(state, id, fingerprint, ownerId) {
  state.sessions[id] = fingerprint;
  state.owners ??= {};
  state.owners[id] = ownerId;
}

/**
 * Forgets every session done for another owner, with its analysis revision and
 * catalog stamp, so the sync counts it as new. Returns how many it forgot.
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

/** Drops the first-run window: every recording counts from here on. */
export function liftWindow(state) {
  state.since = null;
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
