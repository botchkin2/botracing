import type {PresetsDoc, PresetsWrite} from '@/src/data/presets';
import type {PresetList} from '@/src/state/presetMerge';

// One sync of the device's presets with the account's (pit-wall thread 104, B2). Pure over its
// deps, so the hook (usePresetSync.ts) is only the triggers and the tests run it against a
// server that follows the real rules (functions/src/fuelPresetsCore.ts).
//
//   read the account's list; merge it into the device's (the store's applyServer: a preset on
//   one side only is kept, a clash keeps both, a tombstone beats an older preset); when the
//   account lacks something, write the whole list with the version it was built on. A write
//   refused as stale (409) gives the current list: merge again and retry. Nothing is applied
//   by replacing, so a change made on the device while a request was out is still there and
//   still pending for the next round.

export type SyncDeps = {
  get(): Promise<PresetsDoc>;
  put(body: PresetsWrite): Promise<{ok: boolean; doc: PresetsDoc}>;
  /** The device's list now, and whether the account lacks something of it. */
  local(): PresetList & {pending: boolean};
  /** Merge a doc of the account into the device's list (sets `pending`). */
  applyServer(doc: PresetsDoc): void;
};

/** Rounds of write and re-merge before it gives up and leaves the rest pending. */
export const MAX_ROUNDS = 5;

/**
 * Brings the device and the account level. Resolves with the account's doc it ended on;
 * throws on a network or server failure (the list stays pending: the caller retries), and
 * when two devices keep changing it for more than MAX_ROUNDS rounds.
 */
export async function syncPresets(deps: SyncDeps): Promise<PresetsDoc> {
  let server = await deps.get();
  for (let round = 0; round < MAX_ROUNDS; round++) {
    deps.applyServer(server);
    const local = deps.local();
    if (!local.pending) return server;
    const written = await deps.put({
      presets: local.presets,
      removed: local.removed,
      baseVersion: server.version,
    });
    server = written.doc;
  }
  deps.applyServer(server);
  if (!deps.local().pending) return server;
  throw new Error('presets: the account kept changing, try again');
}
