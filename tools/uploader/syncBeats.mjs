// The heartbeat writes while a sync child runs: one per progress line, and a
// keep-alive when it prints nothing (a surface fold prints one line per track
// and a track can take minutes). Pure apart from the timers it is given, so
// it is tested with a fake clock.
//
// The heartbeat must never say 'syncing' once the sync is over (steward, pit-wall
// thread 44 #1499), so:
//   - every write goes through one gate: a beat in flight blocks the next one;
//   - stop() is awaited before the caller writes the state that follows the
//     sync, so a late 'syncing' cannot land after it;
//   - runWithBeats stops in a finally, so a throwing sync cannot leave the
//     timer running.

/**
 * `beat(state, force)` writes the doc. Returns {progress, stop}: call
 * progress() on each progress line, and await stop() when the sync is over.
 */
export function syncBeats({
  beat,
  intervalMs,
  log = () => {},
  timers = {setInterval, clearInterval},
}) {
  let stopped = false;
  let inFlight = null;
  const pulse = force => {
    if (stopped || inFlight) return;
    inFlight = beat('syncing', force)
      .catch(error => log(`heartbeat failed: ${String(error)}`))
      .finally(() => {
        inFlight = null;
      });
  };
  const timer = timers.setInterval(() => pulse(true), intervalMs);
  return {
    progress: () => pulse(false),
    stop: async () => {
      stopped = true;
      timers.clearInterval(timer);
      await inFlight;
    },
  };
}

/** Runs `run(progress)` with the beats going, and stops them however it ends. */
export async function runWithBeats(options, run) {
  const beats = syncBeats(options);
  try {
    return await run(beats.progress);
  } finally {
    await beats.stop();
  }
}
