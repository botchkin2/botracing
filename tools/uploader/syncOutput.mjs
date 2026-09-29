// Reads sync.mjs's output, line by line, for the watcher. Pure, so it is
// tested with sample output. sync.mjs prints each session as a block: a line
// starting with its id, then indented lines, "  failed: ..." when it failed,
// and a closing "done N, failed M, unchanged K".

export function newSyncResult() {
  return {sessions: [], failedIds: [], done: 0, failed: 0, errors: []};
}

export function readSyncLine(result, line) {
  const session = line.match(/^([0-9a-f]{16}) /);
  if (session) result.sessions.push(session[1]);
  if (/^\s+failed: /.test(line)) {
    result.errors.push(line.trim());
    const id = result.sessions[result.sessions.length - 1];
    if (id && !result.failedIds.includes(id)) result.failedIds.push(id);
  }
  const end = line.match(/^done (\d+), failed (\d+)/);
  if (end) [result.done, result.failed] = [+end[1], +end[2]];
  return result;
}

// Queued: recordings not yet synced, plus sessions whose last sync failed.
// A failed session's files are already described, so without the second
// term it would read as done (sector, pitlane #565/#566).
export function queueCount({pendingFiles, failedSessions}) {
  return pendingFiles + (failedSessions?.length ?? 0);
}
