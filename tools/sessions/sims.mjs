// The sims the uploader knows. Each adapter is the only per-sim table
// (pit-wall thread 54): watch.mjs and sync.mjs take this list and do not
// keep a second copy of folders, recording suffixes, or game exes.
import * as lmu from './lmu.mjs';
import * as iracing from './iracing.mjs';

const byId = {lmu, iracing};

export const adapters = Object.freeze({lmu, iracing});

export function adapter(id) {
  const a = byId[id];
  if (!a) throw new Error(`unknown sim "${id}"`);
  return a;
}

// LMU_TELEMETRY is only LMU. An iRacing sync with that env set still uses
// the iRacing default folder (PR 311).
export function telemetryFolder(id, env = process.env) {
  const a = adapter(id);
  if (id === 'lmu' && env.LMU_TELEMETRY) return env.LMU_TELEMETRY;
  return a.defaultFolder;
}
