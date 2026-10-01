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
