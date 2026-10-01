// Reads sync.mjs's output, line by line, for the watcher. Pure, so it is
// tested with sample output. sync.mjs prints each session as a block: a line
// starting with its id, then indented lines, "  failed: ..." when it failed,
// and a closing "done N, failed M, unchanged K".

export function newSyncResult() {
  return {
    sessions: [],
    failedIds: [],
    done: 0,
    failed: 0,
    errors: [],
    total: null,
    // The closing "done N, failed M" line was read: the sync ran to its end.
    finished: false,
    // The surface fold that follows the sessions ("surface N/M tracks"), or
    // null before it starts.
    fold: null,
  };
}

export function readSyncLine(result, line) {
  const todo = line.match(/^to do (\d+)$/);
  if (todo) result.total = +todo[1];
  const session = line.match(/^([0-9a-f]{16}) /);
  if (session) result.sessions.push(session[1]);
  if (/^\s+failed: /.test(line)) {
    result.errors.push(line.trim());
    const id = result.sessions[result.sessions.length - 1];
    if (id && !result.failedIds.includes(id)) result.failedIds.push(id);
  }
  const fold = line.match(/^surface (\d+)\/(\d+) tracks$/);
  if (fold) result.fold = {done: +fold[1], total: +fold[2]};
  const end = line.match(/^done (\d+), failed (\d+)/);
  if (end) {
    [result.done, result.failed] = [+end[1], +end[2]];
    result.finished = true;
  }
  return result;
}

// Queued: recordings not yet synced, plus sessions whose last sync failed.
// A failed session's files are already described, so without the second
// term it would read as done (sector, pitlane #565/#566).
export function queueCount({pendingFiles, failedSessions}) {
  return pendingFiles + (failedSessions?.length ?? 0);
}

// Sessions finished so far out of those this sync has to do, or null before
// sync.mjs has said how many. Each session's block is printed once it is
// stored or has failed, so the count of blocks is the progress. Once the
// sessions are done the surface fold takes over, tagged phase 'surface': the
// sessions stay at total/total through a fold that can take many minutes.
export function progressOf(result) {
  if (result.fold) return {...result.fold, phase: 'surface'};
  if (result.total == null) return null;
  return {
    done: Math.min(result.sessions.length, result.total),
    total: result.total,
  };
}
