// Self-healing step 1 (pit-wall thread 74, #5661/#5667): a game-file build that
// covers a drive the PC already uploaded live is built under the live session's
// id, and the live copy is replaced in place, per stretch. A stored recording is
// replaced only when the build has a recording starting within PAIR_WITHIN_S of
// it (the pairing #627 checks); a stretch the build lacks is the only copy of
// that stretch, so it stays, with its tyres withdrawn when its capture was the
// defective one. What is replaced is tombstoned, not deleted: `supersededBy` on
// the recording and its laps, hidden from reads, kept TOMBSTONE_DAYS so a heal
// can be undone by clearing the field. Pure.

export const PAIR_WITHIN_S = 2;
export const TOMBSTONE_DAYS = 30;
/** What a kept stretch of a defective capture loses (analyzeFromArchive.mjs). */
export const DEFECT = 'mergedWheels';

/**
 * @param {object} p
 * @param {{id: string, recordedAt: string}[]} p.stored  the stored session's recording docs
 * @param {{id: string, recordedAt: string}[]} p.built   the build's recordings
 * @param {{id: string, recordingId?: string}[]} p.laps   the stored session's lap docs
 * @param {string} p.ownerId  the session's owner: the upload API refuses a set, a merge too, that does not name it
 * @param {string} p.nowIso
 * @param {string | null} p.defect  the defect of the capture the stored copy came from; a kept stretch is marked with it
 * @returns {{replaced: Record<string, string>, kept: string[], ops: object[], lapsSuperseded: number}}
 *   `replaced`: stored recording id -> the build's recording that replaces it;
 *   `kept`: stored recordings the build has no stretch for.
 */
export function healPlan({
  stored,
  built,
  laps,
  ownerId,
  nowIso,
  defect = null,
}) {
  const taken = new Set();
  const replaced = {};
  const kept = [];
  for (const rec of stored) {
    // The build's own id: written in place by the upload, nothing to heal.
    if (built.some(b => b.id === rec.id)) continue;
    const at = Date.parse(rec.recordedAt);
    const match = built.find(
      b =>
        !taken.has(b.id) &&
        Math.abs(Date.parse(b.recordedAt) - at) <= PAIR_WITHIN_S * 1000,
    );
    if (match) {
      taken.add(match.id);
      replaced[rec.id] = match.id;
    } else kept.push(rec.id);
  }
  const mark = by => ({ownerId, supersededBy: by, supersededAt: nowIso});
  const ops = Object.entries(replaced).map(([id, by]) => ({
    op: 'set',
    coll: 'recordings',
    id,
    data: mark(by),
    merge: true,
  }));
  let lapsSuperseded = 0;
  for (const lap of laps) {
    const by = replaced[lap.recordingId];
    if (!by || lap.supersededBy) continue;
    ops.push({
      op: 'set',
      coll: 'laps',
      id: lap.id,
      data: mark(by),
      merge: true,
    });
    lapsSuperseded++;
  }
  for (const id of defect ? kept : [])
    ops.push({
      op: 'set',
      coll: 'recordings',
      id,
      data: {ownerId, defects: [defect]},
      merge: true,
    });
  return {replaced, kept, ops, lapsSuperseded};
}

/** A tombstoned doc is hidden from reads and from "leftover" cleanups. */
export const isSuperseded = doc => Boolean(doc?.supersededBy);

/**
 * Whether a tombstone is old enough to be swept (a later job; none runs yet).
 * `listedIds`: every id a live session lists (its recordingIds). Such a doc is
 * never swept, whatever its mark says: a recording marked before #658 can
 * belong to the session that replaced its owner.
 */
export const tombstoneExpired = (doc, nowMs, listedIds) =>
  isSuperseded(doc) &&
  !listedIds.has(doc.id) &&
  nowMs - Date.parse(doc.supersededAt) > TOMBSTONE_DAYS * 86_400_000;

/**
 * Game-file sessions that cover a drive the PC uploaded live from a defective
 * capture (in the full live index, not in the usable one) take that live
 * session's id and carry `healDefect`. Only when it is unambiguous: one live
 * id for the session, and no other session claiming it. `cover(entries, info)`
 * is liveSession.mjs liveCover.
 */
/**
 * A game file whose every recording is covered by one live session is built
 * under that session's id (audit row 13). It does not replace the live
 * recordings; store.mjs adds only the stretches the live copy lacks.
 */
export function claimCoveredSessions(sessions, index, cover) {
  const claimed = [];
  for (const s of sessions) {
    if (s.healDefect || s.healLack) continue;
    const ids = new Set();
    let open = false;
    for (const f of s.files) {
      const hit = cover(index, f.info);
      if (!hit) open = true;
      else ids.add(hit.sessionId);
    }
    if (open || ids.size !== 1) continue;
    const [id] = ids;
    if (s.id === id) continue;
    s.hashId = s.id;
    s.id = id;
    s.healLack = true;
    claimed.push(s);
  }
  return claimed;
}

const spanMs = rec => {
  const at = Date.parse(rec.recordedAt);
  const dur = Number(rec.durationSec ?? rec.durationS ?? 0);
  return {at, end: at + dur * 1000};
};

/** True when two recordings cover the same wall-clock stretch. */
function overlaps(a, b) {
  return a.at < b.end && a.end > b.at;
}

/**
 * Built recordings the stored session has no pair for. A pair is the same id,
 * a start within PAIR_WITHIN_S, or any wall-clock overlap: the shared laps
 * stay the stored ones. The seconds a built recording runs before that overlap
 * are `uncoveredPrefixS` (the 10-21 Sebring files start 52 s and 66 s before
 * the recorder). Those seconds sit inside the first lap, so they are not a
 * recording of their own and are not uploaded here.
 */
export function recordingsToAdd(stored, built) {
  return built.filter(b => {
    if (stored.some(s => s.id === b.id)) return false;
    const span = spanMs(b);
    return !stored.some(s => {
      const other = spanMs(s);
      if (Math.abs(other.at - span.at) <= PAIR_WITHIN_S * 1000) return true;
      return overlaps(span, other);
    });
  });
}

/**
 * The longest head start of a built recording that then overlaps a stored one,
 * in seconds, or null. That head is the part the live copy lacks.
 */
export function uncoveredPrefixS(stored, built) {
  let best = null;
  for (const b of built) {
    const span = spanMs(b);
    let cut = null;
    for (const s of stored) {
      const other = spanMs(s);
      if (!overlaps(span, other) || !(other.at > span.at)) continue;
      cut = cut == null ? other.at : Math.min(cut, other.at);
    }
    if (cut == null) continue;
    const seconds = (cut - span.at) / 1000;
    if (!best || seconds > best.seconds)
      best = {id: b.id, seconds: Math.round(seconds * 10) / 10};
  }
  return best;
}

export function adoptLiveIds(sessions, fullIndex, usableIndex, cover) {
  const defective = Object.fromEntries(
    Object.entries(fullIndex).filter(([key]) => !(key in usableIndex)),
  );
  if (Object.keys(defective).length === 0) return [];
  const claims = new Map();
  for (const s of sessions) {
    if (s.files[0].info.sim !== 'lmu') continue;
    const ids = new Set(
      s.files.map(f => cover(defective, f.info)?.sessionId).filter(Boolean),
    );
    if (ids.size === 1) {
      const [id] = ids;
      claims.set(id, [...(claims.get(id) ?? []), s]);
    }
  }
  const adopted = [];
  for (const [id, list] of claims) {
    if (list.length !== 1) continue;
    list[0].hashId = list[0].id;
    list[0].id = id;
    list[0].healDefect = DEFECT;
    adopted.push(list[0]);
  }
  return adopted;
}

/**
 * A deleted live copy is never resurrected (bearing #5679, guard 2): an
 * adoption whose live session is gone from the store is undone, and the
 * game file builds under its own hash id as before. `exists(id)` reads the
 * store. Returns the adoptions that stand.
 */
export async function confirmAdoptions(adopted, exists) {
  const standing = [];
  for (const s of adopted) {
    if (await exists(s.id)) standing.push(s);
    else {
      s.id = s.hashId;
      delete s.hashId;
      delete s.healDefect;
    }
  }
  return standing;
}

/**
 * The hand rebuilds waiting to be tombstoned (`pending`: {hashId: healedId},
 * kept in the sync state). A failed tombstone stays pending and is tried again
 * on the next sync (bearing #5693); one that went through, or whose session is
 * already gone or superseded, is dropped. `supersede(oldId, byId)` is the
 * store's, returning what it hid or null.
 */
export async function settleSupersedes(pending, supersede, log = () => {}) {
  for (const [oldId, byId] of Object.entries(pending)) {
    try {
      const moved = await supersede(oldId, byId);
      if (moved)
        log(
          `  heal: ${oldId} replaced by ${byId} (${moved.recordings} recording(s), ${moved.laps} lap(s) hidden)`,
        );
      delete pending[oldId];
    } catch (e) {
      log(
        `  heal: ${oldId} not hidden yet, tried again next sync: ${e.message}`,
      );
    }
  }
}

/**
 * Game-file sessions uploaded as a drive's second copy, from before the cover
 * rule saw their live stretch (pit wall thread 98: a recorder that started a
 * minute late split the 2026-10-21 Sebring race and practice). An uploaded
 * session whose recordings one usable live session covers, all of them, is
 * that drive's copy: {hashId: liveId}, for settleSupersedes. `cover` is
 * liveSession.mjs liveCover; `uploaded(id)` reads the sync state.
 */
export function coveredCopies(sessions, liveIndex, cover, uploaded) {
  const copies = {};
  for (const s of sessions) {
    if (!uploaded(s.id)) continue;
    const ids = new Set(
      s.files.map(f => cover(liveIndex, f.info)?.sessionId ?? null),
    );
    if (ids.size !== 1) continue;
    const [id] = ids;
    if (id && id !== s.id) copies[s.id] = id;
  }
  return copies;
}
