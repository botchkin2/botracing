import type {FuelPreset} from './fuelPresets';

// How the device's preset list and the account's meet (pit-wall thread 104, B2). Pure.
//
// Both sides keep a list and a tombstone per removed preset (id -> when it was removed).
// A merge never loses a preset by accident:
//   - an id on one side only is kept (a device-only preset is uploaded, a server-only one is kept);
//   - an id on both with the same content is one preset;
//   - an id on both that differs is merged against a BASE, what this device last saw of the
//     account (`synced`: id -> savedAt): a device that did not edit it just holds an old copy and
//     takes the account's; a device that edited it while the account did not keeps its edit; only
//     when both moved (or there is no base) is it a real conflict, and then the newer `savedAt`
//     keeps the id and the other is kept under a new id, named "... (copy)": neither is deleted;
//   - a removal is a tombstone, and a preset whose `savedAt` is not after its tombstone is gone
//     on both sides: a device that was offline holding a removed preset does not bring it back.
//     A preset saved again after its removal wins over the tombstone.

export type Tombstones = Record<string, string>;
export type PresetList = {presets: FuelPreset[]; removed: Tombstones};

/** The server keeps a tombstone this long (functions/src/fuelPresetsCore.ts TOMBSTONE_DAYS). */
export const TOMBSTONE_DAYS = 90;
const DAY_MS = 86_400_000;

const time = (iso: string) => Date.parse(iso);

const sameContent = (a: FuelPreset, b: FuelPreset) =>
  a.name === b.name &&
  a.length.kind === b.length.kind &&
  a.length.value === b.length.value &&
  a.fuelL === b.fuelL &&
  a.vePct === b.vePct &&
  a.veRatio === b.veRatio &&
  a.formationLap === b.formationLap &&
  a.mandatoryStops === b.mandatoryStops &&
  a.savedAt === b.savedAt;

/** Two lists hold the same presets (in any order) and the same tombstones. */
export function sameList(a: PresetList, b: PresetList): boolean {
  if (a.presets.length !== b.presets.length) return false;
  const other = new Map(b.presets.map(p => [p.id, p]));
  if (!a.presets.every(p => {
    const q = other.get(p.id);
    return q != null && sameContent(p, q);
  }))
    return false;
  const ids = Object.keys(a.removed);
  return (
    ids.length === Object.keys(b.removed).length &&
    ids.every(id => b.removed[id] === a.removed[id])
  );
}

function mergeTombstones(a: Tombstones, b: Tombstones, nowMs: number): Tombstones {
  const out: Tombstones = {};
  for (const id of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const at = [a[id], b[id]].filter((x): x is string => x != null).sort().pop() as string;
    if (nowMs - time(at) <= TOMBSTONE_DAYS * DAY_MS) out[id] = at;
  }
  return out;
}

/** A copy's id from the id and the copy's own save time: the same loser is the same copy each merge. */
const copyId = (p: FuelPreset) => `${p.id}-${time(p.savedAt).toString(36)}`;

/** What a device last saw of the account's presets: id -> the `savedAt` it had. */
export type SyncedBase = Record<string, string>;

/** The base a list of the account gives. */
export const baseOf = (presets: FuelPreset[]): SyncedBase =>
  Object.fromEntries(presets.map(p => [p.id, p.savedAt]));

/**
 * `local` is this device's list, `server` the account's, `base` what the device last saw of
 * the account. Server order first, then what only the device holds. Idempotent: merging a
 * result with either input again gives it back.
 */
export function mergePresets(
  local: PresetList,
  server: PresetList,
  nowMs: number,
  base: SyncedBase = {},
): PresetList {
  const removed = mergeTombstones(local.removed, server.removed, nowMs);
  const alive = (p: FuelPreset) =>
    !(removed[p.id] != null && time(removed[p.id]) >= time(p.savedAt));
  const out = new Map<string, FuelPreset>();
  const put = (p: FuelPreset) => {
    if (!out.has(p.id)) out.set(p.id, p);
  };
  const localById = new Map(local.presets.map(p => [p.id, p]));
  for (const s of server.presets) {
    const l = localById.get(s.id);
    if (l == null || sameContent(l, s)) {
      put(s);
      continue;
    }
    const seen = base[s.id];
    // the device did not edit it, it only holds an older copy: the account's edit
    if (seen != null && l.savedAt === seen) {
      put(s);
      continue;
    }
    // only the device edited it
    if (seen != null && s.savedAt === seen) {
      put(l);
      continue;
    }
    // both moved (or nothing is known): neither is deleted
    const [keep, other] = time(l.savedAt) > time(s.savedAt) ? [l, s] : [s, l];
    put(keep);
    put({...other, id: copyId(other), name: copyName(other.name)});
  }
  for (const l of local.presets) {
    const s = server.presets.find(p => p.id === l.id);
    if (s == null) put(l);
  }
  const presets = [...out.values()].filter(alive);
  // a tombstone a later save has overtaken is not kept
  for (const p of presets)
    if (removed[p.id] != null && time(removed[p.id]) < time(p.savedAt)) delete removed[p.id];
  return {presets, removed};
}

const copyName = (name: string) =>
  name.endsWith(' (copy)') ? name : `${name} (copy)`.slice(0, 80);

/** The list after saving `preset` here: it replaces its id, and a removal of that id is over. */
export function saveIn(list: PresetList, preset: FuelPreset): PresetList {
  const removed = {...list.removed};
  delete removed[preset.id];
  return {
    presets: list.presets.some(p => p.id === preset.id)
      ? list.presets.map(p => (p.id === preset.id ? preset : p))
      : [...list.presets, preset],
    removed,
  };
}

/** The list after removing `id` here: gone, with a tombstone stamped `at` (ISO). */
export function removeFrom(list: PresetList, id: string, at: string): PresetList {
  if (!list.presets.some(p => p.id === id)) return list;
  return {presets: list.presets.filter(p => p.id !== id), removed: {...list.removed, [id]: at}};
}
