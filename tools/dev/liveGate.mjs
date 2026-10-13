// The live-laps gate's verdict (tools/dev/liveE2E.mjs): every replayed lap must
// reach the app, each within maxLapS of reaching the disk. Printing the times
// was not enough: 0.1.9 shipped with a 27.9 s first lap the gate only printed
// (pit-wall thread 1 #4958, #4969).

/** latencyMs: lap number (1-based) -> ms from disk to the API's lapCount. */
export function liveVerdict({laps, latencyMs, maxLapS}) {
  const problems = [];
  for (let k = 1; k <= laps; k++) {
    const ms = latencyMs.get(k);
    if (ms == null) problems.push(`lap ${k} never reached the app`);
    else if (ms > maxLapS * 1000)
      problems.push(`lap ${k} took ${(ms / 1000).toFixed(1)} s (limit ${maxLapS} s)`);
  }
  return {pass: problems.length === 0, problems};
}
