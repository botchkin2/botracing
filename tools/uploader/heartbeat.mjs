// The uploader's status doc, uploaders/{hostId}, as the app's Settings reads
// it (contract: pit wall thread 30, #456 and #460). Pure, so it is tested
// without Firestore.

// The recorder rewrites its status.json at least every 30 s; older than this
// means it is not running.
export const RECORDER_STALE_SEC = 120;

// watch: the watcher's own state. recorder: tools/capture's status.json, or
// null when there is none.
export function heartbeatDoc({
  hostId,
  version,
  lmuFound,
  state,
  watch,
  queue,
  freeBytes,
  recorder,
  nowMs,
}) {
  return {
    hostId,
    host: hostId,
    version,
    lmuFound,
    state,
    lastSeenAt: new Date(nowMs).toISOString(),
    lastUploadAt: watch.lastUploadAt ?? null,
    lastSessionId: watch.lastSessionId ?? null,
    queue,
    sessionsDone: watch.sessionsDone ?? 0,
    lastError: watch.lastError ?? null,
    disk: {captureBytes: recorder?.captureBytes ?? 0, freeBytes},
    recorder: recorderBlock(recorder, nowMs),
  };
}

function recorderBlock(status, nowMs) {
  if (!status) return null;
  const updated = Date.parse(status.updatedAt);
  const stale = !(nowMs - updated <= RECORDER_STALE_SEC * 1000);
  return {
    state: stale ? 'not-running' : status.state,
    gameVersion: status.gameVersion ?? null,
    layoutOk: status.layoutOk ?? null,
    layoutReason: status.layoutReason ?? null,
    lastChunkAt: status.lastChunkAt ?? null,
    updatedAt: status.updatedAt ?? null,
  };
}

// What changed enough to write now rather than at the next 5-minute beat.
export function beatKey(doc) {
  return JSON.stringify([
    doc.state,
    doc.lmuFound,
    doc.lastUploadAt,
    doc.lastError?.at,
    doc.queue,
    doc.recorder?.state,
    doc.recorder?.layoutOk,
  ]);
}
