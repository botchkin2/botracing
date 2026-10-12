// What "the analysis has changed" means, in one place: the uploader's watcher
// runs a full sync when its stored key differs, and sync's session fingerprint
// hashes the same key. The watcher compared only analysisVersion, so the
// blockVersions bumps of #195, #196 and #197 never triggered a run: the runtime
// sat at 'waiting-for-game' with no tyres or traffic on any lap (apex, pit-wall
// thread 44 #1530).
//
// Plain JavaScript, no imports.

/** analysisVersion plus every block version, in a fixed order. */
export function versionKey(analysisVersion, blockVersions) {
  const blocks = Object.keys(blockVersions)
    .sort()
    .map(name => `${name}=${blockVersions[name]}`)
    .join(',');
  return `${analysisVersion}|${blocks}`;
}

/**
 * What the session doc records of the rules that made it: `{v, blocks, kept}`.
 * `kept` names the blocks a resync took from the stored doc because their
 * input (the live capture) is gone (keepCapture.mjs); they were made under an
 * older rule and cannot be made again.
 */
export function analysisStamp(analysisVersion, blockVersions, kept = []) {
  return {
    v: analysisVersion,
    blocks: {...blockVersions},
    kept: [...new Set(kept)].sort(),
  };
}

/**
 * Whether a session needs analysing again under these rules: no stamp (every
 * session written before stamps), an older analysis version, or any block
 * older than the code's. A kept block is left out of the test: nothing can
 * bring it up to date, so counting it would re-run the session on every open.
 */
export function isStale(stamp, analysisVersion, blockVersions) {
  if (!stamp || typeof stamp.v !== 'number') return true;
  if (stamp.v < analysisVersion) return true;
  const kept = new Set(stamp.kept ?? []);
  for (const [name, v] of Object.entries(blockVersions)) {
    if (kept.has(name)) continue;
    if (!(stamp.blocks?.[name] >= v)) return true;
  }
  return false;
}

/**
 * The stamp once some blocks were kept from the stored doc: each kept block
 * says the version it was really made under (the stored stamp's, or 0 when
 * the stored doc predates stamps), never the code's.
 */
export function withKept(stamp, kept, storedStamp) {
  if (kept.length === 0) return stamp;
  const blocks = {...stamp.blocks};
  for (const name of kept) blocks[name] = storedStamp?.blocks?.[name] ?? 0;
  return {...stamp, blocks, kept: [...new Set(kept)].sort()};
}

/**
 * Whether the stored stamp is newer than the writer's: the stored analysis
 * version is higher, or a block the stored doc made itself (not kept) is at a
 * higher version than the writer's code. A writer never replaces newer
 * analysis with older (an installed tray behind the cloud, thread 1 #4573).
 * A stored doc without a stamp is never newer.
 */
export function stampNewer(stored, mine) {
  if (!stored || typeof stored.v !== 'number') return false;
  if (!mine || typeof mine.v !== 'number') return true;
  if (stored.v !== mine.v) return stored.v > mine.v;
  const kept = new Set(stored.kept ?? []);
  for (const [name, v] of Object.entries(stored.blocks ?? {})) {
    if (kept.has(name)) continue;
    if (v > (mine.blocks?.[name] ?? 0)) return true;
  }
  return false;
}
