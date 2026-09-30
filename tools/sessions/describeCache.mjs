// Whether a recording's cached describe() result can be reused. The uploader
// keeps each file's describe output (`info`, with the fuel setup in it) in its
// state so an unchanged file is not read again. That cache was keyed on the
// file's size and time only, so a change to what describe() computes never
// reached files described earlier: #144's fuel setup fix left the LMP2 race on
// "fillLimitL 1980" in production (camber, pit-wall thread 39 #1321). The
// cache entry now also carries the describe version it was made with, and an
// entry from another version is described again.
//
// Plain JavaScript, no imports: sync.mjs and its test both call it.

/**
 * The cached info for a file, or null when it has to be described again.
 * `known` is the state's entry for the file ({size, mtimeMs, info,
 * describeVersion}), `stat` its current size and mtime.
 */
export function reusableInfo(known, stat, describeVersion) {
  if (!known || !known.info) return null;
  if (known.size !== stat.size || known.mtimeMs !== stat.mtimeMs) return null;
  // An entry with no version was made before versions existed: always stale.
  if (known.describeVersion !== describeVersion) return null;
  return known.info;
}
