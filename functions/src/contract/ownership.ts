// Who may write a document through the upload API: the one rule the API
// (uploadCore.ts) and the tools' in-memory store (tools/golden/memoryStore.mjs)
// share, so a write the API refuses fails the tray's tests too (pit wall
// thread 80: heal tombstones without an ownerId passed every test, then 403'd
// on Botkin's PC).

type Doc = Record<string, unknown>;

/** Collections a user writes, each document naming its owner. */
export const OWNED = ['recordings', 'sessions', 'laps'];
/** Shared, read-only to everyone here; written by the admin tools only. */
export const TRACK_DATA = ['tracks', 'trackBoundaries'];

/** An existing document of another owner: never touched, by any op. */
export const isTheirs = (
  existing: Doc | null,
  ownerKey: string,
  coll: string,
): boolean =>
  existing !== null && OWNED.includes(coll) && existing.ownerId !== ownerKey;

/** A set on an owned collection, a merge too, names its writer as the owner. */
export const namesOwner = (coll: string, data: Doc, ownerKey: string) =>
  !OWNED.includes(coll) || data.ownerId === ownerKey;
