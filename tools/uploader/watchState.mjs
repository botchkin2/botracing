// One sim's sync state in the watcher's state.json: the legacy-layout sim's is
// the top level of the state (the shape before a second sim), the others keep
// theirs under `sims`.
export const FRESH = () => ({retries: {}});

export function stateOf(watch, sim) {
  if (sim.adapter.watcher.legacyLayout) return watch;
  watch.sims ??= {};
  return (watch.sims[sim.id] ??= FRESH());
}

// A watcher that died mid-sync left `syncing` set. Nothing runs at start, so
// every sim's flag is cleared here, and each sim has its state.
export function clearStaleSyncing(watch, sims) {
  for (const sim of sims) stateOf(watch, sim).syncing = false;
}
