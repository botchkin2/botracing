// "Uploaded" means read back, not sent (pit-wall thread 100, L6; decisions/lap/
// 2026-10-21-no-validation-drops-data.md: a source is never deleted until what
// was derived from it is read back from the store and matches). After a sync
// uploads a session, this reads it back: the session doc, every lap the build
// made, and the field file. Only a verified session lets the tray's cleanup
// delete the captures it read (captureMarker.mjs, desktop prune.rs).

/**
 * Reads `out` (a built session, after store.upload) back through `backend`.
 * `skipped` is what the upload returned when it wrote nothing (superseded,
 * newer).
 * Returns {ok: true, sessionId, laps, fieldHash} or {ok: false, reason}.
 * A session replaced by a heal is checked as its successor: the capture's
 * data lives on there. With no `out` (a capture marked before the read-back
 * existed: `sessionId` names it), the build's laps are not known, so the
 * session must hold at least one lap and its field.
 * A session with no field passes only when the build made none and the stored
 * doc says why (`fieldMissing`, ticket 80): an iRacing qualifying has no field
 * file to read back. A field the build made that is not stored still fails.
 * The reason comes back as `fieldMissing`.
 */
export async function verifyStored(
  backend,
  out,
  {skipped = null, sessionId = null} = {},
) {
  let id = out?.session.id ?? sessionId;
  let stored = await backend.getDoc('sessions', id);
  const replaced = stored?.supersededBy ?? null;
  if (replaced) {
    id = replaced;
    stored = await backend.getDoc('sessions', id);
  }
  if (!stored) return {ok: false, reason: `session ${id} is not in the store`};

  const storedLaps = new Set(await backend.sessionLapIds(id));
  if (replaced || !out) {
    if (storedLaps.size === 0)
      return {ok: false, reason: `session ${id} has no laps`};
  } else {
    const missing = out.laps.filter(lap => !storedLaps.has(lap.id));
    if (missing.length > 0)
      return {
        ok: false,
        reason: `${missing.length} of ${out.laps.length} laps not stored (first ${missing[0].id})`,
      };
  }

  const field = stored.field ?? null;
  if (!field?.path) {
    const why = stored.fieldMissing;
    if (!replaced && !out?.session.field && typeof why === 'string' && why)
      return {
        ok: true,
        sessionId: id,
        laps: out ? out.laps.length : storedLaps.size,
        fieldHash: null,
        fieldMissing: why,
      };
    return {ok: false, reason: `session ${id} has no field`};
  }
  if ((await backend.fileMd5(field.path)) === null)
    return {ok: false, reason: `field file ${field.path} is not in the bucket`};
  // The build's field, when it made one and the upload kept it, must be the
  // one stored. A skipped upload (the cloud's analysis is newer) or a heal
  // successor keeps its own.
  const built = out?.session.field?.hash ?? null;
  const builtPath = out?.session.field?.path ?? null;
  // A field that did not replace the stored one is uploaded beside it
  // (fieldAfterSync). The session keeps the stored hash, so the built hash
  // differs on purpose: `field.aside` is that file. A doc from before `aside`
  // moved off the mark still carries the path on a `smaller` mark. The file
  // has to be in the bucket or the capture never verifies and the 14-day
  // prune deletes it (gauge on #730).
  if (!replaced && built && !skipped && field.hash !== built) {
    const aside =
      field.aside ??
      (field.mark?.kind === 'smaller' ? field.mark.aside : null);
    const asideKept =
      aside &&
      aside === builtPath &&
      (await backend.fileMd5(aside)) !== null;
    if (!asideKept)
      return {
        ok: false,
        reason: `stored field ${field.hash} is not the uploaded ${built}`,
      };
  }

  return {
    ok: true,
    sessionId: id,
    laps: replaced || !out ? storedLaps.size : out.laps.length,
    fieldHash: field.hash ?? null,
  };
}
