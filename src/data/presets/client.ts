import {apiFetch, HttpError} from '../http';

/**
 * One preset as the API carries it: the same shape as the store's `FuelPreset`
 * (src/state/fuelPresets.ts; the data layer does not import state, and the Plan feature's
 * sync types the two against each other).
 */
export type PresetWire = {
  id: string;
  name: string;
  length: {kind: 'laps' | 'min'; value: number};
  fuelL: number | null;
  vePct: number;
  veRatio: number | null;
  formationLap: boolean;
  mandatoryStops: number;
  savedAt: string;
};

/** The account's list (docs/API.md, GET and PUT /api/fuel-presets). */
export type PresetsDoc = {
  presets: PresetWire[];
  /** preset id -> ISO time it was removed */
  removed: Record<string, string>;
  /** The server adds 1 on each write; 0 before the first. */
  version: number;
  updatedAt: string | null;
};

export type PresetsWrite = {
  presets: PresetWire[];
  removed: Record<string, string>;
  /** The version this list was built on. */
  baseVersion: number;
};

const PATH = '/fuel-presets';

export async function fetchPresets(signal?: AbortSignal): Promise<PresetsDoc> {
  const response = await apiFetch(PATH, {signal});
  if (!response.ok) throw new HttpError(response.status, PATH);
  return (await response.json()) as PresetsDoc;
}

/**
 * Writes the list. `ok: false` is the 409 for a write built on an old version, with the
 * current doc to merge into; any other refusal throws.
 */
export async function putPresets(
  body: PresetsWrite,
): Promise<{ok: boolean; doc: PresetsDoc}> {
  const response = await apiFetch(PATH, {
    method: 'PUT',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(body),
  });
  if (response.ok || response.status === 409)
    return {ok: response.ok, doc: (await response.json()) as PresetsDoc};
  throw new HttpError(response.status, PATH);
}
