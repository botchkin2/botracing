// GET and PUT /api/fuel-presets: his named fuel-planner rules (src/state/fuelPresets.ts),
// kept per owner so they follow him between the PC and the phone (pit-wall thread 104,
// B2). No Firebase imports, so node --test runs it (functions/test/fuelPresetsCore.test.mjs);
// fuelPresetsApi.ts binds it to Firestore and Auth.
//
// One doc per owner key (the same key every other read resolves, so two sign-ins of one
// person share it): {presets, removed, version, updatedAt}. A write names the version it was
// built on and is refused with the current doc when another device wrote since (compare and
// set, 409); the version is a counter the server increments, so two writes in one
// millisecond cannot collide and no client clock is compared. `removed` holds a tombstone
// per removed preset id, kept 90 days, so a device that was offline and still holds a removed
// preset does not bring it back when it syncs (the merge, src/state/presetMerge.ts).
export const MAX_PRESETS = 50;
export const MAX_TOMBSTONES = 200;
export const TOMBSTONE_DAYS = 90;
const DAY_MS = 86_400_000;

const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/;

export interface PresetDoc {
  id: string;
  name: string;
  length: {kind: 'laps' | 'min'; value: number};
  fuelL: number | null;
  vePct: number;
  veRatio: number | null;
  formationLap: boolean;
  mandatoryStops: number;
  savedAt: string;
}

export interface PresetsDoc {
  presets: PresetDoc[];
  /** preset id -> ISO time it was removed */
  removed: Record<string, string>;
  /** 0 before anything was written; the server adds 1 on each write. */
  version: number;
  /** Display only. */
  updatedAt: string | null;
}

export interface Reply {
  status: number;
  body: Record<string, unknown>;
}

export interface PresetsDeps {
  /** Throws Unauthorized. */
  owner(authorization: string | undefined): Promise<string>;
  read(owner: string): Promise<PresetsDoc | null>;
  /**
   * Writes `next` only when the stored version is `baseVersion` (a missing doc is 0), in
   * one transaction; otherwise gives back what is stored.
   */
  writeIf(
    owner: string,
    baseVersion: number,
    next: PresetsDoc,
  ): Promise<{ok: true} | {ok: false; current: PresetsDoc}>;
  now(): number;
}

const EMPTY: PresetsDoc = {presets: [], removed: {}, version: 0, updatedAt: null};

const isObject = (x: unknown): x is Record<string, unknown> =>
  typeof x === 'object' && x !== null && !Array.isArray(x);
const num = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const isoOk = (x: unknown): x is string =>
  typeof x === 'string' && x.length <= 40 && !Number.isNaN(Date.parse(x));

/** One preset, typed field by field; unknown fields are dropped. Null with the reason. */
export function cleanPreset(raw: unknown): PresetDoc | string {
  if (!isObject(raw)) return 'a preset is not an object';
  const {id, name, length, fuelL, vePct, veRatio, formationLap, mandatoryStops, savedAt} =
    raw;
  if (typeof id !== 'string' || !ID.test(id)) return 'a preset has a bad id';
  if (typeof name !== 'string' || name.trim() === '' || name.length > 80)
    return `preset ${id}: name must be 1 to 80 characters`;
  if (
    !isObject(length) ||
    (length.kind !== 'laps' && length.kind !== 'min') ||
    !num(length.value) ||
    !(length.value > 0) ||
    length.value > 10_000
  )
    return `preset ${id}: bad length`;
  if (fuelL !== null && !(num(fuelL) && fuelL > 0 && fuelL <= 1000))
    return `preset ${id}: bad fuelL`;
  if (!(num(vePct) && vePct >= 0 && vePct <= 100)) return `preset ${id}: bad vePct`;
  if (veRatio !== null && !(num(veRatio) && veRatio > 0 && veRatio <= 10))
    return `preset ${id}: bad veRatio`;
  if (typeof formationLap !== 'boolean') return `preset ${id}: bad formationLap`;
  if (!(num(mandatoryStops) && Number.isInteger(mandatoryStops) && mandatoryStops >= 0 && mandatoryStops <= 20))
    return `preset ${id}: bad mandatoryStops`;
  if (!isoOk(savedAt)) return `preset ${id}: bad savedAt`;
  return {
    id,
    name: name.trim(),
    length: {kind: length.kind, value: length.value},
    fuelL: fuelL as number | null,
    vePct,
    veRatio: veRatio as number | null,
    formationLap,
    mandatoryStops,
    savedAt,
  };
}

/** The tombstones of a request, typed; ones older than 90 days are dropped. */
function cleanRemoved(raw: unknown, nowMs: number): Record<string, string> | string {
  if (!isObject(raw)) return 'removed must be an object of id to time';
  const out: Record<string, string> = {};
  for (const [id, at] of Object.entries(raw)) {
    if (!ID.test(id) || !isoOk(at)) return 'removed has a bad id or time';
    if (nowMs - Date.parse(at) > TOMBSTONE_DAYS * DAY_MS) continue;
    out[id] = at;
  }
  if (Object.keys(out).length > MAX_TOMBSTONES) return 'too many removed presets';
  return out;
}

const bad = (message: string): Reply => ({status: 400, body: {error: message}});

export async function handleFuelPresets(
  deps: PresetsDeps,
  method: string,
  authorization: string | undefined,
  body: unknown,
): Promise<Reply> {
  if (method !== 'GET' && method !== 'PUT')
    return {status: 405, body: {error: 'GET or PUT only'}};
  // Throws Unauthorized: the caller maps it to 401.
  const owner = await deps.owner(authorization);
  if (method === 'GET') return {status: 200, body: {...((await deps.read(owner)) ?? EMPTY)}};

  if (!isObject(body)) return bad('send a JSON body');
  const {presets, removed, baseVersion} = body;
  if (!(num(baseVersion) && Number.isInteger(baseVersion) && baseVersion >= 0))
    return bad('baseVersion must be the version read last (0 when there was none)');
  if (!Array.isArray(presets) || presets.length > MAX_PRESETS)
    return bad(`presets must be a list of at most ${MAX_PRESETS}`);
  const nowMs = deps.now();
  const cleaned: PresetDoc[] = [];
  for (const raw of presets) {
    const preset = cleanPreset(raw);
    if (typeof preset === 'string') return bad(preset);
    if (cleaned.some(p => p.id === preset.id)) return bad(`two presets have the id ${preset.id}`);
    cleaned.push(preset);
  }
  const tombstones = cleanRemoved(removed ?? {}, nowMs);
  if (typeof tombstones === 'string') return bad(tombstones);
  const next: PresetsDoc = {
    presets: cleaned,
    removed: tombstones,
    version: baseVersion + 1,
    updatedAt: new Date(nowMs).toISOString(),
  };
  const done = await deps.writeIf(owner, baseVersion, next);
  if (!done.ok) return {status: 409, body: {...done.current}};
  return {status: 200, body: {...next}};
}
