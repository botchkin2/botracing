// Drives the recorder refused, kept until they age out (pit wall thread 95).
//
// The recorder's `refused` state lasts only while the game runs, so the
// heartbeat's recorder-layout problem vanished when LMU closed: a Sebring drive
// with no capture (and so no field) left nothing behind. Each refusal is kept
// here, in the watcher's state, as {firstAtMs, lastAtMs, count, reason}, and
// the heartbeat shows it as `capture-missed` for REFUSAL_KEEP_DAYS (the
// capture prune window). Pure, so it is tested without a watcher.

// A refusal after this long a gap is another drive.
export const REFUSAL_GAP_MS = 10 * 60 * 1000;
export const REFUSAL_KEEP_DAYS = 14;
export const MAX_REFUSALS = 5;

// The list after one look at the recorder's status.
export function trackRefusals(list, recorder, nowMs) {
  const keep = nowMs - REFUSAL_KEEP_DAYS * 86400 * 1000;
  const next = list.filter(r => r.lastAtMs >= keep);
  if (recorder?.state === 'refused' && recorder.layoutOk === false) {
    const open = next[next.length - 1];
    const reason = String(recorder.layoutReason ?? 'layout not recognised');
    if (open && nowMs - open.lastAtMs <= REFUSAL_GAP_MS) {
      open.lastAtMs = nowMs;
      open.count += 1;
      open.reason = reason;
    } else {
      next.push({firstAtMs: nowMs, lastAtMs: nowMs, count: 1, reason});
    }
  }
  return next.slice(-MAX_REFUSALS);
}

// The refusal this look opened (a drive's first), to log; null when there is
// none: the same drive, or the list aged out to empty. By start time, because
// the list is capped, so its length can stay the same.
export function newRefusal(prev, next) {
  const newest = next.at(-1);
  if (!newest) return null;
  return newest.firstAtMs !== prev.at(-1)?.firstAtMs ? newest : null;
}
